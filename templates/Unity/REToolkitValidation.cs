// Injected only into a disposable staging project. Target Editor code is untrusted.
// Uses public APIs shared by Unity 2022.3 and Unity 6000; never saves or plays.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace REToolkit
{
    public static class EditorValidation
    {
        const int MaxEntries = 10000;
        const int MaxObjects = 200000;
        const int MaxProperties = 2000000;
        const int MaxDiagnostics = 1000;
        const int MaxReportBytes = 16 * 1024 * 1024;
        const int MaxReflectedTypes = 1024;
        const int MaxObservationMilliseconds = 240000;
        const string ScanPolicy = "reference-scan-v2";

        [Serializable] public sealed class Entry { public string assetId; public string path; public string kind; }
        [Serializable] public sealed class Request
        {
            public string kind; public int schemaVersion; public string runId; public string graphRevision;
            public string unityVersion; public string scanPolicy; public Entry[] scripts; public Entry[] assets; public bool dataCapture;
        }
        [Serializable] public sealed class Compilation { public string state = "failed"; }
        [Serializable] public sealed class ScriptObservation
        {
            public string assetId; public string path; public string guid; public string fileID;
            public string fullName; public string assembly; public bool resolved; public string classification = "unresolved";
            public List<string> nonAttachableTypes;
        }
        [Serializable] public sealed class TraversalPolicy { public string policy = ScanPolicy; }
        [Serializable] public sealed class AssetTraversal
        {
            public bool complete; public int objects; public int properties; public int skippedSubtrees;
            public string stopReason = "interrupted"; public string objectPath = ""; public string componentType = ""; public string propertyPath = "";
        }
        [Serializable] public sealed class AssetObservation
        {
            public string assetId; public string path; public string kind; public bool loaded;
            public int missingScripts; public int missingReferences;
            public AssetTraversal traversal = new AssetTraversal();
            public DataSnapshot data;
        }
        [Serializable] public sealed class DataProperty { public string path; public string kind; public string type; public string value; }
        [Serializable] public sealed class DataObject
        {
            public string guid; public string fileID; public string fullName; public string assembly;
            public bool scriptable; public bool complete = true;
            public List<DataProperty> properties = new List<DataProperty>();
        }
        [Serializable] public sealed class DataSnapshot
        {
            public string policy = "scriptable-data-v2"; public bool complete;
            public int unsupportedProperties; public List<DataObject> objects = new List<DataObject>();
        }
        [Serializable] public sealed class Diagnostic { public string severity; public string message; public string path; }
        [Serializable] public sealed class Report
        {
            public string kind = "retoolkit-unity-observation"; public int schemaVersion = 1;
            public string runId; public string graphRevision; public string unityVersion;
            public bool complete = false; public Compilation compilation = new Compilation();
            public TraversalPolicy traversal = new TraversalPolicy();
            public List<ScriptObservation> scripts = new List<ScriptObservation>();
            public List<AssetObservation> assets = new List<AssetObservation>();
            public List<Diagnostic> diagnostics = new List<Diagnostic>();
        }

        sealed class LimitException : Exception
        {
            public readonly string code;
            public LimitException(string message, string reason = "asset_error") : base(message) { code = reason; }
        }
        sealed class Observer
        {
            public readonly Report report = new Report();
            public string currentPath = ""; public bool errors;
            public Action checkpoint;
            public bool dataCapture;
            int dataProperties; long dataBytes;
            int errorCount;
            Dictionary<string, string> compilerSources;
            readonly System.Diagnostics.Stopwatch elapsed = System.Diagnostics.Stopwatch.StartNew();
            void Deadline()
            {
                if (elapsed.ElapsedMilliseconds >= MaxObservationMilliseconds)
                    throw new LimitException("Observation time budget reached; remaining assets were not scanned.", "interrupted");
            }
            public void Diagnostic(string severity, string message, string assetPath = "")
            {
                if (severity == "error") report.complete = false;
                if (severity == "error") { errors = true; errorCount++; }
                if (report.diagnostics.Count >= MaxDiagnostics) { errors = true; report.complete = false; return; }
                report.diagnostics.Add(new Diagnostic { severity = severity, message = Clip(message, 8192), path = assetPath });
            }
            public void Log(string message, string trace, LogType type)
            {
                // Never log from the callback: target import/execute callbacks can themselves emit errors.
                if (type == LogType.Error || type == LogType.Exception || type == LogType.Assert) Diagnostic("error", message, currentPath);
                else if (type == LogType.Warning) Diagnostic("warning", message, currentPath);
            }
            public void ObjectBudget(AssetObservation row)
            {
                Deadline();
                if (row.traversal.objects >= MaxObjects) throw new LimitException("Unity object traversal limit reached.", "object_limit");
                row.traversal.objects++;
            }
            public void References(UnityEngine.Object target, AssetObservation row)
            {
                row.traversal.componentType = Location(target.GetType().FullName);
                row.traversal.propertyPath = "";
                ObjectBudget(row);
                DataObject dataObject = null;
                if (row.data != null)
                {
                    if (row.data.objects.Count >= 10000) throw new LimitException("Data object budget reached.", "object_limit");
                    string guid; long localId;
                    if (!AssetDatabase.TryGetGUIDAndLocalFileIdentifier(target, out guid, out localId) || String.IsNullOrEmpty(guid))
                        throw new LimitException("Stored object identity could not be observed.");
                    var type = target.GetType();
                    var item = new DataObject { guid = guid, fileID = localId.ToString(CultureInfo.InvariantCulture), fullName = type.FullName, assembly = type.Assembly.GetName().Name, scriptable = target is ScriptableObject };
                    row.data.objects.Add(item);
                    if (item.scriptable) dataObject = item;
                }
                using (var serialized = new SerializedObject(target))
                {
                    var property = serialized.GetIterator();
                    // IDs are scoped to this SerializedObject, not shared across components/assets.
                    var managedIds = new HashSet<long>();
                    bool enterChildren = true;
                    while (property.Next(enterChildren))
                    {
                        row.traversal.propertyPath = Location(property.propertyPath);
                        Deadline();
                        if (row.traversal.properties >= MaxProperties) throw new LimitException("Serialized property traversal limit reached.", "property_limit");
                        row.traversal.properties++;
                        enterChildren = true;
                        // Only known primitive payload arrays are reference-free. Never infer this
                        // from Generic alone: structs/lists may contain object or managed references.
                        // Object references are atomic GUID/local-ID values. Their serialized
                        // pointer children are implementation details, not referenced object data.
                        // Keep capturing/checking the parent below, then advance to its sibling.
                        if (property.propertyType == SerializedPropertyType.ObjectReference ||
                            property.propertyType == SerializedPropertyType.String ||
                            (dataObject == null && ReferenceFreeArray(property))) enterChildren = false;
                        else if (property.propertyType == SerializedPropertyType.ManagedReference)
                        {
                            long id = property.managedReferenceId;
                            if (id >= 0 && !managedIds.Add(id)) enterChildren = false;
                        }
                        if (!enterChildren) row.traversal.skippedSubtrees++;
                        if (dataObject != null)
                        {
                            var value = CaptureValue(property);
                            string propertyPath = property.propertyPath, propertyType = property.type, kind = property.propertyType.ToString();
                            if (++dataProperties > 100000 || propertyPath.Length > 2048 || propertyType.Length > 512)
                                throw new LimitException("Data property budget reached.", "property_limit");
                            // Worst-case JSON escaping, including arbitrary target strings.
                            dataBytes += 128L + 6L * (propertyPath.Length + propertyType.Length + kind.Length + (value == null ? 0 : value.Length));
                            if (dataBytes > 8L * 1024 * 1024) throw new LimitException("Data byte budget reached.", "property_limit");
                            if (value == null) { dataObject.complete = false; row.data.unsupportedProperties++; }
                            dataObject.properties.Add(new DataProperty { path = propertyPath, kind = kind, type = propertyType, value = value });
                        }
                        // A null script pointer can have instance ID zero. It is
                        // still an unresolved ScriptableObject binding, not an
                        // ordinary optional null object reference.
                        if (row.kind == "asset" && target is ScriptableObject &&
                            property.propertyType == SerializedPropertyType.ObjectReference &&
                            property.propertyPath == "m_Script" && property.objectReferenceValue == null)
                        {
                            if (row.missingScripts >= MaxObjects) throw new LimitException("Missing script count limit reached.", "object_limit");
                            row.missingScripts++;
                        }
                        if (property.propertyType == SerializedPropertyType.ObjectReference &&
                            property.objectReferenceValue == null && property.objectReferenceInstanceIDValue != 0)
                        {
                            if (row.missingReferences >= MaxObjects) throw new LimitException("Missing reference count limit reached.", "object_limit");
                            row.missingReferences++;
                        }
                    }
                }
            }
            public void Hierarchy(GameObject root, AssetObservation row)
            {
                var pending = new Stack<Transform>();
                pending.Push(root.transform);
                while (pending.Count != 0)
                {
                    var transform = pending.Pop();
                    var gameObject = transform.gameObject;
                    row.traversal.objectPath = ObjectPath(transform);
                    References(gameObject, row);
                    int missing = GameObjectUtility.GetMonoBehavioursWithMissingScriptCount(gameObject);
                    if (missing > MaxObjects - row.missingScripts) throw new LimitException("Missing component count limit reached.", "object_limit");
                    row.missingScripts += missing;
                    foreach (var component in gameObject.GetComponents<Component>()) if (component != null) References(component, row);
                    if (transform.childCount > MaxObjects - pending.Count) throw new LimitException("Hierarchy traversal limit reached.", "object_limit");
                    for (int index = transform.childCount - 1; index >= 0; index--) pending.Push(transform.GetChild(index));
                }
            }
            public void Script(Entry entry)
            {
                var row = new ScriptObservation { assetId = entry.assetId, path = entry.path };
                report.scripts.Add(row);
                Deadline();
                var script = AssetDatabase.LoadAssetAtPath<MonoScript>(entry.path);
                if (script == null) { Diagnostic("error", "Requested MonoScript could not be loaded.", entry.path); return; }
                string guid; long localId;
                if (!AssetDatabase.TryGetGUIDAndLocalFileIdentifier(script, out guid, out localId))
                { Diagnostic("error", "Requested MonoScript identity could not be observed.", entry.path); return; }
                row.guid = guid;
                row.fileID = localId.ToString(CultureInfo.InvariantCulture);
                var type = script.GetClass();
                if (type == null)
                {
                    if (compilerSources == null) compilerSources = CompilerSources();
                    string expected = Path.GetFullPath(Path.Combine(Directory.GetParent(Application.dataPath).FullName, entry.path));
                    compilerSources.TryGetValue(expected, out row.assembly);
                    if (!String.IsNullOrEmpty(row.assembly)) row.classification = "compiled-source";
                    else Diagnostic("warning", "MonoScript.GetClass returned no compiled type and compiler source membership was not confirmed.", entry.path);
                    return;
                }
                row.fullName = type.FullName;
                row.assembly = type.Assembly.GetName().Name;
                row.resolved = !String.IsNullOrEmpty(row.fullName) && !String.IsNullOrEmpty(row.assembly);
                if (row.resolved)
                {
                    row.classification = type.IsAbstract || type.ContainsGenericParameters || !typeof(UnityEngine.Object).IsAssignableFrom(type) ? "non-attachable" : "attachable";
                    var names = new List<string>();
                    var pending = new Queue<Type>(); var seen = new HashSet<Type>(); pending.Enqueue(type);
                    while (pending.Count > 0)
                    {
                        Deadline();
                        var current = pending.Dequeue();
                        if (!seen.Add(current)) continue;
                        if (seen.Count > MaxReflectedTypes) throw new LimitException("Script reflected type inventory exceeds limit.");
                        if (current.Assembly != type.Assembly) throw new InvalidOperationException("Nested script type assembly changed.");
                        if (current.IsAbstract || current.ContainsGenericParameters || !typeof(UnityEngine.Object).IsAssignableFrom(current))
                        {
                            if (String.IsNullOrEmpty(current.FullName) || current.FullName.Length > 2048) throw new InvalidOperationException("Nested script type identity is unavailable.");
                            names.Add(current.FullName);
                        }
                        var nested = current.GetNestedTypes(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic);
                        if (nested.Length > MaxReflectedTypes - seen.Count - pending.Count) throw new LimitException("Script reflected type inventory exceeds limit.");
                        foreach (var child in nested) pending.Enqueue(child);
                    }
                    names.Sort(StringComparer.Ordinal); row.nonAttachableTypes = names;
                }
            }
            public void Asset(Entry entry)
            {
                var row = new AssetObservation { assetId = entry.assetId, path = entry.path, kind = entry.kind };
                if (dataCapture && entry.kind == "asset") row.data = new DataSnapshot();
                report.assets.Add(row);
                int errorsBefore = errorCount;
                try
                {
                    if (checkpoint != null) checkpoint();
                    Deadline();
                    if (entry.kind == "scene")
                    {
                        Scene scene = default(Scene);
                        try
                        {
                            scene = EditorSceneManager.OpenScene(entry.path, OpenSceneMode.Additive);
                            if (!scene.IsValid() || !scene.isLoaded) throw new InvalidOperationException("Requested scene did not load.");
                            row.loaded = true;
                            foreach (var root in scene.GetRootGameObjects()) Hierarchy(root, row);
                        }
                        finally { if (scene.IsValid() && scene.isLoaded) EditorSceneManager.CloseScene(scene, true); }
                    }
                    else if (entry.kind == "prefab")
                    {
                        GameObject root = null;
                        try
                        {
                            root = PrefabUtility.LoadPrefabContents(entry.path);
                            if (root == null) throw new InvalidOperationException("Requested prefab did not load.");
                            row.loaded = true;
                            Hierarchy(root, row);
                        }
                        finally { if (root != null) PrefabUtility.UnloadPrefabContents(root); }
                    }
                    else
                    {
                        // Includes hidden subassets. Inspect only objects stored
                        // in this requested file; do not follow external assets.
                        var objects = AssetDatabase.LoadAllAssetsAtPath(entry.path);
                        if (objects == null || objects.Length == 0) throw new InvalidOperationException("Requested data asset did not load any objects.");
                        row.loaded = true;
                        var seen = new HashSet<UnityEngine.Object>();
                        foreach (var target in objects)
                        {
                            if (target == null) throw new InvalidOperationException("Requested data asset contains an unloadable object.");
                            if (!seen.Add(target)) continue;
                            row.traversal.objectPath = Location(entry.path + "::" + target.name);
                            References(target, row);
                        }
                    }
                    row.traversal.complete = errorCount == errorsBefore;
                    row.traversal.stopReason = row.traversal.complete ? "" : "asset_error";
                    if (row.data != null)
                    {
                        row.data.complete = row.traversal.complete && row.data.unsupportedProperties == 0;
                        foreach (var item in row.data.objects) if (!item.complete) row.data.complete = false;
                    }
                }
                catch (LimitException error) { row.traversal.stopReason = error.code; Diagnostic("error", error.Message, entry.path); }
                catch (Exception error) { row.traversal.stopReason = "asset_error"; Diagnostic("error", error.Message, entry.path); }
            }
        }

        static string FloatBits(float value) { return "f32:" + BitConverter.ToUInt32(BitConverter.GetBytes(value), 0).ToString("x8", CultureInfo.InvariantCulture); }
        static string DoubleBits(double value) { return "f64:" + BitConverter.ToUInt64(BitConverter.GetBytes(value), 0).ToString("x16", CultureInfo.InvariantCulture); }
        static string Numbers(params float[] values)
        {
            var parts = new string[values.Length];
            for (int i = 0; i < values.Length; i++) parts[i] = FloatBits(values[i]);
            return String.Join(";", parts);
        }
        static string Integers(params int[] values)
        {
            var parts = new string[values.Length];
            for (int i = 0; i < values.Length; i++) parts[i] = values[i].ToString(CultureInfo.InvariantCulture);
            return String.Join(";", parts);
        }
        static string CaptureValue(SerializedProperty property)
        {
            string value;
            try
            {
                switch (property.propertyType)
                {
                    case SerializedPropertyType.Integer: value = property.longValue.ToString(CultureInfo.InvariantCulture); break;
                    case SerializedPropertyType.Boolean: value = property.boolValue ? "true" : "false"; break;
                    case SerializedPropertyType.Float:
                        if (String.Equals(property.type, "double", StringComparison.OrdinalIgnoreCase)) value = DoubleBits(property.doubleValue);
                        else if (String.Equals(property.type, "float", StringComparison.OrdinalIgnoreCase) || String.Equals(property.type, "single", StringComparison.OrdinalIgnoreCase)) value = FloatBits(property.floatValue);
                        else return null;
                        break;
                    case SerializedPropertyType.String: value = property.stringValue; break;
                    case SerializedPropertyType.Character: case SerializedPropertyType.ArraySize: case SerializedPropertyType.FixedBufferSize:
                        value = property.intValue.ToString(CultureInfo.InvariantCulture); break;
                    case SerializedPropertyType.Enum:
                        value = property.intValue.ToString(CultureInfo.InvariantCulture) + ":" + String.Join("\u001f", property.enumNames); break;
                    case SerializedPropertyType.Generic: value = property.isArray ? "array:" + property.arraySize.ToString(CultureInfo.InvariantCulture) : "container"; break;
                    case SerializedPropertyType.ManagedReference:
                        value = property.managedReferenceId.ToString(CultureInfo.InvariantCulture) + ":" + property.managedReferenceFullTypename; break;
                    case SerializedPropertyType.ObjectReference:
                        var target = property.objectReferenceValue;
                        if (target == null) { value = property.objectReferenceInstanceIDValue == 0 ? "null" : null; break; }
                        string guid; long id;
                        value = AssetDatabase.TryGetGUIDAndLocalFileIdentifier(target, out guid, out id) && !String.IsNullOrEmpty(guid) ? guid + ":" + id.ToString(CultureInfo.InvariantCulture) : null; break;
                    case SerializedPropertyType.Vector2: var v2 = property.vector2Value; value = Numbers(v2.x, v2.y); break;
                    case SerializedPropertyType.Vector3: var v3 = property.vector3Value; value = Numbers(v3.x, v3.y, v3.z); break;
                    case SerializedPropertyType.Vector4: var v4 = property.vector4Value; value = Numbers(v4.x, v4.y, v4.z, v4.w); break;
                    case SerializedPropertyType.Color: var color = property.colorValue; value = Numbers(color.r, color.g, color.b, color.a); break;
                    case SerializedPropertyType.Rect: var rect = property.rectValue; value = Numbers(rect.x, rect.y, rect.width, rect.height); break;
                    case SerializedPropertyType.Bounds: var bounds = property.boundsValue; value = Numbers(bounds.center.x, bounds.center.y, bounds.center.z, bounds.extents.x, bounds.extents.y, bounds.extents.z); break;
                    case SerializedPropertyType.Quaternion: var q = property.quaternionValue; value = Numbers(q.x, q.y, q.z, q.w); break;
                    case SerializedPropertyType.Vector2Int: var i2 = property.vector2IntValue; value = Integers(i2.x, i2.y); break;
                    case SerializedPropertyType.Vector3Int: var i3 = property.vector3IntValue; value = Integers(i3.x, i3.y, i3.z); break;
                    case SerializedPropertyType.RectInt: var ri = property.rectIntValue; value = Integers(ri.x, ri.y, ri.width, ri.height); break;
                    case SerializedPropertyType.BoundsInt: var bi = property.boundsIntValue; value = Integers(bi.position.x, bi.position.y, bi.position.z, bi.size.x, bi.size.y, bi.size.z); break;
                    default: return null; // Unknown/curve/gradient/exposed-reference kinds are explicit gaps.
                }
                if (value == null || Encoding.UTF8.GetByteCount(value) > 32768) return null;
                for (int i = 0; i < value.Length; i++)
                {
                    if (Char.IsHighSurrogate(value[i])) { if (++i >= value.Length || !Char.IsLowSurrogate(value[i])) return null; }
                    else if (Char.IsLowSurrogate(value[i])) return null;
                }
                return value;
            }
            catch (Exception) { return null; }
        }

        static bool ReferenceFreeArray(SerializedProperty property)
        {
            if (!property.isArray) return false;
            if (property.arraySize == 0) return true;
            // Inspect the serialized element kind rather than a name: user-defined
            // structs can have primitive-looking names and still hold references.
            switch (property.GetArrayElementAtIndex(0).propertyType)
            {
                case SerializedPropertyType.Integer: case SerializedPropertyType.Boolean:
                case SerializedPropertyType.Float: case SerializedPropertyType.String: return true;
                default: return false;
            }
        }
        static string ObjectPath(Transform transform)
        {
            string result = "";
            for (int depth = 0; transform != null && depth < 256; depth++, transform = transform.parent)
            {
                result = Location(transform.name) + (result.Length == 0 ? "" : "/" + result);
                if (result.Length >= 2048) return Clip(result, 2048);
            }
            return result;
        }
        static Dictionary<string, string> CompilerSources()
        {
            string project = Directory.GetParent(Application.dataPath).FullName;
            var comparer = Path.DirectorySeparatorChar == '\\' ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;
            var result = new Dictionary<string, string>(comparer);
            foreach (var assembly in CompilationPipeline.GetAssemblies())
            {
                if (String.IsNullOrEmpty(assembly.name) || assembly.sourceFiles == null) continue;
                foreach (string source in assembly.sourceFiles)
                    if (!String.IsNullOrEmpty(source))
                    {
                        // Ambiguous compiler membership cannot establish even an assembly identity.
                        string full = Path.GetFullPath(Path.IsPathRooted(source) ? source : Path.Combine(project, source));
                        string previous;
                        if (result.TryGetValue(full, out previous) && previous != assembly.name) result[full] = null;
                        else result[full] = assembly.name;
                    }
            }
            return result;
        }

        public static void Run()
        {
            var observer = new Observer();
            string reportFile = null;
            bool subscribed = false;
            try
            {
                string projectDirectory = Directory.GetParent(Application.dataPath).FullName;
                string controlDirectory = Directory.GetParent(projectDirectory).FullName;
                var arguments = Environment.GetCommandLineArgs();
                reportFile = ControlFile(Argument(arguments, "-retkReport"), controlDirectory);
                string requestFile = ControlFile(Argument(arguments, "-retkRequest"), controlDirectory);
                if (String.Equals(requestFile, reportFile, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Request and report must differ.");
                if (new FileInfo(requestFile).Length > MaxReportBytes) throw new LimitException("Request byte limit exceeded.");
                var request = JsonUtility.FromJson<Request>(File.ReadAllText(requestFile, Encoding.UTF8));
                Validate(request);
                observer.dataCapture = request.dataCapture;
                observer.report.runId = request.runId;
                observer.report.graphRevision = request.graphRevision;
                observer.report.unityVersion = Application.unityVersion;
                if (request.unityVersion != Application.unityVersion) throw new InvalidOperationException("Exact Unity version mismatch.");
                if (EditorApplication.isPlayingOrWillChangePlaymode || EditorApplication.isCompiling || EditorUtility.scriptCompilationFailed)
                    throw new InvalidOperationException("Editor is playing, compiling, or has compilation errors.");
                observer.report.compilation.state = "succeeded";
                Application.logMessageReceived += observer.Log;
                subscribed = true;
                observer.checkpoint = () => WriteReport(reportFile, observer);
                foreach (var entry in request.scripts)
                {
                    observer.currentPath = entry.path;
                    try { observer.Script(entry); }
                    catch (Exception error) { observer.Diagnostic("error", error.Message, entry.path); }
                }
                // A checkpoint is useful even if the Editor is stopped before the first asset.
                WriteReport(reportFile, observer);
                foreach (var entry in request.assets)
                {
                    observer.currentPath = entry.path;
                    try { observer.Asset(entry); }
                    catch (Exception error) { observer.Diagnostic("error", error.Message, entry.path); }
                    WriteReport(reportFile, observer);
                }
                if (EditorApplication.isCompiling || EditorUtility.scriptCompilationFailed)
                {
                    observer.report.compilation.state = "failed";
                    observer.Diagnostic("error", "Compilation changed during observation.");
                }
                observer.report.complete = !observer.errors && observer.report.scripts.Count == request.scripts.Length && observer.report.assets.Count == request.assets.Length;
                foreach (var row in observer.report.assets) if (!row.traversal.complete) observer.report.complete = false;
            }
            catch (Exception error) { observer.Diagnostic("error", error.Message); }
            finally
            {
                if (subscribed) Application.logMessageReceived -= observer.Log;
                if (reportFile != null)
                {
                    try { WriteReport(reportFile, observer); }
                    catch (Exception error) { Debug.LogError("REToolkit could not write observation: " + Clip(error.Message, 8192)); }
                }
            }
        }

        static string Clip(string value, int length) { return value == null ? "" : value.Length <= length ? value : value.Substring(0, length); }
        static string Location(string value)
        {
            string bounded = Clip(value, 2048);
            for (int index = 0; index < bounded.Length; index++)
                if (Char.IsControl(bounded[index]))
                {
                    var characters = bounded.ToCharArray();
                    for (int position = index; position < characters.Length; position++) if (Char.IsControl(characters[position])) characters[position] = ' ';
                    return new string(characters);
                }
            return bounded;
        }
        static string Argument(string[] arguments, string key)
        {
            string result = null;
            for (int index = 0; index < arguments.Length; index++)
                if (arguments[index] == key)
                {
                    if (result != null || index + 1 >= arguments.Length) throw new InvalidOperationException("Missing or repeated " + key);
                    result = arguments[++index];
                }
            if (String.IsNullOrEmpty(result)) throw new InvalidOperationException("Missing " + key);
            return result;
        }
        static string ControlFile(string value, string controlDirectory)
        {
            string full = Path.GetFullPath(value);
            var comparison = Path.DirectorySeparatorChar == '\\' ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
            if (!Path.IsPathRooted(value) || !String.Equals(Path.GetDirectoryName(full), controlDirectory, comparison))
                throw new InvalidOperationException("Control paths must be direct children of the staging run control directory, outside the project.");
            for (var info = new DirectoryInfo(controlDirectory); info != null; info = info.Parent)
                if ((info.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Linked control directory rejected.");
            if (File.Exists(full) && (File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Linked control file rejected.");
            return full;
        }
        static void Validate(Request request)
        {
            if (request == null || request.kind != "retoolkit-unity-validation-request" || request.schemaVersion != 1 ||
                String.IsNullOrEmpty(request.runId) || request.runId.Length > 2048 ||
                String.IsNullOrEmpty(request.graphRevision) || request.graphRevision.Length > 2048 ||
                String.IsNullOrEmpty(request.unityVersion) || request.unityVersion.Length > 128 ||
                request.scripts == null || request.assets == null || request.scripts.Length > MaxEntries || request.assets.Length > MaxEntries)
                throw new InvalidOperationException("Invalid validation request contract.");
            if (!String.IsNullOrEmpty(request.scanPolicy) && request.scanPolicy != ScanPolicy) throw new InvalidOperationException("Unknown scan policy.");
            var ids = new HashSet<string>(StringComparer.Ordinal);
            var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var entry in request.scripts) ValidateEntry(entry, true, ids, paths);
            foreach (var entry in request.assets)
            {
                ValidateEntry(entry, false, ids, paths);
                if (entry.kind == "asset" && request.scanPolicy != ScanPolicy) throw new InvalidOperationException("Data assets require explicit traversal policy.");
                if (request.dataCapture)
                {
                    Guid assetGuid;
                    if (request.assets.Length > 64 || entry.kind != "asset" || !entry.assetId.StartsWith("asset:", StringComparison.Ordinal) || !Guid.TryParseExact(entry.assetId.Substring(6), "N", out assetGuid))
                        throw new InvalidOperationException("Data capture requires at most 64 exact exported .asset GUIDs.");
                }
            }
            if (request.dataCapture && request.assets.Length == 0) throw new InvalidOperationException("Data capture requires selected assets.");
        }
        static void ValidateEntry(Entry entry, bool script, HashSet<string> ids, HashSet<string> paths)
        {
            if (entry == null || String.IsNullOrEmpty(entry.assetId) || entry.assetId.Length > 2048 || String.IsNullOrEmpty(entry.path) ||
                entry.path.Length > 2048 || !entry.path.StartsWith("Assets/", StringComparison.Ordinal) || entry.path.IndexOf('\\') >= 0 ||
                entry.path.IndexOf(':') >= 0 || !ids.Add(entry.assetId) || !paths.Add(entry.path)) throw new InvalidOperationException("Invalid or duplicate requested asset.");
            foreach (string part in entry.path.Split('/'))
                if (part == "" || part == "." || part == ".." || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                    throw new InvalidOperationException("Unsafe requested asset path.");
            string extension = Path.GetExtension(entry.path);
            if (script ? !String.Equals(extension, ".cs", StringComparison.OrdinalIgnoreCase) :
                !((entry.kind == "scene" && String.Equals(extension, ".unity", StringComparison.OrdinalIgnoreCase)) ||
                (entry.kind == "prefab" && String.Equals(extension, ".prefab", StringComparison.OrdinalIgnoreCase)) ||
                (entry.kind == "asset" && String.Equals(extension, ".asset", StringComparison.OrdinalIgnoreCase))))
                throw new InvalidOperationException("Only requested C# scripts, scenes, prefabs and .asset files may be inspected.");
        }

        static void WriteReport(string file, Observer observer)
        {
            string json = Serialize(observer.report);
            while (Encoding.UTF8.GetByteCount(json) > MaxReportBytes)
            {
                observer.report.complete = false;
                // Halving makes report reduction bounded even at maximum request/diagnostic sizes.
                if (observer.report.diagnostics.Count > 1) observer.report.diagnostics.RemoveRange(observer.report.diagnostics.Count / 2, observer.report.diagnostics.Count - observer.report.diagnostics.Count / 2);
                else if (observer.report.assets.Count > 0) observer.report.assets.RemoveRange(observer.report.assets.Count / 2, observer.report.assets.Count - observer.report.assets.Count / 2);
                else if (observer.report.scripts.Count > 0) observer.report.scripts.RemoveRange(observer.report.scripts.Count / 2, observer.report.scripts.Count - observer.report.scripts.Count / 2);
                else throw new LimitException("Report header exceeds byte limit.");
                json = Serialize(observer.report);
            }
            // Same-directory replacement keeps readers on a whole old/new observation.
            // Node seals the final observation separately; this file stays a mutable checkpoint.
            string temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllText(temporary, json, new UTF8Encoding(false));
                if (File.Exists(file)) File.Replace(temporary, file, null);
                else File.Move(temporary, file);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        // JsonUtility converts null strings to empty strings on some Editor versions.
        // Explicit wire serialization preserves null identities for unresolved MonoScripts.
        static string Serialize(Report report)
        {
            var json = new StringBuilder();
            json.Append("{\"kind\":"); Quoted(json, report.kind);
            json.Append(",\"schemaVersion\":1,\"runId\":"); Quoted(json, report.runId);
            json.Append(",\"graphRevision\":"); Quoted(json, report.graphRevision);
            json.Append(",\"unityVersion\":"); Quoted(json, report.unityVersion);
            json.Append(",\"complete\":").Append(report.complete ? "true" : "false");
            json.Append(",\"traversal\":{\"policy\":"); Quoted(json, report.traversal.policy); json.Append('}');
            json.Append(",\"compilation\":{\"state\":"); Quoted(json, report.compilation.state);
            json.Append("},\"scripts\":[");
            for (int index = 0; index < report.scripts.Count; index++)
            {
                if (index > 0) json.Append(','); var row = report.scripts[index];
                json.Append("{\"assetId\":"); Quoted(json, row.assetId); json.Append(",\"path\":"); Quoted(json, row.path);
                json.Append(",\"guid\":"); Quoted(json, row.guid); json.Append(",\"fileID\":"); Quoted(json, row.fileID);
                json.Append(",\"fullName\":"); Quoted(json, row.fullName); json.Append(",\"assembly\":"); Quoted(json, row.assembly);
                json.Append(",\"resolved\":").Append(row.resolved ? "true" : "false");
                json.Append(",\"classification\":"); Quoted(json, row.classification);
                if (row.nonAttachableTypes != null)
                {
                    json.Append(",\"nonAttachableTypes\":[");
                    for (int typeIndex = 0; typeIndex < row.nonAttachableTypes.Count; typeIndex++) { if (typeIndex > 0) json.Append(','); Quoted(json, row.nonAttachableTypes[typeIndex]); }
                    json.Append(']');
                }
                json.Append('}');
            }
            json.Append("],\"assets\":[");
            for (int index = 0; index < report.assets.Count; index++)
            {
                if (index > 0) json.Append(','); var row = report.assets[index];
                json.Append("{\"assetId\":"); Quoted(json, row.assetId); json.Append(",\"path\":"); Quoted(json, row.path);
                json.Append(",\"kind\":"); Quoted(json, row.kind); json.Append(",\"loaded\":").Append(row.loaded ? "true" : "false");
                json.Append(",\"missingScripts\":").Append(row.missingScripts.ToString(CultureInfo.InvariantCulture));
                json.Append(",\"missingReferences\":").Append(row.missingReferences.ToString(CultureInfo.InvariantCulture));
                var traversal = row.traversal;
                json.Append(",\"traversal\":{\"complete\":").Append(traversal.complete ? "true" : "false");
                json.Append(",\"objects\":").Append(traversal.objects.ToString(CultureInfo.InvariantCulture));
                json.Append(",\"properties\":").Append(traversal.properties.ToString(CultureInfo.InvariantCulture));
                json.Append(",\"skippedSubtrees\":").Append(traversal.skippedSubtrees.ToString(CultureInfo.InvariantCulture));
                json.Append(",\"stopReason\":"); Quoted(json, traversal.stopReason);
                json.Append(",\"objectPath\":"); Quoted(json, traversal.objectPath);
                json.Append(",\"componentType\":"); Quoted(json, traversal.componentType);
                json.Append(",\"propertyPath\":"); Quoted(json, traversal.propertyPath); json.Append('}');
                if (row.data != null)
                {
                    json.Append(",\"data\":{\"policy\":"); Quoted(json, row.data.policy);
                    json.Append(",\"complete\":").Append(row.data.complete ? "true" : "false");
                    json.Append(",\"unsupportedProperties\":").Append(row.data.unsupportedProperties.ToString(CultureInfo.InvariantCulture));
                    json.Append(",\"objects\":[");
                    for (int o = 0; o < row.data.objects.Count; o++)
                    {
                        if (o > 0) json.Append(','); var item = row.data.objects[o];
                        json.Append("{\"guid\":"); Quoted(json, item.guid); json.Append(",\"fileID\":"); Quoted(json, item.fileID);
                        json.Append(",\"fullName\":"); Quoted(json, item.fullName); json.Append(",\"assembly\":"); Quoted(json, item.assembly);
                        json.Append(",\"scriptable\":").Append(item.scriptable ? "true" : "false"); json.Append(",\"complete\":").Append(item.complete ? "true" : "false");
                        json.Append(",\"properties\":[");
                        for (int p = 0; p < item.properties.Count; p++)
                        {
                            if (p > 0) json.Append(','); var field = item.properties[p];
                            json.Append("{\"path\":"); Quoted(json, field.path); json.Append(",\"kind\":"); Quoted(json, field.kind);
                            json.Append(",\"type\":"); Quoted(json, field.type); json.Append(",\"value\":"); Quoted(json, field.value); json.Append('}');
                        }
                        json.Append("]}");
                    }
                    json.Append("]}");
                }
                json.Append('}');
            }
            json.Append("],\"diagnostics\":[");
            for (int index = 0; index < report.diagnostics.Count; index++)
            {
                if (index > 0) json.Append(','); var row = report.diagnostics[index];
                json.Append("{\"severity\":"); Quoted(json, row.severity); json.Append(",\"message\":"); Quoted(json, row.message);
                json.Append(",\"path\":"); Quoted(json, row.path); json.Append('}');
            }
            return json.Append("]}").ToString();
        }
        static void Quoted(StringBuilder json, string value)
        {
            if (value == null) { json.Append("null"); return; }
            json.Append('"');
            foreach (char character in value)
            {
                if (character == '"') json.Append("\\\"");
                else if (character == '\\') json.Append("\\\\");
                else if (character < 32) json.Append("\\u").Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                else json.Append(character);
            }
            json.Append('"');
        }
    }
}
