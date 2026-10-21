# REToolkit

AssetRipper AI access and controlled Unity stub reconstruction are available in
the JavaScript CLI: `retk assets --help` and
`retk reconstruct --help`. See [the workflow and MCP setup](docs/assetripper-ai.md).
Reconstructed exports can now be [validated in an isolated Unity staging project](docs/unity-validation.md)
with `retk reconstruct validate <Game>`.
Local library ZIPs can be [cataloged, planned and imported into staging](docs/libraries.md)
with `retk libraries --help`; library roots start empty.

REToolkit prepares Unity IL2CPP Android builds for Ghidra. Query an imported
project through the persistent headless Java bridge, or use GhidraMCP with the
live Ghidra/PyGhidra GUI. The recommended
command line is `retk <command>`, registered through npm after installing
Node.js 24+. Direct `node re.js <command>` and `re.cmd <command>` also work.

The workspace pipeline, native setup, Ghidra/PyGhidra launch and Electron desktop
use JavaScript. Run `npm run gui:install`, then `retk gui` for the desktop.
The PowerShell installer remains a thin Node adapter; the previous Windows GUI
is retained as legacy. See [desktop, runtime, visual and migration setup](docs/desktop.md).
Jev now has a local configuration file and a **Settings · Jev** screen; see
[Jev configuration](docs/jev-settings.md).

Use builds you are allowed to inspect. Do not bypass DRM, anti-cheat,
payment/licensing, or redistribute source/assets you do not own.

## Start

Install Node.js 24+, open CMD in this REToolkit checkout and register the command:

```cmd
npm ci
npm run cli:install
retk --version
retk --help
```

