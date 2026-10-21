# Windows vendor MCP qualification implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development and TDD,
> with independent spec review followed by quality review.

**Goal:** Qualify the locked MCP installer against real Windows wheels while
preserving isolated launch and all archive/rollback guarantees.

**Architecture:** Narrow pywin32 312 adapter plus a private offline qualification
harness. Real metadata/transport checks are separate from GUI/plugin acceptance.

**Tech Stack:** Node24 ESM/node:test, existing checked ZIP IO, isolated CPython3.12.

- [x] Baseline215 JS, backup/hash tracked main files, isolated worktree from0ce7313.
- [x] Adapter worker owns src/python-runtime/windows-site.js and runner.js plus
  test/python-windows-site.test.js and runner tests. Export PYWIN32_PTH exact known
  string, validateWindowsWheel(wheel) (reject unsupported pywin32),
  allowWindowsHook(wheel,path,size) boolean, validateWindowsHook(wheel,path,bytes),
  WINDOWS_SITE_SCRIPT fixed Python prefix expects sys.argv[1] selected site.
  Prefix used in metadata probe and MCP launcher, pip stays independent. Test red
  before code, then fixed native imports and no arbitrary hook execution.
- [x] Root owns installer.js exception wiring: each wheel validates adapter
  eligibility; scoped hook entry preflight, read bounded extracted hook after CRC
  and exact-content check. Installer tests red then green. Preserve guard behavior.
- [x] Root owns test/helpers/mcp-handshake.mjs + helper tests: bounded stdio-only
  initialize/tools listing, exact close ownership, sanitized failures.
- [x] Root owns test/vendor-mcp-smoke.mjs + extension validator/helper tests,
  package command, docs/README/roadmap and actual smoke orchestration.
- [x] Artifact worker owns ignored .worktrees/vendor-mcp-artifacts/* only. Obtain
  exact public sources with size/hash/index/release provenance. Build schema1 lock
  and prepopulate <sha256>.zip cache; no installation or interpreter execution.
  Inputs from existing dist-info metadata; no ambient credentials/env exposure.
- [x] Independent spec review and quality review; resolve actionable findings.
- [x] Full JS/PS + source-owned smoke and real vendor smoke, no network during
  installation. Guard explicit changed paths only and backup original bytes before
  integration; repeat root qualification. Leave unrelated files unchanged.
