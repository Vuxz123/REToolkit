# AssetRipper provider qualification

Date: 2026-10-20. Task3 provider only. No user game was loaded, exported or modified.

## Implementation

`src/assets/session.js` starts a detached owned worker, status/stop/query clients,
and the synchronous descriptor-presence gate. `worker.js` owns the existing
workspace lock and toolchain reader for the entire observed engine lifetime.
An extra `assets-engine-<runId>.json` marker exists before spawning. Forced owner
death, uncertain child close and uncertain transaction recovery retain ownership;
there is no PID-based recovery action. Queued operations recheck the stop/recovery
gate immediately before execution. Network operations retain the captured lock
context through `AsyncResource.bind`.

Private ACL runtime directories hold config, tokens, captured logs, and verified
copies of the installed executable and DLLs. Shared installed settings are not
copied or modified. AssetRipper1.3.14 uses executable-relative
`AssetRipper.Settings.json`; the provider deliberately uses its upstream defaults
in the private launch directory. Upstream file logging is disabled with the
accepted1.3.14 syntax `--log=false`; captured stdout has a4MiB limit. The engine
binds `--port 0`; only the endpoint
advertised by that owned child's startup output is probed. Required operations
must appear in `/openapi.json` before transport readiness.

RPC is authenticated NDJSON over a separate owned loopback socket: 64KiB request
frames and 2MiB response frames, bounded sockets/queues/deadlines. Large typed
operations use a maximum32MiB private UUID envelope; callers cannot supply a path.
Load/export are serialized jobs with independently observable status. A successful
load command is required before raw reads or export; transport readiness is not
load verification. Raw selectors preserve signed64 PathID numeric tokens without
rounding. Binary reads use base64 and bounded data.

Publication is confined to the05_ReconstructedSource subtree, validated before
staging and again immediately before publication. Reserved workspace control
paths cannot become export destinations. Exports target a fresh empty stage.
A unique Unity root and
ProjectSettings/ProjectVersion.txt must exist before publication. The previous
export is renamed to a unique backup, project state is updated to the actual
nested Unity root, and the journal records publication. Post-save failure restores
the exact original project.re.json bytes and prior export; uncertain rollback
retains all ownership gates. State records export_ready, compileReady:false,
bindingsVerified:false and behavior:unverified.

## Automated fixture evidence

Command: `node --test test/assets-provider.test.js`.

15 tests passed. Cases cover one persistent load; exact negative/positive64-bit
source identifiers; fresh repeated export/backup; content drift; oversized wire
frames and engine output; redirects; authentication; HTTP failure; silent export
failure; missing OpenAPI capabilities; early child exit; active request deadlines;
job deadline and observed close; writer exclusion; forced owner death; repeated
large reconstruct.plan envelopes; failed-load export/raw refusal; exact project
JSON rollback after save; and queued operation refusal following uncertain
reconstruction while preserving workspace/read/startup gates. Reserved destination
regressions preserve exact project and active lock marker bytes and verify that
no engine export is invoked.

The HTTP engine is source-owned `test/fixtures/assetripper-engine.mjs`. These tests
qualify orchestration and fixture exports, not real Unity loading/export fidelity.

## Real installed engine evidence

Command: `node test/real-assets.mjs C:/Users/DPC00176/REToolkit`.

Latest observed successful run: `3d8ec362-431f-4ec8-83cf-8df5b8f102ad`.
Installed AssetRipper1.3.14 started from its verified private executable/DLL copy,
advertised loopback HTTP, and exposed the required pinned routes. Owned stop
observed child close, removed the workspace lock and left zero reader leases.
The dependency-only skipLoad seam ensured no user or fixture input was loaded.
The smoke also verifies that no uncapped upstream AssetRipper file log is created.

Advertised raw routes included Audio, Binary, Font, Image, Json, Model.glb, Text,
Video and Yaml; LoadFolder and Export/UnityProject were advertised too. This smoke
does not establish real export fidelity, Unity compilation, component binding
validation or gameplay equivalence.

## Upstream settings/protocol references

- [1.3.14 executable-relative settings](https://raw.githubusercontent.com/AssetRipper/AssetRipper/1.3.14/Source/AssetRipper.Export/Configuration/SerializedSettings.cs)
- [1.3.14 loopback and route registration](https://raw.githubusercontent.com/AssetRipper/AssetRipper/1.3.14/Source/AssetRipper.GUI.Web/WebApplicationLauncher.cs)
- [1.3.14 destructive nonempty export behavior](https://raw.githubusercontent.com/AssetRipper/AssetRipper/1.3.14/Source/AssetRipper.GUI.Web/GameFileLoader.cs)
- [1.3.14 source PathID serialization](https://raw.githubusercontent.com/AssetRipper/AssetRipper/1.3.14/Source/AssetRipper.GUI.Web/Paths/AssetPath.cs)
- [1.3.14 source collection serialization](https://raw.githubusercontent.com/AssetRipper/AssetRipper/1.3.14/Source/AssetRipper.GUI.Web/Paths/CollectionPath.cs)
