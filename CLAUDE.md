# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

REToolkit is a portable Windows PowerShell toolkit that prepares Unity IL2CPP
Android builds (APK/XAPK/AAB) for Ghidra-based reverse engineering, then hands
off to GhidraMCP for AI-assisted analysis. It is pure PowerShell — no compiled
project, no package manager, no build step.

Use only on builds you are allowed to inspect. Do not use it to bypass DRM,
anti-cheat, payment/licensing, or to redistribute source/assets you do not own.

## Commands

There is no build step. Everything runs directly as PowerShell.

**Syntax-check a single script** (no toolkit state needed):
```powershell
[System.Management.Automation.Language.Parser]::ParseFile("path\to\file.ps1", [ref]$null, [ref]$errors)
```

**Run the test suite** — each file is standalone, run individually (there is no
aggregating runner):
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-mcp-first.Tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\ghidra-script-bundle.Tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\ghidra-preferences.Tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\workspace-archive.Tests.ps1
```
Despite the `.Tests.ps1` naming, these are **not** real Pester tests — they are
hand-rolled scripts using local `Assert-Contains`/`Assert-NotContains`/
`Assert-True`/`Assert-Equals` helpers. `retk-mcp-first.Tests.ps1`,
`ghidra-script-bundle.Tests.ps1`, and `ghidra-preferences.Tests.ps1` mostly
`Get-Content -Raw` the real source files and assert that specific
functions/strings/flags are present or absent — a regression guard on the
public interface and documented behavior, not an execution test.
`workspace-archive.Tests.ps1` is the exception: it dot-sources
`scripts\retk-project.ps1` and actually exercises `New-Workspace` /
`Export-WorkspaceArchive` / `Import-WorkspaceArchive` end-to-end against a temp
directory. When adding a function whose presence/behavior other code depends
on, add or extend an `Assert-*` line for it in the matching test file.

**Run the toolkit itself:**
```powershell
.\install-re-toolkit.ps1 -All        # install JDK/Python/.NET/Ghidra/Il2CppDumper/GhidraMCP/AssetRipper
.\re.ps1 doctor                      # check local toolkit paths/runtime
.\re.ps1 flow <GameName> <apk-or-extracted-path>
```

Target platform is Windows PowerShell 5.1 (not just PowerShell 7) — several
comments in the code call this out explicitly (e.g. `Join-NativeArgumentString`
builds a manual command-line string because `ProcessStartInfo.ArgumentList` is
not reliable there). Do not introduce PS7-only syntax/cmdlets without checking.

## Architecture

### Two independent entry points

- **`re.ps1`** — the daily-driver CLI. Builds `$Root`/`$Tools`/`$Workspaces`/
  `$ToolPaths` at the top, then dot-sources `scripts\ghidra-script-bundle.ps1`,
  `scripts\ghidra-preferences.ps1`, and the modules in `$RetkScriptModules`
  (`retk-core`, `retk-process`, `retk-il2cpp`, `retk-pyghidra`, `retk-project`,
  `retk-pipeline`, `retk-ui`, in that order) before dispatching on `$Command`
  via a `switch`. Every dot-sourced module relies on those script-scope
  variables already existing — they are not passed as parameters.
- **`install-re-toolkit.ps1`** — a large (~1400 line), fully self-contained
  installer. It does not dot-source anything from `scripts\` (except
  optionally `ghidra-script-bundle.ps1` for Script Bundle registration) and
  duplicates a few helpers (e.g. `Join-NativeArgumentString`-equivalents)
  rather than sharing code with `re.ps1`.
- **`run-ghidra.ps1` / `run-pyghidra.ps1`** — standalone GUI launcher scripts,
  used directly (not through the `re.ps1` dispatcher). They intentionally
  duplicate JDK/Python path resolution and env setup from `re.ps1`/
  `retk-core.ps1` rather than dot-sourcing them, so a fix in one place does not
  automatically propagate to the others — check both when touching JDK/Python
  path resolution or `Invoke-WithToolkitEnv`-style logic.

### Workspace model

Every project lives at `workspaces\<GameName>\` with `project.re.json` as the
single source of truth (`00_OriginalBuild/`, `01_Extracted/`,
`02_Il2CppDumperOutput/`, `03_GhidraProject/`, `04_Notes/`,
`05_ReconstructedSource/`). Almost every command in `scripts\retk-pipeline.ps1`
and `scripts\retk-project.ps1` follows the same shape: `Read-Project` →
mutate the in-memory object → `Save-Project` (atomic temp-file+rename under a
named mutex). All workspace path construction funnels through
`Get-WorkspacePath` in `scripts\retk-project.ps1`, which calls
`Assert-WorkspaceName` — that is the single validation choke point for
`GameName`; do not build `workspaces\<name>` paths any other way.

### Templates are the source of truth, not embedded strings

`templates\Il2CppDumper\*.py` and `templates\Ghidra\*` are read from disk at
runtime (`Get-Il2CppDumperGhidraTemplate` in `scripts\retk-il2cpp.ps1`,
`Repair-Il2CppGhidraScript`) to patch/repair generated files like
`ghidra.py`/`ghidra_with_struct.py` inside a workspace or `tools\Il2CppDumper`.
If you need to change the Ghidra-side Python script behavior, edit the
template file, not a PowerShell string literal.

### Toolkit-local runtime isolation

JDK, Python, and the PyGhidra venv all install under `runtime\` scoped to this
folder and never touch the user's global `PATH`/`JAVA_HOME`/`py` launcher.
`Invoke-WithToolkitEnv` (`scripts\retk-core.ps1`) temporarily sets
`JAVA_HOME_OVERRIDE`/`GHIDRA_INSTALL_DIR`/`PYGHIDRA_PYTHON`/`Path` for the
duration of a scriptblock, then restores the previous values in a `finally`.

### GhidraMCP has two separate halves

`tools\ghidra-mcp\extension\GhidraMCP` (installed into Ghidra's user
Extensions folder) is the Java-side Ghidra plugin that runs an HTTP server
inside the GUI. The `bridge-mcp-ghidra` console script — installed by `pip`
from the `ghidra_mcp_bridge-*.whl` release asset into
`tools\ghidra-mcp\.venv` — is a different thing: the Python stdio bridge that
an AI client (Codex/OpenCode) launches via `re.ps1 mcp`; it forwards requests
to whichever GhidraMCP HTTP server is running. Confusing these two is a
common failure mode when debugging "MCP not
responding" issues.

### Detached process launching

`scripts\retk-process.ps1` has two launcher families:
`Start-DetachedNativeProcess` (hidden window, redirects stdout/stderr to log
files under `logs\`, with `Invoke-LogRetention` pruning old logs) and
`Start-DetachedGuiProcess` (visible window, used for e.g. `re.ps1
assetripper`). Both poll `Process.HasExited` for a short window after launch
so a process that crashes immediately is reported as a failure instead of a
false "started" success — `Start-Process` returning a non-null `Process`
object only means Windows accepted the launch request, not that the process
is still alive.
