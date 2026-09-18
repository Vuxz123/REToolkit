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

    # Format-RetkGuiElapsed
    Assert-Equals (Format-RetkGuiElapsed ([TimeSpan]::FromSeconds(5))) "00:00:05" "5 seconds should format as 00:00:05."
    Assert-Equals (Format-RetkGuiElapsed ([TimeSpan]::FromSeconds(65))) "00:01:05" "65 seconds should format as 00:01:05, not wrap the minutes."
    Assert-Equals (Format-RetkGuiElapsed ([TimeSpan]::FromSeconds(3725))) "01:02:05" "3725 seconds should format as 01:02:05."

    # Test-RetkGuiDoctorHasIssues
    Assert-Equals (Test-RetkGuiDoctorHasIssues -Lines @()) $false "No lines should mean no issues."
    Assert-Equals (Test-RetkGuiDoctorHasIssues -Lines @("  [OK]   JdkRoot   C:\path")) $false "Only [OK] lines should mean no issues."
    Assert-Equals (Test-RetkGuiDoctorHasIssues -Lines @("  [OK]   JdkRoot   C:\path", "  [MISS] PythonRoot C:\path")) $true "A [MISS] line should be reported as an issue."
    # 're.ps1 doctor' prints a blank line before the "Toolkit JDK:" section;
    # a Mandatory string[] parameter rejects an empty-string ELEMENT unless
    # AllowEmptyString is also declared, which threw at runtime here before
    # that attribute was added.
    Assert-Equals (Test-RetkGuiDoctorHasIssues -Lines @("  [OK]   JdkRoot   C:\path", "", "Toolkit JDK:")) $false "A blank line among the doctor output must not throw a parameter-binding error."

    # Get-RetkGuiHarnessInfo
    $harnessInfo = Get-RetkGuiHarnessInfo -HomeDir "C:\FakeHome" -CodexHome $null
    Assert-Equals $harnessInfo.Count 3 "Should return exactly 3 harness entries."
    $claudeInfo = $harnessInfo | Where-Object { $_.Name -eq 'Claude Code' }
    Assert-Equals $claudeInfo.RootDir "C:\FakeHome\.claude" "Claude Code root should be HomeDir\.claude."
    Assert-Equals $claudeInfo.SkillsDir "C:\FakeHome\.claude\skills" "Claude Code skills dir should be under .claude\skills."
    $codexInfo = $harnessInfo | Where-Object { $_.Name -eq 'Codex' }
    Assert-Equals $codexInfo.RootDir "C:\FakeHome\.codex" "Codex root should default to HomeDir\.codex when CODEX_HOME is not set."
    $openCodeInfo = $harnessInfo | Where-Object { $_.Name -eq 'OpenCode' }
    Assert-Equals $openCodeInfo.RootDir "C:\FakeHome\.config\opencode" "OpenCode root should be HomeDir\.config\opencode."
    Assert-Equals $openCodeInfo.SkillsDir "C:\FakeHome\.config\opencode\skills" "OpenCode skills dir should be under .config\opencode\skills."

    $harnessInfoWithCodexHome = Get-RetkGuiHarnessInfo -HomeDir "C:\FakeHome" -CodexHome "D:\CustomCodex"
    $codexInfo2 = $harnessInfoWithCodexHome | Where-Object { $_.Name -eq 'Codex' }
    Assert-Equals $codexInfo2.RootDir "D:\CustomCodex" "Codex root should honor a CODEX_HOME override when set."
    Assert-Equals $codexInfo2.SkillsDir "D:\CustomCodex\skills" "Codex skills dir should be under the overridden CODEX_HOME."

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

. (Join-Path $RepoRoot "scripts\retk-core.ps1")

$collectedLines = [System.Collections.ArrayList]::Synchronized((New-Object System.Collections.ArrayList))
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
# The Exited event can fire marginally before the second stream's EOF
# sentinel ($null passed to OnOutput) is actually delivered -- give it a
# short grace window so the sentinel count below is deterministic.
Start-Sleep -Milliseconds 500

Get-EventSubscriber | Where-Object { $_.SourceObject -eq $proc } | Unregister-Event

