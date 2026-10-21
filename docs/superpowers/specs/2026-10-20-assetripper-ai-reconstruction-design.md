# AssetRipper AI bridge and Unity script reconstruction

Date: 2026-10-20. Status: approved by user ("chốt phạm vi"); slices1 and2 authorized.
User confirmed the target is the Unity project exported by AssetRipper.
JavaScript remains the CLI/orchestration language. This is a separate development
scope from the pending Python/MCP qualification changes; preserve those changes
and all unrelated files.

## Intended outcome

AI can inspect the game structure, follow references, correlate serialized script
components with IL2CPP evidence, reconstruct C# incrementally, and attach that C#
to the correct exported components without discarding serialized values.

The workflow is:

1. Load the same selected build in an owned persistent AssetRipper session.
2. Export into a fresh staging directory and verify a Unity project layout.
3. Index exported scenes, prefabs, assets, components, scripts and references.
4. Link script identities to IL2CPP metadata and Ghidra evidence from that build.
5. Produce a reviewable reconstruction/binding plan, then apply it transactionally.
6. Compile and inspect the reconstructed project in the matching Unity Editor.

Graph extraction, source reconstruction, compilation, reference validation and
gameplay equivalence are separate results. A compiled method is not proof that
the original behavior has been recovered. Missing/ambiguous data stays explicit.

## Existing capabilities and constraints

The local AssetRipper marker is1.3.14. REToolkit currently has a legacy one-shot
PowerShell adapter using LoadFolder/ExportUnityProject; the JavaScript CLI calls
that adapter. It does not provide a persistent asset-query bridge or script
rebinding workflow. Its existing nonempty-directory export check is insufficient
for declaring a reconstructed project valid.

The pinned upstream1.3.14 source has loopback HTTP endpoints for individual asset
JSON/YAML/binary/media, loading and exporting, plus OpenAPI documentation. Some
collection/scene/search surfaces are HTML views, not bulk structured APIs. Do not
promise complete live enumeration from those endpoints without a capability
check. The exported Unity project is the canonical structured index for v1.

Source AssetRipper collection/PathID identity and exported Unity GUID/fileID
identity are distinct. Source-to-export links are verified where evidence allows;
names alone never establish that mapping. Source PathID is signed64-bit; Unity
fileID can also exceed JavaScript safe integers. Preserve both losslessly as
decimal strings internally and encode numeric tokens losslessly at API boundaries.

## Approaches considered

1. Recommended: Node.js bridge over the existing AssetRipper HTTP API, plus an
   exported-project graph and reconstruction planner. Reuses the installed engine,
   keeps the CLI JavaScript, and covers reading and script attachment. Live raw
   operations are limited to capabilities actually advertised by the pinned engine.
2. Embedded C# provider in an AssetRipper source build. Enables custom typed bulk
   traversal and exporter mapping hooks, but requires a maintained engine build.
   Add this provider later if the stock API/export evidence leaves required gaps;
   use the same bridge schema so clients do not need a different workflow.
3. Export-only filesystem tools. Useful for graph indexing, but insufficient as
   the entire design because the user also wants live engine access and a bridge.

## Components

### 1. Persistent AssetRipper provider

Node owns start/status/stop and serializes load/export operations. Launch only a
toolkit-owned headless child on loopback, retaining engine and workspace leases
until actual close. Never attach blindly to an occupied port, reset a user's GUI,
or terminate a process identified only by PID. The supervisor binds runId,
workspace, executable identity, input manifest and settings fingerprint.

Probe the pinned OpenAPI/capabilities before exposing an operation. No scraping
HTML as a supposedly stable complete JSON API. Keep reads bounded, paginate
results, reject redirects outside the owned endpoint, sanitize logs and enforce
deadlines. Long import/export runs are explicit jobs with status; a timeout does
not declare completion or authorize releasing uncertain ownership.

Determine AssetRipper's actual default-settings location before implementation.
Keep configuration/logs private to the run; if settings are executable-relative,
use a verified private launch copy rather than modifying shared installed settings.
Expose typed operations, not arbitrary HTTP paths, shell commands or code eval.

Export only to an empty private stage. Upstream headless export can delete a
nonempty output folder, so never send the existing reconstructed project as that
destination. Verify Assets, ProjectSettings/ProjectVersion.txt and export results
before journaled publication; preserve a previous project and user edits.

### 2. Asset/scene graph

Index the actual exported project root, including nested ExportedProject layouts.
Parse Unity YAML documents, .meta and assembly definitions with bounded lossless
parsing. Preserve unknown fields and document IDs; do not infer references through
regular-expression replacement. Unsupported binary/custom formats are recorded
as unsupported or opaque, not silently treated as empty.

Nodes include scenes, prefabs/variants, GameObjects, Transforms, components,
MonoScripts, ScriptableObjects, materials, textures, meshes, animation controllers
and clips. Edges include parent/child, component ownership, prefab correspondence,
asset dependencies, serialized references, script references and UnityEvent targets.

Canonical exported object identity is project/build binding + asset GUID + local
fileID. Store original paths, class IDs, full script type/assembly identity and
available source collection/PathID separately. Index incoming and outgoing edges.
Track missing references, duplicate GUIDs, ambiguous types, prefab overrides and
coverage. Queries return a selected subtree or paged neighborhood, not the entire
game graph in every response.

The index is a versioned on-disk snapshot with revision/fingerprint and bounded
node/edge records. Asset inputs/settings matter even when the native binary did
not change. Changed inputs, .meta, scene, prefab or assembly files invalidate the
relevant snapshot and stale mutation plans. Do not read or modify Unity Library
and other generated caches as source assets.

