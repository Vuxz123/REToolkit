# REToolkit GUI — Design Spec

Date: 2026-08-13
Status: Approved for planning

## Goal

Give REToolkit a Windows GUI, packaged as a standalone `.exe`, so a user can
drive the common workflow (create workspace, add a build, run the pipeline,
open Ghidra/PyGhidra, check status, export/import) without typing `re.ps1`
commands, while still exposing every other `re.ps1` command through a raw
command box for completeness.

The GUI is a thin front end. It must not duplicate or reimplement any
pipeline logic that already lives in `scripts\retk-*.ps1` — it only launches
`re.ps1` as a child process and displays its output.

## Non-goals

- No per-flag form for every `re.ps1` command (e.g. no dedicated UI for every
  `pull-ldplayer` flag) — the raw command box covers long-tail cases.
- No "install/update toolkit" button that runs `install-re-toolkit.ps1 -All`
  from inside the GUI.
- No running multiple workspace operations concurrently.
- No custom `.ico` branding.
- No `mcp` button — that command blocks waiting for stdio from an AI client
  and has no meaningful standalone GUI behavior. Still reachable via the raw
  command box.

## Architecture

### New files

- `scripts\retk-gui.ps1` — the WinForms GUI script (System.Windows.Forms /
  System.Drawing, loaded via `Add-Type -AssemblyName`). Pure PowerShell,
  consistent with the rest of the repo. Not dot-sourced by `re.ps1`; it is
  its own entry point, launched directly (as `.ps1` in dev, or as the
  compiled `.exe` in normal use).
