# REToolkit Setup And MCP Handoff

Use the current repo-local instructions in `skills/retoolkit-install`,
`skills/retoolkit-flow`, `skills/retoolkit-mcp-analysis` and
`skills/retoolkit-game-reconstruction`. The recommended
CLI is `retk <command>` on Node.js 24+. `retk gui` opens the Electron desktop.
The old PowerShell UI is retained for compatibility; use the current desktop
and [runtime guide](../docs/desktop.md).

## Install And Prepare

From the repository root:

```powershell
npm ci
npm run cli:install
retk setup install --lock config/native-windows-x64.lock.json
retk desktop-runtime install --lock config/desktop-windows-x64.lock.json
npm run gui:install
node .\re.js doctor
node .\re.js flow FoodHunt "D:\Builds\FoodHunt.apk" --dry-run
node .\re.js flow FoodHunt "D:\Builds\FoodHunt.apk" --no-open
node .\re.js status FoodHunt
node .\re.js open FoodHunt
```

Installation, desktop, Ghidra/PyGhidra launch and the core pipeline run through
Node.js. The PowerShell installer is an adapter; do not route the current Node
pipeline through the legacy PowerShell implementation.

Resume is the default. Use explicit `--binary` and `--metadata` paths when
candidate discovery is ambiguous. Existing Ghidra programs must never be
silently overwritten: use a new workspace, or deliberately request
`--reimport`, which backs up the project before replacement. Close the owning
Ghidra project before headless work; do not delete its lock or kill unrelated
processes. Archive replacement similarly requires explicit `--force` and backup.

Successful `flow` means prepared, not analysis-ready. In CodeBrowser, verify
the intended program, finish Auto Analysis, run the Il2CppDumper script with
this workspace's `script.json`, then start GhidraMCP. A detached launch or
import flag does not establish these facts.

## MCP Client

Configure the client to run `node <absolute-path-to-re.js> mcp`. Merge the
fragments in `config/codex-ghidra-mcp.example.toml` or
`config/opencode-ghidra-mcp.example.json` into existing settings. The JavaScript
command launches the local Python stdio bridge directly; the separate GUI
extension provides the live Ghidra server.

```text
File > Configure > Configure All Plugins > GhidraMCP
Tools > GhidraMCP > Start MCP Server
```

Then query through MCP:

```text
list_instances
connect_instance <GameName>
list_tool_groups
load_tool_group function
load_tool_group listing
```

Verify the connected project/program before interpreting results. The retired
`ghidra` / `ghidra-cli` query backend is disabled. Use MCP for functions,
decompilation, xrefs, strings, symbols, types and comments.

## Installed Skill Updates

REToolkit skills are agent-neutral Markdown instruction folders. Read them
from this checkout when supported. Installing or updating a personal skill copy
is separate, explicitly requested work; do not automatically write outside the
repository merely to run the toolkit.

An installed `ghidra-reverse-engineering-cli` skill may contain obsolete query
instructions. Search the agent's configured skill roots before following them:

```powershell
$retkSkillRoots = @((Join-Path $HOME '.codex\skills'), (Join-Path $HOME '.agents\skills'))
if ($env:CODEX_HOME) { $retkSkillRoots += Join-Path $env:CODEX_HOME 'skills' }
$retkSkillRoots = @($retkSkillRoots | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -Unique)
if ($retkSkillRoots.Count -gt 0) {
    rg -n -g SKILL.md 'ghidra-reverse-engineering-cli|ghidra-cli|re\.ps1 ghidra\b' $retkSkillRoots
}
```

Include other roots configured by the agent. Without `rg`, use
`Get-ChildItem -LiteralPath <root> -Filter SKILL.md -Recurse | Select-String -Pattern 'ghidra-cli'`.
Warnings that an alias is disabled are current guidance; instructions to run
the obsolete backend need review.

When the user explicitly requests installation/update:

1. Read the exact installed folders and local customizations. Identify both
   old `retoolkit-*` folders and a conflicting legacy CLI skill.
2. Copy complete folders to a timestamped backup outside all active skill
   roots, such as `~/.codex/skill-backups/<timestamp>/`. Verify `SKILL.md` and
   every supporting file was copied. Keep the backup intact.
3. Review changes against this checkout and retain useful local customizations
   while updating CLI/MCP instructions. Do not rename an MCP skill to the old
   CLI skill name.
4. Archive conflicting installed folders outside active skill roots. Install
   the four current repo folders into the agent's configured skill directory
   only after checking the exact destinations; avoid merging into or silently
   overwriting existing customized folders.
5. Restart the agent, verify the loaded skill paths, and retain the backup for
   rollback. Other agents can read the same repo folders using their own skill
   mechanism; do not assume Codex paths apply to every agent.

The explicit cleanup command automates the known legacy integrations:

```cmd
node scripts/clean-agent-integrations.mjs
node scripts/clean-agent-integrations.mjs --apply
```

The first command is read-only. Apply backs up originals under
`.cache/agent-cleanup/<UUID>/`, verifies hashes, updates existing Ghidra entries
in Codex/OpenCode, refreshes installed REToolkit skill files and retires the old
Codex CLI skill. Other MCP servers and settings stay unchanged. Backups may
contain private configuration; keep them out of Git. Restart the affected agent
after applying. AssetRipper MCP still requires an explicitly selected workspace.

## Verification

Run `npm test` for the JavaScript behavioral suite and optionally
`npm run test:legacy` for the original PS5.1 suites. Record real-engine checks
separately: fresh authorized build, an existing analyzed workspace, `.re`
transfer/reopen and a live MCP query. Disposable fixtures do not establish
real GUI/engine readiness. Do not claim original source reconstruction from
`dump.cs`, DummyDll or AssetRipper output alone.
