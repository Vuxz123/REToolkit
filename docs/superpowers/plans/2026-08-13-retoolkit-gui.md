# REToolkit GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows desktop GUI for REToolkit, packaged as a standalone `.exe`, that is a thin launcher over `re.ps1` — no pipeline logic is duplicated.

**Architecture:** `scripts\retk-gui.ps1` is a WinForms script with a small set of pure, independently-testable helper functions (root resolution, raw-command parsing, workspace discovery, async process runner) plus a `Start-RetkGui` function that builds the window and wires buttons to those helpers. `scripts\build-gui.ps1` compiles it into `REToolkit-GUI.exe` at the repo root via the `ps2exe` module. Every button spawns `re.ps1 <command>` as a child process and streams its stdout/stderr into a log pane in real time; only one command runs at a time.

**Tech Stack:** Windows PowerShell 5.1, `System.Windows.Forms` / `System.Drawing` (via `Add-Type -AssemblyName`), `Microsoft.VisualBasic.Interaction` for simple input prompts, `ps2exe` PowerShell module (from PSGallery) for `.exe` packaging.

## Global Constraints

- Target platform is Windows PowerShell 5.1 — do not use PS7-only syntax. `ProcessStartInfo.ArgumentList` is not reliable on PS 5.1 in this codebase; always build the argument string with `Join-NativeArgumentString` from `scripts\retk-core.ps1` instead (documented reason: `re.ps1`/`retk-process.ps1`).
- The GUI must never reimplement pipeline logic — every action is `re.ps1 <command...>` run as a child process, nothing else.
- `REToolkit-GUI.exe` is a build artifact: never commit it, always add it to `.gitignore`.
- Test files in this repo (`tests\*.Tests.ps1`) are hand-rolled scripts using local `Assert-True`/`Assert-Equals`/`Assert-Contains`/`Assert-NotContains` helpers, run individually via `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\<file>.Tests.ps1` — not real Pester. Follow that convention exactly; do not introduce a Pester dependency.
- Follow the spec at `docs/superpowers/specs/2026-08-13-retoolkit-gui-design.md` for scope; do not add features listed under its "Non-goals" section (no per-flag forms, no in-GUI installer, no concurrent workspace ops, no custom icon, no `mcp` button).

---

## Task 1: Root resolution helper + test scaffold

**Files:**
- Create: `scripts\retk-gui.ps1`
- Create: `tests\retk-gui.Tests.ps1`

**Interfaces:**
- Produces: `Resolve-RetkGuiRoot -OwnDirectory <string>` → returns the resolved REToolkit repo root path (string), or throws if `re.ps1` cannot be found next to `$OwnDirectory` or its parent.
- Produces: a guarded entry point at the bottom of `retk-gui.ps1` (`if ($MyInvocation.InvocationName -ne '.') { Start-RetkGui }`) so the file can be dot-sourced by tests without launching any UI. `Start-RetkGui` itself is defined as an empty stub in this task (`function Start-RetkGui { }`) and filled in by Task 4.

- [ ] **Step 1: Write the failing test**

Create `tests\retk-gui.Tests.ps1`:

```powershell
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $RepoRoot "scripts\retk-gui.ps1")

function Assert-True {
    param(
        [Parameter(Mandatory)] [bool]$Condition,
        [Parameter(Mandatory)] [string]$Message
    )
    if (-not $Condition) { throw "ASSERT TRUE failed: $Message" }
}

function Assert-Equals {
    param(
        [AllowNull()] $Actual,
        [AllowNull()] $Expected,
        [Parameter(Mandatory)] [string]$Message
    )
    if ($Actual -ne $Expected) {
        throw "ASSERT EQUALS failed: $Message`nExpected: $Expected`nActual  : $Actual"
    }
}

function Assert-Contains {
    param(
        [Parameter(Mandatory)] [string]$Text,
        [Parameter(Mandatory)] [string]$Needle,
        [Parameter(Mandatory)] [string]$Message
    )
    if (-not $Text.Contains($Needle)) {
        throw "ASSERT CONTAINS failed: $Message`nMissing: $Needle"
    }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory)] [scriptblock]$Action,
        [Parameter(Mandatory)] [string]$Message
    )
    $threw = $false
    try { & $Action } catch { $threw = $true }
    if (-not $threw) { throw "ASSERT THROWS failed: $Message" }
}

