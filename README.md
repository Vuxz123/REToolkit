# REToolkit

### REToolkit for Unity games, specifically Android

## Quick Install

Pull this repository to your machine first. If you use an AI agent, you can drag
the files from `prompts/` into the agent and ask it to install or configure the
toolkit for you.

Suggested agent prompt:

```text
cài đặt với prompts trên và chạy flows cho thằng apk này {path}
```

Agent note: `flow`, `open`, and `pyghidra-gui` start PyGhidra detached by
default, so the wrapper returns after launch handoff while the GUI keeps
running. PyGhidra stdout/stderr logs are written under `logs/pyghidra-gui-*`.
Use `--console` only when you intentionally want foreground logs.

REToolkit is a portable Windows toolkit for preparing Unity IL2CPP projects for
Ghidra-based reverse engineering. The toolkit prepares the project; interactive
analysis and AI-assisted queries should run through GhidraMCP.

Use this only for builds you are allowed to inspect. Do not use it to bypass
DRM, anti-cheat, payment, licensing, or to redistribute source/assets you do not
own.

## Workflow

```text
Unity IL2CPP build
-> extract or scan build
-> locate libil2cpp.so/GameAssembly.dll and global-metadata.dat
-> run Il2CppDumper
-> generate dump.cs, DummyDll, script.json, il2cpp.h, ghidra.py
-> import binary into a Ghidra project with no analysis
-> open Ghidra/PyGhidra GUI
-> run Auto Analysis and ghidra.py manually
-> query/decompile/xref through GhidraMCP
```

The default `flow` intentionally does not run long headless analysis and does
not auto-apply `ghidra.py`. Do those steps in the GUI, then let the AI client
talk to the live Ghidra instance through MCP.

## Layout

```text
REToolkit/
  re.ps1
  install-re-toolkit.ps1
  tools/
    ghidra/
    ghidra-mcp/
    Il2CppDumper/
    AssetRipper/
  runtime/
    java/jdk-21/
    python/python-3.12/
    python/pyghidra-venv/
  workspaces/
  workspace-template/
  config/
  prompts/
```

Each project lives under:

```text
workspaces/<GameName>/
  project.re.json
  00_OriginalBuild/
  01_Extracted/
  02_Il2CppDumperOutput/
  03_GhidraProject/
  04_Notes/
  05_ReconstructedSource/
```

## Requirements

- Windows 10/11.
- Windows PowerShell 5.1 or PowerShell 7.
- Ghidra compatible with the installed GhidraMCP plugin.
- JDK 21, preferably the toolkit portable JDK at `runtime/java/jdk-21`.
- Toolkit-local Python 3.12 at `runtime/python/python-3.12`.
- .NET Runtime 8 for Il2CppDumper's `net8.0` package.
- `uv` for running the Python MCP bridge from `re.ps1 mcp`.

## Install

