# REToolkit

REToolkit prepares Unity IL2CPP Android builds for Ghidra. Query an imported
project through the persistent headless Java bridge, or use GhidraMCP with the
live Ghidra/PyGhidra GUI. The recommended
command line is JavaScript: `node re.js <command>` (or `re.cmd <command>` on
Windows). Node.js 24 or newer is required.

The workspace pipeline is native JavaScript. The existing PowerShell installer,
GUI, and selected tool adapters remain available while the CLI migration comes
first. The GUI still uses the legacy PowerShell pipeline; it does not yet expose
the JavaScript CLI's complete state and resume behavior.

Use builds you are allowed to inspect. Do not bypass DRM, anti-cheat,
payment/licensing, or redistribute source/assets you do not own.

## Start

Install Node.js 24+, then install the toolkit-local engines and runtimes:

```powershell
npm ci
.\install-re-toolkit.ps1 -All
node .\re.js doctor
node .\re.js flow FoodHunt "D:\Builds\FoodHunt.apk" --no-open
node .\re.js status FoodHunt
node .\re.js open FoodHunt
```

The installer remains PowerShell and installs JDK, Python, .NET, Ghidra,
Il2CppDumper, GhidraMCP and AssetRipper. JavaScript does not replace these
engines. Runtime files stay under `runtime/` and `tools/`; do not change global
Python, Java or PATH to work around a missing toolkit runtime.

`flow` accepts APK/XAPK/AAB/ZIP files or an extracted directory. Its default
resume behavior preserves valid work. Use `--dry-run` to inspect the plan before
running engines, and `--no-open` to prepare without launching the GUI:

```powershell
node .\re.js flow FoodHunt "D:\Builds\FoodHunt.apk" --dry-run
node .\re.js flow FoodHunt "D:\Builds\FoodHunt.apk" --resume --no-open
```

A successful flow means **prepared**, not **analysis-ready**. Import uses
`-noanalysis`; run explicit `analyze` or use GUI Auto Analysis before relying on
decompilation. Symbols have a separate plan/apply workflow below. A detached
GUI launch does not prove that the intended program opened.
Verify the program, completed analysis, required symbols and MCP connection
before reporting analysis readiness.

## Diagnostics And Jev Handoff

```powershell
node re.js doctor FoodHunt --task prepare --json
node re.js doctor FoodHunt --task headless --json
node re.js doctor FoodHunt --task mcp --probe --json
node re.js status FoodHunt --json
```

Readiness is task-specific: `ready`, `available`, `unknown`, or `blocked`.
Installed files establish availability; a matching live Program establishes
query readiness. Analysis and symbols have independent evidence. Doctor exits
1 for a blocked task, and returns stable diagnostic codes with next actions.
`--probe` explicitly starts a bounded MCP discovery child; it does not connect
to a guessed instance or query target contents. Diagnostics do not start native
sessions, repair state, or migrate project files. Status retains its existing
state refresh behavior. The legacy GUI does not yet consume this model.

Capture narrow observations from an already-running native session, then stop
the session before taking a portable handoff snapshot:

```powershell
node re.js session start FoodHunt
node re.js evidence capture FoodHunt --kind functions --selector Board --limit 20
node re.js evidence capture FoodHunt --kind decompile --selector Board_Update --limit 100
node re.js session stop FoodHunt
node re.js handoff create FoodHunt --evidence exports/evidence/FoodHunt --out exports/FoodHunt.zip
node re.js handoff verify exports/FoodHunt.zip
node re.js jev request exports/FoodHunt.zip --questions config/jev-questions.example.json --out exports/request.json
```