$tempRoot = Join-Path $env:TEMP ("retk-gui-test-" + [guid]::NewGuid().ToString("N"))
try {
    # Own directory has re.ps1 directly (compiled exe sitting at repo root).
    $ownWithRe = Join-Path $tempRoot "own-with-re"
    New-Item -ItemType Directory -Force -Path $ownWithRe | Out-Null
    Set-Content -LiteralPath (Join-Path $ownWithRe "re.ps1") -Value "# stub" -Encoding ASCII
    Assert-Equals (Resolve-RetkGuiRoot -OwnDirectory $ownWithRe) $ownWithRe "Own directory containing re.ps1 should resolve to itself."

    # Own directory lacks re.ps1 but its parent has it (dev mode, script in scripts\).
    $devRoot = Join-Path $tempRoot "dev-root"
    $devScripts = Join-Path $devRoot "scripts"
    New-Item -ItemType Directory -Force -Path $devScripts | Out-Null
    Set-Content -LiteralPath (Join-Path $devRoot "re.ps1") -Value "# stub" -Encoding ASCII
    Assert-Equals (Resolve-RetkGuiRoot -OwnDirectory $devScripts) $devRoot "Own directory without re.ps1 should fall back to the parent directory."

    # Neither own directory nor parent has re.ps1.
    $orphan = Join-Path $tempRoot "orphan\deeper"
    New-Item -ItemType Directory -Force -Path $orphan | Out-Null
    Assert-Throws { Resolve-RetkGuiRoot -OwnDirectory $orphan } "Should throw when re.ps1 is not found next to own directory or its parent."
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "retk-gui checks passed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1`
Expected: FAIL — `scripts\retk-gui.ps1` does not exist yet (dot-source error).

- [ ] **Step 3: Write the minimal implementation**

Create `scripts\retk-gui.ps1`:

```powershell
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic

function Resolve-RetkGuiRoot {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string]$OwnDirectory)

    $ownRePs1 = Join-Path $OwnDirectory "re.ps1"
    if (Test-Path -LiteralPath $ownRePs1) {
        return $OwnDirectory
    }

    $parentDirectory = Split-Path -Parent $OwnDirectory
    if ($parentDirectory) {
        $parentRePs1 = Join-Path $parentDirectory "re.ps1"
        if (Test-Path -LiteralPath $parentRePs1) {
            return $parentDirectory
        }
    }

    throw "Could not find re.ps1 next to '$OwnDirectory' or its parent. REToolkit-GUI.exe must sit in the REToolkit repo root, or retk-gui.ps1 must run from the repo's scripts\ folder."
}

function Start-RetkGui {
    # Filled in by Task 4.
}

if ($MyInvocation.InvocationName -ne '.') {
    Start-RetkGui
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1`
Expected: PASS, prints `retk-gui checks passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/retk-gui.ps1 tests/retk-gui.Tests.ps1
git commit -m "Add REToolkit GUI root-resolution helper and test scaffold"
```

---

## Task 2: Raw-command parsing + workspace discovery helpers

**Files:**
- Modify: `scripts\retk-gui.ps1`
- Modify: `tests\retk-gui.Tests.ps1`

**Interfaces:**
- Consumes: none beyond Task 1 (file structure only).
- Produces: `Split-RetkGuiCommandLine -Text <string>` → `string[]` (empty array for blank/whitespace input; splits on whitespace, treats `"..."` segments as single tokens).
- Produces: `Get-RetkGuiWorkspaceNames -WorkspacesDir <string>` → `string[]`, sorted, containing only the names of immediate subdirectories of `$WorkspacesDir` that contain a `project.re.json` file. Returns `@()` if `$WorkspacesDir` does not exist.

- [ ] **Step 1: Write the failing test**

Insert the following into `tests\retk-gui.Tests.ps1`, directly above the final `Write-Host "retk-gui checks passed"` line:

```powershell
$tempRoot2 = Join-Path $env:TEMP ("retk-gui-test2-" + [guid]::NewGuid().ToString("N"))
try {
    # Split-RetkGuiCommandLine
    Assert-Equals (Split-RetkGuiCommandLine -Text "").Count 0 "Empty text should split to zero arguments."
    Assert-Equals (Split-RetkGuiCommandLine -Text "   ").Count 0 "Whitespace-only text should split to zero arguments."

    $simple = Split-RetkGuiCommandLine -Text "status FoodHunt"
    Assert-Equals $simple.Count 2 "status FoodHunt should split into 2 tokens."
    Assert-Equals $simple[0] "status" "First token should be status."
    Assert-Equals $simple[1] "FoodHunt" "Second token should be FoodHunt."

    $quoted = Split-RetkGuiCommandLine -Text 'add MyGame "C:\path with spaces\build.apk"'
    Assert-Equals $quoted.Count 3 "Quoted path should count as a single token."
    Assert-Equals $quoted[2] 'C:\path with spaces\build.apk' "Quoted token should have quotes stripped."

    # Get-RetkGuiWorkspaceNames
    $workspacesDir = Join-Path $tempRoot2 "workspaces"
    New-Item -ItemType Directory -Force -Path (Join-Path $workspacesDir "GameA") | Out-Null
    Set-Content -LiteralPath (Join-Path $workspacesDir "GameA\project.re.json") -Value "{}" -Encoding ASCII
    New-Item -ItemType Directory -Force -Path (Join-Path $workspacesDir "GameB") | Out-Null
    Set-Content -LiteralPath (Join-Path $workspacesDir "GameB\project.re.json") -Value "{}" -Encoding ASCII
    New-Item -ItemType Directory -Force -Path (Join-Path $workspacesDir "NotAWorkspace") | Out-Null

    $names = Get-RetkGuiWorkspaceNames -WorkspacesDir $workspacesDir
    Assert-Equals $names.Count 2 "Only folders with project.re.json should be listed."
    Assert-Equals $names[0] "GameA" "Names should be sorted alphabetically."
    Assert-Equals $names[1] "GameB" "Names should be sorted alphabetically."

    $missing = Get-RetkGuiWorkspaceNames -WorkspacesDir (Join-Path $tempRoot2 "does-not-exist")
    Assert-Equals $missing.Count 0 "A missing workspaces directory should return zero names."
}
finally {
    if (Test-Path -LiteralPath $tempRoot2) {
        Remove-Item -LiteralPath $tempRoot2 -Recurse -Force -ErrorAction SilentlyContinue
    }
}

```

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1`
Expected: FAIL — `Split-RetkGuiCommandLine` / `Get-RetkGuiWorkspaceNames` not recognized.

- [ ] **Step 3: Write the minimal implementation**

In `scripts\retk-gui.ps1`, add these two functions above `function Start-RetkGui`:

```powershell
function Split-RetkGuiCommandLine {
    [CmdletBinding()]
    param([Parameter()] [string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) { return @() }

    $tokenMatches = [System.Text.RegularExpressions.Regex]::Matches($Text, '"([^"]*)"|(\S+)')
    $tokens = New-Object System.Collections.Generic.List[string]
    foreach ($tokenMatch in $tokenMatches) {
        if ($tokenMatch.Groups[1].Success) {
            [void]$tokens.Add($tokenMatch.Groups[1].Value)
        }
        else {
            [void]$tokens.Add($tokenMatch.Groups[2].Value)
        }
    }
    return @($tokens)
}

function Get-RetkGuiWorkspaceNames {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string]$WorkspacesDir)

    if (-not (Test-Path -LiteralPath $WorkspacesDir -PathType Container)) { return @() }

    $names = Get-ChildItem -LiteralPath $WorkspacesDir -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "project.re.json") } |
        Sort-Object Name |
        ForEach-Object { $_.Name }

    return @($names)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1`
Expected: PASS, prints `retk-gui checks passed`.

- [ ] **Step 5: Commit**

```bash
git add scripts/retk-gui.ps1 tests/retk-gui.Tests.ps1
git commit -m "Add raw-command parsing and workspace discovery to REToolkit GUI"
```

---

## Task 3: Async process runner (`Invoke-RetkGuiCommand`)

**Files:**
- Modify: `scripts\retk-gui.ps1`
- Modify: `tests\retk-gui.Tests.ps1`

**Interfaces:**
- Consumes: `Join-NativeArgumentString -Arguments <string[]>` from `scripts\retk-core.ps1` (must be dot-sourced before this function is used — done here directly in `retk-gui.ps1`, and again inside `Start-RetkGui` in Task 4 since that is the only place `$Root` is known at GUI-startup time).
- Produces: `Invoke-RetkGuiCommand -Root <string> -Arguments <string[]> -OnOutput <scriptblock> -OnExit <scriptblock>` → returns the started `System.Diagnostics.Process` object (already `Start()`-ed, with `BeginOutputReadLine`/`BeginErrorReadLine` called). `OnOutput` is invoked with one `[string]` line for every stdout/stderr line received (interleaved). `OnExit` is invoked once, with the process's `[int]` exit code, after the process exits.
- **Caller contract:** `OnOutput`/`OnExit` scriptblocks that reference variables from an enclosing scope (e.g. a `$logBox` control) MUST be created with `.GetNewClosure()` before being passed in — they run inside the `Register-ObjectEvent` subscriber scope, not the caller's scope, so without `GetNewClosure()` those outer variables will not be visible. Task 4 relies on this.

- [ ] **Step 1: Write the failing test**

Insert the following into `tests\retk-gui.Tests.ps1`, directly above the final `Write-Host "retk-gui checks passed"` line:

```powershell
. (Join-Path $RepoRoot "scripts\retk-core.ps1")

