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
