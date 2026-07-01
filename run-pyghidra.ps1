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
$PyGhidraLauncher = Join-Path $GhidraRoot "Ghidra\Features\PyGhidra\support\pyghidra_launcher.py"

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

if (-not (Test-Path -LiteralPath $PyGhidraLauncher)) {
    Write-Host "[FAIL] PyGhidra launcher not found at: $PyGhidraLauncher" -ForegroundColor Red
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

if (-not (Test-Path -LiteralPath $PyGhidraPython)) {
    Write-Host "Creating PyGhidra venv with toolkit Python: $PyGhidraVenv" -ForegroundColor Cyan
    New-Item -ItemType Directory -Path (Split-Path -Parent $PyGhidraVenv) -Force | Out-Null
    & $PythonExe -m venv $PyGhidraVenv
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAIL] Failed to create PyGhidra venv. Exit code: $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }
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

    $vmArgs = Get-PyGhidraVmArgs

    Push-Location $Root
    try {
        & $PyGhidraPython $PyGhidraLauncher $GhidraRoot @vmArgs @args
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
