---
name: retoolkit-mcp-analysis
description: Use when connecting to a REToolkit-prepared Ghidra/PyGhidra program through GhidraMCP, querying functions/decompilation/xrefs, or troubleshooting GUI server and project lock issues.
---

# REToolkit MCP Analysis

Interactive analysis uses the live Ghidra/PyGhidra GUI through GhidraMCP.
Launch the bridge with the recommended JavaScript CLI:

```powershell
node .\re.js mcp
```

The JavaScript command directly starts the Python stdio bridge in
`tools/ghidra-mcp/.venv`. The GUI extension is a different component: it owns
the server and live program. Protocol stdout must not include status banners.
The retired `ghidra` / `ghidra-cli` backend is disabled.

`flow` success means **prepared**, not **analysis-ready**. Before querying:

1. Confirm the target project/program is open in CodeBrowser.
2. Finish Auto Analysis; run `ghidra.py` or `ghidra_with_struct.py` with this
   workspace's `02_Il2CppDumperOutput/script.json` when symbols are required.
3. Enable `File > Configure > Configure All Plugins > GhidraMCP`.
4. Start `Tools > GhidraMCP > Start MCP Server`.

```text
list_instances
connect_instance <GameName>
list_tool_groups
load_tool_group function
load_tool_group listing
```

Verify the connected project/program before interpreting results. Load other
groups only when needed. Use MCP for functions, decompilation, xrefs, strings,
symbols, types and comments, with workspace notes and `dump.cs` as supporting
context. These generated artifacts are not the original source code.

If the extension is missing, install the saved `tools/ghidra-mcp/GhidraMCP-<version>.zip`
through `File > Install Extensions > Add`, restart Ghidra, then enable it. If
instances are absent, check the intended CodeBrowser and server; check the
GhidraMCP HTTP Server tool options for the configured port.

For a project lock, use the already-open GUI/MCP server. For deliberate headless
work, save and close the owning GUI project and let active jobs finish. Never
delete locks, stop unrelated processes or recommend the retired stop alias.

If installed `ghidra-reverse-engineering-cli` guidance contradicts this skill,
prefer this checkout's instructions and review the
[installed-skill search/backup procedure](../../README.md#agent-skills-and-older-installations).
Do not rewrite personal skills automatically. The retained PowerShell GUI has
not been migrated to the JavaScript CLI; do not promise GUI feature parity or
claim a live engine test passed from source checks or disposable fixtures.
