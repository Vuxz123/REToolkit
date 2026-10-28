using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using REToolkit;

static class Fixture
{
    public static string scenario, directory;
    public static EditorValidation.Request request;
    public static readonly Dictionary<string, UnityEngine.GameObject> assets = new Dictionary<string, UnityEngine.GameObject>();
    public static readonly Dictionary<string, UnityEditor.MonoScript> scripts = new Dictionary<string, UnityEditor.MonoScript>();
    public static readonly Dictionary<string, UnityEngine.Object[]> dataAssets = new Dictionary<string, UnityEngine.Object[]>();
    public static int loads;
    public static int Main(string[] args)
    {
        scenario = args[0]; directory = args[1];
        UnityEngine.Application.dataPath = Path.Combine(directory, "project", "Assets");
        request = new EditorValidation.Request { kind = "retoolkit-unity-validation-request", schemaVersion = 1, runId = "owned", graphRevision = "fixture", unityVersion = "fixture", scripts = new EditorValidation.Entry[0] };
        var entries = new List<EditorValidation.Entry>();
        if (scenario == "classes")
        {
            Type[] types = { typeof(Attachable), typeof(AbstractComponent), typeof(GenericComponent<>), typeof(PlainClass), null, null };
            for (int i = 0; i < types.Length; i++) scripts["Assets/Script" + i + ".cs"] = new UnityEditor.MonoScript { type = types[i] };
            request.scripts = scripts.Keys.Select((p, i) => new EditorValidation.Entry { assetId = "script" + i, path = p }).ToArray();
            assets["Assets/Classes.prefab"] = new UnityEngine.GameObject("Classes");
            entries.Add(new EditorValidation.Entry { assetId = "asset0", path = "Assets/Classes.prefab", kind = "prefab" });
        }
        else if (scenario.StartsWith("data", StringComparison.Ordinal))
        {
            request.scanPolicy = "reference-scan-v2";
            request.dataCapture = scenario.StartsWith("data-capture", StringComparison.Ordinal);
            int count = request.dataCapture ? 1 : scenario == "data-errors" ? 4 : scenario == "data-limits" ? 3 : 2;
            for (int index = 0; index < count; index++)
            {
                string assetPath = "Assets/Table" + index + ".asset";
                var table = new Table { name = "Table" + index };
                table.nodes.Add(new UnityEditor.Node { path = "m_Script", type = UnityEditor.SerializedPropertyType.ObjectReference, reference = (scenario == "data-missing-script" || scenario == "data-capture-atomic-missing") && index == 0 ? null : new UnityEditor.MonoScript(), instanceId = 0 });
                if (scenario.Contains("atomic"))
                {
                    // These are Unity pointer representation children, not fields on the referenced object.
                    // Next(true) deliberately exposes them; Next(false) must land on the following sibling.
                    long pointerId = scenario.EndsWith("2676", StringComparison.Ordinal) ? 2676 : 2672;
                    table.nodes.Add(new UnityEditor.Node { path = "m_Script.m_FileID", type = UnityEditor.SerializedPropertyType.Integer, depth = 1, number = pointerId });
                    table.nodes.Add(new UnityEditor.Node { path = "m_Script.pointerMissing", type = UnityEditor.SerializedPropertyType.ObjectReference, depth = 1 });
                    table.nodes.Add(new UnityEditor.Node { path = "m_FileID", type = UnityEditor.SerializedPropertyType.Integer, number = 41 });
                    table.nodes.Add(new UnityEditor.Node { path = "nested", type = UnityEditor.SerializedPropertyType.Generic });
                    table.nodes.Add(new UnityEditor.Node { path = "nested.m_FileID", type = UnityEditor.SerializedPropertyType.Integer, depth = 1, number = 43 });
                    table.nodes.Add(new UnityEditor.Node { path = "nested.reference", type = UnityEditor.SerializedPropertyType.ObjectReference, depth = 1, reference = new UnityEngine.Object { localId = 9007199254740999L } });
                    table.nodes.Add(new UnityEditor.Node { path = "nested.reference.m_PathID", type = UnityEditor.SerializedPropertyType.Integer, depth = 2, number = pointerId });
                    table.nodes.Add(new UnityEditor.Node { path = "nested.afterReference", type = UnityEditor.SerializedPropertyType.Integer, depth = 1, number = 47 });
                    table.nodes.Add(new UnityEditor.Node { path = "managed", type = UnityEditor.SerializedPropertyType.ManagedReference, id = 42 });
                    table.nodes.Add(new UnityEditor.Node { path = "managed.m_FileID", type = UnityEditor.SerializedPropertyType.Integer, depth = 1, number = 53 });
                    table.nodes.Add(new UnityEditor.Node { path = "managed.self", type = UnityEditor.SerializedPropertyType.ManagedReference, depth = 1, id = 42 });
                    table.nodes.Add(new UnityEditor.Node { path = "managed.self.hidden", type = UnityEditor.SerializedPropertyType.Integer, depth = 2, number = 59 });
                    table.nodes.Add(new UnityEditor.Node { path = "afterManaged", type = UnityEditor.SerializedPropertyType.Integer, number = 61 });
                    table.nodes.Add(new UnityEditor.Node { path = "optional", type = UnityEditor.SerializedPropertyType.ObjectReference, instanceId = 0 });
                    table.nodes.Add(new UnityEditor.Node { path = "optional.m_FileID", type = UnityEditor.SerializedPropertyType.Integer, depth = 1, number = pointerId });
                    if (scenario.EndsWith("missing", StringComparison.Ordinal))
                    {
                        table.nodes.Add(new UnityEditor.Node { path = "missing", type = UnityEditor.SerializedPropertyType.ObjectReference });
                        table.nodes.Add(new UnityEditor.Node { path = "missing.m_FileID", type = UnityEditor.SerializedPropertyType.Integer, depth = 1, number = pointerId });
                    }
                }
                UnityEngine.Object[] objects = new UnityEngine.Object[] { table };
                if (scenario == "data" && index == 0)
                {
                    Add(table, "mainRef", UnityEditor.SerializedPropertyType.ObjectReference, 0);
                    var hidden = new Table { name = "Hidden" };
                    Add(hidden, "refs", UnityEditor.SerializedPropertyType.Generic, 0, 1, true, "PPtr<Object>");
                    Add(hidden, "refs.missing", UnityEditor.SerializedPropertyType.ObjectReference, 1);
                    objects = new UnityEngine.Object[] { table, hidden, new UnityEngine.Object { name = "Native" } };
                }
                if (scenario == "data-errors" && index == 0) objects = new UnityEngine.Object[0];
                if (scenario == "data-errors" && index == 1) objects = new UnityEngine.Object[] { null };
                if (scenario == "data-limits" && index == 0) Add(table, "values", UnityEditor.SerializedPropertyType.Generic, 0, 50);
                if (scenario == "data-limits" && index == 1) objects = Enumerable.Range(0, 21).Select(i => (UnityEngine.Object)new Table { name = "Part" + i }).ToArray();
                if (request.dataCapture)
                {
                    table.nodes.Add(new UnityEditor.Node { path = "scores", type = UnityEditor.SerializedPropertyType.Generic, array = true, element = "byte" });
                    table.nodes.Add(new UnityEditor.Node { path = "scores.Array.size", type = UnityEditor.SerializedPropertyType.ArraySize, depth = 1, number = 2 });
                    table.nodes.Add(new UnityEditor.Node { path = "scores.Array.data[0]", type = UnityEditor.SerializedPropertyType.Integer, depth = 1, number = 7 });
                    table.nodes.Add(new UnityEditor.Node { path = "scores.Array.data[1]", type = UnityEditor.SerializedPropertyType.Integer, depth = 1, number = 9 });
                    if (scenario == "data-capture-unsupported") table.nodes.Add(new UnityEditor.Node { path = "curve", type = UnityEditor.SerializedPropertyType.AnimationCurve });
                    if (scenario == "data-capture-floats")
                    {
                        table.nodes.Add(new UnityEditor.Node { path = "negativeFloat", type = UnityEditor.SerializedPropertyType.Float, single = BitConverter.ToSingle(BitConverter.GetBytes(unchecked((int)0x80000000)), 0) });
                        table.nodes.Add(new UnityEditor.Node { path = "negativeDouble", type = UnityEditor.SerializedPropertyType.Float, declaredType = "double", real = BitConverter.Int64BitsToDouble(long.MinValue) });
                        table.nodes.Add(new UnityEditor.Node { path = "largeIntVector", type = UnityEditor.SerializedPropertyType.Vector3Int, integers = new UnityEngine.Vector3Int { x = int.MaxValue, y = int.MinValue, z = 16777217 } });
                    }
                    if (scenario == "data-capture-limits") Add(table, "scores.Array.data", UnityEditor.SerializedPropertyType.Integer, 1, 50);
                    var hidden = new Table { name = "Hidden" };hidden.nodes.Add(new UnityEditor.Node { path = "label", type = UnityEditor.SerializedPropertyType.String, text = "hidden value" });
                    objects = new UnityEngine.Object[] { table, hidden, new UnityEngine.Object() };
                }
                dataAssets[assetPath] = objects;
                entries.Add(new EditorValidation.Entry { assetId = request.dataCapture ? "asset:0123456789abcdef0123456789abcdef" : "asset" + index, path = assetPath, kind = "asset" });
            }
        }
        else
        {
            int count = scenario == "limits" ? 3 : scenario == "error" || scenario == "logerror" ? 2 : 1;
            for (int i = 0; i < count; i++)
            {
                string path = "Assets/Asset" + i + ".prefab";
                var root = new UnityEngine.GameObject(scenario == "limits" && i == 0 ? "\n" + new string('x', 2050) : "Root" + i);
                if (scenario == "payloads")
                {
                    Add(root, "text", UnityEditor.SerializedPropertyType.String, 0); Add(root, "text.hidden", UnityEditor.SerializedPropertyType.Generic, 1, 50);
                    Add(root, "bytes", UnityEditor.SerializedPropertyType.Generic, 0, 1, true, "byte"); Add(root, "bytes.hidden", UnityEditor.SerializedPropertyType.Generic, 1, 50);
                    Add(root, "strings", UnityEditor.SerializedPropertyType.Generic, 0, 1, true, "string"); Add(root, "strings.hidden", UnityEditor.SerializedPropertyType.Generic, 1, 50);
                    Add(root, "refs", UnityEditor.SerializedPropertyType.Generic, 0, 1, true, "PPtr<Object>"); Add(root, "refs.missing", UnityEditor.SerializedPropertyType.ObjectReference, 1);
                    Add(root, "structs", UnityEditor.SerializedPropertyType.Generic, 0, 1, true, "NestedStruct"); Add(root, "structs.missing", UnityEditor.SerializedPropertyType.ObjectReference, 1);
                    Add(root, "primitiveNamedStruct", UnityEditor.SerializedPropertyType.Generic, 0, 1, true, "int"); Add(root, "primitiveNamedStruct.missing", UnityEditor.SerializedPropertyType.ObjectReference, 1);
                    Add(root, "managed", UnityEditor.SerializedPropertyType.ManagedReference, 0, 1, false, "", 42);
                    Add(root, "managed.missing", UnityEditor.SerializedPropertyType.ObjectReference, 1);
                    Add(root, "managed.self", UnityEditor.SerializedPropertyType.ManagedReference, 1, 1, false, "", 42);
                    Add(root, "managed.self.hidden", UnityEditor.SerializedPropertyType.Generic, 2, 50);
                    var component = new UnityEngine.Component { gameObject = root };
                    Add(component, "independentManaged", UnityEditor.SerializedPropertyType.ManagedReference, 0, 1, false, "", 42);
                    Add(component, "independentManaged.missing", UnityEditor.SerializedPropertyType.ObjectReference, 1);
                    root.components.Add(component);
                }
                if (scenario == "limits" && i == 0) Add(root, "expensive", UnityEditor.SerializedPropertyType.Generic, 0, 50);
                if (scenario == "limits" && i == 1) for (int j = 0; j < 30; j++) root.components.Add(new UnityEngine.Component());
                assets[path] = root;
                entries.Add(new EditorValidation.Entry { assetId = "asset" + i, path = path, kind = "prefab" });
            }
        }
        request.assets = entries.ToArray();
        EditorValidation.Run();
        return 0;
    }
    static void Add(UnityEngine.Object target, string path, UnityEditor.SerializedPropertyType type, int depth, int count = 1, bool array = false, string element = "", long id = -1)
    {
        for (int i = 0; i < count; i++) target.nodes.Add(new UnityEditor.Node { path = path + i, type = type, depth = depth, array = array, element = element, id = id });
    }
    public static void Checkpoint(string path)
    {
        var json = File.ReadAllText(Path.Combine(directory, "report.json"));
        if (!json.Contains("\"complete\":false,\"traversal\":{\"policy\"")) throw new Exception("checkpoint root must be incomplete");
        if (Fixture.scenario == "classes" && !json.Contains("\"classification\":\"compiled-source\"")) throw new Exception("script checkpoint missing before asset load");
        var entry = request.assets.Single(value => value.path == path);
        int start = json.IndexOf("\"assetId\":\"" + entry.assetId + "\"", StringComparison.Ordinal);
        if (start < 0) throw new Exception("current asset checkpoint missing before asset load");
        int end = json.IndexOf("\"assetId\":", start + 1, StringComparison.Ordinal);
        var currentRow = json.Substring(start, (end < 0 ? json.Length : end) - start);
        if (!currentRow.Contains("\"loaded\":false") || !currentRow.Contains("\"traversal\":{\"complete\":false")) throw new Exception("current asset must be incomplete before asset load");
        if (loads > 0 && !json.Contains("\"assetId\":\"asset" + (loads - 1) + "\"")) throw new Exception("prior asset checkpoint missing");
        loads++;
        Console.WriteLine("checkpoint verified");
    }
}
class Attachable : UnityEngine.Component { }
abstract class AbstractComponent : UnityEngine.Component { }
class GenericComponent<T> : UnityEngine.Component { }
class PlainClass {
    public class PlainNested { public class Deep { } }
    private abstract class AbstractNested : UnityEngine.Component { }
    public class GenericNested<T> : UnityEngine.Component { }
    public class ConcreteNested : UnityEngine.Component { }
}
class Table : UnityEngine.ScriptableObject { }

