# Local Unity library catalog and staging imports

`libraries` reads ZIPs from configured local folders, resolves versioned project
requirements, and imports a saved plan into an isolated Unity project. The
original reconstructed export and source ZIPs stay unchanged. No library roots
are configured by default; an empty catalog reports `unconfigured`.

## Agent package knowledge and version trials

Agents should read the bundled
[Unity package map and installation recipe](../skills/retoolkit-game-reconstruction/references/unity-packages.md)
when a Unity dependency is missing. It covers registry packages, engine modules,
external libraries and the Editor API route for registry installs. Registry
downloads are not a capability of the local `libraries_*` MCP tools.

The agent policy is **available version first**: a library need not match the
game's original release before a staging trial. Select an actual catalog release,
pass that version explicitly through `requirements`, import a ready plan and
verify the stage. Keep the original requirement and chosen trial separately in
the reconstruction ledger. If compile/integration errors reveal a version
mismatch, obtain the exact release next. Collision, dependency, Editor, payload
and freshness checks still apply; DLL/stub replacement is separate work.
Default manifest requirements remain unchanged, so the agent must send explicit
trial requirements instead of repeatedly retrying the original version.

## Configure and inspect

Register the folders containing your library ZIPs through the CLI:

```powershell
node re.js libraries roots list
node re.js libraries roots add "D:\UnityLibraries"
node re.js libraries scan --json
node re.js libraries list --limit 100 --json
node re.js libraries list --query dotween --limit 20 --json
```

Roots are read-only sources, searched for ZIP files. Links/junctions, overlapping
roots and unsafe ZIP entries are rejected. The toolkit-local configuration is
`.retk-libraries.json`, which is ignored by Git:

```json
{
  "schemaVersion": 1,
  "libraryRoots": [],
  "libraryImportPolicy": "auto-staging-on-unique-match"
}
```

The policy permits an agent to import a unique compatible saved plan into staging.
It does not trigger downloads or infer an installation from a compile error.
Scanning stores the content-bound catalog under `.cache/libraries/`. Rescan after
changing roots or ZIP contents. ZIP names alone do not establish a release.

## Shared DOTween source from Yarn Fever!

The optional local shared snapshot in `libraries/dotween/` comes from
`C:/Users/DPC00176/RiderProjects/threadscrew`, whose Unity product name is
`Yarn Fever!`. It contains DOTween core **1.2.335**: runtime and Editor DLLs,
modules, documentation, resources and original `.meta` files. DOTween Pro,
DemiLib, examples and the game's DOTween settings are excluded. The source
project was read only; no game export was changed and no Unity import ran.

The snapshot ZIP and its private provenance are local inputs, not distributed in
this source repository. Fresh checkouts can register their own authorized library
folders. The two snapshot-specific tests skip when the local archive is absent;
descriptor and synthetic catalog/import regression tests still run.

The release was read from the runtime DLL's static constructor IL using
reflection-only metadata inspection. Its assembly version is separately
`1.0.0.0`. The snapshot receipt binds all 37 source paths and hashes, records
the static identity evidence, and verifies the ZIP through fresh extraction
and a second source inventory. Original copyright/license notices are retained.

The built-in DOTween descriptor pins only archive SHA-256
`e50be4124b46cfcbceb300c8cc6b6cdaad8ca7f7a9365179979190cd4d2f26e0`,
root `Assets`, release `1.2.335`. The current machine registers this repository's
`libraries/` directory through the standard roots API. Other checkouts can
register their own absolute `libraries/` path with `libraries roots add` and
scan it normally. A different archive hash does not inherit the release pin.

This establishes an available shared package and exact release recognition.
The catalog still reports uninspected managed DLL metadata, unverified plugin
importer settings and conditional C# module declarations. Those compatibility
gates remain in force for integration; the package has not been imported,
compiled or verified against a reconstructed game.

## Identify requirements and save a plan

The selected workspace must already have scanned native/metadata inputs and an
exported Unity project under `05_ReconstructedSource`. Stop active AssetRipper or
Ghidra sessions before library workspace operations.

```powershell
node re.js libraries identify MyGame --section requirements --limit 100 --json
node re.js libraries identify MyGame --section installed --limit 100 --json
node re.js libraries identify MyGame --section candidates --query tween --limit 20 --json
node re.js libraries plan MyGame --json
```

When requirements are omitted, identification and planning use the exported
package manifests, including `Packages/manifest.json`, verified against the current
source graph. Manifest/lock declarations alone do not prove installed contents.
Namespace, type, assembly and filename observations remain hints. An installed
package requires an exact payload inventory; a stub or partial copy does not
count as integrated.

An explicit UTF-8 requirements JSON file overrides manifest requirements:

```json
{
  "kind": "retoolkit-library-requirements",
  "schemaVersion": 1,
  "packages": [
    {"id": "com.example.library", "version": "1.2.3"}
  ]
}
```

```powershell
node re.js libraries identify MyGame --requirements requirements.json --json
node re.js libraries plan MyGame --requirements requirements.json --json
```

The DTO allows only these fields, with at most 64 package requirements. Use the
catalog's `libraryId` as the requirement ID. Use the selected available version
for a trial even if the original manifest names another release. Exact selected
versions and supported simple compatible ranges can be resolved; the resolver
never chooses latest implicitly. It checks
the full dependency closure and blocks missing, ambiguous, incompatible or
conflicting candidates, unsupported ranges, dependency cycles, and path, GUID,
type or assembly collisions. Existing source/DLL replacements require separate
migration work.

