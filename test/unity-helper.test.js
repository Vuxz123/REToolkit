import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const helperUrl = new URL('../templates/Unity/REToolkitValidation.cs', import.meta.url);

// Source-owned contract tests: these do not claim an Editor execution or engine acceptance.
test('Unity helper exposes only the fixed batch entry and observation wire contract', async () => {
  const source = await fs.readFile(helperUrl, 'utf8');
  assert.match(source, /namespace REToolkit/);
  assert.match(source, /public static class EditorValidation/);
  assert.match(source, /public static void Run\(\)/);
  for (const value of ['-retkRequest', '-retkReport', 'retoolkit-unity-validation-request', 'retoolkit-unity-observation']) assert.ok(source.includes(value), value);
  for (const name of ['runId', 'graphRevision', 'unityVersion', 'complete', 'compilation', 'scripts', 'assets', 'diagnostics', 'assetId', 'path', 'guid', 'fileID', 'fullName', 'assembly', 'resolved', 'kind', 'loaded', 'missingScripts', 'missingReferences', 'severity', 'message']) assert.match(source, new RegExp(`public \\w+(?:<[^>]+>)?(?:\\[\\])? ${name}\\b`), name);
});

test('Unity helper observes real MonoScript long identities and actual runtime types', async () => {
  const source = await fs.readFile(helperUrl, 'utf8');
  assert.match(source, /LoadAssetAtPath<MonoScript>/);
  assert.match(source, /long localId/);
  assert.match(source, /TryGetGUIDAndLocalFileIdentifier\(script, out guid, out localId\)/);
  assert.match(source, /localId\.ToString\(CultureInfo\.InvariantCulture\)/);
  assert.match(source, /script\.GetClass\(\)/);
  assert.match(source, /type\.FullName/);
  assert.match(source, /type\.Assembly\.GetName\(\)\.Name/);
});

test('Unity helper traverses staged scenes, prefabs and serialized references without saving or playing', async () => {
  const source = await fs.readFile(helperUrl, 'utf8');
  for (const api of ['EditorSceneManager.OpenScene', 'EditorSceneManager.CloseScene', 'PrefabUtility.LoadPrefabContents', 'PrefabUtility.UnloadPrefabContents', 'GetMonoBehavioursWithMissingScriptCount', 'SerializedObject', 'SerializedPropertyType.ObjectReference', 'objectReferenceValue', 'objectReferenceInstanceIDValue']) assert.ok(source.includes(api), api);
  assert.match(source, /finally/);
  assert.doesNotMatch(source, /(?:SaveScene|SaveAssets|SaveAsPrefabAsset|EnterPlaymode|StartAssetEditing|ApplyModifiedProperties)\s*\(/);
  assert.doesNotMatch(source, /isPlaying\s*=\s*true/);
});

test('Unity helper fails closed with request, object, diagnostic and serialized byte limits', async () => {
  const source = await fs.readFile(helperUrl, 'utf8');
  assert.match(source, /MaxEntries = 10000/);
  assert.match(source, /MaxObjects = 200000/);
  assert.match(source, /MaxReportBytes = 16 \* 1024 \* 1024/);
  assert.match(source, /MaxProperties/);
  assert.match(source, /MaxDiagnostics/);
  assert.match(source, /complete = false/);
  assert.match(source, /Encoding\.UTF8\.GetByteCount/);
  assert.match(source, /EditorUtility\.scriptCompilationFailed/);
  assert.match(source, /EditorApplication\.isCompiling/);
  assert.match(source, /FileAttributes\.ReparsePoint/);
  assert.match(source, /Path\.GetFullPath/);
  assert.match(source, /Path\.GetDirectoryName\(full\)/);
  assert.match(source, /Assets\//);
  assert.match(source, /\.cs/);
});

test('Unity helper preserves nullable script identity sentinels on the JSON wire', async () => {
  const source = await fs.readFile(helperUrl, 'utf8');
  assert.doesNotMatch(source, /JsonUtility\.ToJson/);
  assert.match(source, /if \(value == null\) \{ json\.Append\("null"\); return; \}/);
  assert.match(source, /new UTF8Encoding\(false\)/);
  assert.match(source, /if \(severity == "error"\) report\.complete = false/);
  assert.match(source, /Application\.logMessageReceived -= observer\.Log/);
});
