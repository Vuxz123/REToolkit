# Jev GUI credential isolation

The user requested fixing the review finding before the pending commit/push.
The key must stay usable by explicit Jev operations, while Agent terminals and
their MCP children must not inherit the Jev credential namespace.

- [x] Reproduce GUI session key mutation of the parent environment and inheritance
  in all four harness bootstraps/runners with synthetic sentinel credentials.
- [x] Keep one GUI key in the Settings closure instead of process.env. Settings
  status exposes only presence booleans. Provide the selected key only to explicit
  Jev test/send operations; changing the configured name does not forward old keys.
- [x] Strip TYPESAFE_/JEV_ names case-insensitively at bootstrap, terminal runner,
  Codex queue probe/dispatch and non-Jev desktop child boundaries. Keep harness
  auth, PATH, thread identity and harness-specific configuration intact.
- [x] Verify GUI Settings → Jev broker integration, fake harnesses and Codex queue
  children, real isolated Electron fixture, relevant/full regression and review.
- [x] Document behavior and prepare the source refresh/data constructor fixes and
  this credential isolation fix for the requested origin/master delivery. Git
  commit/push history records the final delivery outcome.

Do not read/print real credentials, launch an authenticated Agent, send Jev
requests or modify any user's existing terminal/game job for verification.

## Evidence

- Fail-first tests reproduced key inheritance, parent-env mutation and missing
  private-key broker forwarding. Focused Agent/Settings/Jev/wake surfaces:
  69 passed, zero failed/skipped (`.cache/jev-isolation-verified.log`).
- Read-only review caught Windows inherited-name casing regression; a synthetic
  case-insensitive host reproduced it, and snapshot normalization fixed it.
- Actual sandboxed Electron smoke passed with an isolated vendor-runtime copy,
  private fixture toolkit and fixture-only AppContainer read ACL. Installed
  runtime unchanged, no game execution/API request. Evidence:
  `.cache/jev-isolated-electron-check-final.log`.
- Final read-only review found no remaining concrete P1/P2 issue. Full regression
  `node --test --test-concurrency=2 test/*.test.js`: 1087 tests, 1086 passed,
  0 failed, 1 skipped (gated real Unity acceptance), exit 0. Evidence:
  `.cache/source-and-jev-final-tests.log`. Syntax, README links and staged diff
  checks passed; no high-confidence credential pattern was found in source.
