# Desktop completion implementation plan

Use subagent-driven-development for independent module tasks, parent integration,
then spec and quality reviews. Existing baseline:515 JS tests and7 PS suites.

- [x] Snapshot current272 main production paths; reuse ignored worktree.
- [x] Node launcher task: new `src/desktop-launch` modules/tests; export
  `startDesktopLauncher(toolkit,{mode,name,console})` and status. Reuse local
  runtime paths and managed GUI profile when available; preserve leases through
  actual close, fixed launch commands, private settings and bounded logs.
- [x] Runtime task: new `src/desktop-runtime` modules/tests; exact profile
  plan/install/verify, reuse locked Python/archive logic, toolkit-local .NET and
  private extension installation. Export profile selection for Node launchers.
- [x] Visual task: new `src/visual` modules/tests; strict contract validation,
  bounded PNG metrics/diff, explicit ffmpeg frame extraction/video observations,
  saved request/report evidence with stale/hash/profile guards.
- [x] Parent: pin Electron44.9.1 and PNG decoder, add `retk gui` and typed Node
  job broker, sandboxed main/preload and local HTML/CSS/JS desktop panels. TDD IPC
  validation, command mapping, jobs and launch. Add real offscreen Electron smoke.
- [x] Parent integration: CLI/toolkit routes use new launch/runtime/visual APIs;
  no legacy PowerShell pipeline fallback. Existing global command remains linked.
- [x] Parent: explicit reconstruction migration request/plan/staged apply/verify
  with Editor-observed script identities, exact file/field preconditions and
  unsupported binary/mixed/ambiguous cases rejected. Test original byte retention.
- [x] User addition: fixed `config/jev.json`, checked example, strict Node CLI,
  GUI Settings, session-only password, synthetic connection test, request-model
  guard and no secret in configuration/history/log DTOs.
- [x] Real-game scale implementation: complete250k-file inventory with8 hash
  workers, source rechecks, read-only allowlisted bulk summaries and explicit
 128/256/512MiB graph budgets. Full-game success requires its own observed run.
- [ ] Cancelled by user: Real Screwdom: immutable XAPK inventory, new workspace, explicit ABI,
  dump/import/export, actual observed compilation/binding reports and baseline
  comparison/Jev only when required original evidence/authentication is available.
- [x] Independent reviews, full JS+PS+Electron/fixture/real checks, scoped delivery
  and repeated main verification. Record all achieved/unverified/blocked evidence;
  do not substitute fixture success for game success. No commit or push.

## Observed large-project storage correction

Screwdom has184599 source files. The explicit512MiB JSON profile reached641157
nodes after183 assets and correctly refused publication. Retain JSON compatibility
for small exports; add explicit `assets index --storage sqlite` using Node's
built-in SQLite. Keep complete source inventory and metadata in a version2
manifest, with a sealed hash-bound database in a fresh owned index generation.
Stream serialized records, preserve exact IDs and reference statuses, and use
bounded paged queries. Never interpret absent in-memory rows as an empty graph.

- [x] Store: fresh transactional DB, fixed prepared SQL, row/count/disk limits,
  sealed receipt, readonly hash-verified reader, bounded list/get/refs/tree.
- [x] Index: shared source parser/metadata/projection rules, incremental nodes,
  second-pass references, complete final source verification before publication.
- [x] Integration: explicit CLI/MCP/desktop storage selector, version-aware
  readers, focused script binding materialization and bounded reconstruction.
  Unsupported operations must stop explicitly rather than use partial data.
- [x] Independent review and fixture parity/corruption/limit tests. Actual
  Screwdom indexing/validation was cancelled by the user; owned processes were
  stopped and partial outputs retained. No further game testing.
