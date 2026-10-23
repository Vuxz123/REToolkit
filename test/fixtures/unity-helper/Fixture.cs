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
            int count = scenario == "data-errors" ? 4 : scenario == "data-limits" ? 3 : 2;
            for (int index = 0; index < count; index++)
            {
                string assetPath = "Assets/Table" + index + ".asset";
                var table = new Table { name = "Table" + index };
                table.nodes.Add(new UnityEditor.Node { path = "m_Script", type = UnityEditor.SerializedPropertyType.ObjectReference, reference = scenario == "data-missing-script" && index == 0 ? null : new UnityEditor.MonoScript(), instanceId = 0 });
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
                dataAssets[assetPath] = objects;
                entries.Add(new EditorValidation.Entry { assetId = "asset" + index, path = assetPath, kind = "asset" });
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
class PlainClass { }
class Table : UnityEngine.ScriptableObject { }

namespace UnityEngine
{
    public class Object { public string name = "Object"; public List<UnityEditor.Node> nodes = new List<UnityEditor.Node>(); }
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
        public static bool TryGetGUIDAndLocalFileIdentifier(UnityEngine.Object target, out string guid, out long id) { guid = "0123456789abcdef0123456789abcdef"; id = 11500000; return true; }
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
    public enum SerializedPropertyType { Generic, Integer, Boolean, Float, String, ObjectReference, ManagedReference }
    public class Node { public string path, element; public SerializedPropertyType type; public int depth; public bool array; public long id; public UnityEngine.Object reference; public int instanceId = 1; }
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