If PowerShell blocks unsigned scripts:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Unblock-File .\re.ps1
Unblock-File .\install-re-toolkit.ps1
```

Check current state:

```powershell
.\install-re-toolkit.ps1
.\re.ps1 doctor
```

Install runtime and core tools:

```powershell
.\install-re-toolkit.ps1 -All
```

`-All` runs the recommended full install order: runtime, .NET Runtime,
Ghidra, Il2CppDumper, GhidraMCP, then AssetRipper.

Install pieces individually:

```powershell
.\install-re-toolkit.ps1 -InstallRuntime
.\install-re-toolkit.ps1 -InstallDotNetRuntime
.\install-re-toolkit.ps1 -InstallGhidra
.\install-re-toolkit.ps1 -InstallIl2CppDumper
.\install-re-toolkit.ps1 -InstallGhidraMcp
.\install-re-toolkit.ps1 -InstallAssetRipper
```

`-InstallRuntime` installs JDK 21 and a toolkit-local Python 3.12 under
`runtime/python/python-3.12`. It does not change the global Python, PATH, or
`py.exe` launcher, so a system Python 3.14 can stay installed. `pyghidra-gui`
uses a separate `runtime/python/pyghidra-venv` created from that local Python.
If the venv is deleted, the PyGhidra wrapper recreates it before launch.

`-InstallDotNetRuntime` installs Microsoft .NET Runtime 8 with `winget`.
Il2CppDumper v6.7.48 publishes `net8.0` and `net6.0` zips; the installer uses
`net8.0` when Microsoft.NETCore.App 8.x is present and falls back to `net6.0`
only when a 6.x runtime is already installed.

`-InstallIl2CppDumper` also replaces the bundled `ghidra.py` and
`ghidra_with_struct.py` with toolkit-maintained Python 3/PyGhidra templates.
The installer and `re.ps1 ghidra-gui`/`re.ps1 pyghidra-gui` register
`tools/Il2CppDumper` as a Ghidra Script Bundle in the CodeBrowser user config:

```text
%APPDATA%\ghidra\ghidra_<version>_PUBLIC\tools\_code_browser.tcd
```

A `.bak.<timestamp>` copy is written before that file is changed. If the
CodeBrowser config does not exist yet, the toolkit creates it from
`templates/Ghidra/_code_browser.tcd` before registering the Script Bundle.
Manual fallback: open Script Manager > Bundle Manager and add
`tools\Il2CppDumper`.

If Ghidra opens but Script Manager still does not show `ghidra.py` or
`ghidra_with_struct.py`, fully close all Ghidra/PyGhidra windows and reopen the
GUI so CodeBrowser reloads its Script Bundle config.

Download the latest GhidraMCP release assets from
`https://github.com/bethington/ghidra-mcp/releases/latest`:

```powershell
.\install-re-toolkit.ps1 -InstallGhidraMcp
```

That installer path uses the GitHub Releases API and downloads these release
assets into `tools/ghidra-mcp`:

- `GhidraMCP-<version>.zip`, the Ghidra extension ZIP.
- `ghidra_mcp_bridge-<version>-py3-none-any.whl`, the Python MCP bridge
  (ships its own dependencies).

It also creates `tools/ghidra-mcp/.venv` and `pip install`s the wheel there.
`re.ps1 mcp` uses that local Python environment when it exists.

When a local Ghidra install is present, the installer also extracts the
extension ZIP to `tools/ghidra-mcp/extension/GhidraMCP` and installs a copy into
Ghidra's user extension folder:

```text
%APPDATA%\ghidra\ghidra_<version>_PUBLIC\Extensions\GhidraMCP
```

The `bridge_mcp_ghidra` wheel is not the Ghidra plugin. It is the AI-client-side
MCP bridge: Codex/OpenCode talks to it over stdio (via the `bridge-mcp-ghidra`
console script installed into `tools/ghidra-mcp/.venv`), and it forwards
requests to the GhidraMCP server running inside the Ghidra GUI.

Optional:

```powershell
.\install-re-toolkit.ps1 -InstallAssetRipper
```

## Enable GhidraMCP In The GUI

After `-InstallGhidraMcp` downloads the release assets and auto-installs the
extension:

1. Start Ghidra or PyGhidra:

```powershell
.\re.ps1 ghidra-gui FoodHunt
# or
.\re.ps1 pyghidra-gui FoodHunt
```

Passing a `GameName` updates Ghidra's user preferences before launch so the
tool opens with that workspace project as the recent/default project. Plain
`ghidra-gui` and `pyghidra-gui` still work when you do not want to select a
project. If Ghidra has never created `%APPDATA%\ghidra\...\preferences`, the
toolkit creates it from `templates/Ghidra/preferences` and then injects the
selected workspace project.

2. Restart Ghidra if it was already open while the installer ran.

3. Open a CodeBrowser for the target project/program.
4. Enable the plugin:

```text
File > Configure > Configure All Plugins > GhidraMCP
```

5. Optional port configuration:

```text
CodeBrowser > Edit > Tool Options > GhidraMCP HTTP Server
```