Plans return `ready`, `satisfied` or `blocked`, an `operationId`, issues, and a
`storedPlan` path. Full artifacts live under
`04_Notes/assets/library-plans/<operationId>.json`; compact CLI responses omit the
full payload inventory. Review blocking issues before importing.

List and identify results are paged. Reuse `nextCursor` with the same command,
section, query and revision. `identify` defaults to `candidates`; its other
sections are `installed` and `requirements`. The full identification artifact is
`04_Notes/assets/libraries-identification.json`.

## Import and verify

Use the saved operation UUID, with the exact Unity Editor version named in the
export's `ProjectSettings/ProjectVersion.txt` installed locally:

```powershell
node re.js libraries import MyGame --operation <UUID> --json
node re.js libraries verify MyGame --operation <UUID> --json
```

The importer revalidates the plan against the current project and catalog,
privately re-extracts the source ZIPs, and verifies complete payload paths and
hashes. Every payload stages before publication. A missing exact Editor reports
`blocked / unity_editor_missing`; the toolkit does not upgrade the project.
See [Editor selection and ownership recovery](unity-validation.md).

UPM payloads become portable embedded `Packages/<packageId>` folders, retaining
their package manifests. A fixed Editor helper requests package resolution and
waits asynchronously for the requested embedded identities. The toolkit does not
hand-edit the project's root package manifest. Local/Git/unresolved package
dependencies remain blocked. `Packages/retk-libraries.lock.json` records exact
managed payloads and source catalog/archive identities; subsequent staging checks
verify that lock and each complete managed folder inventory.

Assets payloads retain their `Assets/` paths and supplied `.meta` bytes. Unity may
create metadata for previously missing entries; generated metadata is recorded
after original payload hashes pass. Supplied GUIDs are never regenerated to
resolve a collision. A narrow staged `ProjectVersion.txt` normalization may add
the matching Editor build revision, which is recorded in the receipt.

Import artifacts live under
`04_Notes/assets/library-imports/<operationId>/`: `project/`, the fixed
`request.json`, `observation.json` when available, and `receipt.json`. Repeated
import verifies the saved receipt and current stage bytes. Changed source, ZIP,
catalog, plan, control artifacts or staging files invalidate reuse. An unfinished
operation requires inspection and a fresh plan; it is not silently resumed or
promoted into the original export.

`state: imported` establishes package resolution, with `compileReady:false`,
`bindingsVerified:false` and `uiVerified:false`. `verify` runs fresh
[Unity compilation and binding validation](unity-validation.md) against the
imported staging graph and stores a new verification report. Its `compileReady`
and `bindingsVerified` flags apply to that exact snapshot and observed coverage.
UI and gameplay behavior remain unverified. Missing reports, compiler failures,
timeouts or unconfirmed child closure cannot establish readiness; uncertain
closure retains ownership gates for recovery.

## Recognized formats and limits

UPM recognition uses an actual `package.json` with an exact version and package
identity. Assets recognition can use exact release metadata plus a real `.asmdef`.
An Assets metadata record uses this strict schema:

```json
{
  "kind": "retoolkit-library-metadata",
  "schemaVersion": 1,
  "id": "com.example.library",
  "version": "1.2.3",
  "dependencies": {}
}
```

Place `.retk-library.json` within the actual `Assets` payload; it supplies data,
never executable adapters. Built-in descriptors cover names such as DOTween,
UniTask, Newtonsoft.Json, TextMesh Pro, Cinemachine, Input System, URP, Spine,
Odin and FairyGUI. Namespaces and assembly names are recognition hints, not proof
of an exact version. A verified exact-content descriptor pin can establish
otherwise missing release metadata, as with the local DOTween snapshot above.

Nested ZIPs are not recursively searched. Inner `.unitypackage` tar/GUID/path
inspection is unsupported, including one found inside an otherwise recognized
package. Uninspected DLL identities, native/plugin payloads, malformed assembly
definitions and unsupported C# declarations block automatic integration when
compatibility or duplicate implementations cannot be established. The catalog
does not execute DLLs or setup instructions. Unity staging can execute package
Editor/import hooks; it isolates project writes and is not an OS sandbox.

## Agent and MCP workflow

Use the existing `node re.js assets mcp MyGame` stdio server configured in the
[AssetRipper AI guide](assetripper-ai.md#mcp-configuration). It exposes typed
`libraries_scan`, `libraries_list`, `libraries_identify`, `libraries_plan`,
`libraries_import` and `libraries_verify` over the same service as the CLI.
Requirements are the inline DTO above; import/verify accept `operationId`.
List/identify accept bounded paging, and identify accepts `section`. Root
registration remains CLI-only: MCP cannot introduce filesystem roots, output
paths, arbitrary Editor methods, shell commands or downloads.

An agent can scan/list, inspect requirements and candidates, save a unique ready
plan, import its UUID, then verify it. Report missing/candidate/installed/imported
states separately and preserve the distinction between resolution and fresh
compilation/binding evidence.

The source-owned acceptance test used actual Unity **2022.3.62f2**: UPM staging
import, package resolution, compilation and binding verification succeeded, with
one requested script and zero prefabs. Original ZIP/export hashes remained
unchanged. Run `npm run test:libraries -- 2022.3.62f2` to repeat the fixture. No
actual vendor ZIP was qualified by that Unity acceptance fixture; the later
DOTween source snapshot above has only archive and static identity verification.
Neither establishes vendor-library, real-game, UI or gameplay compatibility.
