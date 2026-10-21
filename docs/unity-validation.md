# Verify reconstructed exports in Unity

`reconstruct validate` imports a fresh source-only staging copy using the exact
Unity Editor version recorded in `ProjectSettings/ProjectVersion.txt`. It reports
compilation, observed MonoScript identities and missing component/reference counts.
It does not publish the staging project over the original export.

```powershell
node re.js assets index MyGame
node re.js assets session stop MyGame
node re.js reconstruct validate MyGame --timeout-seconds 600 --json
node re.js reconstruct validation MyGame --operation <UUID> --json
node re.js reconstruct validation MyGame --operation <UUID> --section scripts --limit 100
node re.js reconstruct validation MyGame --operation <UUID> --section assets --limit 100
node re.js reconstruct validation MyGame --operation <UUID> --section diagnostics --limit 20
```

Use returned cursors with the same operation and section. The shared MCP server
exposes `reconstruct_validate` and `reconstruct_validation`; it accepts no arbitrary
Editor flags, helper methods, output paths or eval text. Stop AssetRipper first:
Editor validation takes the same workspace lease.

The default Windows installation path is
`<ProgramFiles>/Unity/Hub/Editor/<exact-version>/Editor/Unity.exe`. A custom
`unityEditorPath` in `project.re.json` may name another installed `Unity.exe`.
The executable's embedded ProductVersion must match before launch; the helper's
actual `Application.unityVersion` must match afterward. A missing Editor reports
`blocked / unity_editor_missing`. REToolkit does not install an Editor or silently
upgrade the project.

Each run is retained under `04_Notes/assets/unity-validation/<UUID>`:

- `project/`: copied Assets, ProjectSettings and Packages plus the fixed helper;
- `request.json`: selected build, graph revision and requested script/asset IDs;
- `observation.json`: bounded actual Editor observations, if the helper ran;
- `receipt.json`: process/result provenance, hashes, readiness and coverage;
- `editor-output.txt`: bounded local output for compiler/infrastructure diagnosis.

Generated Library/Temp caches are excluded from the original copy. Copied source
hashes must match the graph, and original sources are rechecked before and after
execution. Symlinks/junctions, reserved helper paths and local/Git/unresolved package
dependencies are refused in this version; make dependencies portable first.
Staging isolates project writes but is not an OS sandbox: Unity import hooks and
Editor code belonging to that project can execute during import.

`compileReady:true` requires a closed successful process and a complete validated
report from the exact Editor. `bindingsVerified:true` additionally requires all
requested scripts to resolve to expected full type/assembly/GUID identities and
every requested scene/prefab to load without observed missing components or object
references. Binary scenes/prefabs are included even when the offline graph marked
them opaque. These flags apply to that exact source snapshot. Any later source,
metadata or build change makes the receipt stale. `behavior` remains `unverified`.

A compiler error can prevent the helper from running. A missing report, timeout,
nonzero exit, wrong run/version/GUID or incomplete observations cannot establish
readiness. Killing a process is a request; the supervisor waits for the actual close
event. Uncertain closure retains workspace/toolchain ownership and reports
`unity_recovery_required`; inspect retained markers rather than deleting them.

This completes the Editor verification portion of reconstruction slice3. DLL
conversion, explicit script rebinding, serialized-field migrations and gameplay
validation remain separate work. Existing source-apply receipts retain
`compileReady:false`; the independent Editor receipt supplies compilation evidence.

Run the source-owned real Editor acceptance fixture with
`npm run test:unity-validation -- 2022.3.62f2`. It exercises valid compilation and
binding, a missing script, and a deliberate compile error, preserving original
inventory after each staging run. Unit/fixture process tests do not prove real
Editor acceptance or real game compatibility.

The fixed helper uses Unity's public
[GUID/local fileID API](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/AssetDatabase.TryGetGUIDAndLocalFileIdentifier.html),
[MonoScript.GetClass](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/MonoScript.GetClass.html)
and [missing-script count API](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/GameObjectUtility.GetMonoBehavioursWithMissingScriptCount.html).
