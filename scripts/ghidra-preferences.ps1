[CmdletBinding()]
param()

function ConvertTo-GhidraPreferencePathValue {
    param([Parameter(Mandatory)] [string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\','/'))
    return (($fullPath -replace '\\', '\\') -replace ':', '\:')
}

function ConvertFrom-GhidraPreferenceValue {
    param([Parameter()] [string]$Value)

    if ($null -eq $Value) { return "" }

    $builder = New-Object System.Text.StringBuilder
    $escaped = $false
    foreach ($ch in $Value.ToCharArray()) {
        if ($escaped) {
            switch ($ch) {
                't' { [void]$builder.Append("`t") }
                'r' { [void]$builder.Append("`r") }
                'n' { [void]$builder.Append("`n") }
                'f' { [void]$builder.Append("`f") }
                default { [void]$builder.Append($ch) }
            }
            $escaped = $false
            continue
        }

        if ($ch -eq '\') {
            $escaped = $true
            continue
        }

        [void]$builder.Append($ch)
    }

    if ($escaped) {
        [void]$builder.Append('\')
    }

    return $builder.ToString()
}

function ConvertTo-GhidraProjectDirectoryValue {
    param([Parameter(Mandatory)] [string]$ProjectDir)

    $fullPath = [System.IO.Path]::GetFullPath($ProjectDir).TrimEnd([char[]]@('\','/'))
    $slashPath = $fullPath -replace '\\', '/'

    if ($slashPath -match '^([A-Za-z]):(.*)$') {
        return ("/{0}\:{1}/" -f $Matches[1], $Matches[2].TrimEnd('/'))
    }

    return ($slashPath.TrimEnd('/') + '/')
}

function Read-GhidraPreferencesLines {
    param([Parameter(Mandatory)] [string]$PreferencesPath)

    if (Test-Path -LiteralPath $PreferencesPath -PathType Leaf) {
        return @(Get-Content -LiteralPath $PreferencesPath)
    }

    return @(
        "#User Preferences",
        ("#{0}" -f (Get-Date).ToString("ddd MMM dd HH:mm:ss zzz yyyy"))
    )
}

function Set-GhidraPreferenceLine {
    param(
        [Parameter(Mandatory)] [System.Collections.Generic.List[string]]$Lines,
        [Parameter(Mandatory)] [string]$Key,
        [Parameter(Mandatory)] [string]$Value
    )

    $line = "{0}={1}" -f $Key, $Value
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        if ($Lines[$i] -match ("^{0}=" -f [regex]::Escape($Key))) {
            if ($Lines[$i] -eq $line) {
                return $false
            }

            $Lines[$i] = $line
            return $true
        }
    }

    [void]$Lines.Add($line)
    return $true
}

function Set-GhidraDefaultProjectPreference {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$PreferencesPath,
        [Parameter(Mandatory)] [string]$ProjectDir,
        [Parameter(Mandatory)] [string]$ProjectName,
        [int]$MaxRecentProjects = 10
    )

    $fullProjectDir = [System.IO.Path]::GetFullPath($ProjectDir).TrimEnd([char[]]@('\','/'))
    $projectPath = Join-Path $fullProjectDir $ProjectName
    $projectValue = ConvertTo-GhidraPreferencePathValue -Path $projectPath
    $projectDirValue = ConvertTo-GhidraPreferencePathValue -Path $fullProjectDir
    $projectDirectoryValue = ConvertTo-GhidraProjectDirectoryValue -ProjectDir $fullProjectDir

    $rawLines = Read-GhidraPreferencesLines -PreferencesPath $PreferencesPath
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($rawLine in $rawLines) {
        [void]$lines.Add([string]$rawLine)
    }

    $recentExisting = @()
    foreach ($line in $lines) {
        if ($line -match '^RecentProjects=(.*)$') {
            $recentExisting = @($Matches[1] -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
            break
        }
    }

    $projectPlain = ConvertFrom-GhidraPreferenceValue -Value $projectValue
    $recentValues = New-Object System.Collections.Generic.List[string]
    [void]$recentValues.Add($projectValue)
    foreach ($existing in $recentExisting) {
        $existingPlain = ConvertFrom-GhidraPreferenceValue -Value $existing
        if ($existingPlain.Equals($projectPlain, [System.StringComparison]::OrdinalIgnoreCase)) {
            continue
        }
        [void]$recentValues.Add($existing)
        if ($recentValues.Count -ge $MaxRecentProjects) {
            break
        }
    }

    $changed = $false
    $changed = (Set-GhidraPreferenceLine -Lines $lines -Key "LastOpenedProject" -Value $projectValue) -or $changed
    $changed = (Set-GhidraPreferenceLine -Lines $lines -Key "LastSelectedProjectDirectory" -Value $projectDirValue) -or $changed
    $changed = (Set-GhidraPreferenceLine -Lines $lines -Key "ProjectDirectory" -Value $projectDirectoryValue) -or $changed
    $changed = (Set-GhidraPreferenceLine -Lines $lines -Key "RECENT_0" -Value $projectDirValue) -or $changed
    $changed = (Set-GhidraPreferenceLine -Lines $lines -Key "RecentProjects" -Value ($recentValues -join ';')) -or $changed

    if ($changed) {
        $parent = Split-Path -Parent $PreferencesPath
        if ($parent) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($PreferencesPath, (($lines -join "`r`n").TrimEnd() + "`r`n"), $utf8NoBom)
    }

    return [pscustomobject]@{
        Changed         = $changed
        PreferencesPath = $PreferencesPath
        ProjectDir      = $fullProjectDir
        ProjectName     = $ProjectName
        ProjectPath     = $projectPath
    }
}

function Get-GhidraPreferencesPath {
    param(
        [Parameter(Mandatory)] [string]$GhidraRoot,
        [string]$ApplicationDataRoot = ""
    )

    $settingsDir = Get-GhidraUserSettingsDir -GhidraRoot $GhidraRoot -ApplicationDataRoot $ApplicationDataRoot
    if ([string]::IsNullOrWhiteSpace($settingsDir)) {
        return ""
    }

    return (Join-Path $settingsDir "preferences")
}
