# Release hardening implementation plan

Use superpowers:subagent-driven-development and TDD in the isolated worktree.
Goal: add a usable locked relocatable-archive installation path, CI and GUI build
provenance under the existing approved roadmap; preserve legacy setup modes.

Architecture/contracts:

- `src/toolchain/lease.js` (root): `acquireToolchainRead(root)` synchronous returns
  `{release()}`; `withToolchainWrite(root,action,{inspectProcesses}={})` async;
  `assertToolchainIdle(root,{inspectProcesses}={})`. Default Windows inspection
  fails closed; tests inject only external observation, retaining actual FS locks.
  Writer directory `.cache/toolchain/writer`, readers `.cache/toolchain/readers/*`;
  no auto recovery of uncertain markers. Reject links before writes.
- `src/toolchain/manifest.js`, `installer.js`, `verify.js` (installer agent):
  `readToolchainLock(file)`, `validateToolchainLock(value)`,
  `planToolchain(root,lock)`, `installToolchain(root,lock,{cache,fetchImpl,
  inspectProcesses,onEvent}={})`, `verifyToolchain(root)`.
  `onEvent` test fault observation after journal/stage/moves, never a manifest
  executable hook. Root controls lease.js. Installation imports withToolchainWrite.
  Receipt fixed `.cache/toolchain/receipt.json`; persistent backup/journal under
  `.cache/toolchain/transactions/<UUID>`. Root CLI prints results and uses errors
  with stable code/message. Verify returns `{ok,state,packages,errors,limitations}`.
- `scripts/retk-build-provenance.ps1` and `tests/retk-build-provenance.Tests.ps1`
  (GUI agent), update build-gui.ps1. Agent owns CI `.github/workflows/windows.yml`
  and `.gitignore` GUI sidecar rule; no package/re.js changes.
- Root owns toolchain CLI/re.js/PS installer delegation, process/toolkit engine
  read lease integration, docs/package, final verification and integration.

Tasks:

- [x] Inspect roadmap/installer, select explicit locked path; create clean worktree.
- [x] Dependencies/baseline inspected:134 tests, one pre-change Windows rename
  failure; isolated rerun passed. Later reproduced/fixed with real sharing tests.
- [x] Installer agent: write failing fixture tests, schema/plan/stage/extract/
  rollback/receipt/verify/cache implementation; own targeted tests and self-review.
- [x] GUI/CI agent: failing provenance behavior tests then staged build helper,
  provenance and source tracking; pinned Windows workflow; own targeted PS tests.
- [x] Root: lease red/green including concurrency/uncertain readers + real child
  integration; strict toolchain CLI and early PS delegation fixture tests.
- [x] Spec review; fixes; quality review; fixes.
- [x] Full JS/PS suites, source-owned locked install/change/tamper/rollback CLI
  acceptance; inspect live installed-tool busy detection read-only.
- [x] Update README/roadmap/verification with actual scope and qualification;
  guarded integrate to root; root checks. Keep worktree and existing unrelated files.

No live engine replacement, global environment mutation, Jev call or source-owned
fixture result promoted to real vendor engine qualification.
