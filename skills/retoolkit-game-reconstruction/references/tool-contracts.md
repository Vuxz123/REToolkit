# REToolkit tool contracts for reconstruction

Read only the section needed by the current step. All commands below are current
Node CLI routes; substitute an explicitly selected workspace for `Game`. Run
`node <absolute-checkout>/re.js` instead of `retk` if the global shim is unavailable.
Use absolute input/request paths when running outside the checkout. Output paths
returned relative to a workspace must be resolved against that workspace before
passing them to CLI options that resolve from the caller's current directory.

Discover actual MCP `tools/list` and schemas first; do not invent tools or assume
REA names exist here. The assets stdio registration is
`node <absolute-re.js> assets mcp Game`; Ghidra uses
`node <absolute-re.js> mcp`. Existing `retoolkit-mcp-analysis` covers the GUI bridge.
The assets server exposes typed tools including a background setup coordinator;
it does not autonomously reconstruct game logic or expose MCP prompts.

## Background preparation

First use `preparation_status {}`. Optional `runId` selects a saved run;
`verifyFreshness` is boolean and defaults true. Current content/receipt checks
produce `freshness: current|stale`; lightweight false observation returns
`not-rechecked`, unverified actionable readiness and separate recordedReadiness.
Do not trust historical handoff bytes as fresh validation.

Start once using `jobs_start {"operation":"workspace.prepare","params":{...}}`.
Allowed params: `profile` (`native`/`reconstruction`), `symbols`
(`plan`/`apply`/`skip`), explicit `addressMode` (`rva`/`va`), optional `serial`,
`packageName`, boolean `autoPull`, `includeData`, `baselineValidation`, UUID
`resumeRunId`. Use saved choices; do not guess a device or address mode. Defaults
are reconstruction/plan/includeData true/baselineValidation false; autoPull is
enabled by default only with explicit serial+package. Missing SDKs are reported.
CLI: `retk prepare Game --symbols plan --address-mode rva --json`.

GUI/status can observe the same worker without an agent polling continuously.
The report has per-stage evidence, blockers and independent readiness, including
unverified downloaded/on-demand data and gameplay. Script mapping is a bounded
first page. A pipeline completing does not establish game reconstruction.
Resume uses unchanged input/tool/config/receipt evidence; unknown writes are
never replayed. Full contract: checkout `docs/project-preparation.md`.

## Observable jobs and symbols

Use `jobs_start` with `operation` and an inline typed `params` object, then
`jobs_get` with its exact `jobId`. `jobs_list` accepts `limit` to resume recent
workspace jobs. The server binds the workspace; do not send a different name.
Example: `{"operation":"workspace.dump","params":{}}`. The tools/list schema
enumerates current operations and their nested parameter schemas.

