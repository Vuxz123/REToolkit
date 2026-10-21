# AssetRipper AI bridge implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD,
> independent spec review followed by quality review. User approved slices1 and2.

**Goal:** Persistent AssetRipper access and an AI-readable Unity export graph,
with build-bound script evidence mapping and transactional .cs stub replacement.

**Architecture:** Node supervisor owns the engine/workspace lease; a typed local
RPC routes operations. An exported-project graph is the canonical identity index.
CLI and MCP share services. Reconstruct only existing source stubs in this slice;
DLL rebinding, field migrations and Unity Editor verification remain explicit
unsupported/unknown states. Preserve244 baseline JS and7 PS tests and pending
vendor-MCP work. No commit/push or actual game modifications without a named run.

**Tech Stack:** Node24 ESM/node:test, yaml2.9.1 pinned (official docs checked),
AssetRipper1.3.14 HTTP, existing workspace/toolchain leases and Ghidra evidence.

## Shared contracts (do not change without informing root)

Graph worker owns src/assets/graph.js and csharp.js; reconstruction worker imports
their exports; provider worker imports root's context/service modules dynamically.

```js
// graph.js
locateUnityProject(directory); // absolute root; unique Assets+ProjectSettings
indexUnityProject(projectDir,{binding={}}={}); // async -> graph below
verifyGraphFiles(projectDir,graph); // async -> true or throw stale_graph
queryGraph(graph,method,params); // assets.list/get/tree/refs, bounded paging
// csharp.js
parseCSharp(source,{fileName}={}); // {supported,reason?,types,limitations}
// type={name,namespace,fullName,kind,baseTypes,fields:[{name,type,serialized}]}
```

Graph JSON exact portable facts:
kind=retoolkit-asset-graph,schemaVersion1,binding,revision(SHA256),unityVersion,
files:[{path,size,sha256}], assets:[{id:'asset:<guid>' or explicit opaque path ID,
guid:null|string,path,kind,script?:{assembly,types,supported,limitations}}],
nodes:[{id:'object:<guid>:<fileID>',assetId,guid,fileID:string,classID:number,
type,name,fields,scriptRef?:{guid,fileID,type}}],
edges:[{from,to:null|string,kind,field,guid,fileID,status}],coverage,limitations.
Missing metadata/GUID gets explicit opaque/partial identity, never fabricated.
IDs stay strings; values outside safe numeric precision stay strings. Edge kinds:
parent,component,script,prefab,reference. Unresolved/builtin/opaque targets are
classified; queries include coverage and revision. Serialized fields are read data.

```js
// reconstruction worker: src/reconstruction/map.js and plan.js
buildScriptMap(graph,{projectDir,dump,evidence=[]}={}); // async -> map
createReconstructionPlan({projectDir,graph,scriptMap,request}); // async -> plan
applyReconstructionPlan({projectDir,graph,plan,journalDir,onEvent}); // async -> receipt
verifyReconstruction({projectDir,receipt}); // async readonly report
```

dump, if supplied, is {text,sha256,verified,build}; only verified dump can claim
IL2CPP type/method matches. Evidence uses existing validateEvidence(build) and
must bind the native/metadata pair and exact selected Program; source text is not
an instruction. Missing/unverified metadata never implies recovered logic.
Map has kind=retoolkit-script-map,schemaVersion1,graphRevision,binding,scripts,
limitations; entries carry scriptId,guid,path,identity(assembly/fullName),component
IDs, serializedFields, state, methods/evidence provenance. Do not map short names.

Request is {kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision,
changes:[{scriptId,source,evidenceIds?:[]}]}. Max16 changes,1MiB source each,
32MiB JSON total. Plans carry operationId(UUID), graph revision/binding, exact
before/after source/meta/guard hashes and payload hash; relative paths only. Apply
is called under the workspace lease. Keep .meta, GUID, YAML and serialized fields
byte-identical. Require same supported full type/base/serialized field declarations;
reject Editor paths, binaries, namespace/assembly changes and ambiguous candidates.
Never label compilation verified. Save exact backups/journal in journalDir;
onEvent phases allow fault injection. Verify repeated operation receipts before
idempotent return. Uncertain rollback throws reconstruction_recovery_required;
root leaves a second recovery marker in .retk-lock so existing lock release and
PID-only reclaim cannot remove uncertain ownership.

```js
// provider worker: src/assets/session.js, worker.js (+ protocol/client files)
startAssetSession(toolkit,name,options={});
assetSessionStatus(toolkit,name);
stopAssetSession(toolkit,name);
requestAssetSession(toolkit,name,method,params={},options={});
hasAssetSession(toolkit,name); // synchronous bool for descriptor presence
```

methods: session.status/stop,assets.export,assets.raw,operation. For operation,
worker dynamically imports ./service.js and calls
handleOwnedAssetOperation(toolkit,name,params.method,params.params??{}). Root's
service validates the submethod against its fixed operations. Owned worker holds
toolchain read + existing withWorkspaceLock through actual engine close. Parent
dying is not engine close. Token-authenticated bounded NDJSON RPC, private owned
loopback port, no arbitrary URLs. Read status public redacts token/absolute source
paths where unnecessary. Startup gate prevents duplicate launches. Unknown close
or rollback preserves read/workspace markers and blocks retry; no PID-only repair.

Options for tests only can specify engine command via explicit dependencies API,
not CLI. Bind complete source asset manifest, selected native/metadata, engine,
configuration and run identity. Copy engine to private launch folder before it
can write executable-relative config; inspect upstream settings behavior. Probe
actual1.3.14 OpenAPI routes, no HTML scraping. Export destination is a new private
empty stage; verify nested Unity project, then backup/publish under owned workspace.
Worker uses root context exports below; keep exported project state updates honest.