### 3. Script identity and reconstruction map

Resolve component -> m_Script reference -> exported MonoScript -> full type and
assembly identity. Join it to the workspace's Il2CppDumper metadata and Ghidra
function evidence only when native/metadata/build bindings agree. A matching
short class name is insufficient. Surface candidate ambiguity for user/AI review.

Each mapping carries serialized field names/types, evidence source identifiers,
method selectors/RVAs where verified, evidence coverage, reconstructed source
hash, expected script identity and binding status. Keep metadata declarations,
native pseudocode and AI-authored C# distinguishable. The bridge exposes evidence;
the user's AI client reconstructs source. REToolkit does not invent a second AI
service or assume pseudocode is original C#.

First prefer filling an existing exported .cs stub while keeping its .meta GUID,
class/namespace/assembly identity and serialized fields. This can preserve existing
m_Script references without rewriting every scene or prefab.

DLL MonoScript references and .cs references may have different local fileIDs.
Do not assume every target is fileID11500000. A DLL-to-C# conversion, type move,
renamed serialized field or changed field type requires an explicit migration
plan and verified target identity. Unity Editor validation supplies actual target
GUID/local fileID when offline evidence cannot establish it. No guess-based
rebind or silent regeneration of .meta files.

### 4. Planned writes and Unity validation

Use plan/apply/verify for C# replacement, explicit script rebinding and supported
serialized-field migrations. Plans list exact files, objects and before/after
values, with source graph revision and per-file hashes. Preserve fields, object
references, enabled state, prefab correspondence and overrides outside that plan.

Apply holds the workspace lease, rechecks every precondition, stages all changes,
backs up exact bytes and journals publication/rollback. Repeated operation IDs
are idempotent. Stale plans fail; uncertain rollback retains ownership/evidence.
Unsupported binary assets or complex migrations require an Editor operation,
rather than rewriting bytes speculatively. Mutations stay inside the selected
exported project and never alter the original APK/native binary.

A fixed C# Editor helper may compile/import and inspect the reconstructed project;
the orchestration remains Node. The helper validates actual MonoScript identity,
missing scripts, reference integrity and scene/prefab load results. It reports
compiler diagnostics and failures rather than automatically entering Play Mode or
executing arbitrary AI-supplied Editor commands. Validate in a staging copy first.

Statuses distinguish export_ready, graph_ready, scripts_mapped, source_applied,
compile_ready, bindings_verified and behavior_unverified. No success label jumps
from export or compilation to a claim of equivalent gameplay.

## CLI and AI surface

Proposed new command namespace avoids replacing legacy GUI launchers:

- node re.js assets session start|status|stop <Game>
- node re.js assets export|index <Game>
- node re.js assets list|tree|get|refs|scripts <Game> with typed selectors/paging
- node re.js assets mcp <Game> for a stdio AI client
- node re.js reconstruct plan|apply|verify <Game> with an explicit plan file

MCP exposes asset search/details, scene/prefab trees, component fields, incoming/
outgoing references, script-map/evidence queries and reconstruction plan/apply
operations. It uses the same validated services as the CLI. Asset text, names and
decompiled strings are untrusted data, never tool instructions or authority.

## Delivery slices and acceptance

1. Provider + export/index + CLI/MCP reads. Acceptance: a source-owned fixture
   exports and its scene hierarchy, components and cross-asset references can be
   queried with exact IDs; owned-child failure/lease/resource-limit tests pass.
2. Script/evidence map + transactional .cs stub filling. Acceptance: a fixture
   component retains script GUID and serialized values after replacement; stale
   plans, ambiguity and input mismatch are refused; rollback restores exact bytes.
3. Explicit rebind/migrations + Editor verification. Acceptance: a fixture DLL-to-
   C# or missing-script case resolves to verified targets, compiles and loads its
   scenes/prefabs without reference loss in a matching installed Editor.
4. Incremental real-build reconstruction. Report coverage/missing data, verify
   representative gameplay separately and expand supported component patterns.

The first implementation should deliver slices1 and2, with hooks/state prepared
for slice3. These are independently reviewable work packages. No entire-game
automatic reconstruction or exact IL2CPP-to-original-source claim is a v1 promise.

## Sources inspected

- [AssetRipper1.3.14 route registration](https://raw.githubusercontent.com/AssetRipper/AssetRipper/1.3.14/Source/AssetRipper.GUI.Web/WebApplicationLauncher.cs)
- [Asset JSON/YAML API](https://raw.githubusercontent.com/AssetRipper/AssetRipper/1.3.14/Source/AssetRipper.GUI.Web/Pages/Assets/AssetAPI.cs)
- [Loading/export and nonempty destination deletion](https://raw.githubusercontent.com/AssetRipper/AssetRipper/1.3.14/Source/AssetRipper.GUI.Web/GameFileLoader.cs)
- [Source asset identity](https://raw.githubusercontent.com/AssetRipper/AssetRipper/1.3.14/Source/AssetRipper.GUI.Web/Paths/AssetPath.cs)
- [Collection endpoint limitations](https://raw.githubusercontent.com/AssetRipper/AssetRipper/1.3.14/Source/AssetRipper.GUI.Web/Pages/Collections/CollectionAPI.cs)
- [Unity GUID/local fileID API](https://docs.unity3d.com/6000.0/Documentation/ScriptReference/AssetDatabase.TryGetGUIDAndLocalFileIdentifier.html)
- [Unity asset metadata](https://docs.unity3d.com/6000.0/Documentation/Manual/AssetMetadata.html)
