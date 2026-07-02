---
name: retoolkit-install
description: Use when setting up REToolkit on Windows, importing repo-local REToolkit skills, installing runtime/Ghidra/Il2CppDumper/GhidraMCP/AssetRipper, or configuring Codex/OpenCode MCP for REToolkit.
---

# REToolkit Install

## Overview

Set up REToolkit from the repository root and keep it MCP-first. The toolkit
uses portable runtime paths and should not modify global Python, PATH, or the
Windows `py.exe` launcher.

## Import Skills First

If this skill is being read from the repository, use the repo-local skill
folders directly when the agent runtime supports it. Import or copy them into
the agent's normal skill directory only when that runtime requires installed
skills:

```text
skills/retoolkit-install
skills/retoolkit-flow
skills/retoolkit-mcp-analysis
```

Do not automatically copy these skills into Codex or another personal skill
directory unless the user asks for that install step. Keep the repo copy intact.

## Install Workflow

Work from the REToolkit root:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Unblock-File .\re.ps1
Unblock-File .\install-re-toolkit.ps1
.\install-re-toolkit.ps1
.\re.ps1 doctor
```

Install the recommended toolchain:

```powershell
.\install-re-toolkit.ps1 -All
```

Use individual flags only for repair or a targeted install:

```powershell
.\install-re-toolkit.ps1 -InstallRuntime
.\install-re-toolkit.ps1 -InstallGhidra
.\install-re-toolkit.ps1 -InstallIl2CppDumper
.\install-re-toolkit.ps1 -InstallGhidraMcp
.\install-re-toolkit.ps1 -InstallAssetRipper
```

`-InstallRuntime` creates toolkit-local JDK/Python paths under `runtime/`.
`-InstallGhidraMcp` downloads the Ghidra extension ZIP, the Python bridge, and
requirements into `tools/ghidra-mcp`; `bridge_mcp_ghidra.py` is the AI-client
bridge, not the GUI plugin.

## AI Client MCP

Configure the client to run:

```powershell
.\re.ps1 mcp
```

Codex TOML shape:

```toml
[mcp_servers.ghidra]
command = "C:\\Users\\DPC00176\\REToolkit\\re.ps1"
args = ["mcp"]

[mcp_servers.ghidra.env]
RETOOLKIT_ROOT = "C:\\Users\\DPC00176\\REToolkit"
```

## Handoff

Use `retoolkit-flow` when the user gives an APK/XAPK/AAB/ZIP or extracted
build. Use `retoolkit-mcp-analysis` after the Ghidra/PyGhidra GUI is open.

## Common Mistakes

- Do not use global Python 3.14 for PyGhidra; use the toolkit local runtime.
- Do not treat the MCP bridge as the Ghidra extension; the extension runs in
  the GUI.
- If Script Manager does not show `ghidra.py`, fully close all Ghidra/PyGhidra
  windows and reopen the GUI.
- Network installs may require user approval in sandboxed agent environments.