$collectedLines = [System.Collections.Generic.List[string]]::Synchronized((New-Object System.Collections.Generic.List[string]))
$exitCodeBox = [hashtable]::Synchronized(@{ Code = $null })

$onOutput = {
    param($line)
    $collectedLines.Add($line)
}.GetNewClosure()

$onExit = {
    param($code)
    $exitCodeBox.Code = $code
}.GetNewClosure()

$proc = Invoke-RetkGuiCommand -Root $RepoRoot -Arguments @() -OnOutput $onOutput -OnExit $onExit

$waited = 0
while ($null -eq $exitCodeBox.Code -and $waited -lt 15000) {
    Start-Sleep -Milliseconds 100
    $waited += 100
}

Get-EventSubscriber | Where-Object { $_.SourceObject -eq $proc } | Unregister-Event

Assert-True ($null -ne $exitCodeBox.Code) "Invoke-RetkGuiCommand should report an exit code within 15 seconds."
Assert-Equals $exitCodeBox.Code 0 "re.ps1 with no command should exit 0 (prints usage)."
Assert-True ($collectedLines.Count -gt 0) "Invoke-RetkGuiCommand should stream at least one output line."
Assert-True (($collectedLines -join "`n").Contains("RE Toolkit")) "Output should include the re.ps1 usage banner."

```

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1`
Expected: FAIL — `Invoke-RetkGuiCommand` not recognized.

- [ ] **Step 3: Write the minimal implementation**

In `scripts\retk-gui.ps1`, add near the top (after the `Resolve-RetkGuiRoot` function definition) a guarded root resolution plus a dot-source of `retk-core.ps1`, and add `Invoke-RetkGuiCommand` above `function Start-RetkGui`:

```powershell
$RetkGuiScriptDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
try {
    $RetkGuiRepoRoot = Resolve-RetkGuiRoot -OwnDirectory $RetkGuiScriptDirectory
    . (Join-Path $RetkGuiRepoRoot "scripts\retk-core.ps1")
}
catch {
    if ($MyInvocation.InvocationName -ne '.') {
        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            "REToolkit GUI",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
        exit 1
    }
    throw
}
```

Place this block immediately **after** the `Resolve-RetkGuiRoot` function definition (it depends on it) and **before** `Invoke-RetkGuiCommand`'s definition. `Add-Type -AssemblyName System.Windows.Forms` was already loaded in Task 1, so `MessageBox` is available here. The `$MyInvocation.InvocationName -ne '.'` check re-throws instead of popping a dialog when the file is dot-sourced (by tests), matching the guarded-entry-point pattern from Task 1 — tests run against the real repo root so this `try` always succeeds for them regardless, but the re-throw keeps failures visible (not swallowed) if that ever changes. This makes `$RetkGuiRepoRoot` available at dot-source time for reuse by `Start-RetkGui` in Task 4, avoiding resolving root twice.

```powershell
function Invoke-RetkGuiCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$Root,
        [Parameter(Mandatory)] [string[]]$Arguments,
        [Parameter(Mandatory)] [scriptblock]$OnOutput,
        [Parameter(Mandatory)] [scriptblock]$OnExit
    )

    $rePs1 = Join-Path $Root "re.ps1"
    $fullArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $rePs1) + @($Arguments)

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "powershell.exe"
    $psi.Arguments = Join-NativeArgumentString $fullArgs
    $psi.WorkingDirectory = $Root
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    $proc.EnableRaisingEvents = $true

    Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -MessageData $OnOutput -Action {
        if ($null -ne $EventArgs.Data) { & $Event.MessageData $EventArgs.Data }
    } | Out-Null

    Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -MessageData $OnOutput -Action {
        if ($null -ne $EventArgs.Data) { & $Event.MessageData $EventArgs.Data }
    } | Out-Null

    Register-ObjectEvent -InputObject $proc -EventName Exited -MessageData $OnExit -Action {
        & $Event.MessageData $Event.Sender.ExitCode
    } | Out-Null

    [void]$proc.Start()
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()

    return $proc
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1`
Expected: PASS, prints `retk-gui checks passed`. (This spawns a real `powershell.exe -File re.ps1` child process — allow a few seconds.)

