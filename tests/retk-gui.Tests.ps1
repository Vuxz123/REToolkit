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
