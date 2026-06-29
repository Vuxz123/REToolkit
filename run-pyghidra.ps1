[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$JdkPath = Join-Path $Root "runtime\java\jdk-21"
$PyGhidraRun = Join-Path $Root "tools\ghidra\support\pyghidraRun.bat"

if (-not (Test-Path -LiteralPath $JdkPath)) {
    Write-Host "[FAIL] JDK 21 portable not found at: $JdkPath" -ForegroundColor Red
    Write-Host "       Run: .\install-re-toolkit.ps1 -InstallRuntime" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path -LiteralPath $PyGhidraRun)) {
    Write-Host "[FAIL] PyGhidra runner not found at: $PyGhidraRun" -ForegroundColor Red
    Write-Host "       Install Ghidra with PyGhidra support." -ForegroundColor Yellow
    exit 1
}

$OldJavaHome          = $env:JAVA_HOME
$OldJavaHomeOverride  = $env:JAVA_HOME_OVERRIDE
$OldGhidraInstallDir  = $env:GHIDRA_INSTALL_DIR
$OldPath              = $env:Path

try {
    $env:JAVA_HOME          = $JdkPath
    $env:JAVA_HOME_OVERRIDE = $JdkPath
    $env:GHIDRA_INSTALL_DIR  = Join-Path $Root "tools\ghidra"
    $env:Path = "$JdkPath\bin;$OldPath"

    Write-Host "Using toolkit JDK:" -ForegroundColor Cyan
    & "$JdkPath\bin\java.exe" -version

    Push-Location $Root
    try {
        & $PyGhidraRun @args
    } finally {
        Pop-Location
    }
}
finally {
    $env:JAVA_HOME          = $OldJavaHome
    $env:JAVA_HOME_OVERRIDE = $OldJavaHomeOverride
    $env:GHIDRA_INSTALL_DIR  = $OldGhidraInstallDir
    $env:Path               = $OldPath
}