- [ ] **Step 5: Commit**

```bash
git add scripts/retk-gui.ps1 tests/retk-gui.Tests.ps1
git commit -m "Add async re.ps1 process runner to REToolkit GUI"
```

---

## Task 4: WinForms UI

**Files:**
- Modify: `scripts\retk-gui.ps1`
- Modify: `tests\retk-gui.Tests.ps1`

**Interfaces:**
- Consumes: `Resolve-RetkGuiRoot`, `Split-RetkGuiCommandLine`, `Get-RetkGuiWorkspaceNames`, `Invoke-RetkGuiCommand`, `Join-NativeArgumentString`, `$RetkGuiRepoRoot` (all from Tasks 1-3).
- Produces: a fully working `Start-RetkGui` function (replaces the Task 1 stub). No other file depends on its internals — this is the terminal task for `retk-gui.ps1`'s logic.

This task is not meaningfully unit-testable (it builds and shows a real window). Verification is: (a) static string assertions on the source, matching this repo's existing convention for GUI-adjacent/manual-flow code, and (b) a manual smoke test.

- [ ] **Step 1: Write the failing (static) test**

Insert the following into `tests\retk-gui.Tests.ps1`, directly above the final `Write-Host "retk-gui checks passed"` line:

```powershell
$guiSource = Get-Content -LiteralPath (Join-Path $RepoRoot "scripts\retk-gui.ps1") -Raw

foreach ($verb in @(
    "doctor", "init", "add", "scan", "dump", "flow", "open", "ghidra-gui",
    "analyze", "symbols", "status", "notes", "candidates", "context",
    "summary", "export", "import", "assetripper-cli", "pull-ldplayer"
)) {
    Assert-Contains $guiSource "'$verb'" "GUI should wire a button/handler for the '$verb' re.ps1 command."
}

Assert-Contains $guiSource "OpenFileDialog" "GUI should use a file picker for Add build / Import / Flow."
Assert-Contains $guiSource "FolderBrowserDialog" "GUI should use a folder picker for Scan / Flow."
Assert-Contains $guiSource "SaveFileDialog" "GUI should use a save dialog for Export."
Assert-Contains $guiSource "InputBox" "GUI should prompt for GameName/PackageName via InputBox."
Assert-Contains $guiSource ".Kill(" "Cancel should kill the process tree, not just the top-level process."
Assert-Contains $guiSource "IsRunning" "GUI should track a single-command-at-a-time running state."
Assert-Contains $guiSource "GetNewClosure" "Event-bound scriptblocks must capture outer scope with GetNewClosure per Invoke-RetkGuiCommand's contract."
Assert-Contains $guiSource "Application]::Run" "GUI must start a WinForms message loop."
Assert-Contains $guiSource "MessageBox" "GUI should show a MessageBox if re.ps1 cannot be located, since -noConsole hides console errors otherwise."

```

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1`
Expected: FAIL — the current `Start-RetkGui` stub contains none of these markers.

- [ ] **Step 3: Write the implementation**

Replace the empty `Start-RetkGui` stub (the three `Add-Type` assembly loads and the `MessageBox` error handling around root resolution were already added in Tasks 1 and 3) with:

```powershell
function Show-RetkGuiPathPromptDialog {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string]$Title)

    $dialog = New-Object System.Windows.Forms.Form
    $dialog.Text = $Title
    $dialog.Width = 520
    $dialog.Height = 140
    $dialog.StartPosition = "CenterParent"
    $dialog.FormBorderStyle = "FixedDialog"
    $dialog.MaximizeBox = $false
    $dialog.MinimizeBox = $false

    $textBox = New-Object System.Windows.Forms.TextBox
    $textBox.Left = 10; $textBox.Top = 15; $textBox.Width = 480

    $fileButton = New-Object System.Windows.Forms.Button
    $fileButton.Text = "File..."
    $fileButton.Left = 10; $fileButton.Top = 45
    $fileButton.Add_Click({
        $fd = New-Object System.Windows.Forms.OpenFileDialog
        $fd.Filter = "Android build (*.apk;*.xapk;*.aab;*.zip)|*.apk;*.xapk;*.aab;*.zip|All files (*.*)|*.*"
        if ($fd.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $textBox.Text = $fd.FileName }
    }.GetNewClosure())

    $folderButton = New-Object System.Windows.Forms.Button
    $folderButton.Text = "Folder..."
    $folderButton.Left = 100; $folderButton.Top = 45
    $folderButton.Add_Click({
        $fbd = New-Object System.Windows.Forms.FolderBrowserDialog
        if ($fbd.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $textBox.Text = $fbd.SelectedPath }
    }.GetNewClosure())

    $okButton = New-Object System.Windows.Forms.Button
    $okButton.Text = "OK"
    $okButton.Left = 330; $okButton.Top = 70
    $okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK

    $dialogCancelButton = New-Object System.Windows.Forms.Button
    $dialogCancelButton.Text = "Cancel"
    $dialogCancelButton.Left = 415; $dialogCancelButton.Top = 70
    $dialogCancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

    $dialog.Controls.AddRange(@($textBox, $fileButton, $folderButton, $okButton, $dialogCancelButton))
    $dialog.AcceptButton = $okButton
    $dialog.CancelButton = $dialogCancelButton

    $result = $dialog.ShowDialog()
    if ($result -eq [System.Windows.Forms.DialogResult]::OK -and -not [string]::IsNullOrWhiteSpace($textBox.Text)) {
        return $textBox.Text
    }
    return $null
}

