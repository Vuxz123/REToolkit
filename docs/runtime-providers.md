# Replace an exported runtime DLL on a trial stage

An exported DLL may contain valid types and fields while its methods are inert.
Compilation and reference loading do not demonstrate that Slider, event systems
or other library behavior works. Inspect the actual assembly and relevant IL.

`libraries.runtime.plan` accepts an explicit local replacement DLL and an existing
`Assets/...dll` path with its original `.meta`. The bundled metadata reader does
not load or execute the target assembly. It checks assembly name/culture/key,
existing type names/base types/access, public/protected signatures and serialized
field names/types. Version differences are recorded as trials. Generic signature
constraints, dependency resolution and arbitrary reflection behavior still need
the exact Editor and runtime checks. A nontrivial method body is not behavioral
proof; constant getters can be legitimate implementations.

```powershell
retk libraries runtime plan Game --dll Assets/Plugins/UnityEngine.UI.dll --replacement "C:\explicit\UnityEngine.UI.dll" --json
retk libraries runtime apply Game --operation <plan-UUID> --json
retk libraries runtime verify Game --operation <plan-UUID> --json
```

The plan saves exact candidate bytes and metadata observations. Apply rechecks
the full source inventory and rederives the metadata comparison with the current
fixed helper before copying into a separate stage. It changes only the DLL;
all `.meta`, scenes, prefabs, data and other files retain their original bytes.
An incompatible plan reports concrete blockers. A partial or existing stage is
retained for inspection, never blindly replayed. No registry package, source
provider, manifest, lockfile or DLL dependency is silently installed or removed.

For a shared reconstruction artifact, invoke the same operations with
`recovery_run`, passing the current artifact UUID and revision. Planning retains
the revision; apply adopts the stage as a new generation. Use the returned
revision for subsequent operations. The typed MCP tools are
`libraries_runtime_plan`, `libraries_runtime_apply`, `libraries_runtime_verify`;
long calls can run through `jobs_start` with operation `recovery.run`.

`verify` establishes only staged inventory integrity. After adoption:

1. Run fresh `reconstruct.validate` on the original scene/prefab/data scope.
   Compare actual MonoScript GUID/local fileID/type identities; preserved `.meta`
   alone does not prove DLL subasset identities survived.
2. Run `data.verify` against the original baseline after this provider change.
3. Exercise the affected feature, including Slider value/visual response and
   UI event handling. Source compile and clean bindings alone are insufficient.

For SS2 the installed 6000.0.66f2 Editor contains candidate assemblies in its
`Data/Resources/PackageManager/ProjectTemplates/libcache/*/ScriptAssemblies`.
These are explicit local trial inputs, not an automatic selection rule or proof
of the game's original library version. Do not add `com.unity.ugui` beside an
existing provider DLL: resolve duplicate provider ownership first.
