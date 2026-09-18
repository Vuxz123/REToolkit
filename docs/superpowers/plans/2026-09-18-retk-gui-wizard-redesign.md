# REToolkit GUI Step-Wizard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `scripts\retk-gui.ps1`'s flat stack of 6 GroupBoxes (~20
buttons all visible at once) with a 5-step gated wizard (step rail on the
left, one step's content visible at a time) that guides a user through
Setup → New workspace → Prepare Build → Ghidra → More, using
`project.re.json` state to show which steps are done/locked.

**Architecture:** Pure-logic step-status computation
(`Get-RetkGuiWizardStepStatus`) is added and unit-tested in isolation first.
Then the existing `leftPanel` (a single `FlowLayoutPanel` holding all 6
GroupBoxes) is replaced by a `Panel`-based step rail + a stack of 5
step-content panels (`Visible` toggled, never destroyed/recreated) inside
the same `SplitContainer.Panel1` that already exists. Every existing
button's verb and `-OnClick` scriptblock is unchanged — only which
container each control lives in, and whether the rail lets you click into
it, changes.

**Tech Stack:** Windows PowerShell 5.1, WinForms (`System.Windows.Forms`),
this repo's hand-rolled `Assert-*` test style (see `tests\retk-gui.Tests.ps1`).

**Spec:** `docs/superpowers/specs/2026-09-18-retk-gui-wizard-redesign-design.md`

## Global Constraints

- Target platform is Windows PowerShell 5.1 — do not use PS7-only syntax
  (e.g. the `` `u{XXXX} `` string escape does not exist in 5.1; use
  `[char]0x2713` instead).
- No changes to `re.ps1` or any `scripts\retk-*.ps1` pipeline module. Every
  button keeps calling the exact same `re.ps1 <verb>` it does today.
- Do not dot-source `scripts\retk-project.ps1` into `retk-gui.ps1` to read
  `project.re.json` — its `Read-Project`/`Get-WorkspacePath` depend on the
  `$Workspaces` script-scope variable that only `re.ps1`'s entrypoint sets
  up, which this GUI never establishes (it has its own local
  `$workspacesDir`). Read `project.re.json` directly with
  `Get-Content -Raw | ConvertFrom-Json` instead, keeping this GUI's existing
  minimal-coupling design intact (see CLAUDE.md's "Two independent entry
  points" section).
- Gate step N+1 on step N's completion criterion from the spec's "Step
  definitions" section — do not gate step 4 (Ghidra) on
  `status.imported`; gate it on `status.dumped` (set by both the manual
  `dump` verb and `flow`), since the GUI has no standalone "import into
  Ghidra" button and gating on `imported` would permanently lock users who
  use the manual Add/Scan→Dump path.
- After every task, run `tests\retk-gui.Tests.ps1` and a syntax check via
  `[System.Management.Automation.Language.Parser]::ParseFile` before
  committing.

---

## Task 1: Pure step-status helper (`Get-RetkGuiWizardStepStatus`)

**Files:**
- Modify: `scripts\retk-gui.ps1` (add function near the other pure helpers,
  right after `Get-RetkGuiHarnessInfo`, i.e. after line 122 in the current
  file)
- Modify: `tests\retk-gui.Tests.ps1` (add test block near the other pure
  helper tests, right after the `Get-RetkGuiHarnessInfo` block that ends at
  line 120)

**Interfaces:**
- Produces: `Get-RetkGuiWizardStepStatus -Project <PSCustomObject|$null> -HealthCheckDone <bool>` returning an array of 5 `[pscustomobject]@{ Index; Title; Complete; Unlocked }` records (`Index` 1-5, `Title` a string, `Complete`/`Unlocked` booleans), used by Task 3's `Update-RetkGuiWizardState`.

- [ ] **Step 1: Write the failing tests**

Insert into `tests\retk-gui.Tests.ps1` immediately after the line:
```
    Assert-Equals $codexInfo2.SkillsDir "D:\CustomCodex\skills" "Codex skills dir should be under the overridden CODEX_HOME."
```
add:
```powershell

    # Get-RetkGuiWizardStepStatus
    function Get-StepByIndex($steps, [int]$index) { return $steps | Where-Object { $_.Index -eq $index } }

    $noProjectSteps = Get-RetkGuiWizardStepStatus -Project $null -HealthCheckDone $false
    Assert-Equals $noProjectSteps.Count 5 "Should always return exactly 5 step records."
    Assert-Equals (Get-StepByIndex $noProjectSteps 1).Complete $false "Step 1 (Setup) is not complete until the health check has run."
    Assert-Equals (Get-StepByIndex $noProjectSteps 1).Unlocked $true "Step 1 (Setup) is always unlocked."
    Assert-Equals (Get-StepByIndex $noProjectSteps 2).Unlocked $false "Step 2 should be locked until step 1 (health check) completes."

    $healthDoneNoProjectSteps = Get-RetkGuiWizardStepStatus -Project $null -HealthCheckDone $true
    Assert-Equals (Get-StepByIndex $healthDoneNoProjectSteps 1).Complete $true "Step 1 completes once the health check has run, regardless of issues found."
    Assert-Equals (Get-StepByIndex $healthDoneNoProjectSteps 2).Unlocked $true "Step 2 unlocks once step 1 is complete."
    Assert-Equals (Get-StepByIndex $healthDoneNoProjectSteps 2).Complete $false "Step 2 is not complete without a selected workspace."
    Assert-Equals (Get-StepByIndex $healthDoneNoProjectSteps 3).Unlocked $false "Step 3 stays locked with no workspace selected."

    $projectNotDumped = [pscustomobject]@{ status = [pscustomobject]@{ dumped = $false; imported = $false; analyzed = $false; symbolsApplied = $false } }
    $notDumpedSteps = Get-RetkGuiWizardStepStatus -Project $projectNotDumped -HealthCheckDone $true
    Assert-Equals (Get-StepByIndex $notDumpedSteps 2).Complete $true "Step 2 completes once a workspace/project is selected."
    Assert-Equals (Get-StepByIndex $notDumpedSteps 3).Unlocked $true "Step 3 unlocks once step 2 (workspace selected) is complete."
    Assert-Equals (Get-StepByIndex $notDumpedSteps 3).Complete $false "Step 3 is not complete until status.dumped is true."
    Assert-Equals (Get-StepByIndex $notDumpedSteps 4).Unlocked $false "Step 4 stays locked until status.dumped is true."

    $projectDumped = [pscustomobject]@{ status = [pscustomobject]@{ dumped = $true; imported = $false; analyzed = $false; symbolsApplied = $false } }
    $dumpedSteps = Get-RetkGuiWizardStepStatus -Project $projectDumped -HealthCheckDone $true
    Assert-Equals (Get-StepByIndex $dumpedSteps 3).Complete $true "Step 3 completes once status.dumped is true, whether set by 'dump' or 'flow'."
    Assert-Equals (Get-StepByIndex $dumpedSteps 4).Unlocked $true "Step 4 unlocks once status.dumped is true -- NOT gated on status.imported, since the manual Add/Scan->Dump path never sets it."
    Assert-Equals (Get-StepByIndex $dumpedSteps 4).Complete $false "Step 4 is not complete until Ghidra has actually been touched."
    Assert-Equals (Get-StepByIndex $dumpedSteps 5).Unlocked $false "Step 5 stays locked until step 4 is complete."

    $projectImported = [pscustomobject]@{ status = [pscustomobject]@{ dumped = $true; imported = $true; analyzed = $false; symbolsApplied = $false } }
    $importedSteps = Get-RetkGuiWizardStepStatus -Project $projectImported -HealthCheckDone $true
    Assert-Equals (Get-StepByIndex $importedSteps 4).Complete $true "Step 4 completes once status.imported is true."
    Assert-Equals (Get-StepByIndex $importedSteps 5).Unlocked $true "Step 5 unlocks once step 4 is complete."

    $projectAnalyzedOnly = [pscustomobject]@{ status = [pscustomobject]@{ dumped = $true; imported = $false; analyzed = $true; symbolsApplied = $false } }
    $analyzedSteps = Get-RetkGuiWizardStepStatus -Project $projectAnalyzedOnly -HealthCheckDone $true
    Assert-Equals (Get-StepByIndex $analyzedSteps 4).Complete $true "Step 4 also completes on status.analyzed alone (imported can be false on the manual path)."
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1`

Expected: FAIL with an error that `Get-RetkGuiWizardStepStatus` is not
recognized as a command name.

- [ ] **Step 3: Implement `Get-RetkGuiWizardStepStatus`**

In `scripts\retk-gui.ps1`, insert immediately after the closing `}` of
`Get-RetkGuiHarnessInfo` (currently line 122) and before
`function Get-RetkGuiWorkspaceNames {` (currently line 124):

```powershell

function Get-RetkGuiWizardStepStatus {
    [CmdletBinding()]
    param(
        [Parameter()] [AllowNull()] $Project,
        [Parameter(Mandatory)] [bool]$HealthCheckDone
    )

    $hasWorkspace = $null -ne $Project
    # PowerShell property access on $null (or a missing member) returns
    # $null rather than throwing, so this is safe even when $Project is
    # $null or has no .status property (a malformed/legacy project.re.json).
    $dumped = $hasWorkspace -and [bool]$Project.status.dumped
    $ghidraTouched = $hasWorkspace -and (
        [bool]$Project.status.imported -or
        [bool]$Project.status.analyzed -or
        [bool]$Project.status.symbolsApplied
    )

    return @(
        [pscustomobject]@{ Index = 1; Title = "Setup"; Complete = $HealthCheckDone; Unlocked = $true }
        [pscustomobject]@{ Index = 2; Title = "New workspace"; Complete = $hasWorkspace; Unlocked = $HealthCheckDone }
        [pscustomobject]@{ Index = 3; Title = "Prepare Build"; Complete = $dumped; Unlocked = $hasWorkspace }
        [pscustomobject]@{ Index = 4; Title = "Ghidra"; Complete = $ghidraTouched; Unlocked = $dumped }
        [pscustomobject]@{ Index = 5; Title = "More"; Complete = $false; Unlocked = $ghidraTouched }
    )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1`

Expected: `retk-gui checks passed`

- [ ] **Step 5: Syntax-check and commit**

Run:
```powershell
$errors = $null; [System.Management.Automation.Language.Parser]::ParseFile("scripts\retk-gui.ps1", [ref]$null, [ref]$errors) | Out-Null; if ($errors) { $errors } else { "no syntax errors" }
```
Expected: `no syntax errors`

```bash
git add scripts/retk-gui.ps1 tests/retk-gui.Tests.ps1
git commit -m "Add pure Get-RetkGuiWizardStepStatus helper for GUI wizard gating

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Step-rail layout scaffold + re-parent existing groups

**Files:**
- Modify: `scripts\retk-gui.ps1` (the top-bar block, the `leftPanel`
  construction, the Pipeline group, and the final left-panel assembly)
- Modify: `tests\retk-gui.Tests.ps1` (add static assertions for the new
  structural elements)

**Interfaces:**
- Consumes: nothing from Task 1 yet (gating is Task 3).
- Produces: `$stepRailButtons` (hashtable, keys 1-5, `System.Windows.Forms.Button`), `$stepPanels` (hashtable, keys 1-5, `System.Windows.Forms.Panel`), `$stepFlows` (hashtable, keys 1-5, `System.Windows.Forms.FlowLayoutPanel`, each the sole child of the matching `$stepPanels` entry), and `function script:Show-RetkGuiWizardStep([int]$StepIndex)` — all consumed by Task 3.

This task intentionally leaves every step rail button permanently enabled
(no locking yet) so the deliverable — click any of the 5 rail buttons, see
the right group(s) appear — is independently testable before gating exists.

- [ ] **Step 1: Shrink the top bar to just "Open folder"**

In `scripts\retk-gui.ps1`, replace the current top-bar block:
```powershell
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
```

with:
```powershell
    # --- Top bar: minimal, persistent regardless of which wizard step is showing ---
    $topPanel = New-Object System.Windows.Forms.Panel
    $topPanel.Dock = "Top"
    $topPanel.Height = 40

    $openFolderButton = New-Object System.Windows.Forms.Button
    $openFolderButton.Text = "Open folder"
    $openFolderButton.Left = 10; $openFolderButton.Top = 6
    $openFolderButton.AutoSize = $true

    $topPanel.Controls.Add($openFolderButton)

    # Workspace combo/Refresh/New workspace move into the step 2 ("New
    # workspace") panel below instead of living in the top bar -- created
    # here (same variable names the existing handlers further down already
    # reference) but not parented into any container yet.
    $workspaceCombo = New-Object System.Windows.Forms.ComboBox
    $workspaceCombo.DropDownStyle = "DropDownList"

    $refreshButton = New-Object System.Windows.Forms.Button
    $refreshButton.Text = "Refresh"

    $initButton = New-Object System.Windows.Forms.Button
    $initButton.Text = "New workspace"
    $initButton.AutoSize = $true
```

- [ ] **Step 2: Bump the form/splitter sizing for the new rail column**

Existing groups (`New-RetkGuiGroup`, unchanged) are 520px wide. The step
content area is `SplitterDistance - stepRailPanel.Width(150) -
SplitterWidth(6)`, so it needs `SplitterDistance >= ~700` to fit a 520-wide
group without the step's `AutoScroll` flow panel showing a horizontal
scrollbar.

Replace:
```powershell
    $form.Width = 1100
    $form.Height = 720
```
with:
```powershell
    $form.Width = 1300
    $form.Height = 720
```

Replace:
```powershell
    $splitContainer.SplitterDistance = 550
```
with:
```powershell
    $splitContainer.SplitterDistance = 700
```

- [ ] **Step 3: Remove the old `leftPanel` FlowLayoutPanel**

Replace:
```powershell
    # --- Left panel: action groups ---
    $leftPanel = New-Object System.Windows.Forms.FlowLayoutPanel
    $leftPanel.Dock = "Fill"
    $leftPanel.FlowDirection = "TopDown"
    $leftPanel.WrapContents = $false
    $leftPanel.AutoScroll = $true

    function New-RetkGuiGroup {
```
with:
```powershell
    # --- Step rail + step content panels (replaces the old single
    # FlowLayoutPanel stack of every GroupBox at once) ---
    function New-RetkGuiGroup {
```

(`$leftPanel` is fully removed; `New-RetkGuiGroup`/`Add-RetkGuiButtonToGroup`
are unchanged and keep being used by the groups below.)

- [ ] **Step 4: Wrap the workspace combo into a "New workspace" group, and split the Pipeline group into "Automatic" (Flow) and "Manual" (Add/Scan/Dump)**

Replace the entire Pipeline group block (this single replace also inserts
the new step-2 "New workspace" group immediately before it, so the anchor
stays a single unambiguous, unmodified block of existing text):
```powershell
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
```

with:
```powershell
    # --- New workspace group (step 2): combo + Refresh + New workspace ---
    $workspaceStepGroup = New-RetkGuiGroup -Title "New workspace"
    $workspaceStepGroup.Height = 90
    $workspaceCombo.Left = 15; $workspaceCombo.Top = 28; $workspaceCombo.Width = 320
    $refreshButton.Left = 345; $refreshButton.Top = 26
    $initButton.Left = 430; $initButton.Top = 26
    $workspaceStepGroup.Controls.AddRange(@($workspaceCombo, $refreshButton, $initButton))

    # --- Prepare Build: "Automatic" (Flow, prominent) + "Manual" (Add/Scan/Dump) ---
    $flowGroup = New-RetkGuiGroup -Title "Automatic (recommended)"
    $flowGroup.Height = 90
    $flowButton = New-Object System.Windows.Forms.Button
    $flowButton.Text = "Flow: prepare + open Ghidra"
    $flowButton.Left = 15; $flowButton.Top = 25; $flowButton.Width = 380; $flowButton.Height = 44
    $flowButton.Font = New-Object System.Drawing.Font($flowButton.Font.FontFamily, 10, [System.Drawing.FontStyle]::Bold)
    $flowButton.Add_Click({
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $path = Show-RetkGuiPathPromptDialog -Title "Flow source (APK/XAPK/AAB or extracted folder)"
        if ($null -eq $path) { return }
        Invoke-GuiCommand -Arguments @('flow', $gameName, $path)
    }.GetNewClosure())
    $flowGroup.Controls.Add($flowButton)
    [void]$global:AllActionButtons.Add($flowButton)
    [void]$global:WorkspaceButtons.Add($flowButton)

    $manualGroup = New-RetkGuiGroup -Title "Manual (step by step)"
    Add-RetkGuiButtonToGroup -Group $manualGroup -Text "Add build" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $dlg = New-Object System.Windows.Forms.OpenFileDialog
        $dlg.Filter = "Android build (*.apk;*.xapk;*.aab;*.zip)|*.apk;*.xapk;*.aab;*.zip|All files (*.*)|*.*"
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Invoke-GuiCommand -Arguments @('add', $gameName, $dlg.FileName)
        }
    }.GetNewClosure() | Out-Null
    Add-RetkGuiButtonToGroup -Group $manualGroup -Text "Scan" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = "Select the extracted build folder"
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Invoke-GuiCommand -Arguments @('scan', $gameName, $dlg.SelectedPath)
        }
    }.GetNewClosure() | Out-Null
    Add-RetkGuiButtonToGroup -Group $manualGroup -Text "Dump" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        Invoke-GuiCommand -Arguments @('dump', $gameName)
    }.GetNewClosure() | Out-Null
```

(Every click handler body is byte-for-byte unchanged from before — only the
container and the extra prominent `$flowButton` construction are new.)

- [ ] **Step 5: Build the step rail + content panels, and assemble each step**

Replace:
```powershell
    $leftPanel.Controls.AddRange(@($setupGroup, $skillsGroup, $pipelineGroup, $ghidraGroup, $workspaceGroup, $extrasGroup))

    # --- Split container: resizable divide between actions and log ---
```
with:
```powershell
    # --- Step rail (left, fixed width) + step content (right, one visible at a time) ---
    $stepRailPanel = New-Object System.Windows.Forms.Panel
    $stepRailPanel.Dock = "Left"
    $stepRailPanel.Width = 150

    $stepContentContainer = New-Object System.Windows.Forms.Panel
    $stepContentContainer.Dock = "Fill"

    $stepTitles = @{ 1 = "Setup"; 2 = "New workspace"; 3 = "Prepare Build"; 4 = "Ghidra"; 5 = "More" }
    $stepRailButtons = @{}
    $stepPanels = @{}
    $stepFlows = @{}

    $railTop = 10
    for ($i = 1; $i -le 5; $i++) {
        $railButton = New-Object System.Windows.Forms.Button
        $railButton.Left = 5; $railButton.Top = $railTop; $railButton.Width = 140; $railButton.Height = 40
        $railButton.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
        $railButton.Text = "$i. $($stepTitles[$i])"
        $stepRailPanel.Controls.Add($railButton)
        $stepRailButtons[$i] = $railButton
        $railTop += 46

        $stepPanel = New-Object System.Windows.Forms.Panel
        $stepPanel.Dock = "Fill"
        $stepPanel.Visible = $false
        $stepFlow = New-Object System.Windows.Forms.FlowLayoutPanel
        $stepFlow.Dock = "Fill"
        $stepFlow.FlowDirection = "TopDown"
        $stepFlow.WrapContents = $false
        $stepFlow.AutoScroll = $true
        $stepPanel.Controls.Add($stepFlow)
        $stepContentContainer.Controls.Add($stepPanel)
        $stepPanels[$i] = $stepPanel
        $stepFlows[$i] = $stepFlow
    }

    $stepFlows[1].Controls.AddRange(@($setupGroup, $skillsGroup))
    $stepFlows[2].Controls.Add($workspaceStepGroup)
    $stepFlows[3].Controls.AddRange(@($flowGroup, $manualGroup))
    $stepFlows[4].Controls.Add($ghidraGroup)
    $stepFlows[5].Controls.AddRange(@($workspaceGroup, $extrasGroup))

    function script:Show-RetkGuiWizardStep {
        param([Parameter(Mandatory)] [int]$StepIndex)
        for ($i = 1; $i -le 5; $i++) { $stepPanels[$i].Visible = ($i -eq $StepIndex) }
    }

    for ($i = 1; $i -le 5; $i++) {
        $capturedStepIndex = $i
        $stepRailButtons[$i].Add_Click({ Show-RetkGuiWizardStep -StepIndex $capturedStepIndex }.GetNewClosure())
    }

    # --- Split container: resizable divide between actions and log ---
```

- [ ] **Step 6: Add the rail/content panel into the split container and show step 1 on load**

Replace:
```powershell
    $splitContainer.Dock = "Fill"
    $splitContainer.Panel1.Controls.Add($leftPanel)
    $splitContainer.Panel2.Controls.Add($rightPanel)
```
with:
```powershell
    $splitContainer.Dock = "Fill"
    # Left-docked control added before the Fill one so the rail reserves its
    # 150px and the content container gets the remainder.
    $splitContainer.Panel1.Controls.Add($stepRailPanel)
    $splitContainer.Panel1.Controls.Add($stepContentContainer)
    $splitContainer.Panel2.Controls.Add($rightPanel)
```

Replace:
```powershell
    $form.Add_Shown({ Refresh-Workspaces; Start-RetkGuiHealthCheck; Update-RetkGuiSkillsStatus }.GetNewClosure())
```
with:
```powershell
    $form.Add_Shown({ Refresh-Workspaces; Start-RetkGuiHealthCheck; Update-RetkGuiSkillsStatus; Show-RetkGuiWizardStep -StepIndex 1 }.GetNewClosure())
```

- [ ] **Step 7: Add static assertions for the new structure**

In `tests\retk-gui.Tests.ps1`, after the line:
```
Assert-Contains $guiSource "retoolkit-mcp-analysis" "GUI's skill-install action should copy all 3 repo-local skill folders."
```
add:
```powershell
Assert-Contains $guiSource "Show-RetkGuiWizardStep" "GUI should be able to switch which wizard step panel is visible."
Assert-Contains $guiSource "stepRailButtons" "GUI should have a 5-button step rail."
Assert-Contains $guiSource "Automatic (recommended)" "GUI should present Flow as the prominent, recommended path in step 3."
Assert-Contains $guiSource "Manual (step by step)" "GUI should present Add/Scan/Dump as the manual alternative in step 3."
```

- [ ] **Step 8: Run tests, syntax-check**

Run:
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1
```
Expected: `retk-gui checks passed` (every existing verb-string assertion
still passes unmodified since no click-handler bodies changed).

Run:
```powershell
$errors = $null; [System.Management.Automation.Language.Parser]::ParseFile("scripts\retk-gui.ps1", [ref]$null, [ref]$errors) | Out-Null; if ($errors) { $errors } else { "no syntax errors" }
```
Expected: `no syntax errors`

- [ ] **Step 9: Manual verification**

Launch the GUI directly and click through all 5 rail buttons to confirm
each shows the right group(s) and nothing throws:
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\retk-gui.ps1
```
Expected: step 1 (Setup + Skills) shows on load; clicking rail buttons 2-5
swaps in New workspace / Prepare Build (Automatic+Manual) / Ghidra / More
(Workspace+Extras) respectively; every button still runs its command as
before. All 5 rail buttons are clickable at this stage (gating is Task 3).

- [ ] **Step 10: Commit**

```bash
git add scripts/retk-gui.ps1 tests/retk-gui.Tests.ps1
git commit -m "Restructure REToolkit GUI into a 5-step wizard layout

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Wire gating (lock/checkmark) using the wizard status helper

**Files:**
- Modify: `scripts\retk-gui.ps1`
- Modify: `tests\retk-gui.Tests.ps1`

**Interfaces:**
- Consumes: `Get-RetkGuiWizardStepStatus` (Task 1); `$stepRailButtons`,
  `$stepFlows`/`$stepPanels` are not needed here beyond `$stepRailButtons`
  (Task 2).
- Produces: `function script:Update-RetkGuiWizardState` (no params) and
  `$global:GuiHealthCheckDone` (bool), used by nothing further in this plan
  but a natural extension point.

- [ ] **Step 1: Initialize the health-check-done flag**

In `scripts\retk-gui.ps1`, replace:
```powershell
    $global:IsRunning = $false
    $global:CurrentProcess = $null
    $global:CommandStartedAt = $null
    $global:WasCancelled = $false
```
with:
```powershell
    $global:IsRunning = $false
    $global:CurrentProcess = $null
    $global:CommandStartedAt = $null
    $global:WasCancelled = $false
    $global:GuiHealthCheckDone = $false
```

- [ ] **Step 2: Add `Update-RetkGuiWizardState`**

Add this function right after `Show-RetkGuiWizardStep` (added in Task 2,
Step 5) and before the `for ($i = 1; $i -le 5; $i++) { ... Add_Click ... }`
loop that wires the rail buttons' click handlers — the click handlers need
to call it too (next step), so it must be defined first:

Replace:
```powershell
    function script:Show-RetkGuiWizardStep {
        param([Parameter(Mandatory)] [int]$StepIndex)
        for ($i = 1; $i -le 5; $i++) { $stepPanels[$i].Visible = ($i -eq $StepIndex) }
    }

    for ($i = 1; $i -le 5; $i++) {
        $capturedStepIndex = $i
        $stepRailButtons[$i].Add_Click({ Show-RetkGuiWizardStep -StepIndex $capturedStepIndex }.GetNewClosure())
    }
```
with:
```powershell
    function script:Show-RetkGuiWizardStep {
        param([Parameter(Mandatory)] [int]$StepIndex)
        for ($i = 1; $i -le 5; $i++) { $stepPanels[$i].Visible = ($i -eq $StepIndex) }
    }

    function script:Update-RetkGuiWizardState {
        $project = $null
        $gameName = Get-SelectedGameName
        if ($null -ne $gameName) {
            # Read project.re.json directly instead of dot-sourcing
            # scripts\retk-project.ps1's Read-Project: that function (and
            # Get-WorkspacePath beneath it) depends on the $Workspaces
            # script-scope variable that only re.ps1's entrypoint sets up,
            # which this GUI never establishes (it has its own local
            # $workspacesDir). A plain read keeps this GUI's existing
            # minimal-coupling design intact.
            $projectJsonPath = Join-Path $workspacesDir "$gameName\project.re.json"
            if (Test-Path -LiteralPath $projectJsonPath) {
                try {
                    $project = Get-Content -LiteralPath $projectJsonPath -Raw | ConvertFrom-Json
                }
                catch {
                    $project = $null
                }
            }
        }

        $steps = Get-RetkGuiWizardStepStatus -Project $project -HealthCheckDone $global:GuiHealthCheckDone
        $checkmark = [char]0x2713
        foreach ($stepInfo in $steps) {
            $railButton = $stepRailButtons[$stepInfo.Index]
            $suffix = if ($stepInfo.Complete) { " $checkmark" } elseif (-not $stepInfo.Unlocked) { " (locked)" } else { "" }
            $railButton.Text = "$($stepInfo.Index). $($stepInfo.Title)$suffix"
            $railButton.Enabled = $stepInfo.Unlocked
        }
    }

    for ($i = 1; $i -le 5; $i++) {
        $capturedStepIndex = $i
        $stepRailButtons[$i].Add_Click({ Show-RetkGuiWizardStep -StepIndex $capturedStepIndex }.GetNewClosure())
    }
```

- [ ] **Step 3: Call `Update-RetkGuiWizardState` from the 3 gating triggers + startup**

Replace:
```powershell
        $cancelButton.Enabled = $Running
        Update-WorkspaceButtonsEnabled
        Update-RetkGuiSkillsStatus
    }
```
with:
```powershell
        $cancelButton.Enabled = $Running
        Update-WorkspaceButtonsEnabled
        Update-RetkGuiSkillsStatus
        Update-RetkGuiWizardState
    }
```

Replace:
```powershell
    $workspaceCombo.Add_SelectedIndexChanged({ Update-WorkspaceButtonsEnabled }.GetNewClosure())
```
with:
```powershell
    $workspaceCombo.Add_SelectedIndexChanged({ Update-WorkspaceButtonsEnabled; Update-RetkGuiWizardState }.GetNewClosure())
```

Replace:
```powershell
    $form.Add_Shown({ Refresh-Workspaces; Start-RetkGuiHealthCheck; Update-RetkGuiSkillsStatus; Show-RetkGuiWizardStep -StepIndex 1 }.GetNewClosure())
```
with:
```powershell
    $form.Add_Shown({ Refresh-Workspaces; Start-RetkGuiHealthCheck; Update-RetkGuiSkillsStatus; Update-RetkGuiWizardState; Show-RetkGuiWizardStep -StepIndex 1 }.GetNewClosure())
```

- [ ] **Step 4: Mark the health check done (both outcomes) and refresh wizard state**

In `Start-RetkGuiHealthCheck`, replace:
```powershell
        catch {
            $global:GuiHealthLabel.Text = "Tools: check failed"
            $global:GuiHealthLabel.ForeColor = [System.Drawing.Color]::Firebrick
            $global:GuiHealthLabel.ToolTipText = $_.Exception.Message
            return
        }
```
with:
```powershell
        catch {
            $global:GuiHealthLabel.Text = "Tools: check failed"
            $global:GuiHealthLabel.ForeColor = [System.Drawing.Color]::Firebrick
            $global:GuiHealthLabel.ToolTipText = $_.Exception.Message
            $global:GuiHealthCheckDone = $true
            Update-RetkGuiWizardState
            return
        }
```

Replace:
```powershell
                    $global:GuiHealthLabel.ToolTipText = if ($lines.Count -gt 0) { $lines -join "`r`n" } else { "No doctor output." }
                }
            }
        }.GetNewClosure())
        $healthTimer.Start()
    }