function Start-RetkGui {
    $root = $RetkGuiRepoRoot
    $workspacesDir = Join-Path $root "workspaces"

    $script:IsRunning = $false
    $script:CurrentProcess = $null
    $script:AllActionButtons = New-Object System.Collections.Generic.List[System.Windows.Forms.Button]
    $script:WorkspaceButtons = New-Object System.Collections.Generic.List[System.Windows.Forms.Button]

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "REToolkit GUI"
    $form.Width = 1100
    $form.Height = 720
    $form.StartPosition = "CenterScreen"

    # --- Top bar: workspace selector ---
    $topPanel = New-Object System.Windows.Forms.Panel
    $topPanel.Dock = "Top"
    $topPanel.Height = 40

    $workspaceCombo = New-Object System.Windows.Forms.ComboBox
    $workspaceCombo.Left = 10; $workspaceCombo.Top = 8; $workspaceCombo.Width = 300
    $workspaceCombo.DropDownStyle = "DropDownList"

    $refreshButton = New-Object System.Windows.Forms.Button
    $refreshButton.Text = "Refresh"
    $refreshButton.Left = 320; $refreshButton.Top = 6

    $initButton = New-Object System.Windows.Forms.Button
    $initButton.Text = "New workspace"
    $initButton.Left = 405; $initButton.Top = 6
    $initButton.AutoSize = $true

    $openFolderButton = New-Object System.Windows.Forms.Button
    $openFolderButton.Text = "Open folder"
    $openFolderButton.Left = 530; $openFolderButton.Top = 6
    $openFolderButton.AutoSize = $true

    $topPanel.Controls.AddRange(@($workspaceCombo, $refreshButton, $initButton, $openFolderButton))

    # --- Bottom bar: raw command ---
    $bottomPanel = New-Object System.Windows.Forms.Panel
    $bottomPanel.Dock = "Bottom"
    $bottomPanel.Height = 36

    $rawCommandBox = New-Object System.Windows.Forms.TextBox
    $rawCommandBox.Left = 10; $rawCommandBox.Top = 6; $rawCommandBox.Width = 900
    $rawCommandBox.Text = ""

    $runRawButton = New-Object System.Windows.Forms.Button
    $runRawButton.Text = "Run"
    $runRawButton.Left = 920; $runRawButton.Top = 4

    $bottomPanel.Controls.AddRange(@($rawCommandBox, $runRawButton))

    # --- Right panel: log + controls ---
    $rightPanel = New-Object System.Windows.Forms.Panel
    $rightPanel.Dock = "Right"
    $rightPanel.Width = 560

    $logBox = New-Object System.Windows.Forms.TextBox
    $logBox.Multiline = $true
    $logBox.ReadOnly = $true
    $logBox.ScrollBars = "Vertical"
    $logBox.Font = New-Object System.Drawing.Font("Consolas", 9)
    $logBox.Dock = "Fill"

    $logButtonsPanel = New-Object System.Windows.Forms.Panel
    $logButtonsPanel.Dock = "Bottom"
    $logButtonsPanel.Height = 32

    $clearLogButton = New-Object System.Windows.Forms.Button
    $clearLogButton.Text = "Clear log"
    $clearLogButton.Left = 10; $clearLogButton.Top = 4

    $cancelButton = New-Object System.Windows.Forms.Button
    $cancelButton.Text = "Cancel"
    $cancelButton.Left = 110; $cancelButton.Top = 4
    $cancelButton.Enabled = $false

    $logButtonsPanel.Controls.AddRange(@($clearLogButton, $cancelButton))
    $rightPanel.Controls.Add($logBox)
    $rightPanel.Controls.Add($logButtonsPanel)

    # --- Left panel: action groups ---
    $leftPanel = New-Object System.Windows.Forms.FlowLayoutPanel
    $leftPanel.Dock = "Fill"
    $leftPanel.FlowDirection = "TopDown"
    $leftPanel.WrapContents = $false
    $leftPanel.AutoScroll = $true

    function New-RetkGuiGroup {
        param([Parameter(Mandatory)] [string]$Title)
        $group = New-Object System.Windows.Forms.GroupBox
        $group.Text = $Title
        $group.Width = 500
        $group.Height = 80
        $group.AutoSize = $true
        $group.AutoSizeMode = "GrowAndShrink"
        return $group
    }

    function Add-RetkGuiButtonToGroup {
        param(
            [Parameter(Mandatory)] $Group,
            [Parameter(Mandatory)] [string]$Text,
            [Parameter(Mandatory)] [scriptblock]$OnClick,
            [switch]$RequiresWorkspace
        )
        $flow = $Group.Controls | Where-Object { $_ -is [System.Windows.Forms.FlowLayoutPanel] } | Select-Object -First 1
        if ($null -eq $flow) {
            $flow = New-Object System.Windows.Forms.FlowLayoutPanel
            $flow.Dock = "Top"
            $flow.AutoSize = $true
            $flow.WrapContents = $true
            $flow.Width = 480
            $Group.Controls.Add($flow)
        }
        $button = New-Object System.Windows.Forms.Button
        $button.Text = $Text
        $button.AutoSize = $true
        $button.Add_Click($OnClick)
        $flow.Controls.Add($button)
        [void]$script:AllActionButtons.Add($button)
        if ($RequiresWorkspace) { [void]$script:WorkspaceButtons.Add($button) }
        return $button
    }

    function Get-SelectedGameName {
        if ($null -eq $workspaceCombo.SelectedItem) { return $null }
        return [string]$workspaceCombo.SelectedItem
    }

    function Refresh-Workspaces {
        $selected = Get-SelectedGameName
        $names = Get-RetkGuiWorkspaceNames -WorkspacesDir $workspacesDir
        $workspaceCombo.Items.Clear()
        foreach ($name in $names) { [void]$workspaceCombo.Items.Add($name) }
        if ($selected -and ($names -contains $selected)) {
            $workspaceCombo.SelectedItem = $selected
        }
        elseif ($names.Count -gt 0) {
            $workspaceCombo.SelectedIndex = 0
        }
        Update-WorkspaceButtonsEnabled
    }

    function Update-WorkspaceButtonsEnabled {
        $hasSelection = $null -ne (Get-SelectedGameName)
        foreach ($b in $script:WorkspaceButtons) {
            $b.Enabled = $hasSelection -and (-not $script:IsRunning)
        }
    }

    function Set-RunningState {
        param([bool]$Running)
        foreach ($b in $script:AllActionButtons) { $b.Enabled = -not $Running }
        $runRawButton.Enabled = -not $Running
        $cancelButton.Enabled = $Running
        Update-WorkspaceButtonsEnabled
    }

    function Invoke-GuiCommand {
        param([Parameter(Mandatory)] [string[]]$Arguments)

        if ($script:IsRunning) { return }
        $script:IsRunning = $true
        Set-RunningState $true

        $logBox.AppendText("`r`n> re.ps1 $($Arguments -join ' ')`r`n")

        $onOutput = {
            param($line)
            $logBox.Invoke([Action]{ $logBox.AppendText("$line`r`n") }) | Out-Null
        }.GetNewClosure()

        $onExit = {
            param($code)
            $form.Invoke([Action]{
                $logBox.AppendText("[EXIT CODE $code]`r`n")
                $script:IsRunning = $false
                $script:CurrentProcess = $null
                Set-RunningState $false
                Refresh-Workspaces
            }) | Out-Null
        }.GetNewClosure()

        $script:CurrentProcess = Invoke-RetkGuiCommand -Root $root -Arguments $Arguments -OnOutput $onOutput -OnExit $onExit
    }

    # --- Setup group ---
    $setupGroup = New-RetkGuiGroup -Title "Setup"
    Add-RetkGuiButtonToGroup -Group $setupGroup -Text "Doctor" -OnClick { Invoke-GuiCommand -Arguments @('doctor') } | Out-Null

    # --- Pipeline group ---
    $pipelineGroup = New-RetkGuiGroup -Title "Pipeline"
    Add-RetkGuiButtonToGroup -Group $pipelineGroup -Text "Add build" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $dlg = New-Object System.Windows.Forms.OpenFileDialog
        $dlg.Filter = "Android build (*.apk;*.xapk;*.aab;*.zip)|*.apk;*.xapk;*.aab;*.zip|All files (*.*)|*.*"
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Invoke-GuiCommand -Arguments @('add', $gameName, $dlg.FileName)
        }
    }.GetNewClosure() | Out-Null
    Add-RetkGuiButtonToGroup -Group $pipelineGroup -Text "Scan" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = "Select the extracted build folder"
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Invoke-GuiCommand -Arguments @('scan', $gameName, $dlg.SelectedPath)
        }
    }.GetNewClosure() | Out-Null
    Add-RetkGuiButtonToGroup -Group $pipelineGroup -Text "Dump" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        Invoke-GuiCommand -Arguments @('dump', $gameName)
    }.GetNewClosure() | Out-Null
    Add-RetkGuiButtonToGroup -Group $pipelineGroup -Text "Flow" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $path = Show-RetkGuiPathPromptDialog -Title "Flow source (APK/XAPK/AAB or extracted folder)"
        if ($null -eq $path) { return }
        Invoke-GuiCommand -Arguments @('flow', $gameName, $path)
    }.GetNewClosure() | Out-Null

    # --- Ghidra group ---
    $ghidraGroup = New-RetkGuiGroup -Title "Ghidra"
    foreach ($spec in @(
        @{ Label = "Open (PyGhidra)"; Verb = 'open' },
        @{ Label = "Ghidra GUI"; Verb = 'ghidra-gui' },
        @{ Label = "Analyze"; Verb = 'analyze' },
        @{ Label = "Symbols"; Verb = 'symbols' }
    )) {
        $verb = $spec.Verb
        Add-RetkGuiButtonToGroup -Group $ghidraGroup -Text $spec.Label -RequiresWorkspace -OnClick {
            $gameName = Get-SelectedGameName
            if ($null -eq $gameName) { return }
            Invoke-GuiCommand -Arguments @($verb, $gameName)
        }.GetNewClosure() | Out-Null
    }

    # --- Workspace group ---
    $workspaceGroup = New-RetkGuiGroup -Title "Workspace"
    foreach ($spec in @(
        @{ Label = "Status"; Verb = 'status' },
        @{ Label = "Notes"; Verb = 'notes' },
        @{ Label = "Candidates"; Verb = 'candidates' },
        @{ Label = "Context"; Verb = 'context' },
        @{ Label = "Summary"; Verb = 'summary' }
    )) {
        $verb = $spec.Verb
        Add-RetkGuiButtonToGroup -Group $workspaceGroup -Text $spec.Label -RequiresWorkspace -OnClick {
            $gameName = Get-SelectedGameName
            if ($null -eq $gameName) { return }
            Invoke-GuiCommand -Arguments @($verb, $gameName)
        }.GetNewClosure() | Out-Null
    }
    Add-RetkGuiButtonToGroup -Group $workspaceGroup -Text "Export" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $dlg = New-Object System.Windows.Forms.SaveFileDialog
        $dlg.Filter = "REToolkit archive (*.re)|*.re"
        $dlg.FileName = "$gameName.re"
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Invoke-GuiCommand -Arguments @('export', $gameName, $dlg.FileName)
        }
    }.GetNewClosure() | Out-Null
    Add-RetkGuiButtonToGroup -Group $workspaceGroup -Text "Import" -OnClick {
        $dlg = New-Object System.Windows.Forms.OpenFileDialog
        $dlg.Filter = "REToolkit archive (*.re;*.zip)|*.re;*.zip|All files (*.*)|*.*"
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Invoke-GuiCommand -Arguments @('import', $dlg.FileName)
        }
    }.GetNewClosure() | Out-Null

    # --- Extras group ---
    $extrasGroup = New-RetkGuiGroup -Title "Extras"
    Add-RetkGuiButtonToGroup -Group $extrasGroup -Text "AssetRipper CLI" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        Invoke-GuiCommand -Arguments @('assetripper-cli', $gameName)
    }.GetNewClosure() | Out-Null
    Add-RetkGuiButtonToGroup -Group $extrasGroup -Text "Pull LDPlayer" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $packageName = [Microsoft.VisualBasic.Interaction]::InputBox("Android package name:", "Pull from LDPlayer", "")
        if ([string]::IsNullOrWhiteSpace($packageName)) { return }
        Invoke-GuiCommand -Arguments @('pull-ldplayer', $gameName, $packageName)
    }.GetNewClosure() | Out-Null

    $leftPanel.Controls.AddRange(@($setupGroup, $pipelineGroup, $ghidraGroup, $workspaceGroup, $extrasGroup))

    # --- Top bar handlers ---
    $refreshButton.Add_Click({ Refresh-Workspaces }.GetNewClosure())
    $workspaceCombo.Add_SelectedIndexChanged({ Update-WorkspaceButtonsEnabled }.GetNewClosure())
    $initButton.Add_Click({
        $name = [Microsoft.VisualBasic.Interaction]::InputBox("Workspace name (GameName):", "New workspace", "")
        if ([string]::IsNullOrWhiteSpace($name)) { return }
        Invoke-GuiCommand -Arguments @('init', $name)
    }.GetNewClosure())
    $openFolderButton.Add_Click({
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $path = Join-Path $workspacesDir $gameName
        Start-Process -FilePath "explorer.exe" -ArgumentList (Join-NativeArgumentString @($path))
    }.GetNewClosure())

    # --- Log panel handlers ---
    $clearLogButton.Add_Click({ $logBox.Clear() }.GetNewClosure())
    $cancelButton.Add_Click({
        if ($null -ne $script:CurrentProcess -and -not $script:CurrentProcess.HasExited) {
            $script:CurrentProcess.Kill($true)
            $logBox.AppendText("[CANCELLED]`r`n")
        }
    }.GetNewClosure())

    # --- Raw command handler ---
    $runRawButton.Add_Click({
        $parsedArgs = Split-RetkGuiCommandLine -Text $rawCommandBox.Text
        if ($parsedArgs.Count -eq 0) { return }
        Invoke-GuiCommand -Arguments $parsedArgs
    }.GetNewClosure())

    $form.Controls.Add($leftPanel)
    $form.Controls.Add($rightPanel)
    $form.Controls.Add($topPanel)
    $form.Controls.Add($bottomPanel)

    $form.Add_Shown({ Refresh-Workspaces }.GetNewClosure())

    [System.Windows.Forms.Application]::Run($form)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1`
Expected: PASS, prints `retk-gui checks passed`.

- [ ] **Step 5: Manual smoke test**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\retk-gui.ps1`

