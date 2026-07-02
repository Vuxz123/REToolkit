---
name: retoolkit-mcp-analysis
description: Use when analyzing REToolkit-prepared Ghidra/PyGhidra projects through GhidraMCP, connecting AI clients, querying functions/strings/xrefs/symbols/decompilation, or troubleshooting MCP menu/server/project lock issues.
---

# REToolkit MCP Analysis

## Overview

REToolkit analysis is MCP-first. Use the live Ghidra/PyGhidra GUI plus
GhidraMCP for queries. Do not route project queries through `ghidra-cli`; this
toolkit disables legacy CLI query aliases and points them back to MCP.

## GUI Preconditions

Before querying from the AI client:

1. Open the target project/program in CodeBrowser.
2. Run Auto Analysis if the project was freshly imported.
3. Run `ghidra.py` or `ghidra_with_struct.py` if Il2CppDumper symbols are
   needed.
4. Enable `File > Configure > Configure All Plugins > GhidraMCP`.
5. Start `Tools > GhidraMCP > Start MCP Server`.

If the menu is missing, install
`tools/ghidra-mcp/GhidraMCP-<version>.zip` through
`File > Install Extensions > Add`, restart Ghidra, then enable the plugin.

## Client Connection

The AI client should launch the bridge with:

```powershell
.\re.ps1 mcp
```

Then use MCP tools in this order:

```text
list_instances
connect_instance <GameName>
list_tool_groups
load_tool_group function
load_tool_group listing
```

Load additional groups only when needed for strings, symbols, comments, types,
scripts, xrefs, or batch work.

## Query Rules

- Prefer MCP tools for function listing, decompilation, xrefs, strings,
  symbols, comments, types, and script execution.
- Use `workspaces/<GameName>/04_Notes/agent-context.md`,
  `candidates.md`, `dump.cs`, and `DummyDll` as readable context alongside MCP
  results.
- Ask for explicit confirmation before destructive operations such as patching,
  deleting symbols/functions, or modifying program state.

## Troubleshooting

| Symptom | Action |
|---|---|
| `list_instances` is empty | Open the program in CodeBrowser and start `Tools > GhidraMCP > Start MCP Server`. |
| MCP cannot connect | Check the GhidraMCP HTTP Server port in CodeBrowser tool options. |
| GhidraMCP menu missing | Install the saved extension ZIP, restart Ghidra, enable plugin. |
| Project lock error | Use the already-open GUI/MCP server or close the competing Ghidra/headless process. |
| Script Manager missing `ghidra.py` | Fully close all Ghidra/PyGhidra windows and reopen the GUI. |

## Common Mistakes

- Do not call `.\re.ps1 ghidra-cli` for normal analysis; it is not the query
  path in this toolkit.
- Do not start a separate headless process against a project already open in
  the GUI.
- Do not confuse the Python bridge with the GUI extension; both are required
  for MCP-first analysis.
