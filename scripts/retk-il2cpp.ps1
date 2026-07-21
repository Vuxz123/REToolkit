# Dot-sourced by re.ps1. Uses shared REToolkit variables from the entrypoint.

function Get-Il2CppDumperGhidraTemplateRoot {
    return (Join-Path $Root "templates\Il2CppDumper")
}

function Get-Il2CppDumperGhidraTemplate {
    param([Parameter(Mandatory)] [string]$Name)

    $templateRoot = Get-Il2CppDumperGhidraTemplateRoot
    $templatePath = Join-Path $templateRoot $Name
    if (-not (Test-Path -LiteralPath $templatePath)) {
        throw "Il2CppDumper Ghidra template missing: $templatePath"
    }

    return Get-Content -LiteralPath $templatePath -Raw
}

function Repair-Il2CppGhidraScript {
    param([Parameter(Mandatory)] [string]$Path)

    $name = Split-Path -Leaf $Path
    $replacement = Get-Il2CppDumperGhidraTemplate -Name $name
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }

    $text = if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path -Raw } else { "" }

    if ($text -ne $replacement) {
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($Path, $replacement, $utf8NoBom)
        Write-Host ("  [FIX] Replaced Il2CppDumper {0} with PyGhidra/Python 3 template: {1}" -f $name, $Path) -ForegroundColor Cyan
        return $true
    }

    return $false
}

function Repair-Il2CppDumperGhidraTemplates {
    param([Parameter(Mandatory)] [string]$Dir)

    $changed = $false
    foreach ($name in @("ghidra.py", "ghidra_with_struct.py")) {
        if (Repair-Il2CppGhidraScript -Path (Join-Path $Dir $name)) {
            $changed = $true
        }
    }
    return $changed
}

function Ensure-Il2CppDumperGhidraScriptBundle {
    if (-not (Get-Command "Register-GhidraScriptBundle" -CommandType Function -ErrorAction SilentlyContinue)) {
        return $false
    }

    if (-not (Test-Path -LiteralPath $ToolPaths.Dumper -PathType Leaf)) {
        return $false
    }

    $bundleDir = Join-Path $Tools "Il2CppDumper"
    if (-not (Test-Path -LiteralPath $bundleDir -PathType Container)) {
        return $false
    }

    $toolConfigPath = Get-GhidraCodeBrowserToolConfigPath -GhidraRoot $ToolPaths.GhidraRoot
    if ([string]::IsNullOrWhiteSpace($toolConfigPath)) {
        return $false
    }

    $templatePath = Join-Path $Root "templates\Ghidra\_code_browser.tcd"
    $result = Register-GhidraScriptBundle -ToolConfigPath $toolConfigPath -BundleDir $bundleDir -GhidraRoot $ToolPaths.GhidraRoot -TemplatePath $templatePath -CreateBackup
    switch ($result.Reason) {
        "Added" {
            Write-Host ("  [OK]   Ghidra Script Bundle registered: {0}" -f $result.BundleValue) -ForegroundColor Green
            Write-Host "         If Script Manager does not show ghidra.py, fully close all Ghidra/PyGhidra windows and reopen." -ForegroundColor DarkGray
            return $true
        }
        "Updated" {
            Write-Host ("  [OK]   Ghidra Script Bundle enabled: {0}" -f $result.BundleValue) -ForegroundColor Green
            Write-Host "         If Script Manager does not show ghidra.py, fully close all Ghidra/PyGhidra windows and reopen." -ForegroundColor DarkGray
            return $true
        }
        "AlreadyRegistered" {
            Write-Host ("  [OK]   Ghidra Script Bundle already registered: {0}" -f $result.BundleValue) -ForegroundColor DarkGray
            Write-Host "         If Script Manager does not show ghidra.py, fully close all Ghidra/PyGhidra windows and reopen." -ForegroundColor DarkGray
            return $true
        }
        "MissingToolConfig" {
            Write-Host "  [WARN] Ghidra Script Bundle not registered yet. Start and close Ghidra once, then rerun this command." -ForegroundColor Yellow
            return $false
        }
        default {
            Write-Host ("  [WARN] Ghidra Script Bundle not patched ({0}). Add tools\Il2CppDumper from Script Manager > Bundle Manager." -f $result.Reason) -ForegroundColor Yellow
            return $false
        }
    }
}
