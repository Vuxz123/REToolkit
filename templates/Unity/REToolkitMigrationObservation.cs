// Fixed read-only observer. Run only in the private staging copy prepared by Node.
using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using UnityEngine;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;

namespace REToolkit
{
    // Reuses the existing supervisor's fixed validation entrypoint in a separate
    // private helper assembly; the ordinary validation helper is not installed here.
    public static class EditorValidation { public static void Run() { MigrationObservation.Run(); } }
    public static class MigrationObservation
    {
        const int MaxEntries = 100000, MaxFields = 1000000, MaxBytes = 32 * 1024 * 1024;
        [Serializable] public sealed class Entry { public string path; public string kind; public string guid; }
        [Serializable] public sealed class Selector { public string componentId; public string guid; public string fileID; public string path; }
        [Serializable] public sealed class Request
        {
            public string kind; public int schemaVersion; public string runId; public string graphRevision;
            public string inventorySha256; public string unityVersion; public Entry[] scripts; public Entry[] assets; public Selector[] components; public bool componentMode;
        }
        [Serializable] public sealed class Field { public string name; public string type; public string propertyType; public string valueJson; }
        [Serializable] public sealed class Identity { public string assembly; public string fullName; public string guid; public string fileID; }
        [Serializable] public sealed class Script
        {
            public string path; public string assembly; public string fullName; public string guid; public string fileID; public List<Field> fields = new List<Field>();
        }
        [Serializable] public sealed class ComponentRow { public string componentId; public Identity script; public bool native; public string fullName; public string assembly; public List<Field> fields = new List<Field>(); }
        [Serializable] public sealed class Compilation { public string state = "failed"; }
        [Serializable] public sealed class Report
        {
            public string kind = "retoolkit-migration-observation"; public int schemaVersion = 1;
            public string runId; public string graphRevision; public string inventorySha256; public string unityVersion;
            public bool complete; public Compilation compilation = new Compilation();
            public List<Script> scripts = new List<Script>(); public List<ComponentRow> components = new List<ComponentRow>(); public List<string> diagnostics = new List<string>();
        }
        static int fieldCount, objectCount;
        static Report report;
        static bool componentMode;
        static string Number(long n) { return n.ToString(CultureInfo.InvariantCulture); }
        static string Quote(string s)
        {
            if (s == null) return "null";
            var b = new StringBuilder("\"");
            foreach (char c in s) { if (c == '"') b.Append("\\\""); else if (c == '\\') b.Append("\\\\"); else if (c < 32) b.Append("\\u").Append(((int)c).ToString("x4")); else b.Append(c); }
            return b.Append('"').ToString();
        }
        static void Budget() { if (++fieldCount > MaxFields) throw new InvalidOperationException("Serialized property limit exceeded."); }
        static string PropertyType(FieldInfo field)
        {
            if (field.IsDefined(typeof(SerializeReference), true)) return "ManagedReference";
            Type t = field.FieldType;
            if (typeof(UnityEngine.Object).IsAssignableFrom(t)) return "ObjectReference";
            if (t.IsEnum) return "Enum";
            if (t == typeof(bool)) return "Boolean";
            if (t == typeof(string)) return "String";
            if (t == typeof(float) || t == typeof(double)) return "Float";
            if (t == typeof(sbyte) || t == typeof(byte) || t == typeof(short) || t == typeof(ushort) || t == typeof(int) || t == typeof(uint) || t == typeof(long) || t == typeof(ulong)) return "Integer";
            return "Generic";
        }
        static List<Field> Fields(Type type)
        {
            var fields = new List<Field>(); var names = new HashSet<string>(StringComparer.Ordinal);
            for (Type t = type; t != null && t != typeof(MonoBehaviour) && t != typeof(ScriptableObject) && t != typeof(UnityEngine.Object); t = t.BaseType)
                foreach (var f in t.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly))
                {
                    Budget();
                    if (f.IsStatic || f.IsInitOnly || f.IsLiteral || f.IsNotSerialized || (!f.IsPublic && !f.IsDefined(typeof(SerializeField), true) && !f.IsDefined(typeof(SerializeReference), true))) continue;
                    if (!names.Add(f.Name)) throw new InvalidOperationException("Ambiguous inherited serialized field.");
                    fields.Add(new Field { name = f.Name, type = f.FieldType.FullName, propertyType = PropertyType(f) });
                }
            return fields.OrderBy(f => f.name, StringComparer.Ordinal).ToList();
        }
        static Identity ScriptIdentity(MonoScript script)
        {
            string g; long n; var type = script == null ? null : script.GetClass();
            if (type == null || !AssetDatabase.TryGetGUIDAndLocalFileIdentifier(script, out g, out n)) throw new InvalidOperationException("MonoScript identity/type unresolved.");
            return new Identity { guid = g, fileID = Number(n), assembly = type.Assembly.GetName().Name, fullName = type.FullName };
        }
        static void ObserveScripts(Entry entry)
        {
            foreach (var script in AssetDatabase.LoadAllAssetsAtPath(entry.path).OfType<MonoScript>())
            {
                var type = script.GetClass();
                if (componentMode && (type == null || !typeof(Component).IsAssignableFrom(type) || type.IsAbstract || type.ContainsGenericParameters)) continue;
                if (report.scripts.Count >= MaxEntries) throw new InvalidOperationException("MonoScript limit exceeded.");
                var identity = ScriptIdentity(script);
                report.scripts.Add(new Script { path = entry.path, guid = identity.guid, fileID = identity.fileID, assembly = identity.assembly, fullName = identity.fullName, fields = Fields(script.GetClass()) });
            }
        }
        static void ObservePackageRegistry()
        {
            foreach (var script in MonoImporter.GetAllRuntimeMonoScripts())
            {
                var path = AssetDatabase.GetAssetPath(script); var type = script.GetClass();
                if (!path.StartsWith("Packages/", StringComparison.Ordinal) || type == null || !typeof(Component).IsAssignableFrom(type) || type.IsAbstract || type.ContainsGenericParameters) continue;
                SafeAsset(path); var identity = ScriptIdentity(script);
                if (report.scripts.Any(s => s.path == path && s.guid == identity.guid && s.fileID == identity.fileID)) continue;
                if (report.scripts.Count >= MaxEntries) throw new InvalidOperationException("Package MonoScript limit exceeded.");
                report.scripts.Add(new Script { path = path, guid = identity.guid, fileID = identity.fileID, assembly = identity.assembly, fullName = identity.fullName, fields = Fields(type) });
            }
        }
        static string Value(SerializedProperty p, string localGuid)
        {
            switch (p.propertyType)
            {
                case SerializedPropertyType.Integer:
                    long n = p.longValue; return n > 9007199254740991L || n < -9007199254740991L ? Quote(Number(n)) : Number(n);
                case SerializedPropertyType.Enum: return Number(p.intValue);
                case SerializedPropertyType.Boolean: return p.boolValue ? "true" : "false";
                case SerializedPropertyType.String: return Quote(p.stringValue);
                case SerializedPropertyType.Float:
                    double v = p.doubleValue; if (Double.IsNaN(v) || Double.IsInfinity(v)) throw new InvalidOperationException("Non-finite serialized float unsupported.");
                    return v.ToString("R", CultureInfo.InvariantCulture);
                case SerializedPropertyType.ObjectReference:
                    if (p.objectReferenceValue == null) { if (p.objectReferenceInstanceIDValue != 0) throw new InvalidOperationException("Missing object reference."); return "{\"fileID\":\"0\"}"; }
                    string g; long fileId;
                    if (!AssetDatabase.TryGetGUIDAndLocalFileIdentifier(p.objectReferenceValue, out g, out fileId) || String.IsNullOrEmpty(g) || fileId == 0)
                    {
                        var global = GlobalObjectId.GetGlobalObjectIdSlow(p.objectReferenceValue); g = global.assetGUID.ToString(); fileId = unchecked((long)global.targetObjectId);
                        if (fileId == 0 || g == "00000000000000000000000000000000") throw new InvalidOperationException("Object reference identity unresolved.");
                    }
                    return "{\"fileID\":" + Quote(Number(fileId)) + (g == localGuid ? "" : ",\"guid\":" + Quote(g)) + "}";
                default: return null;
            }
        }
        static void ObserveObject(UnityEngine.Object target, string assetGuid, Dictionary<string, Selector> selectors, HashSet<string> found)
        {
            if (++objectCount > MaxEntries) throw new InvalidOperationException("Object traversal limit exceeded.");
            if (!(target is MonoBehaviour) && !(target is ScriptableObject) && !(componentMode && target is Component)) return;
            string g; long n;
            if (!AssetDatabase.TryGetGUIDAndLocalFileIdentifier(target, out g, out n) || String.IsNullOrEmpty(g) || n == 0)
            {
                var global = GlobalObjectId.GetGlobalObjectIdSlow(target);
                g = global.assetGUID.ToString(); n = unchecked((long)global.targetObjectId);
                if (g != assetGuid || n == 0) return;
            }
            if (g != assetGuid) return;
            // Scene objects use the persistent local identifier, independent of hierarchy/name.
            var selectorKey = assetGuid + ":" + Number(n); Selector selector;
            if (!selectors.TryGetValue(selectorKey, out selector)) return;
            if (!found.Add(selector.componentId)) throw new InvalidOperationException("Ambiguous observed component identity.");
            if (componentMode && !(target is MonoBehaviour) && target is Component)
            {
                report.components.Add(new ComponentRow { componentId = selector.componentId, native = true, fullName = target.GetType().FullName, assembly = target.GetType().Assembly.GetName().Name }); return;
            }
            MonoScript script = target is MonoBehaviour ? MonoScript.FromMonoBehaviour((MonoBehaviour)target) : MonoScript.FromScriptableObject((ScriptableObject)target);
            var row = new ComponentRow { componentId = selector.componentId, script = ScriptIdentity(script) };
            using (var serialized = new SerializedObject(target))
                foreach (var field in Fields(target.GetType()))
                {
                    var property = serialized.FindProperty(field.name);
                    if (property == null || property.propertyType.ToString() != field.propertyType) continue;
                    field.valueJson = Value(property, assetGuid);
                    if (field.valueJson != null) row.fields.Add(field);
                }
            report.components.Add(row);
        }
        static void Hierarchy(GameObject root, string guid, Dictionary<string, Selector> selectors, HashSet<string> found)
        {
            var pending = new Stack<Transform>(); pending.Push(root.transform);
            while (pending.Count != 0)
            {
                var transform = pending.Pop();
                foreach (var component in transform.GetComponents<Component>()) if (component != null) ObserveObject(component, guid, selectors, found);
                if (transform.childCount > MaxEntries - pending.Count) throw new InvalidOperationException("Hierarchy traversal limit exceeded.");
                for (int index = transform.childCount - 1; index >= 0; index--) pending.Push(transform.GetChild(index));
            }
        }
        static void ObserveAsset(Entry entry, Dictionary<string, Selector> selectors, HashSet<string> found)
        {
            if (entry.kind == "scene")
            {
                Scene scene = default(Scene);
                try { scene = EditorSceneManager.OpenScene(entry.path, OpenSceneMode.Additive); foreach (var root in scene.GetRootGameObjects()) Hierarchy(root, entry.guid, selectors, found); }
                finally { if (scene.IsValid() && scene.isLoaded) EditorSceneManager.CloseScene(scene, true); }
            }
            else if (entry.kind == "prefab")
            {
                // Persistent prefab assets retain actual fileIDs. Temporary
                // LoadPrefabContents instances do not expose those identifiers.
                var root = AssetDatabase.LoadAssetAtPath<GameObject>(entry.path);
                if (root == null) throw new InvalidOperationException("Requested prefab did not load.");
                Hierarchy(root, entry.guid, selectors, found);
            }
            else foreach (var target in AssetDatabase.LoadAllAssetsAtPath(entry.path)) ObserveObject(target, entry.guid, selectors, found);
        }
        static string Argument(string[] args, string key)
        {
            string value = null; for (int i = 0; i < args.Length; i++) if (args[i] == key) { if (value != null || ++i >= args.Length) throw new InvalidOperationException("Invalid control argument."); value = args[i]; }
            if (String.IsNullOrEmpty(value)) throw new InvalidOperationException("Missing control argument."); return value;
        }
        static string Control(string file)
        {
            var control = Directory.GetParent(Directory.GetParent(Application.dataPath).FullName).FullName;
            var full = Path.GetFullPath(file); var comparison = Path.DirectorySeparatorChar == '\\' ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
            if (!Path.IsPathRooted(file) || !String.Equals(Path.GetDirectoryName(full), control, comparison)) throw new InvalidOperationException("Control path outside staging.");
            for (var dir = new DirectoryInfo(control); dir != null; dir = dir.Parent) if ((dir.Attributes & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Linked control directory.");
            if (File.Exists(full) && (File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0) throw new InvalidOperationException("Linked control file."); return full;
        }
        static void SafeAsset(string value)
        {
            if (String.IsNullOrEmpty(value) || value.Length > 2048 || !(value.StartsWith("Assets/", StringComparison.Ordinal) || value.StartsWith("Packages/", StringComparison.Ordinal)) || value.IndexOf('\\') >= 0 || value.IndexOf(':') >= 0 || value.Split('/').Any(p => p == "" || p == "." || p == ".." || p.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)) throw new InvalidOperationException("Unsafe asset selector.");
        }
        static void Log(string message, string trace, LogType type)
        {
            if (type != LogType.Error && type != LogType.Exception && type != LogType.Assert) return;
            report.complete = false; if (report.diagnostics.Count < 1000) report.diagnostics.Add(message.Length > 4096 ? message.Substring(0, 4096) : message);
        }
        public static void Run()
        {
            report = new Report(); fieldCount = objectCount = 0; string output = null; bool subscribed = false;
            try
            {
                var args = Environment.GetCommandLineArgs(); output = Control(Argument(args, "-retkReport")); string input = Control(Argument(args, "-retkRequest"));
                if (String.Equals(input, output, StringComparison.OrdinalIgnoreCase) || new FileInfo(input).Length > MaxBytes) throw new InvalidOperationException("Invalid request file.");
                var request = JsonUtility.FromJson<Request>(File.ReadAllText(input, Encoding.UTF8));
                if (request == null || request.kind != "retoolkit-migration-observation-request" || request.schemaVersion != 1 || request.scripts == null || request.assets == null || request.components == null || request.scripts.Length > 10000 || request.assets.Length > 10000 || request.components.Length > MaxEntries) throw new InvalidOperationException("Invalid request.");
                componentMode = request.componentMode;
                report.runId = request.runId; report.graphRevision = request.graphRevision; report.inventorySha256 = request.inventorySha256; report.unityVersion = Application.unityVersion;
                if (request.unityVersion != Application.unityVersion || EditorUtility.scriptCompilationFailed || EditorApplication.isCompiling || EditorApplication.isPlayingOrWillChangePlaymode) throw new InvalidOperationException("Editor version/compilation state invalid.");
                var selectors = new Dictionary<string, Selector>(StringComparer.Ordinal); var found = new HashSet<string>(StringComparer.Ordinal);
                foreach (var selector in request.components) { SafeAsset(selector.path); selectors.Add(selector.guid + ":" + selector.fileID, selector); }
                report.complete = true; report.compilation.state = "succeeded"; Application.logMessageReceived += Log; subscribed = true;
                foreach (var entry in request.scripts) { SafeAsset(entry.path); string ext = Path.GetExtension(entry.path); if (ext != ".cs" && ext != ".dll") throw new InvalidOperationException("Unsupported script path."); ObserveScripts(entry); }
                if (componentMode) ObservePackageRegistry();
                foreach (var entry in request.assets) { SafeAsset(entry.path); if (entry.kind != "scene" && entry.kind != "prefab" && entry.kind != "asset") throw new InvalidOperationException("Unsupported serialized asset."); ObserveAsset(entry, selectors, found); }
                if (found.Count != request.components.Length) throw new InvalidOperationException("Not all requested component identities were observed.");
                if (EditorApplication.isCompiling || EditorUtility.scriptCompilationFailed) throw new InvalidOperationException("Compilation changed during observation.");
            }
            catch (Exception error) { report.complete = false; if (report.diagnostics.Count < 1000) report.diagnostics.Add(error.Message); }
            finally
            {
                if (subscribed) Application.logMessageReceived -= Log;
                if (output != null) { string json = JsonUtility.ToJson(report, true); if (Encoding.UTF8.GetByteCount(json) > MaxBytes) { report.complete = false; report.scripts.Clear(); report.components.Clear(); report.diagnostics.Clear(); report.diagnostics.Add("Report byte limit exceeded."); json = JsonUtility.ToJson(report); } File.WriteAllText(output, json, new UTF8Encoding(false)); }
            }
        }
    }
}
