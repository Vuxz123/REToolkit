# LDPlayer APK Pull Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `re.ps1 pull-ldplayer <GameName> <PackageName>` — pulls a game's base APK, split APKs (including dynamic feature modules that only appear after first launch), and OBB expansion files from a running LDPlayer instance, then feeds the result through the existing `Add-BuildToProject` extract/flatten/scan pipeline so the workspace is ready for `dump`.

**Architecture:** New module `scripts\retk-ldplayer.ps1` dot-sourced by `re.ps1` like the other `retk-*` modules. Pure text-parsing functions (adb output → structured data) are separated from the functions that actually shell out to `adb.exe` via the existing `Invoke-NativeProcess` helper, so the parsers get real executed unit tests even though the adb-calling functions can't be exercised in CI.

**Tech Stack:** Windows PowerShell 5.1 compatible PowerShell, `adb.exe` (via LDPlayer), `System.IO.Compression.ZipFile`.

## Global Constraints

- Target Windows PowerShell 5.1, not just PowerShell 7 (per `CLAUDE.md`) — avoid PS7-only syntax.
- No aggregating test runner. Each `tests\*.Tests.ps1` file is run standalone: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\<name>.Tests.ps1`.
- Design spec: `docs\superpowers\specs\2026-07-21-ldplayer-apk-pull-design.md` (committed `65817dc`). This plan implements it as approved; do not re-litigate decisions already made there.
- Every workspace path must go through `Get-WorkspacePath` (in `scripts\retk-project.ps1`) so `Assert-WorkspaceName` validation applies — never build `workspaces\<name>\...` paths any other way.
- Temp file names must include a GUID (established convention from a prior fix in this repo — see `install-re-toolkit.ps1`'s `Install-Il2CppDumper`/`Install-AssetRipper`/`Install-Java` temp paths).

---

### Task 1: Pure adb-output parsers with real executed tests

**Files:**
- Create: `scripts\retk-ldplayer.ps1`
- Create: `tests\retk-ldplayer.Tests.ps1`

**Interfaces:**
- Produces: `ConvertFrom-PmPathOutput -RawOutput <string>` → `string[]` (remote APK paths, `package:` prefix stripped)
- Produces: `ConvertFrom-PmListPackagesOutput -RawOutput <string>` → `string[]` (package names, `package:` prefix stripped)
- Produces: `ConvertFrom-AdbDevicesOutput -RawOutput <string>` → `[pscustomobject]@{ Serial; State }[]`

- [ ] **Step 1: Create the module file with the three pure parsers**

Create `scripts\retk-ldplayer.ps1`:

```powershell
# Dot-sourced by re.ps1. Uses shared REToolkit variables from the entrypoint.

function ConvertFrom-PmPathOutput {
    param([Parameter(Mandatory)] [string]$RawOutput)

    $values = New-Object System.Collections.Generic.List[string]
    if ([string]::IsNullOrWhiteSpace($RawOutput)) {
        return @($values)
    }

    foreach ($line in ($RawOutput -split "`r?`n")) {
        $trimmed = $line.Trim()
        if ($trimmed.StartsWith("package:")) {
            [void]$values.Add($trimmed.Substring("package:".Length))
        }
    }

    return @($values)
}

function ConvertFrom-PmListPackagesOutput {
    param([Parameter(Mandatory)] [string]$RawOutput)

    # `pm list packages` and `pm path` both emit "package:<value>" lines;
    # the parsing is identical, only the meaning of <value> differs.
    return ConvertFrom-PmPathOutput -RawOutput $RawOutput
}

