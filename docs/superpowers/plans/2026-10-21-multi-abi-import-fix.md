# Multi-ABI APK import repair

**Goal:** Treat extraction completion and IL2CPP selection separately, keep fresh
imports in 01_Extracted, and let desktop users choose ABI/metadata from candidates.

**Observed failure:** add() validates unique selection before publishing the
archive's extracted staging. Two valid libil2cpp binaries leave a failed extract
step and a hidden .extract directory; GUI offers no selection controls.

**Design:** Fresh archive extraction publishes to the canonical directory even
when input selection needs user action; scan remains awaiting-user, not ready.
Existing nonempty extraction/selected project is preserved during ambiguous
replacement. Read-only candidate inspection returns a revision and bounded
relative binary/metadata choices; explicit selection verifies that revision.
Old failed first-import staging can be recovered to canonical storage without
choosing an ABI, replacing an analyzed project, or executing any target/tool.
Preserve recovery evidence and old extracted data; no broad deletion.

- [x] Backend: red/green multi-ABI/missing-input/import-preservation tests;
  structured selection state, canonical first-import publication, inspect/select/
  recover APIs and typed CLI. Guard stale revisions, linked/escaped paths,
  workspace ownership and prior successful outputs.
- [x] GUI: candidate selectors with explicit ABI choice and metadata option,
  actionable warning rather than raw Ambiguous error, load for reopened projects,
  typed selection jobs and safe refresh. Fixture Electron acceptance.
- [x] Recovery: inspect only GoodSort3D's reported run; back up project state,
  recover its recorded staging to 01_Extracted without selecting ARM64/ARMv7.
  Verify canonical candidates and leave ABI choice to the user.
- [x] Verification/review: focused regression tests, full Node suite, actual
  Electron fixtures, review. No game execution, device access or commit/push.

## Verification

- Full Node snapshot: 752 tests, 751 passed, one existing skip, no failures;
  `.cache/multiabi-tests.log`.
- Later ADB regression: a first multi-ABI capture now returns needs-input instead
  of falsely claiming inputs are selected. Focused ADB/API/input suites 25/25 pass.
  The earlier full-suite snapshot precedes this one additional test.
- Actual Electron acceptance passed canonical publication, no implicit ABI choice,
  unique metadata, persisted ARMv7 selection, reopening and legacy recovery.
  Screenshot: `.cache/desktop-results-acceptance/73ce5383-668f-4f25-b3e3-8760cbeb72ad/multiabi-choice.png`.
- Independent review approved after a red/green stale-selection fix: successful
  explicit rescan clears the pending replacement pointer, preserves its files,
  and invalidates its old revision. Corrupt/partial archive stages cannot recover;
  candidate IO errors remain failures, not completed extraction.
- GoodSort3D's exact recorded 07:56 run was recovered to 01_Extracted at 08:11 UTC.
  Project state backup and previous error/step evidence are retained. Observations:
  `.cache/goodsort-input-recovery.json`. Two ABI candidates and one metadata were
  verified; no ABI selected, no engine run, older stage retained.
- GoodSort3D remains extract=succeeded, scan=awaiting-user. GUI restart and explicit
  ABI selection are the next user actions. Other real games/devices were untouched.
