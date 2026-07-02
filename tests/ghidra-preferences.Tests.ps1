[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $Root "scripts\ghidra-preferences.ps1")

function Assert-True {
    param(
        [Parameter(Mandatory)] [bool]$Condition,
        [Parameter(Mandatory)] [string]$Message
    )

    if (-not $Condition) {
        throw "ASSERT TRUE failed: $Message"
    }
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

function Read-TestProperties {
    param([Parameter(Mandatory)] [string]$Path)

    $props = @{}
    Get-Content -LiteralPath $Path | ForEach-Object {
        if ($_ -match '^([^#][^=]*)=(.*)$') {
            $props[$Matches[1]] = $Matches[2]
        }
    }
    return $props
}

$tempRoot = Join-Path $env:TEMP ("retk-ghidra-prefs-test-" + [guid]::NewGuid().ToString("N"))
try {
    $settingsDir = Join-Path $tempRoot "ghidra\ghidra_12.1.2_PUBLIC"
    New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null
    $prefsPath = Join-Path $settingsDir "preferences"

    @"
#User Preferences
#Thu Jul 02 14:55:15 ICT 2026
GhidraShowWhatsNew=false
LastOpenedProject=C\:\\Users\\DPC00176\\Old\\OldGame
LastSelectedProjectDirectory=C\:\\Users\\DPC00176\\Old
ProjectDirectory=/C\:/Users/DPC00176/Old/
RECENT_0=C\:\\Users\\DPC00176\\Old
RecentProjects=C\:\\Users\\DPC00176\\Old\\OldGame
USER_AGREEMENT=ACCEPT
"@ | Set-Content -LiteralPath $prefsPath -Encoding UTF8

    $projectDir = Join-Path $tempRoot "workspaces\FoodHunt\03_GhidraProject"
    New-Item -ItemType Directory -Path $projectDir -Force | Out-Null

    $result = Set-GhidraDefaultProjectPreference `
        -PreferencesPath $prefsPath `
        -ProjectDir $projectDir `
        -ProjectName "FoodHunt"

    Assert-True $result.Changed "First preference update should change the file."
    Assert-Equals $result.ProjectPath (Join-Path $projectDir "FoodHunt") "Result should report the full Ghidra project path."

    $props = Read-TestProperties -Path $prefsPath
    $expectedProject = ConvertTo-GhidraPreferencePathValue -Path (Join-Path $projectDir "FoodHunt")
    $expectedDir = ConvertTo-GhidraPreferencePathValue -Path $projectDir
    $expectedProjectDirectory = ConvertTo-GhidraProjectDirectoryValue -ProjectDir $projectDir

    Assert-True ($expectedProject -match '^[A-Za-z]\\:\\\\') "Escaped project path should use Java properties escaping for the drive and backslashes."
    Assert-True ($expectedProjectDirectory -match '^/[A-Za-z]\\:/.+/$') "ProjectDirectory should use Ghidra's slash path format."
    Assert-Equals $props["LastOpenedProject"] $expectedProject "LastOpenedProject should point at the selected Ghidra project."
    Assert-Equals $props["LastSelectedProjectDirectory"] $expectedDir "LastSelectedProjectDirectory should point at the selected project directory."
    Assert-Equals $props["ProjectDirectory"] $expectedProjectDirectory "ProjectDirectory should use Ghidra's slash path format."
    Assert-Equals $props["RECENT_0"] $expectedDir "RECENT_0 should point at the selected project directory."
    Assert-True ($props["RecentProjects"].StartsWith($expectedProject)) "RecentProjects should put the selected project first."

    $second = Set-GhidraDefaultProjectPreference `
        -PreferencesPath $prefsPath `
        -ProjectDir $projectDir `
        -ProjectName "FoodHunt"

    Assert-True (-not $second.Changed) "Second preference update should be idempotent."
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "ghidra-preferences checks passed"