- `scripts\build-gui.ps1` — build script. Installs the `ps2exe` PowerShell
  module from PSGallery into `-Scope CurrentUser` if `Invoke-ps2exe` is not
  already available, then compiles `scripts\retk-gui.ps1` into
  `REToolkit-GUI.exe` at the repo root using `-noConsole` (no background
  console window, since all output is captured into the GUI's own log pane).
- `tests\retk-gui.Tests.ps1` — static regression test in the same style as
  the other `*.Tests.ps1` files (see below).

### Modified files

- `.gitignore` — add `REToolkit-GUI.exe` so the build output is never
  committed. Every machine builds its own copy via `scripts\build-gui.ps1`.
- `README.md` / `Tutorial.md` — document the GUI: how to build it and what
  it does (brief section, following the existing doc style for
  `assetripper-cli`).

### Root resolution

`retk-gui.ps1` must work both as a dev-mode `.ps1` invocation
(`powershell.exe -File scripts\retk-gui.ps1`, where the script lives in
`scripts\`) and as the compiled `REToolkit-GUI.exe` sitting at the repo
root. Resolution rule:

1. Take the script/exe's own directory (`$PSScriptRoot`, or
   `Split-Path -Parent $MyInvocation.MyCommand.Path` as a fallback for the
   compiled exe if `$PSScriptRoot` is empty).
2. If `re.ps1` exists directly in that directory, that directory is `$Root`.
3. Otherwise, assume dev mode from `scripts\` and use the parent directory
   as `$Root`.
4. If `re.ps1` still isn't found at the resolved `$Root`, show an error
   `MessageBox` ("REToolkit-GUI.exe must sit next to re.ps1") and exit
   before building any UI.

### Argument construction

`retk-gui.ps1` dot-sources `scripts\retk-core.ps1` (it only defines
functions, no top-level side effects, so this is safe standalone) purely to
reuse `Join-NativeArgumentString` — the same manual argument-string builder
`retk-process.ps1` uses, because `ProcessStartInfo.ArgumentList` is not
reliable under Windows PowerShell 5.1 (documented reason already in this
codebase). All child-process argument lists for `re.ps1` go through this
helper for consistency with the rest of the toolkit.

## Process execution model

- Every action runs `re.ps1` as a child process:
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<Root>\re.ps1" <args...>`,
  working directory `$Root`.
- `ProcessStartInfo`: `UseShellExecute = $false`, `RedirectStandardOutput = $true`,
  `RedirectStandardError = $true`, `CreateNoWindow = $true`.
- stdout/stderr are read via the `OutputDataReceived`/`ErrorDataReceived`
  events (`BeginOutputReadLine`/`BeginErrorReadLine`), each line marshaled
  onto the UI thread with `Control.Invoke` and appended to the log `TextBox`
  (auto-scroll to bottom, read-only, monospace font).
- Only one child process may run at a time. While one is running, all
  action buttons are disabled except **Cancel**; **Cancel** calls
  `Process.Kill($true)` (kill the process tree — `flow`, `ghidra-gui`, and
  `pyghidra-gui` can spawn further children) and appends `[CANCELLED]` to
  the log.
- On normal exit, the GUI appends `[EXIT CODE n]` to the log and
  re-enables the buttons. A non-zero exit code appends the line in a
  distinguishable color (red) but does not pop a dialog — the log is the
  single source of truth, consistent with how `re.ps1` already reports
  failures via thrown exceptions printed to the console.

## UI layout

**Top bar:**
- Workspace `ComboBox`, populated by scanning `workspaces\*\project.re.json`
  and listing the parent folder name (GameName) for each hit.
- **Refresh** — re-scans `workspaces\`.
- **New workspace** — small input dialog (via
  `[Microsoft.VisualBasic.Interaction]::InputBox`) asking for `GameName`,
  then runs `init <GameName>` and refreshes the combo box, selecting the
  new entry.
- **Open folder** — `explorer.exe` on the selected workspace's directory
  (not routed through `re.ps1`; direct `Start-Process explorer.exe`).

**Left panel** (GroupBoxes, top to bottom):
- *Setup*: **Doctor** → `doctor`
- *Pipeline*: **Add build** (OpenFileDialog filtered to
  `*.apk;*.xapk;*.aab;*.zip`) → `add <GameName> <path>` · **Scan**
  (FolderBrowserDialog) → `scan <GameName> <path>` · **Dump** →
  `dump <GameName>` · **Flow** → small dialog with a text field plus two
  browse buttons, **File...** (OpenFileDialog, apk/xapk/aab/zip) and
  **Folder...** (FolderBrowserDialog, for an already-extracted path), since
  `flow <GameName> <apk-or-ExtractedPath>` accepts either a file or a
  directory → `flow <GameName> <path>`
- *Ghidra*: **Open** → `open <GameName>` · **Ghidra GUI** →
  `ghidra-gui <GameName>` · **Analyze** → `analyze <GameName>` ·
  **Symbols** → `symbols <GameName>`
- *Workspace*: **Status** → `status <GameName>` · **Notes** →
  `notes <GameName>` · **Candidates** → `candidates <GameName>` ·
  **Context** → `context <GameName>` · **Summary** →
  `summary <GameName>` · **Export** (SaveFileDialog, `.re`) →
  `export <GameName> <outfile>` · **Import** (OpenFileDialog) →
  `import <archive> [GameName]`
- *Extras*: **AssetRipper CLI** → `assetripper-cli <GameName>` ·
  **Pull LDPlayer** (InputBox for PackageName) →
  `pull-ldplayer <GameName> <packageName>`

Every button that needs `GameName` reads it from the top ComboBox; if
nothing is selected, the button is disabled (not merely erroring at click
time), so unusable actions are visibly inert rather than clickable-but-broken.

**Right panel:** log `TextBox` (multiline, read-only, monospace, docked to
fill, auto-scroll on append) + **Clear log** + **Cancel** (only enabled
while a command runs).

**Bottom bar:** raw command `TextBox` (placeholder text like
`e.g. pull-ldplayer MyGame com.foo.bar -SkipLaunch`) + **Run** button, which
splits the text on whitespace respecting quoted segments and runs
`re.ps1 <parsed args>`. This is the escape hatch for every command/flag
combination not covered by a dedicated button.

## Error handling

- Missing `re.ps1` next to the GUI at startup → `MessageBox` and exit (see
  Root resolution above).
- A workspace-scoped button clicked with no workspace selected → button is
  disabled, so this cannot happen via click; defensive check still throws
  and logs rather than silently no-op-ing, in case of a race during
  refresh.
- Child process fails to start (e.g. `powershell.exe` not resolvable) →
  caught, logged as `[FAIL] <message>`, buttons re-enabled.
- File/folder pickers cancelled by the user → action silently aborts, no
  process launched, no log entry.

## Build & packaging

`scripts\build-gui.ps1`:
1. Check `Get-Command Invoke-ps2exe -ErrorAction SilentlyContinue`; if
   missing, `Install-Module ps2exe -Scope CurrentUser -Force` (PSGallery is
   reachable — confirmed during design).
2. `Invoke-ps2exe -inputFile scripts\retk-gui.ps1 -outputFile REToolkit-GUI.exe -noConsole -title "REToolkit GUI"`.
3. Print the resulting exe path on success.

No changes to `install-re-toolkit.ps1` — building the GUI is an explicit,
separate, opt-in step (`scripts\build-gui.ps1`), not part of `-All`.

## Testing

Following the existing `tests\*.Tests.ps1` convention (hand-rolled
`Assert-*` helpers over `Get-Content -Raw`, not real Pester, not an
execution test — there is no WinForms test harness in this repo),
`tests\retk-gui.Tests.ps1` asserts:
- `scripts\retk-gui.ps1` and `scripts\build-gui.ps1` exist.
- `retk-gui.ps1` contains the `$Root` resolution logic (checks for `re.ps1`
  in its own directory, falls back to parent).
- `retk-gui.ps1` dot-sources `retk-core.ps1` and calls
  `Join-NativeArgumentString`.
- Key action verbs are present as literal `re.ps1` sub-command strings:
  `doctor`, `init`, `add`, `scan`, `dump`, `flow`, `open`, `ghidra-gui`,
  `analyze`, `symbols`, `status`, `notes`, `candidates`, `context`,
  `summary`, `export`, `import`, `assetripper-cli`, `pull-ldplayer`.
- Cancel path calls `Kill(` (process-tree kill), not a bare `Kill()`.
- `CreateNoWindow`, `RedirectStandardOutput`, and `RedirectStandardError`
  are all set on the child `ProcessStartInfo`.
- `build-gui.ps1` references `Invoke-ps2exe` and `-noConsole`.
- `.gitignore` contains `REToolkit-GUI.exe`.

## Documentation

Add a short section to `README.md` (near the `assetripper-cli` section,
following its style) and `Tutorial.md` covering: what the GUI is, how to
build it (`scripts\build-gui.ps1`), and that it is a thin launcher over
`re.ps1` with no independent logic.
