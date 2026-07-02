[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $Root "scripts\ghidra-script-bundle.ps1")

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

function Get-TestArrayValues {
    param(
        [Parameter(Mandatory)] [xml]$Document,
        [Parameter(Mandatory)] [string]$Name
    )

    $array = $Document.SelectSingleNode("//ARRAY[@NAME='$Name']")
    return @($array.A | ForEach-Object { $_.VALUE })
}

$tempRoot = Join-Path $env:TEMP ("retk-script-bundle-test-" + [guid]::NewGuid().ToString("N"))
try {
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

    $bundleDir = Join-Path $tempRoot "tools\Il2CppDumper"
    New-Item -ItemType Directory -Path $bundleDir -Force | Out-Null

    $toolDir = Join-Path $tempRoot "ghidra\ghidra_12.1.2_PUBLIC\tools"
    New-Item -ItemType Directory -Path $toolDir -Force | Out-Null
    $toolConfigPath = Join-Path $toolDir "_code_browser.tcd"

    $toolConfig = @'
<?xml version="1.0" encoding="UTF-8"?>
<TOOL_CONFIG CONFIG_NAME="NO_LONGER_USED">
    <TOOL TOOL_NAME="CodeBrowser" INSTANCE_NAME="">
        <PLUGIN_STATE CLASS="ghidra.app.plugin.core.script.GhidraScriptMgrPlugin">
            <ARRAY NAME="BundleHost_ACTIVE" TYPE="boolean">
                <A VALUE="false" />
            </ARRAY>
            <ARRAY NAME="BundleHost_ENABLE" TYPE="boolean">
                <A VALUE="true" />
            </ARRAY>
            <ARRAY NAME="BundleHost_FILE" TYPE="string">
                <A VALUE="$GHIDRA_HOME/Features/Base/ghidra_scripts" />
            </ARRAY>
            <ARRAY NAME="BundleHost_SYSTEM" TYPE="boolean">
                <A VALUE="true" />
            </ARRAY>
        </PLUGIN_STATE>
    </TOOL>
</TOOL_CONFIG>
'@
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($toolConfigPath, $toolConfig, $utf8NoBom)

    $first = Register-GhidraScriptBundle `
        -ToolConfigPath $toolConfigPath `
        -BundleDir $bundleDir `
        -UserHome $tempRoot `
        -CreateBackup

    Assert-True $first.Registered "Il2CppDumper script bundle should be registered."
    Assert-True $first.Changed "First registration should change the tool config."
    Assert-Equals $first.Reason "Added" "First registration should report Added."
    Assert-True (Test-Path -LiteralPath $first.BackupPath) "First registration should create a backup."

    [xml]$afterFirst = Get-Content -LiteralPath $toolConfigPath -Raw
    Assert-Equals @(Get-TestArrayValues -Document $afterFirst -Name "BundleHost_ACTIVE").Count 2 "ACTIVE array should grow with FILE array."
    Assert-Equals @(Get-TestArrayValues -Document $afterFirst -Name "BundleHost_ENABLE").Count 2 "ENABLE array should grow with FILE array."
    Assert-Equals @(Get-TestArrayValues -Document $afterFirst -Name "BundleHost_FILE").Count 2 "FILE array should contain the added bundle."
    Assert-Equals @(Get-TestArrayValues -Document $afterFirst -Name "BundleHost_SYSTEM").Count 2 "SYSTEM array should grow with FILE array."
    Assert-Equals @(Get-TestArrayValues -Document $afterFirst -Name "BundleHost_ACTIVE")[-1] "false" "Added bundle should not be marked active at rest."
    Assert-Equals @(Get-TestArrayValues -Document $afterFirst -Name "BundleHost_ENABLE")[-1] "true" "Added bundle should be enabled."
    Assert-Equals @(Get-TestArrayValues -Document $afterFirst -Name "BundleHost_FILE")[-1] '$USER_HOME/tools/Il2CppDumper' "Added bundle should use a stable Ghidra user-home macro path."
    Assert-Equals @(Get-TestArrayValues -Document $afterFirst -Name "BundleHost_SYSTEM")[-1] "false" "Added bundle should be marked as a user bundle."

    $second = Register-GhidraScriptBundle `
        -ToolConfigPath $toolConfigPath `
        -BundleDir $bundleDir `
        -UserHome $tempRoot `
        -CreateBackup

    Assert-True $second.Registered "Second registration should still report the bundle as registered."
    Assert-True (-not $second.Changed) "Second registration should be idempotent."
    Assert-Equals $second.Reason "AlreadyRegistered" "Second registration should not add a duplicate."

    [xml]$afterSecond = Get-Content -LiteralPath $toolConfigPath -Raw
    Assert-Equals @(Get-TestArrayValues -Document $afterSecond -Name "BundleHost_FILE").Count 2 "Second registration should not duplicate BundleHost_FILE."

    $missingPath = Join-Path $tempRoot "missing\_code_browser.tcd"
    $missing = Register-GhidraScriptBundle `
        -ToolConfigPath $missingPath `
        -BundleDir $bundleDir `
        -UserHome $tempRoot `
        -CreateBackup

    Assert-True (-not $missing.Registered) "Missing tool config should be skipped."
    Assert-True (-not $missing.Changed) "Missing tool config should not create files."
    Assert-Equals $missing.Reason "MissingToolConfig" "Missing tool config should report a precise reason."
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "ghidra-script-bundle checks passed"