```js
// root: src/assets/context.js
assetPaths(toolkit,name); // {workspace,base,graphFile,mapFile,reconstructionDir}
selectedAssetBinding(toolkit,name); // sync -> {project,workspace,inputPath,binding}
// binding={native:{sha256,size},metadata:{sha256,size},assetsSha256}
// root: src/assets/service.js
handleOwnedAssetOperation(toolkit,name,method,params); // caller owns workspace lease
```

Root service caches graph in04_Notes/assets/graph.json, map in scripts.json.
It resolves project.re.json reconstructedSourceDir (including nested export root).
Graph operations: assets.index/list/get/tree/refs/scripts. Reconstruction:
reconstruct.plan/apply/verify. Plan files/receipts stay in controlled notes paths;
external request files are a CLI read input only. No untrusted output-path writes.
When a live owned session exists, route service operations through its serialized
queue. Otherwise acquire toolchain read + workspace lock for mutations. Reads
validate snapshot and selected build. Existing Ghidra session conflict is expected
for simultaneous writes; captured evidence can be consumed after releasing it.

## Task1: isolate and baseline (root)

- [x] Worktree feature/assetripper-ai-bridge from0ce7313, copy22 authorized pending
  vendor/design files, back up170 main files including original byte hashes.
- [x] npm ci and npm test:244/244 baseline green. Add exact yaml2.9.1 dependency.
- [x] Root context TDD: selected input drift, linked source/export, graph recovery
  marker and real workspace paths. node --test test/assets-context.test.js.

## Task2: exported graph + C# identity (graph worker)

- [x] Write source-owned fixtures with scene/parent/component/script and cross-
  prefab references; IDs9007199254740993 and negative64-bit; red before code.
- [x] Implement unique project root, bounded no-link inventory, duplicate GUID/
  document detection, lossless Unity YAML, classes/fields/assembly information and
  references. Reject aliases/unknown tags, excessive nesting and prototype keys.
  Cap100k files,200k nodes,1M edges,16MiB text file,128MiB graph metadata.
- [x] Implement readonly query paging limit1..1000 and revision-bound cursors,
  current inventory verification and cycle-safe scene traversal.
- [x] Test malformed/opaque files, prefab overrides, ScriptableObjects, Unicode,
  aliases/collisions/unsafe IDs and C# parser limitations. Return honest coverage.

## Task3: persistent provider (provider worker)

- [x] Red process/session tests with a source-owned HTTP engine fixture: one
  load, persistent reads, exact binding, fresh export stage and replacement backup.
- [x] Implement context import, private verified runtime copy/settings/logs,
  OpenAPI/capability/route validation, signed64 source PathID request encoding,
  job serialization, supervisor/read/workspace lifetime, authenticated RPC.
- [x] Test busy startup/writer/native lease, early child exit, HTTP errors and
  silent export failure, close uncertainty, source changes, parent death, URL
  redirects, protocol/output/deadline caps. Bound query frames2MiB, input64KiB,
  no arbitrary request methods/URLs or control eval. Long work job status remains
  observable; timeout preserves ownership until true stop/close.
- [x] Smoke real installed engine startup/OpenAPI/stop with no user data, plus
  source-owned fixture export. Report these as separate acceptance levels.

## Task4: script map + transactional fill (reconstruction worker)

- [x] Red matching fixture test: component retains GUID/fileID/field references
  after Player.cs body replacement; opaque/DLL/type/field mismatch is rejected.
- [x] Implement conservative dump type/method map, validate exact Ghidra evidence
  binding, inline-source plan, SHA/revision/meta preconditions and idempotent IDs.
- [x] All sources stage before moves; exact backups and bounded journal persist
  before writes. Recheck guards before publication and before each move. No field
  migration or prefab rewrite; compileReady:false in every receipt.
- [x] Test rollback after first write, external interference, changed stub/meta/
  prefab, unsupported C# syntax, repeated apply/verify and uncertain rollback.

## Task5: shared service, strict CLI and MCP (root)

- [x] TDD src/assets/cli.js: assets session start/status/stop, export,index,list,
  get,tree,refs,scripts,mcp; reconstruct plan/apply/verify. Strict option/arity and
  selector limits, --root/--json, no legacy CLI fallback for these commands.
- [x] TDD src/assets/mcp.js: initialize + notifications/initialized + tools/list
  + tools/call using shared service and typed params. Return revision/coverage,
  max1MiB input/2MiB output, clean stdout, drain/sanitize errors, no arbitrary
  file/URL/shell or unbounded graph dumps. Tool inventory exposes reads and plan/
  apply; user approved writes, requiring a concrete plan is an invariant.
- [x] Integrate re.js dispatch/help, docs/README, task readiness/state reporting
  without claiming analysis/compilation/gameplay success. Keep old GUI adapters.

## Task6: review, qualification and delivery (root)

- [x] Independent spec review then quality review for each worker and integrated
  surface; fix actionable findings with regression tests.
- [x] Full JS +7 PS suites, persistent source-owned engine -> export -> graph ->
  MCP query -> evidence map -> stub plan/apply -> unchanged YAML/meta verify;
  actual AssetRipper startup/capability/stop separately. Unity compile not claimed.
- [x] Update verification/limitations, hash-guard only explicit new/changed paths
  into main with exact backups. Preserve pending vendor changes and unrelated
  files; repeat main checks, leave worktree and no new commit/push.
