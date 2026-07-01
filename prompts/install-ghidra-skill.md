# Install And Use GhidraMCP With REToolkit

This prompt is for an AI agent or human setting up REToolkit for MCP-first
Ghidra reverse engineering.

## Goal

Use `bethington/ghidra-mcp` as the analysis/query backend. REToolkit prepares
Unity IL2CPP projects and launches the MCP bridge with:

```powershell
.\re.ps1 mcp
```

The live Ghidra GUI instance provides analysis capabilities through the
GhidraMCP plugin. Agent queries should go through MCP tools, not a separate
command-line bridge.

## Install

From the REToolkit root:

```powershell
.\install-re-toolkit.ps1 -InstallRuntime
.\install-re-toolkit.ps1 -InstallGhidra
.\install-re-toolkit.ps1 -InstallIl2CppDumper
.\install-re-toolkit.ps1 -InstallGhidraMcp
```

`-InstallGhidraMcp` uses:

```text
https://github.com/bethington/ghidra-mcp
```

It copies `bridge_mcp_ghidra.py` into `tools/ghidra-mcp` and runs the upstream
setup/deploy path against `tools/ghidra`.

## Ghidra GUI Setup

1. Open the target project/program in Ghidra or PyGhidra.
2. Enable the plugin:

```text
File > Configure > Configure All Plugins > GhidraMCP
```

3. Optional port settings:

```text
CodeBrowser > Edit > Tool Options > GhidraMCP HTTP Server
```

4. Start the server:

```text
Tools > GhidraMCP > Start MCP Server
```

## AI Client Config

Codex TOML fragment:

```toml
[mcp_servers.ghidra]
command = "C:\\Users\\DPC00176\\REToolkit\\re.ps1"
args = ["mcp"]

[mcp_servers.ghidra.env]
RETOOLKIT_ROOT = "C:\\Users\\DPC00176\\REToolkit"
```

OpenCode JSON fragment:

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

## Agent Workflow

Prepare the project with REToolkit:

```powershell
.\re.ps1 flow FoodHunt "D:\Path\To\FoodHunt.apk"
```

Then finish in the GUI:

1. Open the imported program.
2. Run Auto Analysis.
3. Run `workspaces\FoodHunt\02_Il2CppDumperOutput\ghidra.py` if symbol import is needed.
4. Start `Tools > GhidraMCP > Start MCP Server`.

Then in the MCP client:

```text
list_instances
connect_instance FoodHunt
list_tool_groups
load_tool_group function
load_tool_group listing
```

Use MCP tools for function listing, decompilation, xrefs, strings, symbols,
comments, types, script execution, and batch operations.

## REToolkit Commands

Use these local commands to prepare and inspect workspace state:

```powershell
.\re.ps1 doctor
.\re.ps1 init <GameName>
.\re.ps1 add <GameName> <apk-or-xapk-or-aab-or-zip>
.\re.ps1 scan <GameName> <ExtractedPath>
.\re.ps1 dump <GameName>
.\re.ps1 import <GameName>
.\re.ps1 flow <GameName> <apk-or-ExtractedPath>
.\re.ps1 open <GameName>
.\re.ps1 path <GameName>
.\re.ps1 status <GameName>
.\re.ps1 candidates <GameName>
.\re.ps1 context <GameName>
.\re.ps1 notes <GameName>
.\re.ps1 ghidra-gui
.\re.ps1 pyghidra-gui
.\re.ps1 mcp
```

Legacy query aliases `summary`, `strings`, `functions`, and `stats` print MCP
guidance only. Do project queries through the connected GhidraMCP tools.

## Safety

- Do not run destructive write operations unless the user explicitly confirms
  the target project/program.
- Avoid running headless analysis while the same project is open in another
  Ghidra process.
- Prefer the already-open GUI plus GhidraMCP for interactive analysis.