function ConvertFrom-AdbDevicesOutput {
    param([Parameter(Mandatory)] [string]$RawOutput)

    $devices = New-Object System.Collections.Generic.List[pscustomobject]
    if ([string]::IsNullOrWhiteSpace($RawOutput)) {
        return @($devices)
    }

    foreach ($line in ($RawOutput -split "`r?`n")) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
        if ($trimmed -eq "List of devices attached") { continue }
        if ($trimmed.StartsWith("*")) { continue }

        $parts = $trimmed -split "\s+"
        if ($parts.Count -lt 2) { continue }

        [void]$devices.Add([pscustomobject]@{
            Serial = $parts[0]
            State  = $parts[1]
        })
    }

    return @($devices)
}
```

- [ ] **Step 2: Write the test file exercising the three parsers**

Create `tests\retk-ldplayer.Tests.ps1`:

```powershell
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
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-ldplayer.Tests.ps1`
Expected: `retk-ldplayer checks passed` printed, exit code 0.

- [ ] **Step 4: Syntax-check both files**

Run:
```powershell
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("scripts\retk-ldplayer.ps1", [ref]$null, [ref]$errors) | Out-Null
if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Host $_.Message } } else { Write-Host "OK" }
```
Expected: `OK` for both `scripts\retk-ldplayer.ps1` and `tests\retk-ldplayer.Tests.ps1`.

- [ ] **Step 5: Commit**

```bash
git add scripts/retk-ldplayer.ps1 tests/retk-ldplayer.Tests.ps1
git commit -m "Add LDPlayer adb-output parsers with tests"
```

---

### Task 2: adb/device discovery (`Resolve-LdPlayerAdb`, `Resolve-LdPlayerDevice`)

**Files:**
- Modify: `scripts\retk-ldplayer.ps1` (append)
- Modify: `tests\retk-ldplayer.Tests.ps1` (append, before the final `Write-Host "retk-ldplayer checks passed"` line)

**Interfaces:**
- Consumes: `ConvertFrom-AdbDevicesOutput` (Task 1)
- Consumes: `Invoke-NativeProcess -FilePath <string> -Arguments <string[]> [-WorkingDirectory <string>]` → `[pscustomobject]@{ ExitCode; Lines; StdOut; StdErr; Command }` (`scripts\retk-process.ps1`, already in the codebase)
- Produces: `Resolve-LdPlayerAdb [-AdbPath <string>]` → `string` (resolved path to `adb.exe`), throws if not found
- Produces: `Resolve-LdPlayerDevice -AdbPath <string> [-DeviceSerial <string>]` → `string` (device serial), throws if none connected

- [ ] **Step 1: Append the two functions to `scripts\retk-ldplayer.ps1`**

Append to the end of `scripts\retk-ldplayer.ps1`:

```powershell