6. Start the server:

```text
Tools > GhidraMCP > Start MCP Server
```

If the GhidraMCP menu is still missing, install the saved ZIP manually with:

```text
File > Install Extensions > Add
```

Select `tools/ghidra-mcp/GhidraMCP-<version>.zip`, restart Ghidra, then enable
the plugin.

The default server URL is usually `http://127.0.0.1:8089/`. The Python MCP
bridge installed at `tools/ghidra-mcp/.venv/Scripts/bridge-mcp-ghidra.exe`
discovers GUI instances and exposes them to AI clients.

## Configure An AI Client

Codex TOML example:

```toml
[mcp_servers.ghidra]
command = "powershell.exe"
args = [
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", "C:\\Users\\DPC00176\\REToolkit\\re.ps1",
  "mcp"
]

[mcp_servers.ghidra.env]
RETOOLKIT_ROOT = "C:\\Users\\DPC00176\\REToolkit"
```

OpenCode JSON example:

```json
{
  "mcpServers": {
    "ghidra": {
      "command": "C:\\Users\\DPC00176\\REToolkit\\re.ps1",
      "args": ["mcp"],
      "type": "stdio",
      "env": {
        "RETOOLKIT_ROOT": "C:\\Users\\DPC00176\\REToolkit"
      }
    }
  }
}
```

Agent query flow:

```text
list_instances
connect_instance <GameName>
list_tool_groups
load_tool_group function
load_tool_group listing
```

Then use the MCP tools for function lists, decompilation, strings, xrefs,
symbols, comments, types, and batch operations.

## Quick Start

Full flow from APK/XAPK/AAB/ZIP:

```powershell
.\re.ps1 flow FoodHunt "D:\Builds\FoodHunt.apk"
```

Full flow from an extracted folder:

```powershell
.\re.ps1 flow FoodHunt "D:\Builds\FoodHunt_Extracted"
```

Manual steps:

```powershell
.\re.ps1 init FoodHunt
.\re.ps1 scan FoodHunt "D:\Builds\FoodHunt_Extracted"
.\re.ps1 dump FoodHunt
.\re.ps1 import FoodHunt
.\re.ps1 open FoodHunt
```

Workspace archive handoff:

```powershell
.\re.ps1 export FoodHunt
.\re.ps1 import .\exports\FoodHunt.re
```

`export` writes a normal ZIP archive with a `.re` extension. On import, toolkit
restores the workspace under `workspaces/` and rebases absolute paths in
`project.re.json` to the current toolkit folder.

After the GUI opens:

1. Open `workspaces/FoodHunt/03_GhidraProject`.
2. Open `libil2cpp.so` or `GameAssembly.dll`.
3. Run Ghidra Auto Analysis.
4. Run `ghidra.py` or `ghidra_with_struct.py` from the `tools\Il2CppDumper`
   Script Bundle, then select the workspace `script.json` when prompted.
5. Start GhidraMCP from `Tools > GhidraMCP > Start MCP Server`.
6. Connect the AI client with `connect_instance FoodHunt`.

## Pull An APK From LDPlayer

If a game is only installed through the Play Store inside LDPlayer, pull it
directly from a running instance instead of finding an APK file by hand:

```powershell
.\re.ps1 pull-ldplayer FoodHunt com.example.foodhunt
```

