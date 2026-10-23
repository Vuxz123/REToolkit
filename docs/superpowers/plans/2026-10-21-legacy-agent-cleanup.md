# Legacy agent integration cleanup

**Goal:** Remove obsolete REToolkit agent launch instructions and migrate existing
Ghidra registrations to the current Node launcher without changing other tools.

**Design:** Update only existing REToolkit/Ghidra MCP entries in Codex and OpenCode.
Preserve enabled state and unrelated client settings. Back up complete original
configurations and installed REToolkit skill folders outside active skill roots.
Replace the obsolete Codex CLI skill with the three current REToolkit skills;
refresh existing Claude copies. Do not select a game or register a workspace-bound
assets server without a workspace. Keep supported compatibility adapters, runtime
generations, user downloads, workspaces and historical design records intact.

**Implementation:** A small Node cleanup script with a dry-run default, exact
file hashes, link rejection, backups and no process/network operations. Pure
configuration transforms have regression tests for preserving unrelated data,
multiline TOML arguments, disabled registrations and repeat runs. Active docs,
skills and client examples must point to the current desktop/runtime launcher.

- [x] Test and implement guarded configuration cleanup.
- [x] Refresh active repo skills/docs/examples; inspect installed customizations.
- [x] Plan, back up and apply the reviewed personal configuration/skill changes.
- [x] Verify resulting config, MCP handshake without game queries, and tests.

No commit/push, game operations, process termination or unrelated cleanup.

## Verification and local application

- Independent review approved the final migration code; 8/8 focused tests passed.
  Regression tests cover multiline TOML strings, comments, bracket characters,
  unrelated/disabled servers, complete skill backups, edit detection and links.
- Applied 13 file changes: two client launch entries, two retired legacy Codex
  skill files, six current Codex skill files and three updated Claude skill files.
- Original backup:
  `.cache/agent-cleanup/28aaf158-76f8-4804-85ef-b23965080b0b/`.
  Its 16 manifest records include unchanged Claude skill UI metadata, completing
  the existing folder backups. All saved-file SHA256 values were verified.
- Independently parsed before/after configuration with Python's TOML/JSON parsers:
  only Ghidra command/args changed in Codex and the command array in OpenCode.
  Enabled state, credentials and unrelated settings/servers were preserved.
- Repeat cleanup plan was empty. The retired Codex skill folder was absent.
- `node test/real-mcp.mjs C:/Users/DPC00176/REToolkit`: initialization and
  tools/list passed, 30 advertised tools, no target queries. This checkout has
  no selected managed Python/desktop profile; the still-used local bridge venv
  was preserved. Node owns its launch; no unused-runtime claim is made.
- Final `npm test`: 666 tests, 665 passed, 1 skipped, 0 failed.
  An earlier run hit EBUSY while removing an unrelated desktop-launch fixture;
  its isolated 8 tests and the subsequent full suite passed without code changes
  to that subsystem. `npm run test:legacy` passed all retained PS suites.
- Active guidance now describes Electron, managed-profile preference, separate
  desktop runtime and current MCP configuration. Historical PowerShell tutorial
  is explicitly marked compatibility-only. Retained raw wrappers still need
  their PowerShell implementation; those and game/workspace data were preserved.

Restart affected agent clients to reload their integrations. Workspace-bound
assets MCP registration and a GUI Agent Setup screen remain separate work.

Configuration formats were checked against official documentation:
[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and
[OpenCode MCP](https://opencode.ai/docs/mcp-servers/).
