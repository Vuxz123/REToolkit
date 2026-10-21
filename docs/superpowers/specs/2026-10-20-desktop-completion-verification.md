# Desktop, Jev and large-project verification

2026-10-21 GUI correction: actual user process had a hidden REToolkit window
because the shared process launcher always set `windowsHide:true`. Added an
explicit desktop override while keeping background defaults. The new actual-CLI
visible-window fixture reproduced `visible:false` before the fix and passed
afterwards;23 related process/desktop tests and the existing offscreen Settings
fixture passed on main. Restarted only the identified idle hidden GUI. Its new
process55716 has window title REToolkit, nonzero handle30608784 and responds;
launcher stderr is empty. No game testing was performed.

Status: implementation delivered by guarded per-file synchronization; no commit
or push requested. Existing unrelated pending changes are preserved.

## Implemented

- Electron44.9.1 desktop with sandboxed local renderer, typed CLI job queue,
  bounded logs/results and workspace/toolchain ownership through child close.
- Node Ghidra/PyGhidra foreground launchers. Private pinned CPython/PyGhidra,
  GhidraMCP extension and .NET runtime installation/verification with rollback.
- `config/jev.example.json`, ignored local `config/jev.json`, CLI settings and
  GUI Settings with session-only API key, model/env-name setup and explicit
  synthetic connection test. No key persisted or actual Jev authentication yet.
- Exact PNG and explicit ffmpeg frame comparison contracts, saved bounded
  evidence reports and stale/unverified outcomes.
- Editor-observed staged script rebinding and supported scalar/reference field
  renames; full DLL conversion/removal and complex serialized migrations remain
  unsupported.
-250000-file complete Unity inventory, shared streaming record parser and
  exact read-only bulk summaries. Explicit JSON128/256/512MiB profiles and
  SQLite version2 manifests with whole-manifest/database receipts, bounded
  queries, focused bindings and source-facts-only library staging.

## Observed verification

- Final main JavaScript suite:639tests,638passed,1opt-in skipped,0failed
  (main `.worktrees/desktop-main-sqlite-js.log`). All7 legacy PowerShell
  suites passed (main `.worktrees/desktop-main-sqlite-legacy.log`).
- Final actual Electron44.9.1 fixture passed11 panels, real typed IPC/workspace
  creation, Settings save and no-key/no-network checks. Screenshot at main
  `.cache/desktop-acceptance/9c3d4d3f-2a1d-4fa4-be5a-7b77c711ed7c/desktop.png`.
  CMD global `retk jev-settings show --json` confirmed the real local config,
  missing authentication and no network request. Settings layout visually checked.
- SQLite store9tests and indexer11tests passed. Shared-service fixtures cover
  script read/map/plan/apply/retry, GUID/meta/YAML preservation, library
  identification/import, scoped migration and corrupt receipt rejection.
- Actual Electron main acceptance previously passed11 panels and typed real
  IPC jobs, Settings save and missing-key rejection without network.
- Actual vendor private-runtime acceptance verified native imports,38locked
  wheels and .NET8.0.22; actual Ghidra/PyGhidra Swing launcher fixtures passed.
- Actual Unity2022.3.62f2 migration fixture preserved integer, Boolean and object
  reference values across staged rebinding/field rename with before/after
  Editor observations. This establishes fixture mechanics only.

## Real-game testing cancelled

The user stopped Screwdom testing on2026-10-20. No further game testing is
authorized in this tranche. Previously prepared dump/import/export and all
partial evidence remain retained. Owned SQLite index PID28564 and validation
runner PID41444 were identified and stopped; their sessions closed. Unity never
launched for the cancelled full-game validation. The separate validation source
snapshot is not a serialized graph. Partial staging/database artifacts are not
success receipts. No real-game compilation, bindings, gameplay or visual success
is claimed. No further game source reads or cleanup were performed after stop.

## Remaining limits

- Main managed GUI runtime activation was refused by the preexisting
  `DebugFlowTest` Ghidra project lock. Existing Ghidra instances/locks were not
  removed or terminated. Private runtime/launcher fixtures passed separately.
- No original-game image/video baseline, connected Android device or Jev API
  key was supplied. Gameplay, game visual fidelity and live Jev stay unverified.
- SQLite disk limit covers main database plus rollback journal; temporary sort
  files are outside that budget. Query/tree/materialization limits are explicit
  and do not silently imply complete traversal of an oversized scope.
