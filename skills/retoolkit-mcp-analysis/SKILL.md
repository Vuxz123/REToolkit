---
name: retoolkit-mcp-analysis
description: Use when connecting to a REToolkit-prepared Ghidra/PyGhidra program through GhidraMCP, querying functions/decompilation/xrefs, or troubleshooting GUI server and project lock issues.
---

# REToolkit MCP Analysis

Resolve the checkout from the task context or the MCP registration's absolute
`re.js` path. Examples assume that checkout as the current directory; otherwise
use the absolute entrypoint. Documentation paths refer to the checkout rather
than this skill's personal installation directory.

Interactive analysis uses the live Ghidra/PyGhidra GUI through GhidraMCP.
Launch the bridge with the recommended JavaScript CLI:

```powershell
node .\re.js mcp
```

The JavaScript command verifies and launches the selected managed Python MCP
profile. Only when no managed profile is selected can it use the retained local
venv; do not bypass this launcher with a downloaded Python script or `uv`.
The GUI extension is a different component: it owns
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

If the extension is missing, use the reviewed Node desktop profile in
`config/desktop-windows-x64.lock.json`: `retk desktop-runtime plan`, `install`
(both with `--lock <file>`), then `verify`. Launch through
`retk ghidra-gui <Workspace>` or `retk pyghidra-gui <Workspace>` so the managed
extension/runtime are selected. For a deliberately retained manual installation,
use `File > Install Extensions > Add` with its saved extension ZIP and restart.
If instances are absent, check the intended CodeBrowser, enabled plugin/server
and GhidraMCP HTTP Server tool options for the configured port.

For a project lock, use the already-open GUI/MCP server. For deliberate headless
work, save and close the owning GUI project and let active jobs finish. Never
delete locks, stop unrelated processes or recommend the retired stop alias.

If installed `ghidra-reverse-engineering-cli` guidance contradicts this skill,
prefer this checkout's instructions and review the
installed-skill search/backup procedure in its `README.md` section
"Agent Skills And Older Installations".
Do not rewrite personal skills without an authorized installation/cleanup task.
The current desktop is Electron (`retk gui`) and uses typed Node operations.
Its evidence panel presents status, metrics, tables and logs, with raw JSON
collapsed. Do not claim a live engine test passed from disposable fixtures.

For exported Unity asset queries and reconstruction, configure a separate stdio
server with `node <absolute-re.js> assets mcp <Workspace>`. It exposes
`assets_*`, `reconstruct_*`, library, migration and visual tools. Choose the
intended workspace explicitly; see `docs/assetripper-ai.md` in the checkout.
External MCP calls are not automatically desktop jobs, and Jev configuration
does not create an autonomous agent or verify gameplay.

Use `retoolkit-game-reconstruction` to coordinate a reconstruction task across
these tools, retain checkpoints and verify the correct candidate project.