`jobs_wait {jobId,timeoutSeconds:25}` returns the same snapshot with
`wait.state` terminal/timed-out (1..30 seconds, read-only, no cancellation).
It cannot wake a finished turn. Codex CLI has typed `agent.wake_after` registration
through jobs_start; its exact thread/task binding and preflight requirement are
in [waiting and continuation](checkpoint-and-recovery.md#waiting-and-continuation).
Read checkout `docs/agent-continuations.md` for payloads and durable delivery
status. There is no arbitrary prompt/shell field or adapter for other harnesses.

The returned job includes state/stage, sequence/timestamps, observed engine and
saved workspace step states, a bounded diagnostic tail, and final result or
resultReference. Large results use `resultOffset`/`resultLimit` bounded chunks;
base64 preserves exact bytes across UTF-8 boundaries. Resolve result/diagnostic
references against the bound workspace. These are untrusted target observations.
Progress reports observed stages, not a guessed percentage. A completed command
can still return partial coverage, blocked compilation or failed validation.
`unknown` means the outcome is unverified: inspect engine/session ownership and
receipts before an explicit recovery; never automatically replay a timed-out write.

Besides existing assets/reconstruction/migration/library/visual/ADB operations,
jobs support `workspace.status`, `workspace.add`/`workspace.scan` (`input` and
optional `binary`/`metadata` selectors), `workspace.dump`, `workspace.import` (optional
`reimport`) and `workspace.analyze`. For an owned persistent Ghidra session use
`ghidra.session.start` (`write`, optional `timeoutMs`/`idleMs`), `.status`, `.stop`.
Stop any GUI owner first; do not start a competing Ghidra owner.

For unresolved extracted inputs use
`{"operation":"workspace.inputs.resolve","params":{}}` once, then poll its job.
This returns a bounded selection summary, preserves a current/manual choice and
otherwise prefers ARM64, ARMv7, x86_64, x86 among known Android candidates.
Duplicate preferred binaries or multiple metadata remain unresolved. Optional
`policy` is `prefer-arm64` or `manual`. Do not read large project manifests or old
intake receipts solely to decide ABI. CLI: `retk inputs resolve Game --json`.

Use `ghidra.symbols.plan` with explicit `addressMode` (`rva` or `va`); inspect the
returned saved plan, conflicts and coverage. `ghidra.symbols.apply` requires
`plan` (within this workspace) and its exact SHA-256 `planHash`, optional `dryRun`
and stable `operationId`. The route uses existing revision/identity/ownership
checks and returns its real mutation receipt. Partial symbol coverage never proves
all names are applied. A stale plan must be investigated rather than overwritten.
Saved version-1 plans support up to 512 MiB with streamed file verification and
JSON processing. Send only their path/hash; do not read the whole plan into agent
context. Existing immutable plans remain usable if all identity/revision/old-value
checks pass. After a helper update, preview in a newly started owned session.
An external script's old 32 MiB check is stale; use the typed route or update that
guard without changing the saved plan. Never automatically restart a stopped or
uncertain write. Streaming reduces file/preview copies, while the atomic apply
still needs heap for its validated changes and transaction snapshots.

## Intake, export and query

For an explicitly selected installed LDPlayer/Android app, capture before flow:

```cmd
retk adb devices --json
retk adb packages --serial emulator-5554 --json
retk pull-ldplayer Game com.example.game --serial emulator-5554 --skip-launch --include-data --json
```

Substitute the actual device/package. Optional CLI `--adb <adb.exe>` selects a
custom installed executable. MCP on this workspace server exposes `adb_devices`,
`adb_packages` with `serial`, and `adb_capture` with `serial`/`packageName` plus
optional binary/metadata selectors. MCP capture includes app data and cannot
override adb.exe or launch the game. GUI provides the same typed operations.

Build APK/splits/OBB go to the XAPK; external/private userdata go to a separate
data ZIP and are not imported as Unity assets. Existing shell/run-as/bounded su
access may read data, but no root enablement or device writes occur. Keep denied
scopes/partial coverage, failures and original artifacts in the ledger. Inspect
only files relevant to reconstruction; keep credential/session material out of
reports and bulk AI/Jev handoff. Read `docs/adb-capture.md` for exact coverage and
limits. Capture success does not establish an atomic save snapshot or Android restore.

```cmd
retk status Game --json
retk flow Game "D:/Inputs/Build.xapk" --dry-run --json
retk flow Game "D:/Inputs/Build.xapk" --no-open --json
retk assets session start Game --json
retk assets session status Game --json
retk assets export Game --json
retk assets session stop Game --json
retk assets index Game --storage sqlite --json
retk assets list Game --kind scene --limit 20 --json
retk assets tree Game --id "asset:<scene-guid>" --depth 5 --limit 100 --json
retk assets refs Game --id "object:<guid>:<fileID>" --direction both --limit 100 --json
retk assets scripts Game --query Namespace.Type --limit 20 --json
retk assets source Game --id "asset:<script-guid>" --json
```

This is a menu, not an unconditional script. Skip export/start when indexing an
existing selected export. Session start means transport readiness; inspect load
job status. Export replaces only through its guarded stage/backup route. For a
small graph use the default JSON storage; SQLite needs Node 24.15+. JSON's
`--max-graph-mib` must not be combined with SQLite. Preserve returned cursors and
coverage. Do not dump the whole graph into the agent context.

Unity serialized sources stream by document in either store; the old 16 MiB
whole-file limit no longer applies. Per-document and other resource limits remain
explicit. SQLite solves graph storage scale, not an oversized individual document.
Keep static coverage gaps when the parser cannot process a document.

The matching MCP tools are `assets_session_start`, `assets_session_status`,
`assets_export`, `assets_session_stop`, `assets_index`, `assets_list`,
`assets_tree`, `assets_refs`, `assets_scripts`, `assets_source` and `assets_get`.
CLI `--id` maps to MCP `id`; MCP `assets_index` uses `graphMaxMiB` for the JSON
budget. The workspace is fixed by server registration rather than per-call args.

Consult `docs/assetripper-ai.md`, `docs/assets-storage.md` and actual `--help`
for supported selectors, export selection, bounds and stale-result handling.

## Evidence and C# source changes

Investigate native behavior through connected Ghidra tools and current dump
mapping. When durable REToolkit envelopes are required, use the native evidence
capture workflow in `docs/diagnostics-and-jev.md` with an existing native session;
do not run the GUI owner and a headless owner on the same workspace together.
MCP text observations are not interchangeable with hashed REToolkit envelopes.

Source request shape:

```json
{
  "kind": "retoolkit-reconstruction-request",
  "schemaVersion": 1,
  "graphRevision": "<current 64-character graph revision>",
  "changes": [{
    "scriptId": "asset:<existing-script-guid>",
    "source": "<complete replacement C# source>",
    "evidenceIds": []
  }]
}
```

Empty evidenceIds do not establish behavioral recovery. Supply real accepted
evidence envelopes where available; otherwise retain the observation/mapping gaps.

```cmd
retk reconstruct plan Game --request "D:/Requests/source.json" --json
retk reconstruct apply Game --operation <UUID> --json
retk reconstruct verify Game --operation <UUID> --json
retk reconstruct validate Game --json
retk reconstruct validation Game --operation <validation-UUID> --section diagnostics --limit 20 --json
```

MCP: `reconstruct_plan` takes the request object inline and optional evidence;
`reconstruct_apply`/`reconstruct_verify` take `operationId`;
`reconstruct_validate` accepts `timeoutSeconds`; `reconstruct_validation` takes
the validation `operationId`, optional section/limit/cursor. Source-apply and
Unity-validation UUIDs are different. `--evidence <file>` on supported CLI plan
or mapping commands is an array of valid envelopes, not fabricated references.

Unity validation does not require a saved asset graph. It inventories and stages
the entire selected source, then measures compile/binding using Unity Editor.
This route can proceed while static graph parsing is blocked; source-inventory
coverage alone leaves serialized references unverified. Read actual Editor
observations and report freshness before claiming compile/binding success.

For a completed partial validation, inspect `compilation.state` separately from
`coverage` (`requestedAssets`, `completedAssets`, `pendingAssets`). A loaded asset
with incomplete traversal remains pending even if its missing counters are zero.
Extended observations report per-asset stop reason and object/component/property
location. `jobs_get.validationProgress` exposes observed counts while it runs.

Resume with `retk reconstruct validate Game --resume-operation <UUID> --json`, or
`reconstruct_validate`/job params `{"resumeOperationId":"<UUID>"}`. This creates a
new operation, verifies source/build/Editor/helper/scope and reuses only completed
attested rows. Old incomplete legacy rows are not resumable checkpoints. Do not
replay unknown/interrupted ownership or loop on an unchanged traversal limit.

For authorized feature acceptance, optional MCP `assetIds` selects 1..1000 unique
exact asset IDs. CLI `--asset-ids` takes the JSON array inline. Scoped success is
`scopeBindingsVerified`, never project-wide `bindingsVerified`. Omit assetIds
when resuming to retain the scope; conflicting scope is rejected. See
`docs/unity-validation.md` in the checkout for shell quoting and report details.
Selectors include scenes, prefabs and `.asset` data tables. A table load covers
its main object and hidden subassets under one bounded file budget. Missing
scripts/references or incomplete loading cannot establish bindings. Keep the
original policy IDs; a helper change needs fresh validation, not dropped table
selectors or a replay of an older helper checkpoint.

The supported source route fills existing eligible stubs and preserves required
declarations/serialized identities, scene/prefab YAML and `.meta`. It does not
add arbitrary new script assets, remove DLLs or recover original method bodies
from dump declarations. Source apply reports compilation/logic unverified.

For `sourceCapabilities.bodyReplacement.state: "requires-plan-validation"`,
optional per-change `"mode":"bodies"` uses the exact installed Editor's bundled
Roslyn parser. A legacy scanner `unsupported` result alone does not rule out
this route. Preserve all imports, attributes, generic/nested headers, constraints,
signatures, fields/initializers and accessor visibility; change only existing
executable bodies, keeping block/arrow/auto-property forms. Do not add members
or backing fields. This is syntax validation, not game compilation/execution.
Meta-free sources qualify when every top-level declaration is an open generic
class, or when every type is a nongeneric class with no base clause (data-source).
Both require no claimed component binding. Use the exact `opaque:Assets/...cs`
ID, never invent a GUID or add `.meta` to evade the gate.
Partial/directive/uncertain overlapping identities remain blocked. Apply
re-derives parser identity, skeleton and complete assembly inventory; stale
source requires reindexing. See `docs/assetripper-ai.md` for the full contract.

Missing native-evidenced constructors have a separate per-change mode
`initialization`, `constructors: [{fullName,kind,evidenceId}]`, with full replacement
source. `fullName` uses metadata nested `+`; `kind` is static/instance. Only
missing static or parameterless instance constructors of existing non-generic
classes are currently supported; exact dump metadata, visibility, imageBase+RVA
and full native observation must match. Provide original evidence envelopes in
the operation's `evidence` array. Other declarations and existing bodies stay
token-identical. No arbitrary fields/members/initializers/base-call changes.
Saved proof is rederived with current verified dump, complete source inventory
and parser at apply; source application still leaves compilation/logic unverified.
See checkout `docs/source-recovery.md`; do not send saved proof as a request field.

SQLite script mapping validates all bindings in bounded memory and exposes
`componentCount`, `unresolvedBindingCount`, `traversedBindingCount`,
`traversalComplete`, `bindingSha256` and bounded components/error samples with
truncation flags. Do not equate sample length with total component count. Plan
and apply rederive the full sealed-database traversal; caller summaries do not
authorize writes. Existing graph materialization caps remain for other routes.

## Output branches and verification

| Candidate output | Required route | What it can establish |
| --- | --- | --- |
| Selected export after source changes | `reconstruct verify` for its source operation; `reconstruct validate` + `reconstruct validation` for independent Editor evidence | Source receipt integrity, current scoped compilation and bindings |
| Library import stage | `libraries verify --operation <library-UUID>` | Current compilation/bindings of that imported stage, not the export |
| Migration stage | `migration observe --receipt <saved-receipt>` then `migration verify --receipt <saved-receipt> --observations <new-observations>` | Scoped compilation, bindings and supported migrated-value assertions for that stage |

Always retain the returned stage path and full receipt. A stage's identity and
coverage do not transfer to another stage. `reconstruct validate` has no arbitrary
project-path option. There is no public automatic promotion/composition command
that chains library staging, migration staging and source reconstruction into a
single selected export. Complete supported source work before deriving stages
where possible; otherwise report the integration gap rather than bypassing guards.

### Libraries when needed

```cmd
retk libraries list --json
retk libraries identify Game --section requirements --json
retk libraries identify Game --section candidates --query tween --limit 20 --json
retk libraries plan Game --requirements "D:/Requests/available-libraries.json" --json
retk libraries import Game --operation <library-UUID> --json
retk libraries verify Game --operation <library-UUID> --json
```

MCP: `libraries_list`, `libraries_identify`, `libraries_plan`, `libraries_import`,
`libraries_verify`; use `operationId` for import/verify. Use `libraries_scan` only
when the configured catalog needs refreshing. Register a user-supplied root via
CLI `retk libraries roots add "D:/LibraryZIPs"`; MCP cannot add filesystem roots.
Read [Unity packages and library selection](unity-packages.md) before resolving
requirements/importing, and checkout `docs/libraries.md` for the full service
contract. Select an available catalog release for an initial trial even when
the game names another version. Send that actual release in explicit requirements;
omitting requirements retains the original manifest's constraints. Only seek the
exact original release when diagnostics indicate version incompatibility.
Recognition hints, ZIP names and manifest declarations do not prove installed
payloads. Unknown selected versions, content ambiguity, collisions and unsupported
`.unitypackage` payloads remain blocked. Preserve dependency closure, existing
DLLs, GUIDs and inventories. Registry installs need the separate Editor API route;
`libraries_*` does not download Unity packages.

### Migration when required

```cmd
retk migration observe Game --json
retk migration plan Game --request "D:/Requests/migration.json" --observations "<absolute-observations-path>" --json
retk migration apply Game --plan "<absolute-plan-path>" --observations "<absolute-observations-path>" --json
retk migration observe Game --receipt "<absolute-receipt-path>" --json
retk migration verify Game --receipt "<absolute-receipt-path>" --observations "<absolute-new-observations-path>" --json
```

MCP: `migration_observe`, `migration_plan`, `migration_apply`, `migration_verify`.
These use existing request/plan/observation/receipt **file paths**, unlike the
inline reconstruction request or visual request. Use saved outputs, not invented
UUID-only arguments. Optional `components` is a file of exact scoped component
IDs. Inspect `src/reconstruction/migration.js`, current examples/tests and tool
schemas before constructing its strict request; no guessed identity/field DTOs.
Observations must be complete, current and from the exact Editor. Only supported
scalar/object-reference field renames/rebindings are accepted. Arrays, nested
or managed-reference migration, type conversion and automatic DLL removal are
unsupported. Read `docs/desktop.md` and `docs/assets-storage.md` for the branch.

## Gameplay, image/video and Jev

The exact Unity version is in `ProjectSettings/ProjectVersion.txt`. Missing or
mismatching Editor, package resolution failures, compiler failure, incomplete
reports and uncertain closure do not verify readiness. Unity's import of project
code can execute hooks; an isolated project is not an OS security sandbox.

Gameplay acceptance requires recorded runtime/manual scenarios on the candidate.
REToolkit has no `gameplay_verify` tool and no general original-game screenshot
acquisition tool. Use existing authorized captures or separately scoped runtime
tools. Do not launch a device/game simply because a visual request is missing.

```cmd
retk visual compare Game --request "D:/Requests/visual.json" --json
retk visual report Game --operation <visual-UUID> --section summary --json
```

MCP `visual_compare` takes its typed request inline; `visual_report` takes
`operationId`, optional section/limit/cursor. Read `src/visual/README.md` before
constructing the request. Declare exact screen/state, matching profiles, original
baseline provenance, every required region and thresholds. No implicit resize;
video requires explicit ffmpeg and aligned sampled timestamps. This compares
files, it does not execute or capture the game. Preserve candidate provenance in
the ledger so capture results cannot be attributed to a different staging branch.

For optional Jev assessment, read `docs/jev-settings.md` and
`docs/diagnostics-and-jev.md`. There are no Jev tools on assets MCP; use CLI or
explicit desktop operations. An example sequence after selecting evidence:

```cmd
retk handoff create Game --evidence "D:/Evidence/Game" --out "D:/Handoff/Game.zip"
retk handoff verify "D:/Handoff/Game.zip"
retk jev request "D:/Handoff/Game.zip" --questions "D:/Requests/questions.json" --out "D:/Handoff/request.json"
retk jev run "D:/Handoff/request.json" --out "D:/Handoff/result.json"
```

Use fresh destinations outside toolkit workspaces and include only accepted
same-build observations. Handoff requires no active native session. Omit the
evidence option when no valid capture folder exists; do not fabricate one.
Inspect the request before sending; the current Jev adapter selects bounded text,
not binary assets/screenshots/video. Add supported text reports explicitly when
needed. Keys stay in the configured environment/session, never prompts or files.
A synthetic connection test is not game assessment. Jev feedback does not change
local verification results and cannot establish whole-game equivalence.
