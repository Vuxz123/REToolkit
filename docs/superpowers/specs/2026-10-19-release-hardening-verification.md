# Release hardening verification

Date: 2026-10-19. Windows, Node24, Windows PowerShell5.1. Source implementation in
the isolated `feature/milestone-5` worktree is based on commit `cb20cd6`.

## Local evidence

Guarded integration delivered35 reviewed files to the main workspace while
preserving unrelated pending files. Main-workspace verification after fixes:
**175/175 JS tests**, **7/7 PowerShell suites**, and the sequential locked CLI
fixture smoke all passed. Root/worktree delivery hashes were compared at finish.

- Full JavaScript suite after Windows lifecycle fixes: **175/175 passed**, zero
  skipped/failures. Four new tests cover actual sharing handles and stop proof.
- PowerShell runner: **7/7 suites passed**, including new GUI provenance behavior.
- Locked CLI acceptance: `npm run test:toolchain` passed with its own ZIP and Temp
  root, through actual PowerShell `-LockedManifest` delegation and JS commands.
  Verified cache meant zero downloads. Tampered output was detected; reinstall
  retained the previous tree in backup. No vendor executable was executed.
- Source-owned real Ghidra regression: `node test/real-handoff.mjs <installed-root>`
  passed with the engine lease integration. A seeded managed PE was imported,
  native read session queried, evidence captured, ZIP moved/verified and Jev
  request built offline. `headless:ready`, decompile coverage:`partial`.
- Readonly Windows process inspection against the installed root reported busy
  bridge/Python processes. Only state, PID and executable names were returned;
  no command lines/credentials, termination or engine update occurred.
- CIM inspection was unavailable in the restricted process environment and
  correctly returned unknown. Readonly observation and CLI fixture acceptance
  were also run with permission to query CIM; the installer never bypassed this
  guard. Missing executable/command identity and both slash forms were tested
  through the actual embedded PowerShell with only CIM observations substituted.
  One CLI smoke during concurrent process-test churn refused unknown identity;
  the final sequential smoke passed. This guard was not weakened to make it pass.

## Regression and review scope

Spec review covered and corrected readers/project-root junction traversal,
false-idle process identity and inconsistent inventory/journal byte budgets.
Quality review corrected shared-cache substitution, unbounded dumper JSON,
missing executable identity and numeric native-fetch abort error codes. Final
independent tests:37/37 installer/lease/CLI,12/12 process, and PS provenance.
A native-fetch localhost stalled-body probe aborted at its shortened deadline,
returned TOOLCHAIN_DOWNLOAD_FAILED and released its gate.

ZIP fixtures cover safe paths, links, case collisions, CRC, declared limits,
implicit-prefix memory accounting, real cache corruption/replacement, private
archive changes and exact receipts. Multi-package tests cover all destinations,
known rollback, receipt rollback and uncertain rollback preserving its gate.
Read leases remain until actual engine close even if its outer parent dies;
an abruptly killed worker leaves conservative inspection evidence.

GUI fixtures cover source hashes/revision/dirty/unknown identity, compiler
version, artifact hash/size, source drift, occupied outputs, failed/empty
compilation, mid/late publication rollback and a real Windows file-sharing fault
that blocks rollback. They do not compile or run the real GUI.

The pre-change baseline had one native Windows current.json rename EPERM; root
verification later reproduced it and a fixture cleanup race. Controlled real
Windows sharing handles then reproduced atomic replacement refusal. The writer
now retries Windows sharing errors for at most1s using a monotonic clock, never
deleting the old target. A250ms hold succeeds after release; an1800ms hold times
out with original JSON intact and no temporary file. Other errors are not retried.

Terminal session metadata previously preceded supervisor lease/finally/process
closure. The supervisor now records its PID before engine launch. Stop proves
workspace lease cleanup, checks unchanged run ownership, waits for that known
owner's OS-observed exit and startup gate removal. It does not reclaim locks
based on PID death. A real child publishing terminal state before releasing its
lease/cwd reproduces the old return race; an uncertain engine marker with a dead
PID still blocks stop/reuse. Fixture teardown separately awaits its ChildProcess
event; event callback timing is not used as the OS liveness contract.

CI action pins were checked against official
[checkout7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) and
[setup-node7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0)
release commit links. Workflow source uses read-only permissions, Windows
PowerShell5.1 and Node24 fixture suites; no hosted execution was triggered.

## Qualification limits

No existing engine was replaced, no global setup changed, no vendor ZIP was
downloaded/executed, no real ps2exe module was installed, and no Jev call ran.
The locked path supports four relocatable ZIP types only; legacy latest-based
setup does not inherit its guarantees. A supplied lock's exact version/hash is
not an independently qualified vendor set. Python/MCP/.NET reproducibility,
live GUI/game acceptance and hosted CI remain visible roadmap work.
