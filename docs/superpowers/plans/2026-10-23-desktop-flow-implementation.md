# Project desktop workflow implementation

> Follow the approved desktop-flow-redesign spec. Use scoped agent tasks and
> test-first changes; preserve this dirty checkout and do not commit/push.

**Goal:** Replace command-first navigation with a working project dashboard,
contextual pages, observable history, typed operations and a short intake flow.

**Architecture:** Keep Electron sandbox and typed IPC. Read durable jobs and
Agent records through a bounded main-process adapter. Build project decisions in
a pure renderer model, and reuse preparation, input and result views for details.
Manual operations remain available through Advanced. No target execution is
needed to accept the UI; use isolated fixture toolkits.

## 1. Observation and history

- [x] Write failing fixture tests for bounded project activity/session reads,
  project isolation, interrupted workers and restart history without replay.
- [x] Implement `src/desktop/activity.js`: `createDesktopActivityReader(root,
  {toolkit,ghidraActivity})` returning `{inspect(name),detail(name,{source,id})}`.
  Inspect returns `{name,observedAt,jobs,sessions,warnings,lock}`. Job keys retain
  source and exact IDs; sessions never assert MCP connected or Agent resumed.
- [x] Persist compact desktop history in a guarded bounded journal. Rehydrate
  interrupted commands as unknown observations, never enqueue them again.
- [x] Wire typed `activity.inspect/detail` IPC in main/preload, with sender and
  workspace validation. Tests use temporary roots, never repository history.

## 2. Project shell and decision model

- [x] Test pure model: project isolation, available lock versus readiness,
  stale/partial evidence, waiting/unknown jobs and disabled conflicting writes.
- [x] Add `src/desktop/project-model.js`, `workflow-view.js`, and new static shell.
  Routes: Home, Overview, Reconstruction, Resources, Verification, Activity,
  Libraries, Settings, Advanced. Preserve all current operation IDs.
- [x] Keep project header and harness action visible; hide completed input
  selectors behind details. Show one evidence-based next action and an activity
  bar without invented percentages or ETA.
- [x] Bind results/forms/activity to current project. Restore only project/route
  presentation preferences; restoring the UI must not execute a command.

## 3. Intake and typed actions

- [x] Test and implement the intake steps in `project-view.js`: build/name,
  preparation policy, review then real intake; retain incomplete created projects.
  Do not claim input inspection before the real scan job has run.
- [x] Keep existing project callbacks and element IDs used by acceptance tools.
- [x] Implement typed enum/boolean/UUID/scope controls in `operation-form.js`.
  Project identity is read-only outside explicit new/import operations. Saved
  operations can be selected from exact current-project observations; manual
  fields remain when there is no attested matching record.
- [x] Use existing device/package discovery in recovery/setup. No first-device
  selection, automatic engine execution or unsupported stage promotion.

## 4. Integration and review

- [x] Connect real read-only progress and session observers to shell. Avoid
  stale asynchronous replies after project changes and preserve dialog focus.
- [x] Reorganize runtime/harness/library/Jev setup; Jev sends only on its explicit
  button. Expose plan/import/verify and branch limitations accurately.
- [x] Run focused unit suites, existing desktop acceptance, new sandboxed Electron
  flow acceptance at 1280/1366/1600 and the complete Node regression suite.
- [x] Review spec compliance then correctness/security. Resolve observed failures;
  record remaining capability limits instead of faking support.
- [x] Update desktop docs, acceptance evidence and this checklist. Final delivery
  states restart instructions and material limits; no commit/push this turn.

## Acceptance record — 2026-10-23

- Complete Node suite: 1,021 tests, 1,020 passed, zero failed, one skipped
  (the explicitly gated real Unity migration fixture). Log:
  `.cache/desktop-flow-all-tests-final.log`.
- Final focused desktop check after UI copy fixes: 83/83 passed.
- Production Electron shell: sandbox enabled, Node integration disabled; exact
  emulated viewports 1280×720, 1366×768, 1600×1000 have no horizontal overflow and
  keep the main action and header Agent control visible. The Windows native test
  environment kept resize observations at 1280×720, so the responsive fixture
  uses Electron viewport emulation and offscreen rendering. Actual native-window
  visibility is verified separately through the real CLI.
- Flow fixture: `.cache/desktop-flow-acceptance/0768b0ac-cbea-4267-83fe-25da7a19c8bc/`.
  Covers durable progress (17/50), scoped project switching, typed forms, retained
  Jev draft, session failure honesty and real APK intake with preparation off.
  Overview, job drawer and intake review screenshots were visually inspected.
  Final rerun after copy fixes also passed:
  `.cache/desktop-flow-acceptance/9c1dc848-1944-4f2f-a4bb-fe37db1a4d8e/`.
- Result fixture: `.cache/desktop-results-acceptance/7d8be261-d4eb-451d-8188-b90613093fb0/`.
  Confirms readable tables, raw data collapsed, hostile text escaped, bounded
  previews, ABI recovery, scoped validation and external Ghidra log observation.
- Preparation fixture:
  `.cache/desktop-preparation-acceptance/b89d725f-13e3-40cd-ae9b-2e447b255a7c/`.
  Covers stale versus cheap evidence, durable polling, resume and four harnesses.
- `node test/real-desktop-visible.mjs`: passed through actual CLI; native
  window visible, not minimized, Electron 44.9.1, renderer Node access disabled.
- Spec and quality reviews resolved dropped terminal refresh, stale chooser and
  submit replies, readiness callback/freshness wiring, uncertain result styling,
  dead wake transport claims, and ownership gating. AssetRipper export/stop/index
  remain available for the backend-owned session; conflicting Unity validation
  and preparation are gated by the same predicate in the button and submit path.
- Syntax checks and `git -c core.autocrlf=false -c core.whitespace=cr-at-eol diff --check`
  passed. No commit or push, target game, engine, device or actual Agent execution.

Remaining capability limits are deliberate: no embedded Agent chat, unsupported
harness wake adapter, generic Cancel, automatic stage promotion or library DLL
implementation. Preparation evidence is point-in-time; gameplay and original
visual fidelity are unverified without explicit receipts/captures. Detailed
feature checklists stay in the bundled project workflow rather than fabricated
GUI completion checkboxes. Full receipts above the detail read budget remain
exact saved-file references.