Assert-True ($null -ne $exitCodeBox.Code) "Invoke-RetkGuiCommand should report an exit code within 15 seconds."
Assert-Equals $exitCodeBox.Code 0 "re.ps1 with no command should exit 0 (prints usage)."
Assert-True ($collectedLines.Count -gt 0) "Invoke-RetkGuiCommand should stream at least one output line."
Assert-True (($collectedLines -join "`n").Contains("RE Toolkit")) "Output should include the re.ps1 usage banner."

$eofSentinels = 0
foreach ($l in $collectedLines) { if ($null -eq $l) { $eofSentinels++ } }
Assert-Equals $eofSentinels 2 "Invoke-RetkGuiCommand must pass each stream's EOF sentinel (`$null) through to OnOutput; filtering it out reintroduces a permanent GUI hang."

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
Assert-Contains $guiSource "SplitContainer" "GUI should let the user resize the actions panel vs. the log panel via a SplitContainer."
Assert-Contains $guiSource "StatusStrip" "GUI should show a status bar with command state, elapsed time, and a busy indicator."
Assert-Contains $guiSource "ToolStripProgressBar" "GUI status bar should include a busy-indicator progress bar."
Assert-Contains $guiSource "GuiStatusLabel" "GUI should track the running/idle status label globally so Invoke-GuiCommand can update it."
Assert-Contains $guiSource "GuiElapsedLabel" "GUI should track the elapsed-time label globally so the poll timer can update it."
Assert-Contains $guiSource "GuiHealthLabel" "GUI should show a tool-health indicator label backed by a globally-exposed status label."
Assert-Contains $guiSource "Start-RetkGuiHealthCheck" "GUI should run a background doctor check on startup to populate the health indicator."
Assert-Contains $guiSource "AutoToolTip" "Health indicator should show the full doctor output as a tooltip on hover."
Assert-Contains $guiSource "Get-RetkGuiHarnessInfo" "GUI should compute per-harness (Claude Code/Codex/OpenCode) skill directories."
Assert-Contains $guiSource "Update-RetkGuiSkillsStatus" "GUI should refresh the harness detection/install status label."
foreach ($harnessName in @("Claude Code", "Codex", "OpenCode")) {
    Assert-Contains $guiSource "'$harnessName'" "GUI should wire an install button for the '$harnessName' harness."
}
Assert-Contains $guiSource "retoolkit-mcp-analysis" "GUI's skill-install action should copy all 3 repo-local skill folders."

$buildGuiPath = Join-Path $RepoRoot "scripts\build-gui.ps1"
Assert-True (Test-Path -LiteralPath $buildGuiPath) "scripts\build-gui.ps1 should exist."
$buildGuiSource = Get-Content -LiteralPath $buildGuiPath -Raw
Assert-Contains $buildGuiSource "Invoke-ps2exe" "build-gui.ps1 should compile the GUI with Invoke-ps2exe."
Assert-Contains $buildGuiSource "-noConsole" "build-gui.ps1 should compile without a background console window."
Assert-Contains $buildGuiSource "Install-Module" "build-gui.ps1 should install ps2exe if missing."
Assert-Contains $buildGuiSource "-Scope CurrentUser" "build-gui.ps1 should install ps2exe to CurrentUser scope, not machine-wide."
Assert-Contains $buildGuiSource "REToolkit-GUI.exe" "build-gui.ps1 should name the output REToolkit-GUI.exe."

$gitignoreText = Get-Content -LiteralPath (Join-Path $RepoRoot ".gitignore") -Raw
Assert-Contains $gitignoreText "REToolkit-GUI.exe" ".gitignore should exclude the compiled GUI exe from commits."

$readmeText = Get-Content -LiteralPath (Join-Path $RepoRoot "README.md") -Raw
Assert-Contains $readmeText "scripts\build-gui.ps1" "README should document how to build the GUI."
Assert-Contains $readmeText "REToolkit-GUI.exe" "README should mention the compiled GUI exe."

$tutorialText = Get-Content -LiteralPath (Join-Path $RepoRoot "Tutorial.md") -Raw
Assert-Contains $tutorialText ".\scripts\build-gui.ps1" "Tutorial should show how to build the GUI."

$claudeMdText = Get-Content -LiteralPath (Join-Path $RepoRoot "CLAUDE.md") -Raw
Assert-Contains $claudeMdText "retk-gui.Tests.ps1" "CLAUDE.md's test suite list should include retk-gui.Tests.ps1."

Write-Host "retk-gui checks passed"