Confirm:
- The window opens with the workspace dropdown, five left-panel groups, log pane, and raw command box.
- Clicking **Doctor** streams `re.ps1 doctor` output live into the log and disables the other action buttons while it runs.
- Clicking **Cancel** while a long command (e.g. **Flow** against a real build, if available) is running stops it and appends `[CANCELLED]`.
- After **New workspace** creates one, it appears in the dropdown and workspace-scoped buttons become enabled once selected.
- Close the window when done.

- [ ] **Step 6: Commit**

```bash
git add scripts/retk-gui.ps1 tests/retk-gui.Tests.ps1
git commit -m "Build the REToolkit GUI WinForms window and wire it to re.ps1"
```

---

## Task 5: Build script (`ps2exe` packaging)

**Files:**
- Create: `scripts\build-gui.ps1`
- Modify: `tests\retk-gui.Tests.ps1`

**Interfaces:**
- Consumes: `scripts\retk-gui.ps1` (Task 4's finished file) as `Invoke-ps2exe`'s input.
- Produces: `REToolkit-GUI.exe` at the repo root when run (not produced by the test — the test only checks the script's source, it does not execute `ps2exe`/network install, to keep the test suite fast and offline-safe).

- [ ] **Step 1: Write the failing test**

Insert the following into `tests\retk-gui.Tests.ps1`, directly above the final `Write-Host "retk-gui checks passed"` line:

```powershell
$buildGuiPath = Join-Path $RepoRoot "scripts\build-gui.ps1"
Assert-True (Test-Path -LiteralPath $buildGuiPath) "scripts\build-gui.ps1 should exist."
$buildGuiSource = Get-Content -LiteralPath $buildGuiPath -Raw
Assert-Contains $buildGuiSource "Invoke-ps2exe" "build-gui.ps1 should compile the GUI with Invoke-ps2exe."
Assert-Contains $buildGuiSource "-noConsole" "build-gui.ps1 should compile without a background console window."
Assert-Contains $buildGuiSource "Install-Module" "build-gui.ps1 should install ps2exe if missing."
Assert-Contains $buildGuiSource "-Scope CurrentUser" "build-gui.ps1 should install ps2exe to CurrentUser scope, not machine-wide."
Assert-Contains $buildGuiSource "REToolkit-GUI.exe" "build-gui.ps1 should name the output REToolkit-GUI.exe."

```

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1`
Expected: FAIL — `scripts\build-gui.ps1` does not exist.

- [ ] **Step 3: Write the minimal implementation**

Create `scripts\build-gui.ps1`:

```powershell
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command Invoke-ps2exe -ErrorAction SilentlyContinue)) {
    Write-Host "Installing ps2exe module (CurrentUser scope)..." -ForegroundColor Cyan
    Install-Module -Name ps2exe -Scope CurrentUser -Force -ErrorAction Stop
    Import-Module ps2exe -ErrorAction Stop
}

