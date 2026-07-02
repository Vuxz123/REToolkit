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

function Join-NativeArgumentString {
    param([Parameter()] [string[]]$Arguments)

    if ($null -eq $Arguments) { return "" }

    $quoted = New-Object System.Collections.Generic.List[string]
    foreach ($arg in $Arguments) {
        if ($null -eq $arg) {
            [void]$quoted.Add('""')
            continue
        }

        $s = ([string]$arg).Replace('"', '\"')
        [void]$quoted.Add('"' + $s + '"')
    }

    return ($quoted -join ' ')
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
    Ensure-Il2CppDumperGhidraScriptBundle | Out-Null

    $vmArgs = Get-PyGhidraVmArgs
    $launchArgs = @("-m", "pyghidra", "-g", "--install-dir", $GhidraRoot)
    if ($vmArgs.Count -gt 0) { $launchArgs += $vmArgs }
    $runInConsole = $false
    if ($args.Count -gt 0) {
        foreach ($arg in $args) {
            if ($arg -eq "--console") {
                $runInConsole = $true
                continue
            }
            $launchArgs += $arg
        }
    }

    Push-Location $Root
    try {
        if ($runInConsole) {
            Write-Host "[INFO] --console requested; PyGhidra logs stay attached to this console." -ForegroundColor DarkGray
            $foregroundArgs = @($launchArgs)
            & $PyGhidraPython @foregroundArgs
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
        else {
            $logDir = Join-Path $Root "logs"
            New-Item -ItemType Directory -Force -Path $logDir | Out-Null
            $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
            $stdoutLog = Join-Path $logDir ("pyghidra-gui-{0}.out.log" -f $stamp)
            $stderrLog = Join-Path $logDir ("pyghidra-gui-{0}.out.err.log" -f $stamp)

            $argString = Join-NativeArgumentString $launchArgs
            $proc = Start-Process -FilePath $PyGhidraPython -ArgumentList $argString -WorkingDirectory $Root -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -WindowStyle Hidden -PassThru
            if ($null -eq $proc) { throw "Failed to start detached PyGhidra process." }

            Write-Host ("PyGhidra GUI started in detached mode. PID: {0}" -f $proc.Id) -ForegroundColor Green
            Write-Host ("Stdout log: {0}" -f $stdoutLog) -ForegroundColor DarkGray
            Write-Host ("Stderr log: {0}" -f $stderrLog) -ForegroundColor DarkGray
        }
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
