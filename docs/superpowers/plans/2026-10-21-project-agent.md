# Project creation and AI Agent implementation plan

> Use subagent-driven-development for bounded tasks and independent review.

**Goal:** Create APK projects, launch a selected harness with project MCP context,
and expose observable engine jobs to agents.

**Architecture:** Keep privileged work in Node modules behind typed desktop IPC.
Run long MCP operations in child processes with workspace-local job records and
reuse existing CLI ownership, identity and receipt validation.

**Tech Stack:** Node 24 ESM, Electron, stdio MCP, existing CLI engines.

- [x] Harness task: `src/agents/launcher.js`, dedicated bootstrap/terminal helper
  as needed, `test/agent-launcher.test.js`. Test selection validation, missing
  harness, isolated MCP configs, prompt binding, no global writes/approval bypass.
  Read actual CLI docs/local help before relying on flags.
- [x] Jobs task: `src/jobs/` worker and service, typed definitions/routing in
  `src/assets/api.js`, descriptions in `src/assets/mcp.js`. Test immediate start,
  incremental progress, final success/failure, reconnect, bounded results and
  workspace/operation validation. Reuse Ghidra provider for symbols operations.
- [x] Desktop task: new project service with exclusive new-name reservation;
  project form/button and harness selector/launch IPC. Test duplicate refusal,
  APK success/incomplete import, no native execution, UI selection/disabled states.
- [x] Workflow task: update bundled reconstruction skill and generated launch
  context with split decision criteria, symbols receipts and job polling.
- [x] Verification/review: focused tests, full Node suite, real Electron fixture,
  independent contract/code review, docs and exact limitations. No commit/push
  requested. Preserve earlier uncommitted changes in the current workspace.

## Verification evidence

- Final Node full suite: 737 tests, 736 passed, one existing skip, no failures;
  `.cache/project-agent-tests-final.log` (68.7 seconds).
- Independent focused review: 41/41 tests passed across project, desktop, harness
  and MCP jobs. Actual detached Node workers and a source-owned fake Ghidra
  engine exercise symbol write/provider identity without a vendor mutation.
- Real Electron results acceptance: APK creation/selection, ordinary-form
  incomplete creation with large warnings, bounded preview, duplicate refusal,
  harness dropdown and rejected arbitrary harness all passed. Screenshots at
  `.cache/desktop-results-acceptance/3553dfc7-9fd9-43c0-945c-73809dc0d41c/`.
  Final acceptance rerun passed with the completed Gemini/input-repair code at
  `.cache/desktop-results-acceptance/1591fcb6-c48c-449a-ab46-a7ef1e074fcb/`.
- Real desktop smoke passed after the UI integration, including sandbox and Jev
  settings. No authenticated harness, device, game or Unity runtime was used.
- Retained PowerShell compatibility suites passed;
  `.cache/project-agent-legacy-tests.log`.
- Workflow metadata/local-link/CLI recipe validation passed. Four installed
  workflow files refreshed with guarded backups at
  `.cache/agent-cleanup/faff0263-86f8-41db-b3e6-687cfa246ab8/`; subsequent plan empty.
  The final two input-repair reference copies were refreshed with backup
  `.cache/agent-cleanup/e3f56971-7a5f-46ba-833e-0898951f6070/`; final plan empty.

Review fixes: automatic project selection also refreshes operation fields;
ordinary-form creation follows the same selection path; large intake previews
retain identity/state. Shared project JSON publishing now uses the existing
bounded Windows sharing-handle retry after a fixture exposed EPERM during GUI
polling (red/green regression). Unknown symbol transport outcomes preserve the
exact operation ID and never claim verified failure or success.

Gemini project/system/default settings are checked before terminal creation and
again before harness startup; conflicting reserved MCP bindings or managed MCP
policy remain untouched and cause an explicit refusal. Malformed settings never
echo credential-bearing JSON snippets. Fourteen launcher tests passed. Offline
review of four split/Mono/unknown-symbol/long-job scenarios found no instruction
gaps. Typed workspace.add/scan jobs repair needs-input and select multi-ABI
fixtures without starting an engine. Vendor/harness authentication and actual
device/game compatibility remain unverified.
