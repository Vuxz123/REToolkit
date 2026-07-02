---
name: retoolkit-flow
description: Use when preparing Unity IL2CPP APK/XAPK/AAB/ZIP or extracted builds with REToolkit flow, opening detached Ghidra/PyGhidra GUI handoffs, or exporting/importing .re workspaces.
---

# REToolkit Flow

## Overview

Use `.\re.ps1 flow` to prepare a Unity IL2CPP build and hand analysis to the
Ghidra/PyGhidra GUI. The flow intentionally imports with no headless analysis
and does not auto-apply `ghidra.py`.

## Full Flow

Run from the REToolkit root. If no game name is provided, derive a short,
space-free name from the APK or folder basename.

```powershell
.\re.ps1 flow <GameName> "<apk-or-ExtractedPath>"
```

The command creates/reuses `workspaces/<GameName>`, extracts or scans the
build, finds `libil2cpp.so` or `GameAssembly.dll`, finds
`global-metadata.dat`, runs Il2CppDumper, imports the program into Ghidra with
`-noanalysis`, generates notes, sets the default Ghidra project, and opens
PyGhidra.

## GUI Handoff

`flow`, `open`, and `pyghidra-gui` start PyGhidra detached by default. The
wrapper returns after launch handoff while the GUI keeps running. PyGhidra
stdout/stderr logs are written under `logs/pyghidra-gui-*`.

Use `--console` only when foreground logs are intentional. Do not kill the GUI
just because a previous foreground console command did not exit.

## Finish In Ghidra

After the GUI opens:

1. Open `workspaces/<GameName>/03_GhidraProject`.
2. Open `libil2cpp.so` or `GameAssembly.dll`.
3. Run Ghidra Auto Analysis.
4. Run `ghidra.py` or `ghidra_with_struct.py` from the `tools\Il2CppDumper`
   Script Bundle if symbols are needed.
5. When prompted, choose
   `workspaces\<GameName>\02_Il2CppDumperOutput\script.json`.
6. Start `Tools > GhidraMCP > Start MCP Server`.

Use `retoolkit-mcp-analysis` after this handoff.

## Manual And Archive Commands

Manual preparation:

```powershell
.\re.ps1 init <GameName>
.\re.ps1 add <GameName> "<apk-or-xapk-or-aab-or-zip>"
.\re.ps1 scan <GameName> "<ExtractedPath>"
.\re.ps1 dump <GameName>
.\re.ps1 import <GameName>
.\re.ps1 open <GameName>
```

Workspace handoff:

```powershell
.\re.ps1 export <GameName>
.\re.ps1 import .\exports\<GameName>.re
.\re.ps1 import .\exports\<GameName>.re <NewName>
.\re.ps1 import .\exports\<GameName>.re <GameName> --force
```

`import <GameName>` means Ghidra import. `import <Archive.re>` means workspace
archive import.

## Common Mistakes

- Do not run long headless analysis before the GUI workflow unless explicitly
  requested.
- Do not use `--console` in agent automation unless the user asks for attached
  foreground logs.
- Do not run headless analysis while the same project is locked by the GUI.
