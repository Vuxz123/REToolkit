# REToolkit

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
    python/
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
- Python 3.10+ for GhidraMCP bridge/setup.
- Git for cloning GhidraMCP.
- Maven 3.9+ for building the GhidraMCP extension.
- .NET Desktop Runtime for Il2CppDumper.
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
.\install-re-toolkit.ps1 -InstallRuntime
.\install-re-toolkit.ps1 -InstallGhidra
.\install-re-toolkit.ps1 -InstallIl2CppDumper
```

Install GhidraMCP from `https://github.com/bethington/ghidra-mcp`:

```powershell
.\install-re-toolkit.ps1 -InstallGhidraMcp
```

That installer path clones the upstream repo, copies `bridge_mcp_ghidra.py` into
`tools/ghidra-mcp`, then runs the upstream setup flow:

```text
python -m tools.setup preflight --ghidra-path tools\ghidra
python -m tools.setup ensure-prereqs --ghidra-path tools\ghidra
python -m tools.setup build
python -m tools.setup deploy --ghidra-path tools\ghidra
```

Optional:

```powershell
.\install-re-toolkit.ps1 -InstallAssetRipper
```

## Enable GhidraMCP In The GUI

After `-InstallGhidraMcp` deploys the extension:

1. Start Ghidra or PyGhidra:

```powershell
.\re.ps1 ghidra-gui
# or
.\re.ps1 pyghidra-gui
```

2. Open a CodeBrowser for the target project/program.
3. Enable the plugin:

```text
File > Configure > Configure All Plugins > GhidraMCP
```

4. Optional port configuration:

```text
CodeBrowser > Edit > Tool Options > GhidraMCP HTTP Server
```

5. Start the server:

```text
Tools > GhidraMCP > Start MCP Server
```

The default server URL is usually `http://127.0.0.1:8089/`. The Python MCP
bridge in `tools/ghidra-mcp/bridge_mcp_ghidra.py` discovers GUI instances and
exposes them to AI clients.

## Configure An AI Client

Codex TOML example:

```toml
[mcp_servers.ghidra]
command = "C:\\Users\\DPC00176\\REToolkit\\re.ps1"
args = ["mcp"]

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

After the GUI opens:

1. Open `workspaces/FoodHunt/03_GhidraProject`.
2. Open `libil2cpp.so` or `GameAssembly.dll`.
3. Run Ghidra Auto Analysis.
4. Run `workspaces/FoodHunt/02_Il2CppDumperOutput/ghidra.py` from Script Manager.
5. Start GhidraMCP from `Tools > GhidraMCP > Start MCP Server`.
6. Connect the AI client with `connect_instance FoodHunt`.

## re.ps1 Commands

| Command | Purpose |
|---|---|
| `doctor` | Check local toolkit paths and runtime basics. |
| `init <GameName>` | Create workspace and `project.re.json`. |
| `add <GameName> <apk/xapk/aab/zip>` | Extract a build into `01_Extracted`, then scan. |
| `scan <GameName> <ExtractedPath>` | Locate native binary and metadata. |
| `dump <GameName>` | Run Il2CppDumper. |
| `import <GameName>` | Import into Ghidra with `analyzeHeadless -import -overwrite -noanalysis`. |
| `flow <GameName> <apk-or-ExtractedPath>` | Prepare the project and open PyGhidra. |
| `open <GameName>` | Print paths and open PyGhidra. |
| `path <GameName>` | Print Ghidra project folder/link. |
| `status <GameName>` | Show `project.re.json` state. |
| `notes <GameName>` | Generate `candidates.md` and `agent-context.md`. |
| `candidates <GameName>` | Parse `dump.cs` for candidate class names. |
| `context <GameName>` | Generate agent context. |
| `analyze <GameName>` | Optional headless analysis when the GUI is closed. |
| `symbols <GameName>` | Print manual GUI instructions for running `ghidra.py`. |
| `ghidra-gui` | Start Ghidra GUI with toolkit env. |
| `pyghidra-gui` | Start PyGhidra GUI with toolkit env. |
| `il2cppdumper <args...>` | Raw Il2CppDumper passthrough. |
| `mcp` | Start the GhidraMCP Python bridge for AI clients. |

Legacy query aliases `summary`, `strings`, `functions`, and `stats` no longer
run a CLI backend. They print MCP setup guidance.

## Troubleshooting

### GhidraMCP menu is missing

Enable the plugin in CodeBrowser:

```text
File > Configure > Configure All Plugins > GhidraMCP
```

If the plugin is not listed, rerun:

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