$inputFile = Join-Path $Root "scripts\retk-gui.ps1"
$outputFile = Join-Path $Root "REToolkit-GUI.exe"

if (-not (Test-Path -LiteralPath $inputFile)) {
    throw "GUI source not found: $inputFile"
}

Invoke-ps2exe -inputFile $inputFile -outputFile $outputFile -noConsole -title "REToolkit GUI"

Write-Host "Built: $outputFile" -ForegroundColor Green
```

- [ ] **Step 4: Run test to verify it passes**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1`
Expected: PASS, prints `retk-gui checks passed`.

- [ ] **Step 5: Manual verification**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\build-gui.ps1`

Confirm it prints `Built: <repo-root>\REToolkit-GUI.exe`, the file exists, and double-clicking it (or `.\REToolkit-GUI.exe`) opens the same window as the Task 4 smoke test with no console window behind it.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-gui.ps1 tests/retk-gui.Tests.ps1
git commit -m "Add scripts/build-gui.ps1 to package the REToolkit GUI as an exe"
```

---

## Task 6: Ignore the build output, document the GUI

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`
- Modify: `Tutorial.md`
- Modify: `CLAUDE.md`
- Modify: `tests\retk-gui.Tests.ps1`

**Interfaces:** None — documentation and ignore-rule task, closes out the plan.

- [ ] **Step 1: Write the failing test**

Insert the following into `tests\retk-gui.Tests.ps1`, directly above the final `Write-Host "retk-gui checks passed"` line:

```powershell
$gitignoreText = Get-Content -LiteralPath (Join-Path $RepoRoot ".gitignore") -Raw
Assert-Contains $gitignoreText "REToolkit-GUI.exe" ".gitignore should exclude the compiled GUI exe from commits."

