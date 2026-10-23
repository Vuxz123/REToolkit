# Quick installation implementation

- [x] Add fail-first tests for cold plan, profiles, parser, strict ordering,
  failure propagation, rerun verification and command registration conflicts.
- [x] Implement a built-in-only Node quickstart coordinator and command runner.
  Keep dependency installation before importing existing runtime services.
- [x] Reuse exact native/desktop/Python locks with matching verified receipts;
  record bounded stages and stop on changed/unknown selections.
- [x] Add portable Node lock, CMD entry and PowerShell bootstrap with checked
  archives, guarded extraction/reuse and write-free plan/help.
- [x] Add managed retk shim and user-only PATH registration with --no-path.
  Never execute registration against the real user profile in tests.
- [x] Wire npm/retk entry points and update installation docs and repository skill.
- [x] Run focused fixtures, real isolated CLI shim acceptance and Node regression;
  record remaining checks requiring a genuinely clean Windows machine.


## Verification — 2026-10-23

- Full Node regression after final CLI root binding: 1,059 tests, 1,058 passed,
  zero failed, one gated real Unity migration test skipped. Log:
  `.cache/quickstart-all-tests-final.log`.
- Bootstrap/registration/coordinator/parser fixtures cover write-free cold plans,
  malformed args, linked paths, archive traversal/size limits, portable file
  changes, retained gates/journals, failure ordering, CLI module loading, existing
  command collisions and Unicode CMD paths. PATH merging preserves original raw
  expandable entries, duplicates and empty entries. No real registry write was
  performed by tests.
- Genuine official Node portable download, extraction, exact verification and
  warm reuse passed with existing Node hidden from PATH:
  `.cache/quickstart-bootstrap-acceptance/1da6e0df-db05-4c88-a499-a2f366da095a/`.
  This ran the final bounded HTTP downloader with explicit timeouts.
- Actual frozen npm installation and generated retk command passed in a fresh
  source fixture using portable Node, private npm cache and --no-path:
  `.cache/quickstart-cli-acceptance/1e209b90-c64d-4c25-bfbf-7dd2e25b3ffa/`.
  Real retk --version returned 0.2.0; rerun reused dependencies only after module
  loading. No native engine, user PATH or user npm configuration was changed.
- Production sandboxed Electron flow passed, including the new quickstart plan
  button and correct --root/--json forwarding:
  `.cache/desktop-flow-acceptance/374945b0-2938-48a9-8585-bca5980080c3/`.
  Other project creation, scope isolation and Jev draft checks remain passing.
- Read-only spec/security/correctness review found no remaining P1/P2 after
  fixing PATH preservation and missing-module dependency reuse. Runtime install
  services retain their existing transaction and integrity suites.
- Syntax and whitespace checks passed. No commit/push. The full multi-engine
  installer has not been executed on a newly provisioned clean Windows machine;
  clean-machine runtime/extension activation and live MCP acceptance remain
  separate from the tested bootstrap and CLI installation.
