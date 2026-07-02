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
$GhidraRun = Join-Path $GhidraRoot "ghidraRun.bat"
$Il2CppDumperExe = Join-Path $Root "tools\Il2CppDumper\Il2CppDumper.exe"
$GhidraScriptBundleHelper = Join-Path $Root "scripts\ghidra-script-bundle.ps1"
if (Test-Path -LiteralPath $GhidraScriptBundleHelper) {
    . $GhidraScriptBundleHelper
}

function Ensure-Il2CppDumperGhidraScriptBundle {
    if (-not (Get-Command "Register-GhidraScriptBundle" -CommandType Function -ErrorAction SilentlyContinue)) {
        return $false
    }

    if (-not (Test-Path -LiteralPath $Il2CppDumperExe -PathType Leaf)) {
        return $false
    }

    $bundleDir = Join-Path $Root "tools\Il2CppDumper"
    if (-not (Test-Path -LiteralPath $bundleDir -PathType Container)) {
        return $false
    }

    $toolConfigPath = Get-GhidraCodeBrowserToolConfigPath -GhidraRoot $GhidraRoot
    if ([string]::IsNullOrWhiteSpace($toolConfigPath)) {
        return $false
    }

    $templatePath = Join-Path $Root "templates\Ghidra\_code_browser.tcd"
    $result = Register-GhidraScriptBundle -ToolConfigPath $toolConfigPath -BundleDir $bundleDir -GhidraRoot $GhidraRoot -TemplatePath $templatePath -CreateBackup
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
    Ensure-Il2CppDumperGhidraScriptBundle | Out-Null

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
