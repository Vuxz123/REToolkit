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
