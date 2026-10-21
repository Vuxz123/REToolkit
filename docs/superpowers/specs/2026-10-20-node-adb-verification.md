# Node ADB capture verification — 2026-10-20

## Scope

`adb devices` and `pull-ldplayer` now use native JavaScript argument-array ADB
execution and the existing Node `add` pipeline. Captures preserve base/split APKs
and OBBs, exact package/device selection, remote/local size checks, file SHA256,
an embedded capture inventory and exclusive XAPK publication. Workspace and
toolchain leases cover the pull and import; ADB children use the existing engine
supervisor. JSON/noninteractive capture requires `--skip-launch`.

No real device/emulator was accessed, no vendor binary ran, and no installed
engine, global runtime or legacy PS GUI was replaced. No dependency was added.

## Evidence

- Before work, main **484/484 JS tests passed** and **255 existing production
  paths were hashed and backed up**. Implementation reused an ignored worktree.
- Worktree final `npm test`: **514 passed, 0 failed, 0 skipped**.
- Worktree `npm run test:legacy`: **7 PowerShell suites passed**.
- Focused ADB tests: **30/30 passed**, covering strict metadata, serial/package
  selection, unsafe names, collisions, missing/denied OBB, incomplete pulls,
  changing sizes, failed staging, leases, ABI selection and previous extraction.
- Actual `npm run test:adb` passed using a source-owned compiled C# executable
  and base/split/OBB ZIPs. It exercised the real CLI and **13 supervised ADB
  calls**, verified a workspace lock during every call, imported three captured
  files, expanded the split APK/OBB, checked released leases and refused a
  zero-exit partial pull while preserving the prior project and bundle bytes.
  The fake executable never connects to a device or emulator. PowerShell was
  used only to compile the owned fixture, not as the capture pipeline.
- Spec review found no critical/important issues. Quality review found an OBB
  false-success case: an unknown stderr diagnostic with exit0 was accepted as
  an empty directory. After an observed RED regression, only exact missing-OBB
  diagnostics remain optional; other stderr fails. Re-review independently ran
  **30 tests, all passed**, with no remaining important findings.
- An additional observed RED regression showed initialization could follow a
  junction ancestor before capture rejected it. The new preflight rejects that
  path before initialization or device calls; the outside target stays empty.
- The first capture/CLI tests failed because the new modules were missing, then
  passed after implementation. An integration fixture's explicit ABI path was
  corrected to include the existing extractor's split-APK directory prefix;
  the extractor behavior itself was retained.

## Main delivery

Delivered exactly **19 owned files** with baseline SHA256 guards; all **249
other baseline paths** retain their original bytes. Pending unrelated files,
including `scripts/retk-core.ps1`, were preserved. No blanket synchronization,
commit or push was used. The worktree and local diagnostic logs remain available.

Repeated in the main workspace: **514/514 JS tests**, **7/7 PowerShell suites**
and the actual CLI/compiled ADB fixture smoke all passed. `git diff --check`
found no whitespace errors. Local logs are `.worktrees/adb-main-*.log`; the
scoped hash manifest is `.worktrees/adb-delivery.json`.

## Limits

These fixtures establish orchestration, byte preservation and failure behavior.
They do not establish LDPlayer/Android-version compatibility, original-game
completeness, an atomic device snapshot, or a matching native/metadata pair.
Capture selects inputs; dumping, Ghidra analysis, reconstruction and game
behavior require their own verification. GUI launchers/raw tool wrappers and GUI
runtime setup remain separate migration work. Legacy `re.ps1`/WinForms capture
still uses its old path; the JavaScript CLI has no PowerShell pull fallback.

No commit or push was performed.