namespace UnityEngine
{
    public class Object { static long nextId = 9007199254740993L; public long localId = nextId++; public string name = "Object"; public List<UnityEditor.Node> nodes = new List<UnityEditor.Node>(); }
    public struct Vector2 { public float x, y; }
    public struct Vector3 { public float x, y, z; }
    public struct Vector4 { public float x, y, z, w; }
    public struct Color { public float r, g, b, a; }
    public struct Rect { public float x, y, width, height; }
    public struct Bounds { public Vector3 center, extents; }
    public struct Quaternion { public float x, y, z, w; }
    public struct Vector2Int { public int x, y; }
    public struct Vector3Int { public int x, y, z; }
    public struct RectInt { public int x, y, width, height; }
    public struct BoundsInt { public Vector3Int position, size; }
    public class ScriptableObject : Object { }
    public class Component : Object { public GameObject gameObject; public Transform transform { get { return gameObject == null ? null : gameObject.transform; } } }
    public class GameObject : Object
    {
        public Transform transform; public List<Component> components = new List<Component>();
        public GameObject(string value) { name = value; transform = new Transform { gameObject = this, name = value }; }
        public T[] GetComponents<T>() where T : Component { return components.Cast<T>().ToArray(); }
    }
    public class Transform : Component { public Transform parent; public int childCount { get { return 0; } } public Transform GetChild(int index) { throw new Exception(); } }
    public enum LogType { Error, Exception, Assert, Warning, Log }
    public static class Application
    {
        public static string dataPath; public static string unityVersion = "fixture"; public static event Action<string, string, LogType> logMessageReceived;
        public static void Error() { if (logMessageReceived != null) logMessageReceived("owned callback error", "", LogType.Error); }
    }
    public static class Debug { public static void LogError(string message) { Console.Error.WriteLine(message); } }
    public static class JsonUtility { public static T FromJson<T>(string text) { return (T)(object)Fixture.request; } }
}
namespace UnityEngine.SceneManagement
{
    public struct Scene { public bool isLoaded { get { return false; } } public bool IsValid() { return false; } public UnityEngine.GameObject[] GetRootGameObjects() { return new UnityEngine.GameObject[0]; } }
}
namespace UnityEditor.SceneManagement
{
    public enum OpenSceneMode { Additive }
    public static class EditorSceneManager { public static UnityEngine.SceneManagement.Scene OpenScene(string path, OpenSceneMode mode) { return new UnityEngine.SceneManagement.Scene(); } public static bool CloseScene(UnityEngine.SceneManagement.Scene scene, bool remove) { return true; } }
}
namespace UnityEditor
{
    public static class EditorApplication { public static bool isPlayingOrWillChangePlaymode, isCompiling; }
    public static class EditorUtility { public static bool scriptCompilationFailed; }
    public class MonoScript : UnityEngine.Object { public Type type; public Type GetClass() { return type; } }
    public static class AssetDatabase
    {
        public static T LoadAssetAtPath<T>(string path) where T : UnityEngine.Object { return Fixture.scripts[path] as T; }
        public static UnityEngine.Object[] LoadAllAssetsAtPath(string path)
        {
            Fixture.Checkpoint(path);
            if (Fixture.scenario == "data-errors" && path.EndsWith("Table2.asset")) throw new Exception("fixture data load failure");
            return Fixture.dataAssets[path];
        }
        public static bool TryGetGUIDAndLocalFileIdentifier(UnityEngine.Object target, out string guid, out long id) { guid = "0123456789abcdef0123456789abcdef"; id = target is MonoScript ? 11500000 : target.localId; return true; }
    }
    public static class PrefabUtility
    {
        public static UnityEngine.GameObject LoadPrefabContents(string path)
        {
            Fixture.Checkpoint(path);
            if (Fixture.scenario == "error" && path.EndsWith("Asset0.prefab")) throw new Exception("fixture load failure");
            if (Fixture.scenario == "logerror" && path.EndsWith("Asset0.prefab")) UnityEngine.Application.Error();
            return Fixture.assets[path];
        }
        public static void UnloadPrefabContents(UnityEngine.GameObject root) { }
    }
    public static class GameObjectUtility { public static int GetMonoBehavioursWithMissingScriptCount(UnityEngine.GameObject target) { return 0; } }
    public enum SerializedPropertyType { Generic, Integer, Boolean, Float, String, ObjectReference, ManagedReference, ArraySize, Character, FixedBufferSize, Enum, Vector2, Vector3, Vector4, Color, Rect, Bounds, Quaternion, Vector2Int, Vector3Int, RectInt, BoundsInt, AnimationCurve }
    public class Node { public string path, element, declaredType, text = ""; public long number; public float single; public double real; public UnityEngine.Vector3Int integers; public SerializedPropertyType type; public int depth; public bool array; public long id; public UnityEngine.Object reference; public int instanceId = 1; }
    public class SerializedObject : IDisposable
    {
        UnityEngine.Object target;
        public SerializedObject(UnityEngine.Object value) { target = value; }
        public SerializedProperty GetIterator() { return new SerializedProperty(target.nodes); }
        public void Dispose() { }
    }
    public class SerializedProperty
    {
        List<Node> nodes; int index = -1;
        public SerializedProperty(List<Node> values) { nodes = values; }
        public bool Next(bool children) { int depth = index < 0 ? -1 : nodes[index].depth; index++; if (!children) while (index < nodes.Count && nodes[index].depth > depth) index++; return index < nodes.Count; }
        public SerializedPropertyType propertyType { get { return nodes[index].type; } }
        public string propertyPath { get { return nodes[index].path; } }
        public string type { get { return nodes[index].declaredType ?? propertyType.ToString(); } }
        public long longValue { get { return nodes[index].number; } }
        public int intValue { get { return (int)nodes[index].number; } }
        public bool boolValue { get { return nodes[index].number != 0; } }
        public double doubleValue { get { return nodes[index].real; } }
        public float floatValue { get { return nodes[index].single; } }
        public string stringValue { get { return nodes[index].text; } }
        public string[] enumNames { get { return new string[] { "First", "Second" }; } }
        public string managedReferenceFullTypename { get { return "Fixture Table"; } }
        public UnityEngine.Vector2 vector2Value { get { return new UnityEngine.Vector2(); } }
        public UnityEngine.Vector3 vector3Value { get { return new UnityEngine.Vector3(); } }
        public UnityEngine.Vector4 vector4Value { get { return new UnityEngine.Vector4(); } }
        public UnityEngine.Color colorValue { get { return new UnityEngine.Color(); } }
        public UnityEngine.Rect rectValue { get { return new UnityEngine.Rect(); } }
        public UnityEngine.Bounds boundsValue { get { return new UnityEngine.Bounds(); } }
        public UnityEngine.Quaternion quaternionValue { get { return new UnityEngine.Quaternion(); } }
        public UnityEngine.Vector2Int vector2IntValue { get { return new UnityEngine.Vector2Int(); } }
        public UnityEngine.Vector3Int vector3IntValue { get { return nodes[index].integers; } }
        public UnityEngine.RectInt rectIntValue { get { return new UnityEngine.RectInt(); } }
        public UnityEngine.BoundsInt boundsIntValue { get { return new UnityEngine.BoundsInt(); } }
        public bool isArray { get { return nodes[index].array; } }
        public string arrayElementType { get { return nodes[index].element; } }
        public int arraySize { get { return 1; } }
        public SerializedProperty GetArrayElementAtIndex(int element)
        {
            var type = nodes[index].element == "byte" ? SerializedPropertyType.Integer : nodes[index].element == "string" ? SerializedPropertyType.String : SerializedPropertyType.Generic;
            var result = new SerializedProperty(new List<Node> { new Node { type = type } }); result.Next(true); return result;
        }
        public long managedReferenceId { get { return nodes[index].id; } }
        public UnityEngine.Object objectReferenceValue { get { return nodes[index].reference; } }
        public int objectReferenceInstanceIDValue { get { return nodes[index].instanceId; } }
    }
}
namespace UnityEditor.Compilation
{
    public class Assembly { public string name; public string[] sourceFiles; }
    public static class CompilationPipeline
    {
        public static Assembly[] GetAssemblies() { return new[] { new Assembly { name = "FixtureAssembly", sourceFiles = new[] { Path.Combine(UnityEngine.Application.dataPath, "Script4.cs") } } }; }
    }
}