$readmeText = Get-Content -LiteralPath (Join-Path $RepoRoot "README.md") -Raw
Assert-Contains $readmeText "scripts\build-gui.ps1" "README should document how to build the GUI."
Assert-Contains $readmeText "REToolkit-GUI.exe" "README should mention the compiled GUI exe."

$tutorialText = Get-Content -LiteralPath (Join-Path $RepoRoot "Tutorial.md") -Raw
Assert-Contains $tutorialText ".\scripts\build-gui.ps1" "Tutorial should show how to build the GUI."

$claudeMdText = Get-Content -LiteralPath (Join-Path $RepoRoot "CLAUDE.md") -Raw
Assert-Contains $claudeMdText "retk-gui.Tests.ps1" "CLAUDE.md's test suite list should include retk-gui.Tests.ps1."
```

- [ ] **Step 2: Run test to verify it fails**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1`
Expected: FAIL — none of the four files mention the GUI yet.

- [ ] **Step 3: Update `.gitignore`**

Append to the end of `.gitignore`:

```
REToolkit-GUI.exe
```

- [ ] **Step 4: Update `README.md`**

In `README.md`, insert a new section immediately after the `## re.ps1 Commands` table's closing paragraph (after the "Legacy query aliases ... print MCP setup guidance." line, i.e. right before `## Troubleshooting`):

```markdown
## GUI

Optional desktop GUI, a thin launcher over `re.ps1` — it does not duplicate
any pipeline logic, it just runs `re.ps1 <command>` as a child process and
streams the output into a log pane.

Build it once per machine:

```powershell
.\scripts\build-gui.ps1
```

This installs the `ps2exe` PowerShell module (CurrentUser scope) if needed,
then compiles `scripts\retk-gui.ps1` into `REToolkit-GUI.exe` at the repo
root. `REToolkit-GUI.exe` is a build artifact and is never committed to git
— rebuild it after pulling changes to `scripts\retk-gui.ps1`.

Run `.\REToolkit-GUI.exe` (or `powershell.exe -File scripts\retk-gui.ps1` in
dev mode) to pick a workspace, run Doctor/Add build/Flow/Open/Status/etc.
from buttons, and fall back to the raw command box at the bottom for
anything else `re.ps1` supports.
```

- [ ] **Step 5: Update `Tutorial.md`**

In `Tutorial.md`, rename the existing `## 8. Common Problems` header to `## 9. Common Problems`, and insert a new section immediately before it (i.e. right after the `Legacy query aliases such as ... Query the live Ghidra program through MCP instead.` paragraph that closes section 7):

```markdown
## 8. Optional: Desktop GUI

```powershell
.\scripts\build-gui.ps1
.\REToolkit-GUI.exe
```

The GUI is a thin launcher over `re.ps1` — pick a workspace from the
dropdown, click Doctor/Add build/Flow/Open/Status, or type any other
`re.ps1` command into the raw command box at the bottom.
```

- [ ] **Step 6: Update `CLAUDE.md`**

In `CLAUDE.md`, in the "**Run the test suite**" fenced code block under `## Commands`, add a fifth line after the existing `workspace-archive.Tests.ps1` line:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1
```

Also add one sentence to the paragraph directly below that code block (after the description of `workspace-archive.Tests.ps1`) noting that `retk-gui.Tests.ps1` mixes both styles: real execution tests for the pure helpers (`Resolve-RetkGuiRoot`, `Split-RetkGuiCommandLine`, `Get-RetkGuiWorkspaceNames`, `Invoke-RetkGuiCommand`) and static string assertions for the WinForms wiring in `Start-RetkGui`, since there is no WinForms test harness in this repo.

- [ ] **Step 7: Run test to verify it passes**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1`
Expected: PASS, prints `retk-gui checks passed`.

- [ ] **Step 8: Run the full existing test suite to confirm no regressions**

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-mcp-first.Tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\ghidra-script-bundle.Tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\ghidra-preferences.Tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\workspace-archive.Tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1
```
Expected: all five PASS.

- [ ] **Step 9: Commit**

```bash
git add .gitignore README.md Tutorial.md CLAUDE.md tests/retk-gui.Tests.ps1
git commit -m "Document the REToolkit GUI and ignore its compiled exe"
```
