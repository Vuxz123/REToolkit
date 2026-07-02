# Dot-sourced by re.ps1. Uses shared REToolkit variables from the entrypoint.

function Get-PyGhidraVmArgs {
    $items = New-Object System.Collections.Generic.List[string]

    foreach ($raw in @($env:JDK_JAVA_OPTIONS, $env:GHIDRA_JAVA_OPTIONS, $env:PYGHIDRA_JAVA_OPTIONS)) {
        if ([string]::IsNullOrWhiteSpace($raw)) { continue }
        foreach ($part in ($raw -split '\s+')) {
            if (-not [string]::IsNullOrWhiteSpace($part)) {
                [void]$items.Add($part)
            }
        }
    }

    [void]$items.Add("-Dsun.java2d.dpiaware=true")
    return @($items.ToArray())
}

function Get-PythonPackageVersion {
    param(
        [Parameter(Mandatory)] [string]$PythonExe,
        [Parameter(Mandatory)] [string]$PackageName
    )

    $probe = @"
import importlib.metadata as m
try:
    print(m.version('$PackageName'))
except m.PackageNotFoundError:
    pass
"@
    $lines = @(& $PythonExe -c $probe 2>$null)
    if ($LASTEXITCODE -ne 0) { throw "package version probe failed for $PackageName with exit code $LASTEXITCODE" }

    $version = $lines | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace($version)) { return "" }
    return $version.Trim()
}

function Ensure-PyGhidraPython {
    Assert-PathExists $ToolPaths.PythonExe "Toolkit Python"

    if (Test-Path -LiteralPath $ToolPaths.PyGhidraPython) {
        return $ToolPaths.PyGhidraPython
    }

    Write-Host ("Creating PyGhidra venv with toolkit Python: {0}" -f $ToolPaths.PyGhidraVenv) -ForegroundColor Cyan
    New-Item -ItemType Directory -Path (Split-Path -Parent $ToolPaths.PyGhidraVenv) -Force | Out-Null
    & $ToolPaths.PythonExe -m venv $ToolPaths.PyGhidraVenv
    if ($LASTEXITCODE -ne 0) { throw "Failed to create PyGhidra venv with toolkit Python. Exit code: $LASTEXITCODE" }

    if (-not (Test-Path -LiteralPath $ToolPaths.PyGhidraPython)) {
        throw "PyGhidra venv was created but python.exe is missing: $($ToolPaths.PyGhidraPython)"
    }

    return $ToolPaths.PyGhidraPython
}

function Ensure-PyGhidraPackage {
    param([Parameter(Mandatory)] [string]$PythonExe)

    Assert-PathExists $ToolPaths.PyGhidraDist "PyGhidra package bundle" -Directory

    $current = Get-PythonPackageVersion -PythonExe $PythonExe -PackageName "pyghidra"
    if (-not [string]::IsNullOrWhiteSpace($current)) {
        return $current
    }

    Write-Host ("Installing bundled PyGhidra into local venv from: {0}" -f $ToolPaths.PyGhidraDist) -ForegroundColor Cyan
    & $PythonExe -m pip install --no-index -f $ToolPaths.PyGhidraDist pyghidra
    if ($LASTEXITCODE -ne 0) { throw "Failed to install bundled PyGhidra into local venv. Exit code: $LASTEXITCODE" }

    $installed = Get-PythonPackageVersion -PythonExe $PythonExe -PackageName "pyghidra"
    if ([string]::IsNullOrWhiteSpace($installed)) {
        throw "PyGhidra package install finished but importlib.metadata could not read the version."
    }

    return $installed
}

function Invoke-PyGhidraGui {
    param([Parameter()] [string[]]$Arguments)

    if ($null -eq $Arguments) { $Arguments = @() }

    $pyGhidraPython = Ensure-PyGhidraPython
    Assert-PathExists $ToolPaths.JavaExe "Toolkit JDK 21"
    $pyGhidraVersion = Ensure-PyGhidraPackage -PythonExe $pyGhidraPython
    Ensure-Il2CppDumperGhidraScriptBundle | Out-Null

    $vmArgs = Get-PyGhidraVmArgs
    $launchArgs = @("-m", "pyghidra", "-g", "--install-dir", $ToolPaths.GhidraRoot)
    if ($vmArgs.Count -gt 0) { $launchArgs += $vmArgs }
    if ($Arguments.Count -gt 0) {
        foreach ($arg in $Arguments) {
            if ($arg -eq "--console") {
                Write-Host "[INFO] --console is implicit; PyGhidra is launched in the foreground." -ForegroundColor DarkGray
                continue
            }
            $launchArgs += $arg
        }
    }

    Invoke-WithToolkitEnv {
        Push-Location $Root
        try {
            Write-Host ("Using PyGhidra Python: {0}" -f $pyGhidraPython) -ForegroundColor Cyan
            & $pyGhidraPython --version
            Write-Host ("Using PyGhidra package: {0}" -f $pyGhidraVersion) -ForegroundColor Cyan
            & $pyGhidraPython @launchArgs
            if ($LASTEXITCODE -ne 0) { throw "PyGhidra exited with code $LASTEXITCODE" }
        }
        finally {
            Pop-Location
        }
    }
}
