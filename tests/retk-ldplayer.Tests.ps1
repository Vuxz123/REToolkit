[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $Root "scripts\retk-ldplayer.ps1")

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

# --- ConvertFrom-PmPathOutput ---

$pmPathSample = @"
package:/data/app/~~xxx/com.example.game-yyy/base.apk
package:/data/app/~~xxx/com.example.game-yyy/split_config.arm64_v8a.apk
package:/data/app/~~xxx/com.example.game-yyy/split_config.en.apk
"@

$parsedPaths = @(ConvertFrom-PmPathOutput -RawOutput $pmPathSample)
Assert-Equals $parsedPaths.Count 3 "ConvertFrom-PmPathOutput should parse 3 lines."
Assert-Equals $parsedPaths[0] "/data/app/~~xxx/com.example.game-yyy/base.apk" "ConvertFrom-PmPathOutput should strip the package: prefix."
Assert-Equals $parsedPaths[2] "/data/app/~~xxx/com.example.game-yyy/split_config.en.apk" "ConvertFrom-PmPathOutput should preserve line order."

$emptyPaths = @(ConvertFrom-PmPathOutput -RawOutput "")
Assert-Equals $emptyPaths.Count 0 "ConvertFrom-PmPathOutput should return an empty array for empty input."

$emptyPathsWhitespace = @(ConvertFrom-PmPathOutput -RawOutput "`r`n`r`n")
Assert-Equals $emptyPathsWhitespace.Count 0 "ConvertFrom-PmPathOutput should ignore blank lines."

# --- ConvertFrom-PmListPackagesOutput ---

$pmListSample = "package:com.example.game`r`npackage:com.example.other`r`n"
$parsedPackages = @(ConvertFrom-PmListPackagesOutput -RawOutput $pmListSample)
Assert-Equals $parsedPackages.Count 2 "ConvertFrom-PmListPackagesOutput should parse 2 packages."
Assert-Equals $parsedPackages[0] "com.example.game" "ConvertFrom-PmListPackagesOutput should strip the package: prefix."
Assert-Equals $parsedPackages[1] "com.example.other" "ConvertFrom-PmListPackagesOutput should preserve line order."

# --- ConvertFrom-AdbDevicesOutput ---

$adbDevicesSample = @"
List of devices attached
emulator-5554	device
127.0.0.1:5555	device
127.0.0.1:5557	offline
* daemon not running; starting now at tcp:5037
"@

$devices = @(ConvertFrom-AdbDevicesOutput -RawOutput $adbDevicesSample)
Assert-Equals $devices.Count 3 "ConvertFrom-AdbDevicesOutput should parse 3 device lines and skip the header/daemon-status lines."
Assert-Equals $devices[0].Serial "emulator-5554" "ConvertFrom-AdbDevicesOutput should parse the serial as the first column."
Assert-Equals $devices[0].State "device" "ConvertFrom-AdbDevicesOutput should parse the state as the second column."
Assert-Equals $devices[2].State "offline" "ConvertFrom-AdbDevicesOutput should preserve non-'device' states for the caller to filter."

$readyOnly = @($devices | Where-Object { $_.State -eq "device" })
Assert-Equals $readyOnly.Count 2 "Filtering ConvertFrom-AdbDevicesOutput results to State -eq 'device' should exclude offline devices."

$emptyDevices = @(ConvertFrom-AdbDevicesOutput -RawOutput "List of devices attached`r`n")
Assert-Equals $emptyDevices.Count 0 "ConvertFrom-AdbDevicesOutput should return an empty array when no devices are listed."

# --- source-text regression guards (adb-calling functions can't run without a device) ---

$moduleSource = Get-Content -LiteralPath (Join-Path $Root "scripts\retk-ldplayer.ps1") -Raw

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

Assert-Contains $moduleSource 'function Resolve-LdPlayerAdb' "Module should expose Resolve-LdPlayerAdb."
Assert-Contains $moduleSource 'function Resolve-LdPlayerDevice' "Module should expose Resolve-LdPlayerDevice."
Assert-Contains $moduleSource 'throw "adb.exe not found on PATH or in common LDPlayer install locations. Pass -AdbPath <path-to-adb.exe>."' "Resolve-LdPlayerAdb should give actionable guidance when adb.exe cannot be found."
Assert-Contains $moduleSource 'throw "No LDPlayer device connected.' "Resolve-LdPlayerDevice should give actionable guidance when no device is connected."

Assert-Contains $moduleSource 'function Assert-LdPlayerPackageInstalled' "Module should expose Assert-LdPlayerPackageInstalled."
Assert-Contains $moduleSource 'function Get-LdPlayerApkPaths' "Module should expose Get-LdPlayerApkPaths."
Assert-Contains $moduleSource 'function Get-LdPlayerObbPaths' "Module should expose Get-LdPlayerObbPaths."
Assert-Contains $moduleSource 'Similarly named installed packages' "Assert-LdPlayerPackageInstalled should suggest similarly named packages on a miss."
Assert-Contains $moduleSource 'No OBB directory found' "Get-LdPlayerObbPaths should treat a missing OBB directory as informational, not an error."

Assert-Contains $moduleSource 'function Invoke-LdPlayerAppLaunch' "Module should expose Invoke-LdPlayerAppLaunch."
Assert-Contains $moduleSource 'function Save-LdPlayerBundle' "Module should expose Save-LdPlayerBundle."
Assert-Contains $moduleSource 'Read-Host "Press Enter when ready to pull"' "Invoke-LdPlayerAppLaunch should pause for user confirmation before the caller pulls files."
Assert-Contains $moduleSource '[guid]::NewGuid().ToString("N")' "Save-LdPlayerBundle temp paths should include a GUID to avoid collisions across overlapping runs."
Assert-Contains $moduleSource '[System.IO.Compression.ZipFile]::CreateFromDirectory($stagingDir, $zipPath)' "Save-LdPlayerBundle should zip the staged APK/OBB files."

Assert-Contains $moduleSource 'function Invoke-LdPlayerPull' "Module should expose Invoke-LdPlayerPull."
Assert-Contains $moduleSource 'New-Workspace $GameName' "Invoke-LdPlayerPull should auto-init the workspace if missing, matching Add-BuildToProject's convention."
Assert-Contains $moduleSource '"00_OriginalBuild"' "Invoke-LdPlayerPull should save the pulled bundle under 00_OriginalBuild."
Assert-Contains $moduleSource 'Add-BuildToProject $GameName $bundlePath' "Invoke-LdPlayerPull should hand off to the existing extract/flatten/scan pipeline."

Write-Host "retk-ldplayer checks passed"
