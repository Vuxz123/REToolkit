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

Get-EventSubscriber | Where-Object { $_.SourceObject -eq $proc } | Unregister-Event

Assert-True ($null -ne $exitCodeBox.Code) "Invoke-RetkGuiCommand should report an exit code within 15 seconds."
Assert-Equals $exitCodeBox.Code 0 "re.ps1 with no command should exit 0 (prints usage)."
Assert-True ($collectedLines.Count -gt 0) "Invoke-RetkGuiCommand should stream at least one output line."
Assert-True (($collectedLines -join "`n").Contains("RE Toolkit")) "Output should include the re.ps1 usage banner."

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