Handoff defaults to dump metadata, authored notes, and explicitly supplied
captured evidence. Large reconstructed output, assets, and binaries require
individual opt-ins. Request creation is offline and defaults to notes/evidence
text under a 64 KiB state budget; it fails instead of truncating evidence.
`--against <bundle>` adds a second build for questions you define in Jev.
Inspect the generated JSON before sending it. Set `TYPESAFE_API_KEY` in your
environment and run `node re.js jev run exports/request.json --out exports/result.json`
to submit explicitly. The adapter follows the documented
[TypeSafe HTTP API](https://docs.typesafe.ai/api); live service acceptance has
not been tested. See [the CLI guide](docs/diagnostics-and-jev.md) and
[portable schema](docs/handoff-schema.md) for selection and limits.

## Inputs, State And Repeated Runs

Every workspace is stored in `workspaces/<GameName>/`, with `project.re.json`
and the existing `00_OriginalBuild` through `05_ReconstructedSource` folders.
Schema version 2 records content identity and step state. Legacy project JSON
remains readable; an old boolean alone does not establish current readiness.
Unverified legacy progress stays unknown until evidence supports it. Preserve
unknown fields and the pre-migration backup when moving a workspace forward.

The selected native binary and metadata are identified by SHA-256 and size.
Changed content invalidates dependent results even if a filename stays the
same. Metadata candidates are not proved compatible by their names. When a
scan finds multiple candidates, select paths explicitly instead of accepting
an arbitrary first match:

```powershell
node .\re.js scan FoodHunt "D:\Builds\Extracted" --binary "D:\Builds\Extracted\lib\arm64-v8a\libil2cpp.so" --metadata "D:\Builds\Extracted\assets\bin\Data\Managed\Metadata\global-metadata.dat"
```

`add` and `flow` accept `--binary` / `--metadata` too. Resume checks input
identity and output validity; a file's existence or an old flag is not enough.
Reusing a Ghidra import opens the selected program read-only to verify its
identity; close its GUI project first, or use the already-open GUI's MCP server.
Extraction and dump outputs are staged so a later failure keeps prior valid
work. Workspace mutation is serialized to avoid two commands racing.

Existing Ghidra programs are protected against silent overwrite. If inputs
change, choose a new workspace or deliberately request `--reimport`. Reimport
creates a backup before replacing the existing project; save and close that
project in Ghidra first. Review `--dry-run` before making this choice:

```powershell
node .\re.js flow FoodHunt "D:\Builds\FoodHunt.apk" --reimport --no-open
```

GUI analysis and manual symbols remain awaiting user action or unknown until verified.
A successful headless import does not confirm those separate steps.

## Persistent Ghidra CLI

Close the workspace's GUI project before starting a session. Read sessions are
the default; queries reuse one JVM, loaded Program and decompiler. Session start
does not import or run Auto Analysis.

```powershell
node re.js session start FoodHunt
node re.js function list FoodHunt --query Board --limit 50
node re.js decompile FoodHunt 0x123456 --json
node re.js session stop FoodHunt
```

Editing requires an explicitly started write session. A verified full project
backup precedes launch. Each data-changing operation creates a packed `.gzf`
snapshot and saves its transaction before returning success.

```powershell
node re.js session start FoodHunt --write
node re.js function rename FoodHunt 0x123456 Board_Update --dry-run
node re.js function rename FoodHunt 0x123456 Board_Update
node re.js comment set FoodHunt 0x123456 --type plate --text "Update board state"
node re.js symbols plan FoodHunt --address-mode rva
node re.js symbols apply FoodHunt --plan "<plan path returned above>"
node re.js session stop FoodHunt
node re.js open FoodHunt
```

Plans require verified current dump outputs. Choose address mode explicitly:
`rva` adds the Program image base; `va` uses absolute virtual addresses. Inspect
conflict/skipped counts before apply. USER_DEFINED names are kept unless a new
plan uses `--replace-user-names`; managed comments preserve surrounding text.
Function creation needs `--create-functions` and a verified instruction.
Partial coverage does not set symbolsApplied. Full C types/signatures are outside v1.

Use `node re.js session start --help` for bridge commands and
[the bridge guide](docs/ghidra-bridge.md) for retry/recovery and limits.
This is experimental v1. Qualification uses source-owned fixtures, not every IL2CPP build. ARM/Thumb
symbol mapping is currently unqualified; use the retained GUI path there.

## Commands

Run `node re.js help` for current argument details. `re.cmd` is a Windows
convenience wrapper for the same JavaScript entry point.

| Command | Purpose |
|---|---|
| `doctor` | Check toolkit runtime and engine paths. |
| `init <GameName>` | Create a workspace. |
| `scan <GameName> <directory>` | Locate/select native binary and metadata. |
| `add <GameName> <archive>` | Extract the build and scan it. |
| `dump <GameName>` | Generate Il2CppDumper outputs. |
| `import <GameName>` | Import the selected binary into Ghidra without analysis. |
| `flow <GameName> <source>` | Plan and run preparation; safe resume is the default. |
| `open <GameName>` / `path <GameName>` | Launch the workspace GUI / print project paths. |
| `status <GameName>` | Inspect persisted identity and progress. |
| `analyze <GameName>` | Explicit headless analysis with the GUI project closed. |
| `symbols <GameName>` | Print the manual Il2CppDumper script handoff. |
| `notes <GameName>` / `context <GameName>` / `candidates <GameName>` | Generate local analysis context from available outputs. |
| `export <GameName> [file.re]` | Export a workspace ZIP using the `.re` extension. |
| `import <file.re> [GameName] [--force]` | Restore a workspace archive and rebase paths. |
| `mcp` | Start the Python GhidraMCP bridge directly from JavaScript over stdio. |

`flow` supports `--resume`, `--dry-run`, `--no-open`, `--binary`, `--metadata`
and `--reimport`. Import into an occupied Ghidra project also requires deliberate
reimport. Archive import refuses an existing workspace unless `--force` was
explicitly supplied; replacement creates a backup first. Preserve that backup
until the restored workspace has been checked.

```powershell
node .\re.js export FoodHunt
node .\re.js import .\exports\FoodHunt.re FoodHuntCopy
```

The following compatibility commands temporarily invoke a legacy PowerShell
adapter: `ghidra-gui`, `pyghidra-gui`, `il2cppdumper`, `assetripper`
(`asset-ripper`), `assetripper-cli`, and `pull-ldplayer`. They require Windows
PowerShell 5.1. LDPlayer remains interactive and needs an authorized running
instance. AssetRipper exports do not establish that original source was recovered.
`open` and the optional GUI handoff at the end of `flow` use the retained
PyGhidra launcher adapter too.
Core workspace/state/scan/archive/flow operations do not fall back to PowerShell.

## Ghidra And MCP Handoff

1. Open the correct project and program in CodeBrowser.
2. Run Auto Analysis and wait for completion.
3. Run `ghidra.py` or `ghidra_with_struct.py` from the `tools/Il2CppDumper`
   Script Bundle; select this workspace's `02_Il2CppDumperOutput/script.json`.
4. Enable `File > Configure > Configure All Plugins > GhidraMCP`.
5. Start `Tools > GhidraMCP > Start MCP Server`.
6. In the AI client, discover instances, connect, and verify the intended program.

The GUI extension runs the HTTP server. The separate Python bridge in
`tools/ghidra-mcp/.venv` connects AI-client stdio to that server. Configure your
client to launch the bridge through JavaScript:

```toml
[mcp_servers.ghidra]
command = "node"
args = ["C:\\Users\\DPC00176\\REToolkit\\re.js", "mcp"]

[mcp_servers.ghidra.env]
RETOOLKIT_ROOT = "C:\\Users\\DPC00176\\REToolkit"
```

Replace the absolute root with your checkout. See `config/` for Codex and
OpenCode fragments. Merge them into existing configuration; do not replace
unrelated settings.

```text
list_instances
connect_instance <GameName>
list_tool_groups
load_tool_group function
load_tool_group listing
```

Use connected MCP tools for decompilation, functions, strings, xrefs, symbols,
types and comments. The old `ghidra` / `ghidra-cli` query backend is disabled.
Legacy `summary`, `strings`, `functions` and `stats` aliases only give guidance.

## Agent Skills And Older Installations

Use repo-local `skills/retoolkit-install`, `skills/retoolkit-flow` and
`skills/retoolkit-mcp-analysis`. An installed `ghidra-reverse-engineering-cli`
skill can still recommend obsolete commands. Search installed skill roots:

```powershell
$retkSkillRoots = @((Join-Path $HOME '.codex\skills'), (Join-Path $HOME '.agents\skills'))
if ($env:CODEX_HOME) { $retkSkillRoots += Join-Path $env:CODEX_HOME 'skills' }
$retkSkillRoots = @($retkSkillRoots | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -Unique)
if ($retkSkillRoots.Count -gt 0) {
    rg -n -g SKILL.md 'ghidra-reverse-engineering-cli|ghidra-cli|re\.ps1 ghidra\b' $retkSkillRoots
}
```

Include any other roots configured by your agent. Inspect matches: warnings
about disabled aliases are expected; instructions to execute them are stale.
Updating personal installed skills is separate, explicitly requested work.
Back up complete folders outside active skill roots, review customizations,
then install current instructions and archive conflicting legacy copies. See
[the install prompt](prompts/install-ghidra-skill.md#installed-skill-updates).
The toolkit does not rewrite global skills automatically.

## Tests And Verification Limits

```powershell
npm test
npm run test:legacy
```

`npm test` uses Node's built-in `node:test` runner for `test/*.test.js`.
`test:legacy` is optional and runs the original standalone PowerShell suites;
keep Windows PowerShell 5.1 compatibility when changing the retained adapters.
Tests using disposable files or fake engine processes check orchestration and
state, not Ghidra/Il2CppDumper correctness. GUI helper/source tests do not test
a live WinForms wizard.

Real-engine acceptance must separately cover a fresh authorized build, an
existing analyzed workspace, `.re` transfer/reopen and a verified MCP query.
Do not report these as passed from synthetic fixtures. The optional
`npm run test:ghidra -- C:\\path\\to\\installed-toolkit` builds its own tiny PE
fixture and checks real import and read-only attestation. This was verified
locally with Ghidra 12.1.2 and JDK 21; it does not establish IL2CPP dumping,
game analysis, a live GUI session or an MCP query.
`npm run test:ghidra-session -- C:\path\to\installed-toolkit` checks the new
persistent Java bridge, durable mutations and recovery on synthetic fixtures.
`npm run test:ghidra-symbols -- C:\path\to\installed-toolkit` also covers
synthetic ELF64 ARM64 and PE64 AMD64 loaders. See
[verification scope](docs/superpowers/specs/2026-10-19-ghidra-bridge-verification.md).
The separate read-only bridge check is
`npm run test:mcp -- C:\\path\\to\\installed-toolkit`; local initialization
and `tools/list` succeeded with the installed bridge (30 advertised tools).
This does not verify a connection to a particular game/program.
`npm run test:handoff -- C:\path\to\installed-toolkit` checks a source-owned
seeded PE through real Ghidra evidence capture, ZIP transfer verification, and
offline Jev request creation. It does not test IL2CPP dumping or send to Jev.

## Troubleshooting And Legacy GUI

For a project lock, query the already-open GUI through MCP, or save and close
that project in all Ghidra/PyGhidra windows before headless work. Let active
headless jobs finish. Do not delete locks or stop unrelated processes. There
is no working legacy stop alias.

If GhidraMCP is missing, install `tools/ghidra-mcp/GhidraMCP-<version>.zip` via
`File > Install Extensions > Add`, restart Ghidra, then enable the plugin. If
Script Manager cannot see `ghidra.py`, fully close all Ghidra/PyGhidra windows
and reopen so the Script Bundle config reloads.

The existing `scripts/retk-gui.ps1` / `REToolkit-GUI.exe` remains the legacy
PowerShell GUI. Rebuild with `.\scripts\build-gui.ps1` after changing its source.
GUI migration comes later; use JavaScript CLI for the new resume and state
behavior. [Tutorial.md](Tutorial.md) describes the older PowerShell workflow
and detailed installation screens; its CLI examples are legacy, not the
recommended JavaScript entry point.