This auto-detects `adb.exe` and the running LDPlayer device, opens the app so
any OBB or dynamic-feature-module downloads can trigger, waits for
confirmation, then pulls the base APK, all split APKs, and any OBB files into
`workspaces\FoodHunt\00_OriginalBuild\` and runs the same extract/scan `add`
does. The workspace is ready for `dump` when the command returns.

Options:

```text
-DeviceSerial <serial>   # target a specific device when multiple are connected
-AdbPath <path>          # use a specific adb.exe instead of auto-detecting
-SkipLaunch              # skip opening the app (use when OBB/modules are already downloaded)
```

This command is interactive: it needs LDPlayer open with the game installed
and a human to actually play long enough for background downloads to finish.
It does not pull app-private data under `/data/data/<package>/`.

## re.ps1 Commands

| Command | Purpose |
|---|---|
| `doctor` | Check local toolkit paths and runtime basics. |
| `init <GameName>` | Create workspace and `project.re.json`. |
| `add <GameName> <apk/xapk/aab/zip>` | Extract a build into `01_Extracted`, then scan. |
| `pull-ldplayer <GameName> <PackageName>` | Pull base+split APKs and OBB files from a running LDPlayer instance, then extract/scan like `add`. |
| `scan <GameName> <ExtractedPath>` | Locate native binary and metadata. |
| `dump <GameName>` | Run Il2CppDumper. |
| `import <GameName>` | Import into Ghidra with `analyzeHeadless -import -overwrite -noanalysis`. |
| `export <GameName> [OutFile.re]` | Package a workspace as a `.re` archive. |
| `import <Archive.re> [GameName] [--force]` | Restore a `.re` workspace archive; optional name overrides the workspace folder. |
| `flow <GameName> <apk-or-ExtractedPath>` | Prepare the project and open PyGhidra. |
| `open <GameName>` | Print paths and open PyGhidra. |
| `path <GameName>` | Print Ghidra project folder/link. |
| `status <GameName>` | Show `project.re.json` state. |
| `notes <GameName>` | Generate `candidates.md` and `agent-context.md`. |
| `candidates <GameName>` | Parse `dump.cs` for candidate class names. |
| `context <GameName>` | Generate agent context. |
| `analyze <GameName>` | Optional headless analysis when the GUI is closed. |
| `symbols <GameName>` | Print manual GUI instructions for running `ghidra.py`. |
| `ghidra-gui [GameName]` | Start Ghidra GUI with toolkit env; optional game name sets the default/recent project first. |
| `pyghidra-gui [GameName]` | Start PyGhidra GUI with toolkit env; optional game name sets the default/recent project first. |
| `il2cppdumper <args...>` | Raw Il2CppDumper passthrough. |
| `assetripper [args...]` | Open the installed AssetRipper GUI; alias: `asset-ripper`. |
| `mcp` | Start the GhidraMCP Python bridge for AI clients. |

Legacy query aliases `summary`, `strings`, `functions`, and `stats` no longer
run a CLI backend. They print MCP setup guidance.

## Troubleshooting

### GhidraMCP menu is missing

Enable the plugin in CodeBrowser:

```text
File > Configure > Configure All Plugins > GhidraMCP
```

If the plugin is not listed, install the downloaded release ZIP:

```text
File > Install Extensions > Add
```

Select `tools/ghidra-mcp/GhidraMCP-<version>.zip`, restart Ghidra, then enable
the plugin. If the ZIP is missing, rerun:

```powershell
.\install-re-toolkit.ps1 -InstallGhidraMcp
```

### MCP server is not responding

1. Confirm the CodeBrowser has the target program open.
2. Start the server:

```text
Tools > GhidraMCP > Start MCP Server
```

3. Check the configured port:

```text
CodeBrowser > Edit > Tool Options > GhidraMCP HTTP Server
```

4. In the AI client, call `list_instances`, then `connect_instance <GameName>`.

### Project lock errors

Ghidra projects are normally locked by one process at a time. If
`analyzeHeadless` reports a lock, close the GUI project or use the MCP server
from the already-open GUI instead of starting another headless process.

### Il2CppDumper says the file may be protected

That warning can appear on IL2CPP binaries. If `dump.cs`, `DummyDll`, and
`ghidra.py` are generated, the pipeline can usually continue.

### Il2CppDumper cannot find .NET

Run:

```powershell
.\install-re-toolkit.ps1 -InstallDotNetRuntime
```

The installer uses Il2CppDumper's `net8.0` package when Microsoft.NETCore.App
8.x is installed. It can use the `net6.0` package only when Microsoft.NETCore.App
6.x is already present.
