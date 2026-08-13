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

Write-Host "retk-gui checks passed"