```
with:
```powershell
                    $global:GuiHealthLabel.ToolTipText = if ($lines.Count -gt 0) { $lines -join "`r`n" } else { "No doctor output." }
                    $global:GuiHealthCheckDone = $true
                    Update-RetkGuiWizardState
                }
            }
        }.GetNewClosure())
        $healthTimer.Start()
    }
```

- [ ] **Step 5: Add static assertions**

In `tests\retk-gui.Tests.ps1`, after the assertions added in Task 2 Step 7,
add:
```powershell
Assert-Contains $guiSource "Update-RetkGuiWizardState" "GUI should recompute wizard step lock/checkmark state from project.re.json."
Assert-Contains $guiSource "GuiHealthCheckDone" "GUI should track whether the startup health check has finished, to unlock step 2."
Assert-Contains $guiSource "Get-RetkGuiWizardStepStatus" "GUI should use the pure step-status helper to drive rail button text/enabled state."
```

- [ ] **Step 6: Run tests, syntax-check**

Run:
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-gui.Tests.ps1
```
Expected: `retk-gui checks passed`

Run:
```powershell
$errors = $null; [System.Management.Automation.Language.Parser]::ParseFile("scripts\retk-gui.ps1", [ref]$null, [ref]$errors) | Out-Null; if ($errors) { $errors } else { "no syntax errors" }
```
Expected: `no syntax errors`

