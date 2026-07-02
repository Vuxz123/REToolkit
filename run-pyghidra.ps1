[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$JdkPath = Join-Path $Root "runtime\java\jdk-21"
$PythonRoot = Join-Path $Root "runtime\python\python-3.12"
$PythonExe = Join-Path $PythonRoot "python.exe"
$PyGhidraVenv = Join-Path $Root "runtime\python\pyghidra-venv"
$PyGhidraPython = Join-Path $PyGhidraVenv "Scripts\python.exe"
$GhidraRoot = Join-Path $Root "tools\ghidra"
$PyGhidraDist = Join-Path $GhidraRoot "Ghidra\Features\PyGhidra\pypkg\dist"

if (-not (Test-Path -LiteralPath $JdkPath)) {
    Write-Host "[FAIL] JDK 21 portable not found at: $JdkPath" -ForegroundColor Red
    Write-Host "       Run: .\install-re-toolkit.ps1 -InstallRuntime" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path -LiteralPath $PythonExe)) {
    Write-Host "[FAIL] Toolkit Python not found at: $PythonExe" -ForegroundColor Red
    Write-Host "       Run: .\install-re-toolkit.ps1 -InstallRuntime" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path -LiteralPath $PyGhidraDist -PathType Container)) {
    Write-Host "[FAIL] PyGhidra package bundle not found at: $PyGhidraDist" -ForegroundColor Red
    Write-Host "       Run: .\install-re-toolkit.ps1 -InstallGhidra" -ForegroundColor Yellow
    exit 1
}

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

if (-not (Test-Path -LiteralPath $PyGhidraPython)) {
    Write-Host "Creating PyGhidra venv with toolkit Python: $PyGhidraVenv" -ForegroundColor Cyan
    New-Item -ItemType Directory -Path (Split-Path -Parent $PyGhidraVenv) -Force | Out-Null
    & $PythonExe -m venv $PyGhidraVenv
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAIL] Failed to create PyGhidra venv. Exit code: $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

function Ensure-PyGhidraPackage {
    param([Parameter(Mandatory)] [string]$PythonExe)

    $current = Get-PythonPackageVersion -PythonExe $PythonExe -PackageName "pyghidra"
    if (-not [string]::IsNullOrWhiteSpace($current)) {
        return $current
    }

    Write-Host "Installing bundled PyGhidra into local venv from: $PyGhidraDist" -ForegroundColor Cyan
    & $PythonExe -m pip install --no-index -f $PyGhidraDist pyghidra
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install bundled PyGhidra into local venv. Exit code: $LASTEXITCODE"
    }

    $installed = Get-PythonPackageVersion -PythonExe $PythonExe -PackageName "pyghidra"
    if ([string]::IsNullOrWhiteSpace($installed)) {
        throw "PyGhidra package install finished but importlib.metadata could not read the version."
    }

    return $installed
}

$OldJavaHome          = $env:JAVA_HOME
$OldJavaHomeOverride  = $env:JAVA_HOME_OVERRIDE
$OldGhidraInstallDir  = $env:GHIDRA_INSTALL_DIR
$OldPyGhidraPython    = $env:PYGHIDRA_PYTHON
$OldPythonNoUserSite  = $env:PYTHONNOUSERSITE
$OldPythonPath        = $env:PYTHONPATH
$OldPath              = $env:Path

try {
    $env:JAVA_HOME          = $JdkPath
    $env:JAVA_HOME_OVERRIDE = $JdkPath
    $env:GHIDRA_INSTALL_DIR = $GhidraRoot
    $env:PYGHIDRA_PYTHON    = $PyGhidraPython
    $env:PYTHONNOUSERSITE   = "1"
    $env:PYTHONPATH         = ""
    $env:Path = "$PyGhidraVenv\Scripts;$PythonRoot;$PythonRoot\Scripts;$JdkPath\bin;$OldPath"

    Write-Host "Using toolkit JDK:" -ForegroundColor Cyan
    & "$JdkPath\bin\java.exe" -version

    Write-Host "Using PyGhidra Python:" -ForegroundColor Cyan
    & $PyGhidraPython --version
    $pyGhidraVersion = Ensure-PyGhidraPackage -PythonExe $PyGhidraPython
    Write-Host ("Using PyGhidra package: {0}" -f $pyGhidraVersion) -ForegroundColor Cyan

    $vmArgs = Get-PyGhidraVmArgs
    $launchArgs = @("-m", "pyghidra", "-g", "--install-dir", $GhidraRoot)
    if ($vmArgs.Count -gt 0) { $launchArgs += $vmArgs }
    if ($args.Count -gt 0) {
        foreach ($arg in $args) {
            if ($arg -eq "--console") {
                Write-Host "[INFO] --console is implicit; PyGhidra is launched in the foreground." -ForegroundColor DarkGray
                continue
            }
            $launchArgs += $arg
        }
    }

    Push-Location $Root
    try {
        & $PyGhidraPython @launchArgs
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    } finally {
        Pop-Location
    }
}
finally {
    $env:JAVA_HOME          = $OldJavaHome
    $env:JAVA_HOME_OVERRIDE = $OldJavaHomeOverride
    $env:GHIDRA_INSTALL_DIR = $OldGhidraInstallDir
    $env:PYGHIDRA_PYTHON    = $OldPyGhidraPython
    $env:PYTHONNOUSERSITE   = $OldPythonNoUserSite
    $env:PYTHONPATH         = $OldPythonPath
    $env:Path               = $OldPath
}