`cli:install` uses [npm link](https://docs.npmjs.com/cli/v11/commands/npm-link/)
to register `retk`/`retk.cmd` in npm's global prefix. You can then run `retk`
from any CMD directory; engines and workspaces stay in this linked checkout.
Keep the checkout at its current path, or rerun registration after moving it.
No npm registry publication or engine download happens during registration.
This project has not been published as a public npm package by this workflow;
install from this checkout rather than an unverified registry name.

If CMD cannot find `retk`, run `npm prefix -g` and check that directory is on
your user PATH, then open a new CMD. Registration does not edit PATH itself.
To unregister the command, run `npm unlink --global retoolkit --ignore-scripts`;
the source checkout and its workspace data stay in place.

Then plan and install the four toolkit-local native engines:

```cmd
retk setup plan --lock config/native-windows-x64.lock.json --json
retk setup install --lock config/native-windows-x64.lock.json --json
retk doctor
retk flow FoodHunt "D:\Builds\FoodHunt.apk" --no-open
retk status FoodHunt
retk open FoodHunt
```

Relative build, lock and output paths resolve from the current CMD directory.
For a command run elsewhere, pass absolute paths or use metadata-based native
setup: `retk setup install --all --native-only --json`.

This first setup stage covers JDK21, Ghidra, Il2CppDumper and AssetRipper ZIPs.
Exact defaults are JDK 21.0.11, Ghidra 12.1.2, Dumper 6.7.48 net8.0 and
AssetRipper 1.3.14; Ghidra selection includes JDK. `setup resolve` emits a lock,
`setup plan` resolves metadata without writing, `setup install` uses the existing
staged transaction, and `setup status` reads the receipt and version metadata.
Resolution uses publisher release metadata and fails if the exact asset lacks a
published checksum. The shipped [native Windows x64 lock](config/native-windows-x64.lock.json)
records these four exact releases and their publisher checksums. To resolve other
exact versions, use `--components` and the matching `--*-version` options. For a
separate reviewed lock:

```powershell
retk setup plan --lock config/my-toolchain.lock.json --json
retk setup install --lock config/my-toolchain.lock.json --cache D:\RetkPackages --json
retk setup status --json
```

`--lock` skips metadata networking; planning is offline and installation uses a
verified prepopulated cache without downloads. Missing cache entries download
only the locked archives. Metadata-based `resolve` and `plan` do access the
network. `resolve --out <fresh.json>` writes a new lock without overwriting one.
Downloads have bounded retries and Range resumption within the same invocation;
there is no cross-run partial-download resume. Progress goes to stderr.

The equivalent Windows PowerShell 5.1 adapter is
`.\install-re-toolkit.ps1 -All -NativeOnly`; with no flags it reads status.
`-All` without `-NativeOnly` fails before metadata downloads or engine writes
because GUI Python, GhidraMCP extensions and global .NET need separate reviewed
profiles. `-InstallRuntime` also requests GUI Python and is blocked for the same
reason. Use `-InstallGhidra` (includes JDK) or
`retk setup install --components jdk,ghidra` for native Java/Ghidra setup.
GUI Python, extension and global .NET installation have not been ported. Runtime
files stay under `runtime/` and `tools/`; do not change global Python, Java or PATH
to work around a missing toolkit runtime.

For reviewed archive versions, use the new locked installation path:

```powershell
retk toolchain plan config/my-toolchain.lock.json --json
retk toolchain install config/my-toolchain.lock.json --cache D:\RetkPackages --json
retk toolchain verify --json
```

It verifies SHA256/size, stages all selected packages, refuses busy engines,
backs up previous trees, and rolls back failures. Supported archives are JDK21,
Ghidra, Il2CppDumper and AssetRipper. The separate `python-runtime` lock installs
CPython 3.12 x64 and all MCP wheels into an immutable generation:

```powershell
retk python-runtime plan config/my-python.lock.json --json
retk python-runtime install config/my-python.lock.json --cache D:\RetkPackages --json
retk python-runtime verify --json
```

Python installation executes the reviewed locked interpreter/pip locally and uses
offline wheels with exact hashes. MCP verifies the selected file inventory before
launch; no selection retains the legacy bridge. `-PythonManifest` preserves this
MCP CLI route in the adapter, and `-LockedManifest` preserves the native lock
route. These routes cannot be mixed with native selection/version flags. Neither
installs GUI Python, extensions or .NET. See [Python/MCP locks](docs/python-runtime.md).

Windows MCP dependencies now include a narrow adapter for the reviewed
pywin32312 CPython312 x64 wheel. `npm run test:vendor-mcp -- <lock> <cache>
<extension.zip> <ghidra>` checks offline installation, MCP transport and extension
metadata in Temp. The locally tested bridge6.0.0 set passes CLI qualification;
GUI/plugin activation remains a separate check.

Locks must contain actual release URLs and checksums. The shipped native lock
covers four engine ZIPs; Python/MCP uses its separate wheel lock. See
[toolchain and release checks](docs/toolchain-and-release.md).

`flow` accepts APK/XAPK/AAB/ZIP files or an extracted directory. Its default
resume behavior preserves valid work. Use `--dry-run` to inspect the plan before
running engines, and `--no-open` to prepare without launching the GUI:

```powershell
retk flow FoodHunt "D:\Builds\FoodHunt.apk" --dry-run
retk flow FoodHunt "D:\Builds\FoodHunt.apk" --resume --no-open
```

A successful flow means **prepared**, not **analysis-ready**. Import uses
`-noanalysis`; run explicit `analyze` or use GUI Auto Analysis before relying on
decompilation. Symbols have a separate plan/apply workflow below. A detached
GUI launch does not prove that the intended program opened.
Verify the program, completed analysis, required symbols and MCP connection
before reporting analysis readiness.

## Diagnostics And Jev Handoff

```powershell
retk doctor FoodHunt --task prepare --json
retk doctor FoodHunt --task headless --json
retk doctor FoodHunt --task mcp --probe --json
retk status FoodHunt --json
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
retk session start FoodHunt
retk evidence capture FoodHunt --kind functions --selector Board --limit 20
retk evidence capture FoodHunt --kind decompile --selector Board_Update --limit 100
retk session stop FoodHunt
retk handoff create FoodHunt --evidence exports/evidence/FoodHunt --out exports/FoodHunt.zip
retk handoff verify exports/FoodHunt.zip
retk jev request exports/FoodHunt.zip --questions config/jev-questions.example.json --out exports/request.json
```

Handoff defaults to dump metadata, authored notes, and explicitly supplied
captured evidence. Large reconstructed output, assets, and binaries require
individual opt-ins. Request creation is offline and defaults to notes/evidence
text under a 64 KiB state budget; it fails instead of truncating evidence.
`--against <bundle>` adds a second build for questions you define in Jev.
Inspect the generated JSON before sending it. Set `TYPESAFE_API_KEY` in your
environment and run `retk jev run exports/request.json --out exports/result.json`
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
retk scan FoodHunt "D:\Builds\Extracted" --binary "D:\Builds\Extracted\lib\arm64-v8a\libil2cpp.so" --metadata "D:\Builds\Extracted\assets\bin\Data\Managed\Metadata\global-metadata.dat"
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
retk flow FoodHunt "D:\Builds\FoodHunt.apk" --reimport --no-open
```

GUI analysis and manual symbols remain awaiting user action or unknown until verified.
A successful headless import does not confirm those separate steps.

## Persistent Ghidra CLI

Close the workspace's GUI project before starting a session. Read sessions are
the default; queries reuse one JVM, loaded Program and decompiler. Session start
does not import or run Auto Analysis.

```powershell
retk session start FoodHunt
retk function list FoodHunt --query Board --limit 50
retk decompile FoodHunt 0x123456 --json
retk session stop FoodHunt
```

Editing requires an explicitly started write session. A verified full project
backup precedes launch. Each data-changing operation creates a packed `.gzf`
snapshot and saves its transaction before returning success.

```powershell
retk session start FoodHunt --write
retk function rename FoodHunt 0x123456 Board_Update --dry-run
retk function rename FoodHunt 0x123456 Board_Update
retk comment set FoodHunt 0x123456 --type plate --text "Update board state"
retk symbols plan FoodHunt --address-mode rva
retk symbols apply FoodHunt --plan "<plan path returned above>"
retk session stop FoodHunt
retk open FoodHunt
```

Plans require verified current dump outputs. Choose address mode explicitly:
`rva` adds the Program image base; `va` uses absolute virtual addresses. Inspect
conflict/skipped counts before apply. USER_DEFINED names are kept unless a new
plan uses `--replace-user-names`; managed comments preserve surrounding text.
Function creation needs `--create-functions` and a verified instruction.
Partial coverage does not set symbolsApplied. Full C types/signatures are outside v1.

Use `retk session start --help` for bridge commands and
[the bridge guide](docs/ghidra-bridge.md) for retry/recovery and limits.
This is experimental v1. Qualification uses source-owned fixtures, not every IL2CPP build. ARM/Thumb
symbol mapping is currently unqualified; use the retained GUI path there.

## Commands

Run `retk help` for current argument details. `re.cmd` is a Windows
convenience wrapper for the same JavaScript entry point.

| Command | Purpose |
|---|---|
| `doctor` | Check toolkit runtime and engine paths. |
| `setup resolve / plan / install / status` | Resolve exact native releases, inspect/install a lock, or read installed receipt state. |
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
| `libraries <operation>` | Catalog local Unity library ZIPs, resolve requirements and verify staging imports. |

`flow` supports `--resume`, `--dry-run`, `--no-open`, `--binary`, `--metadata`
and `--reimport`. Import into an occupied Ghidra project also requires deliberate
reimport. Archive import refuses an existing workspace unless `--force` was
explicitly supplied; replacement creates a backup first. Preserve that backup
until the restored workspace has been checked.

```powershell
retk export FoodHunt
retk import .\exports\FoodHunt.re FoodHuntCopy
```

The following compatibility commands temporarily invoke a legacy PowerShell
adapter: `ghidra-gui`, `pyghidra-gui`, `il2cppdumper`, `assetripper`
(`asset-ripper`), and `assetripper-cli`. They require Windows
PowerShell 5.1. AssetRipper exports do not establish that original source was recovered.
`open` and the optional GUI handoff at the end of `flow` use the retained
PyGhidra launcher adapter too.
Core workspace/state/scan/archive/flow operations do not fall back to PowerShell.

ADB discovery and LDPlayer capture are native JavaScript:

```powershell
retk adb devices --adb C:\LDPlayer\LDPlayer9\adb.exe --json
retk pull-ldplayer FoodHunt com.example.game --serial emulator-5554 --skip-launch --json
```

Use `--adb <adb.exe>` if ADB is not on PATH or in a known LDPlayer location.
An explicit serial is required when several devices are ready. Capture keeps
base/split APKs and OBBs, checks remote/local sizes and records SHA256 before
importing through the Node pipeline. Without `--skip-launch`, an interactive
terminal launches the game and waits for Enter after its downloads finish.
JSON/Agent calls require `--skip-launch`. See [ADB capture and recovery](docs/adb-capture.md).

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

`npm run test:setup-download` explicitly downloads the four locked native ZIPs
into an isolated `.cache` toolkit and verifies installed inventories. It requires
at least 5 GiB free, retains its evidence, and executes no vendor binary. See
[native setup verification](docs/superpowers/specs/2026-10-20-node-setup-verification.md).

`npm run test:adb` compiles and runs a source-owned fake ADB executable against
owned base/split/OBB ZIPs. It checks the actual CLI, supervised child processes,
leases and partial-pull preservation without connecting to a device or emulator.

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
Module installation now needs explicit `-InstallPs2Exe`; replacement needs `-Force`.
Builds publish a provenance sidecar with source revision/hashes and EXE identity.
GUI migration comes later; use JavaScript CLI for the new resume and state
behavior. [Tutorial.md](Tutorial.md) describes the older PowerShell workflow
and detailed installation screens; its CLI examples are legacy, not the
recommended JavaScript entry point.
