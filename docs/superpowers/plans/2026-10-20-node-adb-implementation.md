# Native Node ADB Implementation Plan

> Use superpowers:subagent-driven-development. Isolated implementer owns the ADB
> client; parent integrates capture, toolkit and CLI, then separate spec and
> quality reviews inspect the complete change. No commit is requested.

**Goal:** Pull an authorized Android package through the native JavaScript CLI,
preserving split APKs/OBBs and previous valid workspace artifacts.

**Architecture:** Argument-array ADB client, private staged ZIP capture and the
existing Node `add` pipeline under workspace/toolchain leases. No PS fallback,
device mutations other than explicit interactive app launch, or new dependencies.

**Tech stack:** Node24, built-in node:test, existing yazl/yauzl and engine worker.

- [x] Back up current main baseline, verify ignored worktree and baseline tests.
- [x] Client TDD: `src/adb/client.js`, `test/adb-client.test.js`. Implement
  `resolveAdbPath`, `validatePackageName`, `validateSerial`, `parseDevices`,
  `createAdbClient({file,run,runOptions})`. Client exposes `devices()`,
  `selectDevice(serial)`, `packagePaths(serial,packageName)`,
  `obbPaths(serial,packageName)`, `launch(serial,packageName)`,
  `pull(serial,remote,local)`, `size(serial,remote)`. Test argument safety, ready serial selection,
  missing/denied OBB and exact package checks with injected process observations.
- [x] Capture TDD: `src/adb/capture.js`, `test/adb-capture.test.js`. Export
  `captureBundle({workspace,packageName,serial,client,skipLaunch,confirm})`.
  Source-owned ZIPs, collisions, truncation/failed pull and changed files must
  preserve previous bundle/extraction; successful output is exclusively published
  with an inventory manifest. No cleanup of uncertain child-owned staging.
- [x] Toolkit TDD: add `pullLdPlayer(name,packageName,options)` to
  `src/toolkit.js` and intercept `compat('pull-ldplayer')` before legacy adapter.
  `src/adb/options.js` exports `parseAdbArgs`, `isAdbCommand`; `src/adb/cli.js`
  re-exports these and exports `runAdbCli`; `re.js`
  dispatches it before compatibility adapters. Test actual CLI JSON and errors in
  `test/adb-cli.test.js` and existing input extraction fixtures. Interactive
  default is rejected in JSON/non-TTY before operations; skip-launch works for AI.
- [x] Fixture executable source `test/fixtures/adb-engine.cs` plus optional
  `test/real-adb.mjs`/`test:adb` exercise actual process supervisor, lease and
  base/split/OBB ZIP pipeline without connecting a device or opening Ghidra.
- [x] Update README/CLAUDE/repo install skill and `docs/adb-capture.md` with
  current flags, retained PS aliases, discovery, failure evidence and remaining
  migration boundaries. No real emulator compatibility claim from fixture tests.
- [x] Independent spec and quality review; resolve important findings.
- [x] Full JS, seven PS and actual CLI fixture smoke; hash-guarded scoped
  delivery and repeat verification in main. Save final verification report.