- [ ] **Step 7: Manual verification with a real workspace**

Launch the GUI (`powershell.exe -NoProfile -ExecutionPolicy Bypass -File
scripts\retk-gui.ps1`) and confirm, using an existing workspace in
`workspaces\` (or a freshly-created one):
- On load, step 1 shows "1. Setup" with no checkmark/lock, steps 2-5 show
  "(locked)" and are disabled.
- Within a few seconds (once the background doctor check finishes), step 1
  gets a checkmark and step 2 becomes clickable/unlocked.
- Selecting a workspace in step 2's combo marks step 2 complete and unlocks
  step 3.
- For a workspace whose `project.re.json` already has `status.dumped =
  true` (any previously-flowed/dumped workspace), step 3 shows a checkmark
  and step 4 is unlocked immediately upon selecting it.
- For a workspace with `status.imported` or `status.analyzed` true, step 4
  shows a checkmark and step 5 unlocks.
- Take a `PrintWindow`-based screenshot of the GUI window specifically
  (never a full-screen capture, per this session's earlier multi-monitor
  mistake) to visually confirm the rail rendering.

- [ ] **Step 8: Rebuild the compiled GUI exe**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\build-gui.ps1
```
Expected: `Built: <repo root>\REToolkit-GUI.exe`

- [ ] **Step 9: Commit**

```bash
git add scripts/retk-gui.ps1 tests/retk-gui.Tests.ps1
git commit -m "Gate REToolkit GUI wizard steps on project.re.json progress

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
