# REToolkit Tutorial: MCP-First Ghidra Workflow

This tutorial prepares a Unity IL2CPP project, opens it in Ghidra/PyGhidra, and
uses GhidraMCP for AI-assisted queries.

## 1. Prepare PowerShell

```powershell
cd C:\Users\DPC00176\REToolkit
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Unblock-File .\re.ps1
Unblock-File .\install-re-toolkit.ps1
```

## 2. Install Core Tools

```powershell
.\install-re-toolkit.ps1 -InstallRuntime
.\install-re-toolkit.ps1 -InstallGhidra
.\install-re-toolkit.ps1 -InstallIl2CppDumper
.\install-re-toolkit.ps1 -InstallGhidraMcp
```

`-InstallRuntime` installs a toolkit-local Python 3.12 at
`runtime/python/python-3.12`. It does not modify your global Python or `py.exe`
launcher. PyGhidra is launched through `runtime/python/pyghidra-venv`, which is
created from that local Python by the installer and recreated by the wrapper if
it is missing.

`-InstallIl2CppDumper` patches `tools\Il2CppDumper\ghidra.py` and
`tools\Il2CppDumper\ghidra_with_struct.py` with toolkit-maintained Python 3
templates. If Ghidra has already created its CodeBrowser user config, the
installer and `re.ps1 ghidra-gui`/`re.ps1 pyghidra-gui` also register
`tools\Il2CppDumper` as a Ghidra Script Bundle in:

```text
%APPDATA%\ghidra\ghidra_<version>_PUBLIC\tools\_code_browser.tcd
```

The toolkit writes a `.bak.<timestamp>` backup before modifying that file. If
the config does not exist yet, start and close Ghidra once, then rerun the
installer or wrapper. Manual fallback: Script Manager > Bundle Manager, add
`tools\Il2CppDumper`.

`-InstallGhidraMcp` downloads the latest release assets from:

```text
https://github.com/bethington/ghidra-mcp
```

It saves the extension ZIP, Python bridge, and requirements file under
`tools/ghidra-mcp`. It also creates `tools/ghidra-mcp/.venv` and installs
`requirements.txt` there for the MCP bridge.

When Ghidra is installed locally, it also extracts the extension into
`tools/ghidra-mcp/extension/GhidraMCP` and installs it into:

```text
%APPDATA%\ghidra\ghidra_<version>_PUBLIC\Extensions\GhidraMCP
```

`bridge_mcp_ghidra.py` is the MCP bridge used by AI clients. It is separate
from the Ghidra extension that runs inside the GUI.

Optional:

```powershell
.\install-re-toolkit.ps1 -InstallAssetRipper
```

## 3. Enable GhidraMCP In The GUI

1. Start Ghidra or PyGhidra:

```powershell
.\re.ps1 pyghidra-gui
```

2. Restart Ghidra if it was already open while the installer ran.

3. Open a CodeBrowser window for your project/program.
4. Enable the plugin:

```text
File > Configure > Configure All Plugins > GhidraMCP
```

5. Optional: configure port/settings:

```text
CodeBrowser > Edit > Tool Options > GhidraMCP HTTP Server
```

6. Start the server:

```text
Tools > GhidraMCP > Start MCP Server
```

If the menu is missing, use the saved ZIP as a manual fallback:
`File > Install Extensions > Add`, select
`tools/ghidra-mcp/GhidraMCP-<version>.zip`, then restart Ghidra.

## 4. Prepare A Game Project

For an APK/XAPK/AAB/ZIP:

```powershell
.\re.ps1 flow FoodHunt "D:\Path\To\FoodHunt.apk"
```

For an already extracted folder:

```powershell
.\re.ps1 flow FoodHunt "D:\Path\To\FoodHunt_Extracted"
```

The flow does this:

1. Create or reuse `workspaces/FoodHunt`.
2. Extract or scan the build.
3. Find `libil2cpp.so` or `GameAssembly.dll`.
4. Find `global-metadata.dat`.
5. Run Il2CppDumper.
6. Import the native binary into Ghidra with no analysis.
7. Generate `candidates.md` and `agent-context.md`.
8. Open PyGhidra.

## 5. Finish Manual Ghidra Setup

In the GUI:

1. Open `workspaces/FoodHunt/03_GhidraProject`.
2. Open the imported program, usually `libil2cpp.so` or `GameAssembly.dll`.
3. Run Auto Analysis.
4. Run this script from the `tools\Il2CppDumper` Script Bundle if you need
   Il2CppDumper symbols:

```text
ghidra.py
```

When prompted, select `workspaces/FoodHunt/02_Il2CppDumperOutput/script.json`.

5. Start the MCP server:

```text
Tools > GhidraMCP > Start MCP Server
```

## 6. Connect The AI Client

Configure your AI client to launch:

```powershell
.\re.ps1 mcp
```

Then use the Ghidra MCP tools:

```text
list_instances
connect_instance FoodHunt
list_tool_groups
load_tool_group function
load_tool_group listing
```

After `connect_instance <GameName>`, use MCP tools for function lists,
decompilation, strings, xrefs, symbols, comments, and type work.

## 7. Useful Local Commands

```powershell
.\re.ps1 doctor
.\re.ps1 status FoodHunt
.\re.ps1 path FoodHunt
.\re.ps1 candidates FoodHunt
.\re.ps1 context FoodHunt
.\re.ps1 notes FoodHunt
.\re.ps1 mcp
```

Legacy query aliases such as `summary`, `strings`, `functions`, and `stats`
only print MCP guidance now. Query the live Ghidra program through MCP instead.

## 8. Common Problems

- `re.ps1 is not digitally signed`: run `Unblock-File .\re.ps1` and use process-scope execution policy bypass.
- `GhidraMCP` menu is missing: install `tools/ghidra-mcp/GhidraMCP-<version>.zip` with `File > Install Extensions > Add`, restart Ghidra, then enable the plugin from `File > Configure > Configure All Plugins > GhidraMCP`.
- MCP cannot see `FoodHunt`: open the correct project/program in CodeBrowser and start `Tools > GhidraMCP > Start MCP Server`.
- `Unable to lock project`: close other Ghidra/headless processes for that project, or use MCP from the already-open GUI.
- PyGhidra does not open from `open`: run `.\re.ps1 pyghidra-gui`, then open the project manually.
- PyGhidra picks Python 3.14/global Python: run `.\install-re-toolkit.ps1 -InstallRuntime`; `.\re.ps1 pyghidra-gui` should report `runtime\python\pyghidra-venv\Scripts\python.exe`.
- Il2CppDumper says `This file may be protected`: check whether `dump.cs`, `DummyDll`, and `ghidra.py` were still generated.