function Resolve-LdPlayerAdb {
    param([string]$AdbPath = "")

    if (-not [string]::IsNullOrWhiteSpace($AdbPath)) {
        if (-not (Test-Path -LiteralPath $AdbPath -PathType Leaf)) {
            throw "adb.exe not found at -AdbPath: $AdbPath"
        }
        return (Resolve-Path -LiteralPath $AdbPath).Path
    }

    $onPath = Get-Command "adb" -ErrorAction SilentlyContinue
    if ($onPath) {
        return $onPath.Source
    }

    $candidates = @(
        "C:\LDPlayer\LDPlayer9\adb.exe",
        "C:\LDPlayer\LDPlayer4\adb.exe",
        "C:\Program Files\LDPlayer\LDPlayer9\adb.exe",
        "C:\Program Files\LDPlayer\LDPlayer4\adb.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    throw "adb.exe not found on PATH or in common LDPlayer install locations. Pass -AdbPath <path-to-adb.exe>."
}

function Resolve-LdPlayerDevice {
    param(
        [Parameter(Mandatory)] [string]$AdbPath,
        [string]$DeviceSerial = ""
    )

    if (-not [string]::IsNullOrWhiteSpace($DeviceSerial)) {
        return $DeviceSerial
    }

    $result = Invoke-NativeProcess -FilePath $AdbPath -Arguments @("devices")
    if ($result.ExitCode -ne 0) {
        throw "adb devices failed with exit code $($result.ExitCode).`n$($result.StdErr)"
    }

    $devices = @(ConvertFrom-AdbDevicesOutput -RawOutput $result.StdOut | Where-Object { $_.State -eq "device" })

    if ($devices.Count -eq 0) {
        throw "No LDPlayer device connected. Start LDPlayer and wait for it to finish booting, then retry."
    }

    if ($devices.Count -eq 1) {
        return $devices[0].Serial
    }

    Write-Host "Multiple devices connected:" -ForegroundColor Cyan
    for ($i = 0; $i -lt $devices.Count; $i++) {
        Write-Host ("  [{0}] {1}" -f $i, $devices[$i].Serial)
    }
    $choice = Read-Host "Select a device by index"
    $index = 0
    if (-not [int]::TryParse($choice, [ref]$index) -or $index -lt 0 -or $index -ge $devices.Count) {
        throw "Invalid device selection: $choice"
    }
    return $devices[$index].Serial
}
```

`Invoke-NativeProcess` requires `Test-Path -LiteralPath $FilePath` to succeed on the executable itself (it throws otherwise) — this is why `Resolve-LdPlayerAdb` must run and return a real, existing path before any `Invoke-NativeProcess -FilePath $adb ...` call.

- [ ] **Step 2: Append regression-guard assertions to `tests\retk-ldplayer.Tests.ps1`**

These two functions call `adb`, so they can't get real executed tests without a device. Add source-text presence checks instead, matching the pattern in `tests\retk-mcp-first.Tests.ps1`. Insert this block into `tests\retk-ldplayer.Tests.ps1` immediately before the final `Write-Host "retk-ldplayer checks passed"` line:

```powershell

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
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-ldplayer.Tests.ps1`
Expected: `retk-ldplayer checks passed`, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/retk-ldplayer.ps1 tests/retk-ldplayer.Tests.ps1
git commit -m "Add LDPlayer adb/device discovery"
```

---

### Task 3: Package + APK/OBB listing (`Assert-LdPlayerPackageInstalled`, `Get-LdPlayerApkPaths`, `Get-LdPlayerObbPaths`)

**Files:**
- Modify: `scripts\retk-ldplayer.ps1` (append)
- Modify: `tests\retk-ldplayer.Tests.ps1` (append, before the final `Write-Host` line)

**Interfaces:**
- Consumes: `ConvertFrom-PmListPackagesOutput`, `ConvertFrom-PmPathOutput` (Task 1), `Invoke-NativeProcess` (Task 2 context)
- Produces: `Assert-LdPlayerPackageInstalled -AdbPath <string> -DeviceSerial <string> -PackageName <string>` → nothing (throws on failure)
- Produces: `Get-LdPlayerApkPaths -AdbPath <string> -DeviceSerial <string> -PackageName <string>` → `string[]` (remote APK paths)
- Produces: `Get-LdPlayerObbPaths -AdbPath <string> -DeviceSerial <string> -PackageName <string>` → `string[]` (remote OBB paths, empty array if none)

- [ ] **Step 1: Append the three functions to `scripts\retk-ldplayer.ps1`**

```powershell

function Assert-LdPlayerPackageInstalled {
    param(
        [Parameter(Mandatory)] [string]$AdbPath,
        [Parameter(Mandatory)] [string]$DeviceSerial,
        [Parameter(Mandatory)] [string]$PackageName
    )

    $result = Invoke-NativeProcess -FilePath $AdbPath -Arguments @("-s", $DeviceSerial, "shell", "pm", "list", "packages", $PackageName)
    if ($result.ExitCode -ne 0) {
        throw "adb shell pm list packages failed with exit code $($result.ExitCode).`n$($result.StdErr)"
    }

    $exactMatches = @(ConvertFrom-PmListPackagesOutput -RawOutput $result.StdOut)
    if ($exactMatches -contains $PackageName) {
        return
    }

    $allResult = Invoke-NativeProcess -FilePath $AdbPath -Arguments @("-s", $DeviceSerial, "shell", "pm", "list", "packages")
    $allPackages = @(ConvertFrom-PmListPackagesOutput -RawOutput $allResult.StdOut)
    $needle = $PackageName.ToLowerInvariant()
    $suggestions = @($allPackages | Where-Object { $_.ToLowerInvariant().Contains($needle) })

    $message = "Package not installed: $PackageName"
    if ($suggestions.Count -gt 0) {
        $message += "`nSimilarly named installed packages:`n  " + ($suggestions -join "`n  ")
    }
    throw $message
}

function Get-LdPlayerApkPaths {
    param(
        [Parameter(Mandatory)] [string]$AdbPath,
        [Parameter(Mandatory)] [string]$DeviceSerial,
        [Parameter(Mandatory)] [string]$PackageName
    )

    $result = Invoke-NativeProcess -FilePath $AdbPath -Arguments @("-s", $DeviceSerial, "shell", "pm", "path", $PackageName)
    if ($result.ExitCode -ne 0) {
        throw "adb shell pm path failed with exit code $($result.ExitCode).`n$($result.StdErr)"
    }

    $paths = @(ConvertFrom-PmPathOutput -RawOutput $result.StdOut)
    if ($paths.Count -eq 0) {
        throw "pm path returned no APK paths for $PackageName even though the package is installed."
    }

    return $paths
}

