[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $Root "scripts\retk-ldplayer.ps1")

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

Write-Host "retk-ldplayer checks passed"
