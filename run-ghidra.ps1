[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$JdkPath = Join-Path $Root "runtime\java\jdk-21"
$PythonRoot = Join-Path $Root "runtime\python\python-3.12"
$PythonExe = Join-Path $PythonRoot "python.exe"
$PyGhidraVenv = Join-Path $Root "runtime\python\pyghidra-venv"
$PyGhidraPython = Join-Path $PyGhidraVenv "Scripts\python.exe"
$GhidraRun = Join-Path $Root "tools\ghidra\ghidraRun.bat"

if (-not (Test-Path -LiteralPath $JdkPath)) {
    Write-Host "[FAIL] JDK 21 portable not found at: $JdkPath" -ForegroundColor Red
    Write-Host "       Run: .\install-re-toolkit.ps1 -InstallRuntime" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path -LiteralPath $GhidraRun)) {
    Write-Host "[FAIL] Ghidra not found at: $GhidraRun" -ForegroundColor Red
    Write-Host "       Run: .\install-re-toolkit.ps1 -InstallGhidra" -ForegroundColor Yellow
    exit 1
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
    $env:GHIDRA_INSTALL_DIR  = Join-Path $Root "tools\ghidra"
    if (Test-Path -LiteralPath $PythonExe) {
        $selectedPython = if (Test-Path -LiteralPath $PyGhidraPython) { $PyGhidraPython } else { $PythonExe }
        $env:PYGHIDRA_PYTHON = $selectedPython
        $env:PYTHONNOUSERSITE = "1"
        $env:PYTHONPATH = ""
        $env:Path = "$PyGhidraVenv\Scripts;$PythonRoot;$PythonRoot\Scripts;$JdkPath\bin;$OldPath"
    }
    else {
        $env:Path = "$JdkPath\bin;$OldPath"
    }

    Write-Host "Using toolkit JDK:" -ForegroundColor Cyan
    & "$JdkPath\bin\java.exe" -version

    Push-Location $Root
    try {
        & $GhidraRun @args
    } finally {
        Pop-Location
    }
}
finally {
    $env:JAVA_HOME          = $OldJavaHome
    $env:JAVA_HOME_OVERRIDE = $OldJavaHomeOverride
    $env:GHIDRA_INSTALL_DIR  = $OldGhidraInstallDir
    $env:PYGHIDRA_PYTHON    = $OldPyGhidraPython
    $env:PYTHONNOUSERSITE   = $OldPythonNoUserSite
    $env:PYTHONPATH         = $OldPythonPath
    $env:Path               = $OldPath
}