function Get-LdPlayerObbPaths {
    param(
        [Parameter(Mandatory)] [string]$AdbPath,
        [Parameter(Mandatory)] [string]$DeviceSerial,
        [Parameter(Mandatory)] [string]$PackageName
    )

    $remoteDir = "/sdcard/Android/obb/$PackageName"
    $result = Invoke-NativeProcess -FilePath $AdbPath -Arguments @("-s", $DeviceSerial, "shell", "ls", $remoteDir)

    $isMissing = ($result.StdOut -match "No such file or directory") -or ($result.StdErr -match "No such file or directory")
    if ($isMissing) {
        Write-Host "  [INFO] No OBB directory found for $PackageName (this is normal for many games)." -ForegroundColor DarkGray
        return @()
    }
    if ($result.ExitCode -ne 0) {
        throw "adb shell ls failed with exit code $($result.ExitCode).`n$($result.StdErr)"
    }

    $names = @($result.Lines | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    return @($names | ForEach-Object { "$remoteDir/$_" })
}
```

- [ ] **Step 2: Append regression-guard assertions to `tests\retk-ldplayer.Tests.ps1`**

Insert before the final `Write-Host "retk-ldplayer checks passed"` line (after the Task 2 block):

```powershell

Assert-Contains $moduleSource 'function Assert-LdPlayerPackageInstalled' "Module should expose Assert-LdPlayerPackageInstalled."
Assert-Contains $moduleSource 'function Get-LdPlayerApkPaths' "Module should expose Get-LdPlayerApkPaths."
Assert-Contains $moduleSource 'function Get-LdPlayerObbPaths' "Module should expose Get-LdPlayerObbPaths."
Assert-Contains $moduleSource 'Similarly named installed packages' "Assert-LdPlayerPackageInstalled should suggest similarly named packages on a miss."
Assert-Contains $moduleSource 'No OBB directory found' "Get-LdPlayerObbPaths should treat a missing OBB directory as informational, not an error."
```

`$moduleSource` must be re-read after Task 2's Step 1 append if the test file was regenerated from scratch; since this task only appends further assertions to the same already-loaded `$moduleSource` variable, no re-read is needed as long as Task 2's `$moduleSource = Get-Content ...` line stays above this block.

- [ ] **Step 3: Run the test to verify it passes**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-ldplayer.Tests.ps1`
Expected: `retk-ldplayer checks passed`, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/retk-ldplayer.ps1 tests/retk-ldplayer.Tests.ps1
git commit -m "Add LDPlayer package/APK/OBB listing"
```

---

### Task 4: App launch + bundle creation (`Invoke-LdPlayerAppLaunch`, `Save-LdPlayerBundle`)

**Files:**
- Modify: `scripts\retk-ldplayer.ps1` (append)
- Modify: `tests\retk-ldplayer.Tests.ps1` (append, before the final `Write-Host` line)

**Interfaces:**
- Consumes: `Invoke-NativeProcess` (Task 2 context)
- Produces: `Invoke-LdPlayerAppLaunch -AdbPath <string> -DeviceSerial <string> -PackageName <string>` → nothing; pauses on `Read-Host`
- Produces: `Save-LdPlayerBundle -AdbPath <string> -DeviceSerial <string> -PackageName <string> -ApkPaths <string[]> -ObbPaths <string[]>` → `string` (path to the created `.zip`)

- [ ] **Step 1: Append the two functions to `scripts\retk-ldplayer.ps1`**

```powershell

function Invoke-LdPlayerAppLaunch {
    param(
        [Parameter(Mandatory)] [string]$AdbPath,
        [Parameter(Mandatory)] [string]$DeviceSerial,
        [Parameter(Mandatory)] [string]$PackageName
    )

    $result = Invoke-NativeProcess -FilePath $AdbPath -Arguments @("-s", $DeviceSerial, "shell", "monkey", "-p", $PackageName, "-c", "android.intent.category.LAUNCHER", "1")
    if ($result.ExitCode -ne 0) {
        throw "Failed to launch $PackageName via adb shell monkey.`n$($result.StdErr)"
    }

    Write-Host ""
    Write-Host "Launched $PackageName in LDPlayer." -ForegroundColor Cyan
    Write-Host "Play/wait long enough for any OBB or feature-module downloads to finish, then come back here." -ForegroundColor Cyan
    Read-Host "Press Enter when ready to pull"
}

function Save-LdPlayerBundle {
    param(
        [Parameter(Mandatory)] [string]$AdbPath,
        [Parameter(Mandatory)] [string]$DeviceSerial,
        [Parameter(Mandatory)] [string]$PackageName,
        [Parameter(Mandatory)] [string[]]$ApkPaths,
        [Parameter(Mandatory)] [string[]]$ObbPaths
    )

    $stagingDir = Join-Path $env:TEMP ("retk-ldplayer-" + [guid]::NewGuid().ToString("N"))
    $obbStagingDir = Join-Path $stagingDir ("Android\obb\" + $PackageName)
    $zipPath = Join-Path $env:TEMP ("retk-ldplayer-bundle-" + [guid]::NewGuid().ToString("N") + ".zip")

    try {
        New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

        foreach ($remotePath in $ApkPaths) {
            $localName = Split-Path -Leaf $remotePath
            $localPath = Join-Path $stagingDir $localName
            $pullResult = Invoke-NativeProcess -FilePath $AdbPath -Arguments @("-s", $DeviceSerial, "pull", $remotePath, $localPath)
            if ($pullResult.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $localPath)) {
                throw "adb pull failed for ${remotePath}:`n$($pullResult.StdErr)"
            }
        }

        if ($ObbPaths.Count -gt 0) {
            New-Item -ItemType Directory -Path $obbStagingDir -Force | Out-Null
            foreach ($remotePath in $ObbPaths) {
                $localName = Split-Path -Leaf $remotePath
                $localPath = Join-Path $obbStagingDir $localName
                $pullResult = Invoke-NativeProcess -FilePath $AdbPath -Arguments @("-s", $DeviceSerial, "pull", $remotePath, $localPath)
                if ($pullResult.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $localPath)) {
                    throw "adb pull failed for ${remotePath}:`n$($pullResult.StdErr)"
                }
            }
        }

        if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
        [System.IO.Compression.ZipFile]::CreateFromDirectory($stagingDir, $zipPath)

        return $zipPath
    }
    finally {
        if (Test-Path -LiteralPath $stagingDir) {
            Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
```

- [ ] **Step 2: Append regression-guard assertions to `tests\retk-ldplayer.Tests.ps1`**

```powershell

Assert-Contains $moduleSource 'function Invoke-LdPlayerAppLaunch' "Module should expose Invoke-LdPlayerAppLaunch."
Assert-Contains $moduleSource 'function Save-LdPlayerBundle' "Module should expose Save-LdPlayerBundle."
Assert-Contains $moduleSource 'Read-Host "Press Enter when ready to pull"' "Invoke-LdPlayerAppLaunch should pause for user confirmation before the caller pulls files."
Assert-Contains $moduleSource '[guid]::NewGuid().ToString("N")' "Save-LdPlayerBundle temp paths should include a GUID to avoid collisions across overlapping runs."
Assert-Contains $moduleSource '[System.IO.Compression.ZipFile]::CreateFromDirectory($stagingDir, $zipPath)' "Save-LdPlayerBundle should zip the staged APK/OBB files."
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-ldplayer.Tests.ps1`
Expected: `retk-ldplayer checks passed`, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/retk-ldplayer.ps1 tests/retk-ldplayer.Tests.ps1
git commit -m "Add LDPlayer app launch and bundle creation"
```

---

### Task 5: Orchestrator (`Invoke-LdPlayerPull`)

**Files:**
- Modify: `scripts\retk-ldplayer.ps1` (append)
- Modify: `tests\retk-ldplayer.Tests.ps1` (append, before the final `Write-Host` line)

**Interfaces:**
- Consumes: `Get-ProjectJsonPath`, `New-Workspace`, `Get-WorkspacePath`, `Add-BuildToProject` (all in `scripts\retk-project.ps1`, already in the codebase)
- Consumes: `Resolve-LdPlayerAdb`, `Resolve-LdPlayerDevice`, `Assert-LdPlayerPackageInstalled`, `Get-LdPlayerApkPaths`, `Get-LdPlayerObbPaths`, `Invoke-LdPlayerAppLaunch`, `Save-LdPlayerBundle` (Tasks 2-4)
- Produces: `Invoke-LdPlayerPull -GameName <string> -PackageName <string> [-DeviceSerial <string>] [-AdbPath <string>] [-SkipLaunch]` → nothing; ends with the workspace scanned via `Add-BuildToProject`

- [ ] **Step 1: Append the orchestrator to `scripts\retk-ldplayer.ps1`**

```powershell

function Invoke-LdPlayerPull {
    param(
        [Parameter(Mandatory)] [string]$GameName,
        [Parameter(Mandatory)] [string]$PackageName,
        [string]$DeviceSerial = "",
        [string]$AdbPath = "",
        [switch]$SkipLaunch
    )

    if (-not (Test-Path -LiteralPath (Get-ProjectJsonPath $GameName))) {
        Write-Host "[INFO] Workspace not found; running init first." -ForegroundColor Cyan
        New-Workspace $GameName
    }

    $adb = Resolve-LdPlayerAdb -AdbPath $AdbPath
    $serial = Resolve-LdPlayerDevice -AdbPath $adb -DeviceSerial $DeviceSerial
    Assert-LdPlayerPackageInstalled -AdbPath $adb -DeviceSerial $serial -PackageName $PackageName

    $apksBefore = @(Get-LdPlayerApkPaths -AdbPath $adb -DeviceSerial $serial -PackageName $PackageName)

    if (-not $SkipLaunch) {
        Invoke-LdPlayerAppLaunch -AdbPath $adb -DeviceSerial $serial -PackageName $PackageName
    }

    $apksAfter = @(Get-LdPlayerApkPaths -AdbPath $adb -DeviceSerial $serial -PackageName $PackageName)
    $allApks = @(@($apksBefore) + @($apksAfter) | Select-Object -Unique)

    $obbPaths = @(Get-LdPlayerObbPaths -AdbPath $adb -DeviceSerial $serial -PackageName $PackageName)

    Write-Host ("Pulling {0} APK(s) and {1} OBB file(s)..." -f $allApks.Count, $obbPaths.Count) -ForegroundColor Cyan
    $tempZip = Save-LdPlayerBundle -AdbPath $adb -DeviceSerial $serial -PackageName $PackageName -ApkPaths $allApks -ObbPaths $obbPaths

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $originalBuildDir = Join-Path (Get-WorkspacePath $GameName) "00_OriginalBuild"
    New-Item -ItemType Directory -Force -Path $originalBuildDir | Out-Null
    $bundlePath = Join-Path $originalBuildDir ("{0}-{1}.xapk" -f $PackageName, $stamp)
    Move-Item -LiteralPath $tempZip -Destination $bundlePath -Force

    Write-Host ("  [OK]   Bundle saved: {0}" -f $bundlePath) -ForegroundColor Green
    Write-Host ("         {0} APK(s), {1} OBB file(s)" -f $allApks.Count, $obbPaths.Count) -ForegroundColor Cyan

    Add-BuildToProject $GameName $bundlePath
}
```

- [ ] **Step 2: Append regression-guard assertions to `tests\retk-ldplayer.Tests.ps1`**

```powershell

Assert-Contains $moduleSource 'function Invoke-LdPlayerPull' "Module should expose Invoke-LdPlayerPull."
Assert-Contains $moduleSource 'New-Workspace $GameName' "Invoke-LdPlayerPull should auto-init the workspace if missing, matching Add-BuildToProject's convention."
Assert-Contains $moduleSource '"00_OriginalBuild"' "Invoke-LdPlayerPull should save the pulled bundle under 00_OriginalBuild."
Assert-Contains $moduleSource 'Add-BuildToProject $GameName $bundlePath' "Invoke-LdPlayerPull should hand off to the existing extract/flatten/scan pipeline."
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-ldplayer.Tests.ps1`
Expected: `retk-ldplayer checks passed`, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/retk-ldplayer.ps1 tests/retk-ldplayer.Tests.ps1
git commit -m "Add LDPlayer pull orchestrator"
```

---

### Task 6: Wire into `re.ps1` and `Show-Usage`

**Files:**
- Modify: `re.ps1:69-77` (module list), `re.ps1` (new dispatcher case, insert after the `"add"` case at what is currently line 108)
- Modify: `scripts\retk-ui.ps1:9` (append a usage line after the `add` line)
- Modify: `tests\retk-mcp-first.Tests.ps1` (append regression guards)

**Interfaces:**
- Consumes: `Invoke-LdPlayerPull` (Task 5)

- [ ] **Step 1: Register the new module in `re.ps1`**

In `re.ps1`, change:

```powershell
$RetkScriptModules = @(
    "scripts\retk-core.ps1",
    "scripts\retk-process.ps1",
    "scripts\retk-il2cpp.ps1",
    "scripts\retk-pyghidra.ps1",
    "scripts\retk-project.ps1",
    "scripts\retk-pipeline.ps1",
    "scripts\retk-ui.ps1"
)
```

to:

```powershell
$RetkScriptModules = @(
    "scripts\retk-core.ps1",
    "scripts\retk-process.ps1",
    "scripts\retk-il2cpp.ps1",
    "scripts\retk-pyghidra.ps1",
    "scripts\retk-project.ps1",
    "scripts\retk-pipeline.ps1",
    "scripts\retk-ldplayer.ps1",
    "scripts\retk-ui.ps1"
)
```

- [ ] **Step 2: Add the dispatcher case in `re.ps1`**

Immediately after this existing line (currently line 108):

```powershell
    "add"        { if (-not $Rest[0] -or -not $Rest[1]) { throw "Usage: .\re.ps1 add <GameName> <apk-or-xapk-or-aab-or-zip>" } Add-BuildToProject $Rest[0] $Rest[1] }
```

insert:

```powershell
    "pull-ldplayer" {
        if ($Rest.Count -lt 2) { throw "Usage: .\re.ps1 pull-ldplayer <GameName> <PackageName> [-DeviceSerial <serial>] [-AdbPath <path>] [-SkipLaunch]" }
        $gameName = $Rest[0]
        $packageName = $Rest[1]
        $deviceSerial = ""
        $adbPath = ""
        $skipLaunch = $false
        $i = 2
        while ($i -lt $Rest.Count) {
            switch ($Rest[$i]) {
                "-DeviceSerial" {
                    $i++
                    if ($i -ge $Rest.Count) { throw "-DeviceSerial requires a value." }
                    $deviceSerial = $Rest[$i]
                }
                "-AdbPath" {
                    $i++
                    if ($i -ge $Rest.Count) { throw "-AdbPath requires a value." }
                    $adbPath = $Rest[$i]
                }
                "-SkipLaunch" { $skipLaunch = $true }
                default { throw "Unknown pull-ldplayer option: $($Rest[$i])" }
            }
            $i++
        }
        Invoke-LdPlayerPull -GameName $gameName -PackageName $packageName -DeviceSerial $deviceSerial -AdbPath $adbPath -SkipLaunch:$skipLaunch
    }
```

- [ ] **Step 3: Add the usage line in `scripts\retk-ui.ps1`**

Change:

```powershell
    Write-Host "  .\re.ps1 add        <GameName> <apk-or-xapk-or-aab-or-zip>"
    Write-Host "  .\re.ps1 scan       <GameName> <ExtractedPath>"
```

to:

```powershell
    Write-Host "  .\re.ps1 add        <GameName> <apk-or-xapk-or-aab-or-zip>"
    Write-Host "  .\re.ps1 pull-ldplayer <GameName> <PackageName>        # pull APK/OBB from a running LDPlayer instance"
    Write-Host "  .\re.ps1 scan       <GameName> <ExtractedPath>"
```

- [ ] **Step 4: Add regression-guard assertions to `tests\retk-mcp-first.Tests.ps1`**

Append near the other `Assert-Contains $re ...` lines (this file already reads `$re = Read-Text "re.ps1"` near its top):

```powershell
Assert-Contains $re 'scripts\retk-ldplayer.ps1' "re.ps1 should load the LDPlayer pull module."
Assert-Contains $re '"pull-ldplayer"' "re.ps1 should expose a pull-ldplayer command."
Assert-Contains $re 'Invoke-LdPlayerPull -GameName $gameName -PackageName $packageName' "re.ps1 pull-ldplayer should call Invoke-LdPlayerPull with parsed arguments."
Assert-Contains $uiModule 'pull-ldplayer <GameName> <PackageName>' "UI module should document the pull-ldplayer command."
```

(`$uiModule` already exists in this file as `Read-Text "scripts\retk-ui.ps1"`.)

- [ ] **Step 5: Run both affected test files**

Run:
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-mcp-first.Tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-ldplayer.Tests.ps1
```
Expected: both print their `... checks passed` line, exit code 0 each.

- [ ] **Step 6: Syntax-check `re.ps1`**

Run:
```powershell
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile("re.ps1", [ref]$null, [ref]$errors) | Out-Null
if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Host $_.Message } } else { Write-Host "OK" }
```
Expected: `OK`.

- [ ] **Step 7: Commit**

```bash
git add re.ps1 scripts/retk-ui.ps1 tests/retk-mcp-first.Tests.ps1
git commit -m "Wire pull-ldplayer into re.ps1 dispatcher and usage"
```

---

### Task 7: Documentation (README.md, Tutorial.md)

**Files:**
- Modify: `README.md` (command table + new section)
- Modify: `Tutorial.md:127-140` (Quick Start build-input section)
- Modify: `tests\retk-mcp-first.Tests.ps1` (append regression guards)

**Interfaces:** none (documentation only)

- [ ] **Step 1: Add a command table row in `README.md`**

In the `## re.ps1 Commands` table, immediately after this row:

```markdown
| `add <GameName> <apk/xapk/aab/zip>` | Extract a build into `01_Extracted`, then scan. |
```

insert:

```markdown
| `pull-ldplayer <GameName> <PackageName>` | Pull base+split APKs and OBB files from a running LDPlayer instance, then extract/scan like `add`. |
```

- [ ] **Step 2: Add a new `README.md` section**

Insert a new section right after the existing `## Quick Start` section (after its closing numbered list, before `## re.ps1 Commands`):

```markdown
## Pull An APK From LDPlayer

If a game is only installed through the Play Store inside LDPlayer, pull it
directly from a running instance instead of finding an APK file by hand:

```powershell
.\re.ps1 pull-ldplayer FoodHunt com.example.foodhunt
```

This auto-detects `adb.exe` and the running LDPlayer device, opens the app so
any OBB or dynamic-feature-module downloads can trigger, waits for
confirmation, then pulls the base APK, all split APKs, and any OBB files into
`workspaces\FoodHunt\00_OriginalBuild\` and runs the same extract/scan `add`
does. The workspace is ready for `dump` when the command returns.

Options:

```text
-DeviceSerial <serial>   # target a specific device when multiple are connected
-AdbPath <path>          # use a specific adb.exe instead of auto-detecting
-SkipLaunch              # skip opening the app (use when OBB/modules are already downloaded)
```

This command is interactive: it needs LDPlayer open with the game installed
and a human to actually play long enough for background downloads to finish.
It does not pull app-private data under `/data/data/<package>/`.
```

- [ ] **Step 3: Add a mention in `Tutorial.md`**

In `Tutorial.md`, section `## 4. Prepare A Game Project`, immediately after this block:

```markdown
For an already extracted folder:

```powershell
.\re.ps1 flow FoodHunt "D:\Path\To\FoodHunt_Extracted"
```
```

insert:

```markdown
If you do not have a build file and the game is only installed through the
Play Store inside LDPlayer, pull it from a running instance first:

```powershell
.\re.ps1 pull-ldplayer FoodHunt com.example.foodhunt
```

This pulls the base APK, split APKs, and OBB files, then runs the same
extract/scan step `flow` does — run `flow`/`dump`/`open` normally afterward.
```

- [ ] **Step 4: Add regression-guard assertions to `tests\retk-mcp-first.Tests.ps1`**

Append near the other `Assert-Contains $readme ...` / `Assert-Contains $tutorial ...` lines:

```powershell
Assert-Contains $readme 'pull-ldplayer <GameName> <PackageName>' "README should document the pull-ldplayer command."
Assert-Contains $readme '## Pull An APK From LDPlayer' "README should have a dedicated LDPlayer pull section."
Assert-Contains $tutorial '.\re.ps1 pull-ldplayer FoodHunt com.example.foodhunt' "Tutorial should show how to pull a build from LDPlayer."
```

- [ ] **Step 5: Run the affected test file**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-mcp-first.Tests.ps1`
Expected: `retk-mcp-first checks passed`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add README.md Tutorial.md tests/retk-mcp-first.Tests.ps1
git commit -m "Document pull-ldplayer in README and Tutorial"
```

---

## Manual Verification (post-implementation, not automatable)

Run once against a real LDPlayer instance before considering this feature done (from the design spec's Testing section):

- [ ] Game with a single APK (no split APKs), no OBB.
- [ ] Game installed from an AAB (multiple `split_config.*.apk`).
- [ ] Game with an OBB expansion file.
- [ ] Game with a Play Feature Delivery module that only appears after first launch (verify the pass-2 `Get-LdPlayerApkPaths` call picks it up).
- [ ] Typo'd package name (verify the suggestion list is useful).
- [ ] `adb.exe` not on PATH and not in a default LDPlayer location (verify the error message and `-AdbPath` override both work).
- [ ] Re-run with `-SkipLaunch` against an already-fully-downloaded game.
