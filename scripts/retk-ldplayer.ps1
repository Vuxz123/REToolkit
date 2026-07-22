# Dot-sourced by re.ps1. Uses shared REToolkit variables from the entrypoint.

function ConvertFrom-PmPathOutput {
    param([Parameter(Mandatory)] [AllowEmptyString()] [string]$RawOutput)

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
    param([Parameter(Mandatory)] [AllowEmptyString()] [string]$RawOutput)

    # `pm list packages` and `pm path` both emit "package:<value>" lines;
    # the parsing is identical, only the meaning of <value> differs.
    return ConvertFrom-PmPathOutput -RawOutput $RawOutput
}

function ConvertFrom-AdbDevicesOutput {
    param([Parameter(Mandatory)] [AllowEmptyString()] [string]$RawOutput)

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
                throw "adb pull failed for ${remotePath} (exit code $($pullResult.ExitCode)):`n$($pullResult.StdErr)"
            }
        }

        if ($ObbPaths.Count -gt 0) {
            New-Item -ItemType Directory -Path $obbStagingDir -Force | Out-Null
            foreach ($remotePath in $ObbPaths) {
                $localName = Split-Path -Leaf $remotePath
                $localPath = Join-Path $obbStagingDir $localName
                $pullResult = Invoke-NativeProcess -FilePath $AdbPath -Arguments @("-s", $DeviceSerial, "pull", $remotePath, $localPath)
                if ($pullResult.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $localPath)) {
                    throw "adb pull failed for ${remotePath} (exit code $($pullResult.ExitCode)):`n$($pullResult.StdErr)"
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
