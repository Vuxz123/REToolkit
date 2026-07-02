[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [switch]$InstallGhidra,
    [switch]$InstallGhidraMcp,
    [switch]$InstallIl2CppDumper,
    [switch]$InstallAssetRipper,
    [switch]$InstallRuntime,
    [int]$JdkVersion = 21,
    [string]$PythonVersion = "3.12.10",
    [string]$GhidraVersion = "",
    [string]$Il2CppDumperVersion = "6.7.48",
    [string]$GhidraMcpReleaseApi = "https://api.github.com/repos/bethington/ghidra-mcp/releases/latest",
    [string]$AssetRipperRepo = "AssetRipper/AssetRipper"
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        $InstallDir = $PSScriptRoot
    }
    elseif (-not [string]::IsNullOrWhiteSpace($PSCommandPath)) {
        $InstallDir = Split-Path -Parent $PSCommandPath
    }
    elseif ($MyInvocation.MyCommand.Path) {
        $InstallDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    else {
        $InstallDir = (Get-Location).Path
    }
}
Set-Location -LiteralPath $InstallDir

$Runtime      = Join-Path $InstallDir "runtime"
$PortableJava = Join-Path $Runtime "java\jdk-21"
$GhidraRoot   = Join-Path $InstallDir "tools\ghidra"
$PythonRoot   = Join-Path $Runtime "python"
if ($PythonVersion -match '^(\d+\.\d+)') {
    $PythonMajorMinor = $Matches[1]
} else {
    $PythonMajorMinor = $PythonVersion
}
$PythonDir    = Join-Path $PythonRoot "python-$PythonMajorMinor"
$PythonExe    = Join-Path $PythonDir "python.exe"
$PyGhidraVenv = Join-Path $PythonRoot "pyghidra-venv"
$PyGhidraPython = Join-Path $PyGhidraVenv "Scripts\python.exe"

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "== $Title ==" -ForegroundColor Cyan
}

function Test-Command {
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    return [pscustomobject]@{
        Name  = $Name
        Found = [bool]$cmd
        Path  = if ($cmd) { $cmd.Source } else { "<not found>" }
    }
}

function Test-PathExists {
    param([string]$Path, [string]$Label)
    $exists = Test-Path -LiteralPath $Path
    if ($exists) {
        Write-Host ("  [OK]   {0,-22} {1}" -f $Label, $Path) -ForegroundColor Green
    } else {
        Write-Host ("  [WARN] {0,-22} {1}" -f $Label, $Path) -ForegroundColor Yellow
    }
    return $exists
}

function Get-PythonMajorMinor {
    param([Parameter(Mandatory)] [string]$Version)

    if ($Version -match '^(\d+\.\d+)') {
        return $Matches[1]
    }

    throw "Python version must start with major.minor, for example 3.12.10"
}

function Resolve-PythonDownloadVersion {
    param([Parameter(Mandatory)] [string]$Version)

    switch -Regex ($Version) {
        '^3\.12$' { return "3.12.10" }
        '^3\.13$' { return "3.13.3" }
        default   { return $Version }
    }
}

function Test-PathWithin {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$Parent
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\','/'))
    $fullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd([char[]]@('\','/'))

    return $fullPath.Equals($fullParent, [System.StringComparison]::OrdinalIgnoreCase) -or
        $fullPath.StartsWith($fullParent + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-ToolkitPythonDir {
    param([Parameter(Mandatory)] [string]$Version)

    $majorMinor = Get-PythonMajorMinor -Version $Version
    return (Join-Path $PythonRoot "python-$majorMinor")
}

function Get-ToolkitPythonExe {
    param([Parameter(Mandatory)] [string]$Version)

    return (Join-Path (Get-ToolkitPythonDir -Version $Version) "python.exe")
}

function Refresh-Path {
    $user = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $machine = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $parts = @($user, $machine, $env:Path) | Where-Object { $_ }
    $env:Path = ($parts -split ";" | Where-Object { $_ -and $_ -notmatch '^\s*$' } | Select-Object -Unique) -join ";"
}

function Clear-RetkTemp {
    $patterns = @(
        "retk-*",
        "ghidra_extract_*",
        "temurin*.zip",
        "GhidraMCP-*.zip",
        "rustup-init*.exe",
        "Il2CppDumper-v*.zip",
        "il2cppdumper_*",
        "AssetRipper_win*.zip",
        "assetripper_*"
    )
    $seen = @{}
    $removed = 0
    foreach ($pat in $patterns) {
        Get-ChildItem -LiteralPath $env:TEMP -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like $pat -and -not $seen.ContainsKey($_.FullName) } |
            ForEach-Object {
                $seen[$_.FullName] = $true
                try {
                    if ($_.PSIsContainer) {
                        Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop
                    } else {
                        Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop
                    }
                    $removed++
                } catch { }
            }
    }
    return $removed
}

function Invoke-Install {
    param([string]$Name, [scriptblock]$Action)
    try {
        & $Action
    } catch {
        Write-Host ("  [FAIL] {0} crashed: {1}" -f $Name, $_) -ForegroundColor Red
    } finally {
        $n = Clear-RetkTemp
        if ($n -gt 0) {
            Write-Host ("  [CLEAN] {0} temp item(s) cleared after {1}" -f $n, $Name) -ForegroundColor DarkGray
        }
    }
}

function Install-Java {
    param([int]$Major)

    $javaExe = Join-Path $PortableJava "bin\java.exe"
    if (Test-Path -LiteralPath $javaExe) {
        Write-Host "  [SKIP] portable JDK already at $PortableJava" -ForegroundColor Yellow
        return $true
    }

    Write-Host "  Querying Adoptium API for Temurin JDK $Major (portable ZIP)..." -ForegroundColor Cyan
    $api = "https://api.adoptium.net/v3/assets/latest/$Major/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse"
    $tmp = $null
    $extract = $null
    try {
        $assets = Invoke-RestMethod -Uri $api -UseBasicParsing -TimeoutSec 30 -Headers @{"User-Agent"="re-toolkit"}
        $asset = $assets | Where-Object { $_.binary.os -eq "windows" -and $_.binary.image_type -eq "jdk" } | Select-Object -First 1
        if (-not $asset) {
            Write-Host "  [FAIL] No Temurin asset for JDK $Major" -ForegroundColor Red
            return $false
        }

        $tmp = Join-Path $env:TEMP "temurin$Major.zip"
        if ($asset.binary.package -and $asset.binary.package.link) {
            $url = $asset.binary.package.link
        } elseif ($asset.binary.archive -and $asset.binary.archive.link) {
            $url = $asset.binary.archive.link
        } else {
            Write-Host "  [FAIL] No portable ZIP link in Adoptium API response (only .msi installer found)." -ForegroundColor Red
            return $false
        }
        Write-Host ("  Downloading {0} ..." -f (Split-Path $url -Leaf)) -ForegroundColor Cyan
        Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -TimeoutSec 600

        $extract = Join-Path $env:TEMP ("temurin" + [guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Path $extract -Force | Out-Null
        Expand-Archive -Path $tmp -DestinationPath $extract -Force

        $inner = Get-ChildItem -LiteralPath $extract -Directory | Select-Object -First 1
        if (-not $inner) {
            Write-Host "  [FAIL] Archive did not contain a JDK folder" -ForegroundColor Red
            return $false
        }

        if (Test-Path -LiteralPath (Split-Path -Parent $PortableJava)) {
            Remove-Item -LiteralPath (Split-Path -Parent $PortableJava) -Recurse -Force -ErrorAction SilentlyContinue
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $PortableJava) -Force | Out-Null
        Move-Item -LiteralPath $inner.FullName -Destination $PortableJava -Force

        if (Test-Path -LiteralPath $javaExe) {
            $ver = (cmd /c "`"$javaExe`" -version 2>&1" | Select-Object -First 1) -replace '"',''
            Write-Host ("  [OK]   Portable JDK: {0}" -f $ver.Trim()) -ForegroundColor Green
            Write-Host ("         Path       : {0}" -f $PortableJava) -ForegroundColor Cyan
            Write-Host          "         (no global JAVA_HOME/PATH change)" -ForegroundColor DarkGray
            return $true
        }
        Write-Host "  [FAIL] java.exe missing after extraction" -ForegroundColor Red
        return $false
    } catch {
        Write-Host "  [FAIL] $_" -ForegroundColor Red
        return $false
    } finally {
        if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
        if ($extract -and (Test-Path -LiteralPath $extract)) { Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

function Install-PyGhidraPythonVenv {
    param(
        [Parameter(Mandatory)] [string]$BasePythonExe,
        [Parameter(Mandatory)] [string]$VenvDir
    )

    $venvPython = Join-Path $VenvDir "Scripts\python.exe"
    if (Test-Path -LiteralPath $venvPython) {
        Write-Host ("  [SKIP] PyGhidra Python venv already at {0}" -f $VenvDir) -ForegroundColor Yellow
        return $true
    }

    try {
        Write-Host ("  Creating PyGhidra Python venv: {0}" -f $VenvDir) -ForegroundColor Cyan
        New-Item -ItemType Directory -Path (Split-Path -Parent $VenvDir) -Force | Out-Null
        & $BasePythonExe -m venv $VenvDir
        if ($LASTEXITCODE -ne 0) { throw "python -m venv failed with exit code $LASTEXITCODE" }

        if (-not (Test-Path -LiteralPath $venvPython)) {
            throw "venv python.exe missing after creation: $venvPython"
        }

        Write-Host ("  [OK]   PyGhidra Python venv: {0}" -f $venvPython) -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host ("  [FAIL] {0}" -f $_.Exception.Message) -ForegroundColor Red
        return $false
    }
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

function Install-PyGhidraPythonPackage {
    param(
        [Parameter(Mandatory)] [string]$VenvPython,
        [Parameter(Mandatory)] [string]$GhidraRoot
    )

    $distDir = Join-Path $GhidraRoot "Ghidra\Features\PyGhidra\pypkg\dist"
    if (-not (Test-Path -LiteralPath $distDir -PathType Container)) {
        Write-Host ("  [WARN] PyGhidra wheel bundle not found yet: {0}" -f $distDir) -ForegroundColor Yellow
        Write-Host "         Install Ghidra, then run -InstallRuntime again or start .\re.ps1 pyghidra-gui." -ForegroundColor Yellow
        return $true
    }

    try {
        $current = Get-PythonPackageVersion -PythonExe $VenvPython -PackageName "pyghidra"
        if (-not [string]::IsNullOrWhiteSpace($current)) {
            Write-Host ("  [OK]   PyGhidra package: {0}" -f $current) -ForegroundColor Green
            return $true
        }

        Write-Host "  Installing bundled PyGhidra into toolkit venv..." -ForegroundColor Cyan
        & $VenvPython -m pip install --no-index -f $distDir pyghidra
        if ($LASTEXITCODE -ne 0) { throw "pip install --no-index -f failed with exit code $LASTEXITCODE" }

        $installed = Get-PythonPackageVersion -PythonExe $VenvPython -PackageName "pyghidra"
        if ([string]::IsNullOrWhiteSpace($installed)) {
            throw "PyGhidra package install finished but importlib.metadata could not read the version."
        }
        Write-Host ("  [OK]   PyGhidra package: {0}" -f $installed) -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host ("  [FAIL] {0}" -f $_.Exception.Message) -ForegroundColor Red
        return $false
    }
}

function Get-Il2CppDumperGhidraPy3Script {
    return @'
# -*- coding: utf-8 -*-
import json
import re
from ghidra.program.model.symbol import SourceType

PROCESS_FIELDS = [
    "ScriptMethod",
    "ScriptString",
    "ScriptMetadata",
    "ScriptMetadataMethod",
    "Addresses",
]

USER_DEFINED = SourceType.USER_DEFINED
base_address = currentProgram.getImageBase()


def as_text(value):
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    if value is None:
        return ""
    return str(value)


def to_offset(value):
    if isinstance(value, str):
        value = value.strip()
        if value.lower().startswith("0x"):
            return int(value, 16)
        return int(value, 10)
    return int(value)


def get_addr(addr):
    return base_address.add(to_offset(addr))


def symbol_name(name):
    text = as_text(name).strip().replace(" ", "-")
    if not text:
        text = "il2cpp_empty"
    text = re.sub(r"[^0-9A-Za-z_.$<>:@?`~-]", "_", text)
    if text[0].isdigit():
        text = "_" + text
    return text


def set_name(addr, name):
    try:
        createLabel(addr, symbol_name(name), True, USER_DEFINED)
    except Exception as exc:
        print("WARN: createLabel failed at {}: {}".format(addr, exc))


def set_comment(addr, value):
    text = as_text(value)
    if not text:
        return
    try:
        setEOLComment(addr, text)
    except Exception as exc:
        print("WARN: setEOLComment failed at {}: {}".format(addr, exc))


def make_function(start):
    if getFunctionAt(start) is not None:
        return
    try:
        createFunction(start, None)
    except Exception as exc:
        print("WARN: createFunction failed at {}: {}".format(start, exc))


def java_file_path(file_obj):
    if hasattr(file_obj, "getAbsolutePath"):
        return file_obj.getAbsolutePath()
    if hasattr(file_obj, "absolutePath"):
        return file_obj.absolutePath
    return str(file_obj)


def load_script_json():
    file_obj = askFile("script.json from Il2CppDumper", "Open")
    script_json_path = java_file_path(file_obj)
    with open(script_json_path, "r", encoding="utf-8") as fp:
        return script_json_path, json.load(fp)


def start_progress(items, message):
    try:
        monitor.initialize(len(items))
        monitor.setMessage(message)
    except Exception:
        pass


def step_progress():
    try:
        monitor.incrementProgress(1)
    except Exception:
        pass


def process_methods(data):
    if "ScriptMethod" not in data or "ScriptMethod" not in PROCESS_FIELDS:
        return
    items = data["ScriptMethod"]
    start_progress(items, "Methods")
    for item in items:
        addr = get_addr(item["Address"])
        set_name(addr, item["Name"])
        step_progress()


def process_strings(data):
    if "ScriptString" not in data or "ScriptString" not in PROCESS_FIELDS:
        return
    items = data["ScriptString"]
    start_progress(items, "Strings")
    for index, item in enumerate(items, 1):
        addr = get_addr(item["Address"])
        set_name(addr, "StringLiteral_{}".format(index))
        set_comment(addr, item["Value"])
        step_progress()


def process_metadata(data):
    if "ScriptMetadata" not in data or "ScriptMetadata" not in PROCESS_FIELDS:
        return
    items = data["ScriptMetadata"]
    start_progress(items, "Metadata")
    for item in items:
        addr = get_addr(item["Address"])
        name = item["Name"]
        set_name(addr, name)
        set_comment(addr, name)
        step_progress()


def process_metadata_methods(data):
    if "ScriptMetadataMethod" not in data or "ScriptMetadataMethod" not in PROCESS_FIELDS:
        return
    items = data["ScriptMetadataMethod"]
    start_progress(items, "Metadata Methods")
    for item in items:
        addr = get_addr(item["Address"])
        name = item["Name"]
        set_name(addr, name)
        set_comment(addr, name)
        step_progress()


def process_addresses(data):
    if "Addresses" not in data or "Addresses" not in PROCESS_FIELDS:
        return
    addresses = data["Addresses"]
    start_progress(addresses, "Addresses")
    for raw_addr in addresses[:-1]:
        make_function(get_addr(raw_addr))
        step_progress()


script_json_path, script_data = load_script_json()
print("Loaded Il2CppDumper script JSON: {}".format(script_json_path))
process_methods(script_data)
process_strings(script_data)
process_metadata(script_data)
process_metadata_methods(script_data)
process_addresses(script_data)
print("Script finished!")
'@
}

function Get-Il2CppDumperGhidraTemplateRoot {
    return (Join-Path $InstallDir "templates\Il2CppDumper")
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

function Install-ToolkitPythonWithUv {
    param(
        [Parameter(Mandatory)] [string]$Version,
        [Parameter(Mandatory)] [string]$TargetDir,
        [Parameter(Mandatory)] [string]$TargetExe
    )

    $uv = Get-Command "uv" -ErrorAction SilentlyContinue
    if (-not $uv) {
        Write-Host "  [INFO] uv not found; falling back to python.org installer." -ForegroundColor DarkGray
        return $false
    }

    if (-not (Test-PathWithin -Path $TargetDir -Parent $PythonRoot)) {
        throw "Refusing to install Python outside toolkit runtime: $TargetDir"
    }

    $stageDir = Join-Path $PythonRoot (".uv-python-" + [guid]::NewGuid().ToString("N"))
    $uvCacheDir = Join-Path $Runtime "uv-cache"
    if (-not (Test-PathWithin -Path $stageDir -Parent $PythonRoot)) {
        throw "Refusing to stage Python outside toolkit runtime: $stageDir"
    }

    $oldUvCacheDir = $env:UV_CACHE_DIR
    try {
        New-Item -ItemType Directory -Path $PythonRoot -Force | Out-Null
        New-Item -ItemType Directory -Path $stageDir -Force | Out-Null
        New-Item -ItemType Directory -Path $uvCacheDir -Force | Out-Null

        $env:UV_CACHE_DIR = $uvCacheDir

        Write-Host ("  Installing toolkit Python {0} with uv (portable, no registry)..." -f $Version) -ForegroundColor Cyan
        & uv python install --install-dir $stageDir --no-registry --no-bin --cache-dir $uvCacheDir $Version
        if ($LASTEXITCODE -ne 0) { throw "uv python install failed with exit code $LASTEXITCODE" }

        $candidate = Get-ChildItem -LiteralPath $stageDir -Recurse -Filter "python.exe" -ErrorAction SilentlyContinue |
            Where-Object { Test-Path -LiteralPath (Join-Path (Split-Path -Parent $_.FullName) "Lib\os.py") } |
            Sort-Object FullName |
            Select-Object -First 1
        if (-not $candidate) {
            $candidate = Get-ChildItem -LiteralPath $stageDir -Recurse -Filter "python.exe" -ErrorAction SilentlyContinue |
                Sort-Object FullName |
                Select-Object -First 1
        }
        if (-not $candidate) { throw "uv install completed but python.exe was not found under $stageDir" }

        $sourceDir = Split-Path -Parent $candidate.FullName
        if (-not (Test-PathWithin -Path $sourceDir -Parent $stageDir)) {
            throw "Refusing to move Python from outside staging dir: $sourceDir"
        }

        if (Test-Path -LiteralPath $TargetDir) {
            Remove-Item -LiteralPath $TargetDir -Recurse -Force
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $TargetDir) -Force | Out-Null
        Move-Item -LiteralPath $sourceDir -Destination $TargetDir -Force

        if (-not (Test-Path -LiteralPath $TargetExe)) {
            throw "python.exe missing after uv install normalization: $TargetExe"
        }

        return $true
    }
    catch {
        Write-Host ("  [WARN] uv Python install failed: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
        return $false
    }
    finally {
        if ([string]::IsNullOrEmpty($oldUvCacheDir)) {
            Remove-Item Env:\UV_CACHE_DIR -ErrorAction SilentlyContinue
        }
        else {
            $env:UV_CACHE_DIR = $oldUvCacheDir
        }

        if ((Test-Path -LiteralPath $stageDir) -and (Test-PathWithin -Path $stageDir -Parent $PythonRoot)) {
            Remove-Item -LiteralPath $stageDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Install-ToolkitPythonWithPythonOrgInstaller {
    param(
        [Parameter(Mandatory)] [string]$Version,
        [Parameter(Mandatory)] [string]$MajorMinor,
        [Parameter(Mandatory)] [string]$TargetDir,
        [Parameter(Mandatory)] [string]$TargetExe
    )

    $exe = Join-Path $env:TEMP "python-installer.exe"
    try {
        New-Item -ItemType Directory -Path (Split-Path -Parent $TargetDir) -Force | Out-Null

        $url = "https://www.python.org/ftp/python/$Version/python-$Version-amd64.exe"
        Write-Host ("  Downloading python.org {0} installer for toolkit Python {1}..." -f $Version, $MajorMinor) -ForegroundColor Cyan
        Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing -TimeoutSec 600
        $arg = "/quiet InstallAllUsers=0 PrependPath=0 Include_test=0 Include_pip=1 Include_launcher=0 Shortcuts=0 AssociateFiles=0 TargetDir=`"$TargetDir`""
        Write-Host "  Running installer into toolkit runtime (no global PATH/launcher change)..." -ForegroundColor Cyan
        $proc = Start-Process -FilePath $exe -ArgumentList $arg -Wait -PassThru
        if ($proc.ExitCode -ne 0) {
            Write-Host ("  [FAIL] Installer exited {0}" -f $proc.ExitCode) -ForegroundColor Red
            return $false
        }

        if (-not (Test-Path -LiteralPath $TargetExe)) {
            Write-Host ("  [FAIL] python.exe missing after install: {0}" -f $TargetExe) -ForegroundColor Red
            Write-Host "         The python.org EXE installer reused existing Windows install state instead of TargetDir." -ForegroundColor Yellow
            Write-Host "         Install uv and rerun -InstallRuntime for a registry-free managed Python install." -ForegroundColor Yellow
            return $false
        }

        return $true
    } catch {
        Write-Host "  [FAIL] $_" -ForegroundColor Red
        return $false
    } finally {
        if (Test-Path -LiteralPath $exe) { Remove-Item -LiteralPath $exe -Force -ErrorAction SilentlyContinue }
    }
}

function Install-Python {
    param([string]$Version)

    $downloadVersion = Resolve-PythonDownloadVersion -Version $Version
    $majorMinor = Get-PythonMajorMinor -Version $downloadVersion
    $targetDir = Get-ToolkitPythonDir -Version $downloadVersion
    $targetExe = Join-Path $targetDir "python.exe"

    if (Test-Path -LiteralPath $targetExe) {
        try {
            $ver = & $targetExe --version 2>&1
            Write-Host ("  [SKIP] toolkit Python already installed: {0}" -f $ver) -ForegroundColor Yellow
            Write-Host ("         Path: {0}" -f $targetDir) -ForegroundColor DarkGray
            if (-not (Install-PyGhidraPythonVenv -BasePythonExe $targetExe -VenvDir $PyGhidraVenv)) { return $false }
            return (Install-PyGhidraPythonPackage -VenvPython $PyGhidraPython -GhidraRoot $GhidraRoot)
        }
        catch {
            Write-Host ("  [WARN] toolkit Python exists but failed to run: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
        }
    }

    $installed = Install-ToolkitPythonWithUv -Version $downloadVersion -TargetDir $targetDir -TargetExe $targetExe
    if (-not $installed) {
        $installed = Install-ToolkitPythonWithPythonOrgInstaller -Version $downloadVersion -MajorMinor $majorMinor -TargetDir $targetDir -TargetExe $targetExe
    }

    if ($installed) {
        $pyVer = & $targetExe --version 2>&1
        Write-Host ("  [OK]   Toolkit Python: {0}" -f $pyVer) -ForegroundColor Green
        Write-Host ("         Path          : {0}" -f $targetDir) -ForegroundColor Cyan
        Write-Host          "         (no global Python/PATH/py launcher change)" -ForegroundColor DarkGray
        if (-not (Install-PyGhidraPythonVenv -BasePythonExe $targetExe -VenvDir $PyGhidraVenv)) { return $false }
        return (Install-PyGhidraPythonPackage -VenvPython $PyGhidraPython -GhidraRoot $GhidraRoot)
    }

    return $false
}

function Install-GhidraRuntime {
    param([string]$ToolsDir, [string]$Version)

    $ghidraDir = Join-Path $ToolsDir "ghidra"
    if (Test-Path -LiteralPath $ghidraDir) {
        Write-Host "  [SKIP] Ghidra already at $ghidraDir" -ForegroundColor Yellow
        return $true
    }

    $tmpZip = $null
    $tmpExtract = $null

    try {
        if (-not $Version) {
            Write-Host "  Querying GitHub for latest Ghidra release..." -ForegroundColor Cyan
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/NationalSecurityAgency/ghidra/releases/latest" -UseBasicParsing -TimeoutSec 30 -Headers @{"User-Agent"="re-toolkit"}
            $asset = $release.assets | Where-Object { $_.name -match "^ghidra_.+_PUBLIC_.+\.zip$" } | Select-Object -First 1
            if (-not $asset) {
                Write-Host "  [FAIL] No PUBLIC zip asset in latest release." -ForegroundColor Red
                return $false
            }
            $fileName = $asset.name
            $url = $asset.browser_download_url
        } else {
            $short = $Version
            $fileName = "ghidra_${short}_PUBLIC_${short}.zip"
            $url = "https://github.com/NationalSecurityAgency/ghidra/releases/download/ghidra_${short}_build/$fileName"
        }

        $tmpZip = Join-Path $env:TEMP $fileName
        $tmpExtract = Join-Path $env:TEMP ("ghidra_extract_" + [guid]::NewGuid().ToString("N"))

        Write-Host ("  Downloading {0} ..." -f $fileName) -ForegroundColor Cyan
        Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing -TimeoutSec 600

        Write-Host "  Extracting..." -ForegroundColor Cyan
        New-Item -ItemType Directory -Path $tmpExtract -Force | Out-Null
        Expand-Archive -Path $tmpZip -DestinationPath $tmpExtract -Force

        $inner = Get-ChildItem -LiteralPath $tmpExtract -Directory | Select-Object -First 1
        if (-not $inner) {
            Write-Host "  [FAIL] Archive contained no top-level folder." -ForegroundColor Red
            return $false
        }

        New-Item -ItemType Directory -Path $ghidraDir -Force | Out-Null
        Get-ChildItem -LiteralPath $inner.FullName -Force | ForEach-Object {
            Move-Item -LiteralPath $_.FullName -Destination $ghidraDir -Force
        }

        $runBat = Join-Path $ghidraDir "ghidraRun.bat"
        if (Test-Path -LiteralPath $runBat) {
            $env:GHIDRA_INSTALL_DIR = $ghidraDir
            [System.Environment]::SetEnvironmentVariable("GHIDRA_INSTALL_DIR", $ghidraDir, "User")
            if (Test-Path -LiteralPath $PyGhidraPython) {
                Install-PyGhidraPythonPackage -VenvPython $PyGhidraPython -GhidraRoot $ghidraDir | Out-Null
            }
            Write-Host ("  [OK]   Ghidra installed at {0}" -f $ghidraDir) -ForegroundColor Green
            return $true
        } else {
            Write-Host "  [FAIL] ghidraRun.bat missing after install." -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "  [FAIL] $_" -ForegroundColor Red
        return $false
    } finally {
        if ($tmpZip -and (Test-Path -LiteralPath $tmpZip))   { Remove-Item -LiteralPath $tmpZip -Force -ErrorAction SilentlyContinue }
        if ($tmpExtract -and (Test-Path -LiteralPath $tmpExtract)) { Remove-Item -LiteralPath $tmpExtract -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

function Install-GhidraMcp {
    param(
        [Parameter(Mandatory)] [string]$ToolsDir,
        [Parameter(Mandatory)] [string]$ReleaseApi,
        [Parameter(Mandatory)] [string]$GhidraRoot
    )

    if (-not (Test-Path -LiteralPath $GhidraRoot -PathType Container)) {
        Write-Host "  [WARN] Ghidra root not found. Downloading release assets anyway; run -InstallGhidra before GUI install." -ForegroundColor Yellow
    }

    $targetDir = Join-Path $ToolsDir "ghidra-mcp"

    try {
        Write-Host ("  Querying latest GhidraMCP release: {0}" -f $ReleaseApi) -ForegroundColor Cyan
        $release = Invoke-RestMethod -Uri $ReleaseApi -UseBasicParsing -TimeoutSec 30 -Headers @{"User-Agent"="re-toolkit"}
        if (-not $release -or -not $release.assets) {
            Write-Host "  [FAIL] Latest release response did not include assets." -ForegroundColor Red
            return $false
        }

        $extensionAsset = $release.assets | Where-Object { $_.name -match '^GhidraMCP-.+\.zip$' } | Select-Object -First 1
        $bridgeAsset = $release.assets | Where-Object { $_.name -eq "bridge_mcp_ghidra.py" } | Select-Object -First 1
        $requirementsAsset = $release.assets | Where-Object { $_.name -eq "requirements.txt" } | Select-Object -First 1

        if (-not $extensionAsset) {
            Write-Host "  [FAIL] No GhidraMCP release extension asset matched ^GhidraMCP-.+\.zip$." -ForegroundColor Red
            return $false
        }
        if (-not $bridgeAsset) {
            Write-Host "  [FAIL] No bridge_mcp_ghidra.py release asset found." -ForegroundColor Red
            return $false
        }
        if (-not $requirementsAsset) {
            Write-Host "  [FAIL] No requirements.txt release asset found." -ForegroundColor Red
            return $false
        }

        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

        $extensionPath = Join-Path $targetDir $extensionAsset.name
        $bridgePath = Join-Path $targetDir "bridge_mcp_ghidra.py"
        $requirementsPath = Join-Path $targetDir "requirements.txt"

        Write-Host ("  Downloading {0} ..." -f $extensionAsset.name) -ForegroundColor Cyan
        Invoke-WebRequest -Uri $extensionAsset.browser_download_url -OutFile $extensionPath -UseBasicParsing -TimeoutSec 600

        Write-Host "  Downloading bridge_mcp_ghidra.py ..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $bridgeAsset.browser_download_url -OutFile $bridgePath -UseBasicParsing -TimeoutSec 600

        Write-Host "  Downloading requirements.txt ..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $requirementsAsset.browser_download_url -OutFile $requirementsPath -UseBasicParsing -TimeoutSec 600

        ("Release: {0}`nTag: {1}`nExtensionZip: {2}`nDownloadedAt: {3}`n" -f $release.name, $release.tag_name, $extensionPath, (Get-Date).ToString("s")) |
            Set-Content -LiteralPath (Join-Path $targetDir "release.txt") -Encoding UTF8

        if (-not (Install-GhidraMcpRequirements -McpDir $targetDir)) {
            return $false
        }

        Write-Host ("  [OK]   GhidraMCP release assets saved to {0}" -f $targetDir) -ForegroundColor Green
        Write-Host ("         Extension ZIP: {0}" -f $extensionPath) -ForegroundColor Cyan
        Write-Host "         In Ghidra GUI: File > Install Extensions > Add" -ForegroundColor Cyan
        Write-Host "         Select the extension ZIP above, restart Ghidra, then enable:" -ForegroundColor Cyan
        Write-Host "         File > Configure > Configure All Plugins > GhidraMCP" -ForegroundColor Cyan
        Write-Host "         Then start: Tools > GhidraMCP > Start MCP Server" -ForegroundColor Cyan
        return $true
    }
    catch {
        Write-Host ("  [FAIL] {0}" -f $_.Exception.Message) -ForegroundColor Red
        return $false
    }
}

function Install-GhidraMcpRequirements {
    param([Parameter(Mandatory)] [string]$McpDir)

    $requirementsPath = Join-Path $McpDir "requirements.txt"
    if (-not (Test-Path -LiteralPath $requirementsPath)) {
        Write-Host "  [FAIL] requirements.txt not found: $requirementsPath" -ForegroundColor Red
        return $false
    }

    $venvDir = Join-Path $McpDir ".venv"
    $venvPython = Join-Path $venvDir "Scripts\python.exe"
    $toolkitPython = if (Test-Path -LiteralPath $PythonExe) { $PythonExe } else { $null }
    $uv = Get-Command "uv" -ErrorAction SilentlyContinue

    try {
        if ($uv) {
            if (-not (Test-Path -LiteralPath $venvPython)) {
                Write-Host ("  Creating MCP bridge venv: {0}" -f $venvDir) -ForegroundColor Cyan
                if ($toolkitPython) {
                    & uv venv --python $toolkitPython $venvDir
                }
                else {
                    & uv venv $venvDir
                }
                if ($LASTEXITCODE -ne 0) { throw "uv venv failed with exit code $LASTEXITCODE" }
            }

            Write-Host "  Installing MCP bridge requirements with uv..." -ForegroundColor Cyan
            & uv pip install --python $venvPython -r $requirementsPath
            if ($LASTEXITCODE -ne 0) { throw "uv pip install --python failed with exit code $LASTEXITCODE" }
        }
        else {
            $pythonPath = $toolkitPython
            if (-not $pythonPath) {
                $python = Get-Command "python" -ErrorAction SilentlyContinue
                if ($python) { $pythonPath = $python.Source }
            }

            if (-not $pythonPath) {
                Write-Host "  [FAIL] uv and python are both missing. Run -InstallRuntime or install uv." -ForegroundColor Red
                return $false
            }

            if (-not (Test-Path -LiteralPath $venvPython)) {
                Write-Host ("  Creating MCP bridge venv with python: {0}" -f $venvDir) -ForegroundColor Cyan
                & $pythonPath -m venv $venvDir
                if ($LASTEXITCODE -ne 0) { throw "python -m venv failed with exit code $LASTEXITCODE" }
            }

            Write-Host "  Installing MCP bridge requirements with pip..." -ForegroundColor Cyan
            & $venvPython -m pip install -r $requirementsPath
            if ($LASTEXITCODE -ne 0) { throw "pip install failed with exit code $LASTEXITCODE" }
        }

        Write-Host ("  [OK]   MCP bridge Python env: {0}" -f $venvPython) -ForegroundColor Green
        return $true
    }
    catch {
        Write-Host ("  [FAIL] {0}" -f $_.Exception.Message) -ForegroundColor Red
        return $false
    }
}

function Install-AssetRipper {
    param([string]$ToolsDir, [string]$Repo)

    $targetDir = Join-Path $ToolsDir "AssetRipper"
    $targetExe = Join-Path $targetDir "AssetRipper.exe"

    if (Test-Path -LiteralPath $targetExe) {
        Write-Host "  [SKIP] AssetRipper already at $targetExe" -ForegroundColor Yellow
        return $true
    }

    $zipPath    = Join-Path $env:TEMP "AssetRipper_win_x64.zip"
    $extractDir = Join-Path $env:TEMP ("AssetRipper_" + [guid]::NewGuid().ToString("N"))

    try {
        Write-Host "  Querying $Repo latest Windows release..." -ForegroundColor Cyan
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -UseBasicParsing -TimeoutSec 30 -Headers @{"User-Agent"="re-toolkit"}

        $asset = $release.assets | Where-Object { $_.name -eq "AssetRipper_win_x64.zip" } | Select-Object -First 1
        if (-not $asset) {
            Write-Host "  [FAIL] AssetRipper_win_x64.zip not in latest release." -ForegroundColor Red
            return $false
        }

        Write-Host ("  Downloading {0} ({1} MB)..." -f $asset.name, [math]::Round($asset.size/1MB,1)) -ForegroundColor Cyan
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UseBasicParsing -TimeoutSec 900

        if (Test-Path -LiteralPath $targetDir) { Remove-Item -LiteralPath $targetDir -Recurse -Force }
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

        New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

        $items = Get-ChildItem -LiteralPath $extractDir -Force
        $inner = if ($items.Count -eq 1 -and $items[0].PSIsContainer) { $items[0].FullName } else { $extractDir }

        Get-ChildItem -LiteralPath $inner -Force | ForEach-Object {
            if ($_.PSIsContainer) {
                Copy-Item -LiteralPath $_.FullName -Destination $targetDir -Recurse -Force
            } else {
                Copy-Item -LiteralPath $_.FullName -Destination $targetDir -Force
            }
        }

        $guiFree = Get-ChildItem -LiteralPath $targetDir -Recurse -Filter "AssetRipper.GUI.Free.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($guiFree -and -not (Test-Path -LiteralPath $targetExe)) {
            Copy-Item -LiteralPath $guiFree.FullName -Destination $targetExe -Force
        }

        if (Test-Path -LiteralPath $targetExe) {
            Write-Host ("  [OK]   AssetRipper installed at {0}" -f $targetDir) -ForegroundColor Green
            if ($guiFree) {
                $relSrc = $guiFree.FullName.Substring($targetDir.Length).TrimStart('\','/')
                Write-Host  ("         Original: {0}" -f $relSrc) -ForegroundColor Cyan
                Write-Host          "         Aliased : AssetRipper.exe (clone of AssetRipper.GUI.Free.exe)" -ForegroundColor Cyan
            }
            return $true
        }
        Write-Host "  [FAIL] AssetRipper.exe not created." -ForegroundColor Red
        return $false
    } catch {
        Write-Host "  [FAIL] $_" -ForegroundColor Red
        return $false
    } finally {
        if (Test-Path -LiteralPath $zipPath)    { Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

function Install-Il2CppDumper {
    param([string]$ToolsDir, [string]$Version)

    $il2cppDir = Join-Path $ToolsDir "Il2CppDumper"
    $il2cppExe = Join-Path $il2cppDir "Il2CppDumper.exe"
    if (Test-Path -LiteralPath $il2cppExe) {
        Repair-Il2CppDumperGhidraTemplates -Dir $il2cppDir | Out-Null
        Write-Host "  [SKIP] Il2CppDumper already at $il2cppExe" -ForegroundColor Yellow
        return $true
    }

    if (-not (Get-Command "dotnet" -ErrorAction SilentlyContinue)) {
        Write-Host "  [FAIL] dotnet not on PATH. Run with -InstallRuntime for JDK/Python; .NET runtime is separate: winget install Microsoft.DotNet.Runtime.6" -ForegroundColor Red
        return $false
    }

    $runtimesText = (& dotnet --list-runtimes 2>&1 | Out-String)

    # Il2CppDumper releases are published as framework-dependent builds such as
    # net6.0 and net8.0.  Detect the actual Microsoft.NETCore.App runtime version,
    # not Microsoft.AspNetCore.App / WindowsDesktop.App, then choose the closest
    # package.  Keep this compatible with Windows PowerShell 5.1.
    $hasNet8 = $runtimesText -match '(?m)^Microsoft\.NETCore\.App\s+8\.'
    $hasNet6 = $runtimesText -match '(?m)^Microsoft\.NETCore\.App\s+6\.'

    if ($hasNet8) {
        $tfm = "net8.0"
    } elseif ($hasNet6) {
        $tfm = "net6.0"
    } else {
        $tfm = "net6.0"
        Write-Host "  [WARN] Microsoft.NETCore.App 6.x/8.x was not detected." -ForegroundColor Yellow
        Write-Host "         Il2CppDumper will be downloaded as net6.0; install runtime if it fails:" -ForegroundColor Yellow
        Write-Host "           winget install Microsoft.DotNet.Runtime.6" -ForegroundColor Yellow
        Write-Host "           winget install Microsoft.DotNet.DesktopRuntime.6" -ForegroundColor Yellow
    }

    $url = "https://github.com/wklin8607/Il2CppDumper/releases/download/Il2CppDumper/Il2CppDumper-v$Version-$tfm.zip"
    $zipPath = Join-Path $env:TEMP "Il2CppDumper-v$Version-$tfm.zip"
    $extractDir = Join-Path $env:TEMP ("Il2CppDumper_" + [guid]::NewGuid().ToString("N"))

    try {
        Write-Host ("  Downloading Il2CppDumper v{0} ({1})..." -f $Version, $tfm) -ForegroundColor Cyan
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -TimeoutSec 600

        New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

        if (Test-Path -LiteralPath $il2cppDir) { Remove-Item -LiteralPath $il2cppDir -Recurse -Force }
        New-Item -ItemType Directory -Path $il2cppDir -Force | Out-Null

        $items = Get-ChildItem -LiteralPath $extractDir -Force
        if ($items.Count -eq 1 -and $items[0].PSIsContainer) {
            Get-ChildItem -LiteralPath $items[0].FullName -Force | ForEach-Object {
                Move-Item -LiteralPath $_.FullName -Destination $il2cppDir -Force
            }
        } else {
            $items | ForEach-Object {
                Move-Item -LiteralPath $_.FullName -Destination $il2cppDir -Force
            }
        }

        if (Test-Path -LiteralPath $il2cppExe) {
            Repair-Il2CppDumperGhidraTemplates -Dir $il2cppDir | Out-Null
            Write-Host ("  [OK]   Il2CppDumper v{0} ({1}) installed at {2}" -f $Version, $tfm, $il2cppDir) -ForegroundColor Green
            return $true
        }
        Write-Host "  [FAIL] Il2CppDumper.exe missing after extraction." -ForegroundColor Red
        return $false
    } catch {
        Write-Host "  [FAIL] $_" -ForegroundColor Red
        return $false
    } finally {
        if (Test-Path -LiteralPath $zipPath)    { Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

$startSweep = Clear-RetkTemp

Write-Host "RE Toolkit Setup" -ForegroundColor Magenta
Write-Host "InstallDir : $InstallDir"
Write-Host "Host       : $env:COMPUTERNAME"
Write-Host "OS         : $([System.Environment]::OSVersion.VersionString)"
if ($startSweep -gt 0) {
    Write-Host ("Pre-run sweep: cleared {0} leftover temp item(s) from previous interrupted runs." -f $startSweep) -ForegroundColor DarkGray
}

if ($InstallRuntime) {
    Write-Section "Runtime install (auto)"
    New-Item -ItemType Directory -Path $Runtime -Force | Out-Null
    Invoke-Install "Java"   { Install-Java   -Major     $JdkVersion    | Out-Null }
    Invoke-Install "Python" { Install-Python -Version   $PythonVersion | Out-Null }
    Refresh-Path
}

Write-Section "Runtime checks"

$java = Test-Command "java"
$javaOk = $false
$javaOnPath = Get-Command "java" -ErrorAction SilentlyContinue
if ($javaOnPath) {
    try {
        $ver = (cmd /c "java -version 2>&1" | Select-Object -First 1) -replace '"',''
        if (-not $ver) { $ver = "found" }
        Write-Host ("  [OK]   java                  {0} (system)" -f $ver.Trim()) -ForegroundColor Green
        $javaOk = $true
    } catch {
        Write-Host "  [OK]   java                  (found on PATH)" -ForegroundColor Green
        $javaOk = $true
    }
} else {
    $javaOk = $false
}

$portableJavaExe = Join-Path $PortableJava "bin\java.exe"
if (Test-Path -LiteralPath $portableJavaExe) {
    try {
        $pver = (cmd /c "`"$portableJavaExe`" -version 2>&1" | Select-Object -First 1) -replace '"',''
        if (-not $pver) { $pver = "found" }
        Write-Host ("  [OK]   java (portable)       {0}" -f $pver.Trim()) -ForegroundColor Green
        Write-Host  ("                            {0}" -f $PortableJava) -ForegroundColor DarkGray
        $javaOk = $true
    } catch {
        Write-Host "  [OK]   java (portable)       found" -ForegroundColor Green
        Write-Host  ("                            {0}" -f $PortableJava) -ForegroundColor DarkGray
        $javaOk = $true
    }
} elseif (-not $javaOk) {
    Write-Host "  [WARN] java                  NOT FOUND. Run with -InstallRuntime." -ForegroundColor Yellow
}

$pythonOk = $false
if (Test-Path -LiteralPath $PythonExe) {
    try {
        $pyVer = & $PythonExe --version 2>&1
        Write-Host ("  [OK]   python (toolkit)      {0}" -f $pyVer) -ForegroundColor Green
        Write-Host ("                            {0}" -f $PythonDir) -ForegroundColor DarkGray
        $pythonOk = $true
    }
    catch {
        Write-Host ("  [WARN] python (toolkit)      found but failed to run: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    }
}
else {
    Write-Host ("  [WARN] python (toolkit)      NOT FOUND. Run with -InstallRuntime. Expected: {0}" -f $PythonExe) -ForegroundColor Yellow
}

$python = Test-Command "python"
if ($python.Found) {
    try {
        $pyVer = & $python.Path --version 2>&1
        Write-Host ("  [INFO] python (system)       {0} at {1}" -f $pyVer, $python.Path) -ForegroundColor DarkGray
    }
    catch {
        Write-Host ("  [INFO] python (system)       found but failed to run: {0}" -f $_.Exception.Message) -ForegroundColor DarkGray
    }
}

if (Test-Path -LiteralPath $PyGhidraPython) {
    Write-Host ("  [OK]   python (PyGhidra)     {0}" -f $PyGhidraPython) -ForegroundColor Green
}
elseif ($pythonOk) {
    Write-Host ("  [WARN] python (PyGhidra)     venv missing. Run -InstallRuntime again or start .\re.ps1 pyghidra-gui to create it.") -ForegroundColor Yellow
}

$dotnet = Test-Command "dotnet"
if ($dotnet.Found) {
    $runtimes = & dotnet --list-runtimes 2>&1
    $desktop = $runtimes | Where-Object { $_ -match "WindowsDesktop" } | Select-Object -First 1
    $core    = $runtimes | Where-Object { $_ -match "App" }        | Select-Object -First 1
    Write-Host ("  [OK]   dotnet                {0}" -f $core) -ForegroundColor Green
    if (-not $desktop) {
        Write-Host "         Missing WindowsDesktop runtime (needed by Il2CppDumper). Install with:" -ForegroundColor Yellow
        Write-Host "           winget install Microsoft.DotNet.DesktopRuntime.8" -ForegroundColor Yellow
    } else {
        Write-Host ("         Desktop runtime: {0}" -f $desktop) -ForegroundColor Green
    }
} else {
    Write-Host "  [WARN] dotnet                NOT FOUND. Install .NET Desktop Runtime matching Il2CppDumper." -ForegroundColor Yellow
}

$uv = Test-Command "uv"
if ($uv.Found) {
    Write-Host ("  [OK]   uv                    {0}" -f (& uv --version)) -ForegroundColor Green
} else {
    Write-Host "  [WARN] uv                    NOT FOUND. Install: irm https://astral.sh/uv/install.ps1 | iex" -ForegroundColor Yellow
}

Write-Section "Tool folders"

$Tools = Join-Path $InstallDir "tools"
$toolsGhidra   = Join-Path $Tools "ghidra"
$toolsIl2cpp   = Join-Path $Tools "Il2CppDumper\Il2CppDumper.exe"
$toolsMcp      = Join-Path $Tools "ghidra-mcp\bridge_mcp_ghidra.py"
$toolsRipper   = Join-Path $Tools "AssetRipper\AssetRipper.exe"

if ($InstallGhidra) {
    if (-not $javaOk) {
        Write-Host "  [FAIL] JDK required before Ghidra install. Run with -InstallRuntime first." -ForegroundColor Red
    } else {
        Invoke-Install "Ghidra" { Install-GhidraRuntime -ToolsDir $Tools -Version $GhidraVersion | Out-Null }
    }
} else {
    Test-PathExists $toolsGhidra "Ghidra root" | Out-Null
}

if ($InstallIl2CppDumper) {
    Invoke-Install "Il2CppDumper" { Install-Il2CppDumper -ToolsDir $Tools -Version $Il2CppDumperVersion | Out-Null }
}
$il2cppOk = Test-PathExists $toolsIl2cpp "Il2CppDumper"
if ($il2cppOk) {
    Repair-Il2CppDumperGhidraTemplates -Dir (Join-Path $Tools "Il2CppDumper") | Out-Null
}
if (-not ($il2cppOk)) {
    Write-Host "         Tip: re-run with -InstallIl2CppDumper, or drop the binary at tools/Il2CppDumper/Il2CppDumper.exe" -ForegroundColor Yellow
}

$mcpOk = Test-PathExists $toolsMcp "Ghidra MCP bridge"
if (-not ($mcpOk)) {
    Write-Host "         Tip: re-run with -InstallGhidraMcp to install bethington/ghidra-mcp." -ForegroundColor Yellow
}

if ($InstallGhidraMcp) {
    Invoke-Install "GhidraMCP" { Install-GhidraMcp -ToolsDir $Tools -ReleaseApi $GhidraMcpReleaseApi -GhidraRoot $toolsGhidra | Out-Null }
    $mcpOk = Test-PathExists $toolsMcp "Ghidra MCP bridge"
}

if ($InstallAssetRipper) {
    Invoke-Install "AssetRipper" { Install-AssetRipper -ToolsDir $Tools -Repo $AssetRipperRepo | Out-Null }
}
Test-PathExists $toolsRipper "AssetRipper" | Out-Null

Write-Section "Workspace template"

$template = Join-Path $InstallDir "workspace-template"
$templateFolders = @(
    "00_OriginalBuild",
    "01_Extracted",
    "02_Il2CppDumperOutput",
    "03_GhidraProject",
    "04_Notes",
    "05_ReconstructedSource"
)
foreach ($f in $templateFolders) {
    $p = Join-Path $template $f
    if (-not (Test-Path -LiteralPath $p)) {
        New-Item -ItemType Directory -Path $p -Force | Out-Null
    }
    Write-Host ("  [OK]   {0}" -f $p) -ForegroundColor Green
}

Write-Section "Sample MCP configs"
Get-ChildItem -LiteralPath (Join-Path $InstallDir "config") -Filter *.json -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ("  [OK]   {0}" -f $_.FullName) -ForegroundColor Green
}
Get-ChildItem -LiteralPath (Join-Path $InstallDir "config") -Filter *.toml -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ("  [OK]   {0}" -f $_.FullName) -ForegroundColor Green
}
$prompts = Join-Path $InstallDir "prompts"
if (Test-Path -LiteralPath $prompts) {
    Get-ChildItem -LiteralPath $prompts -Filter *.md -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host ("  [OK]   {0}" -f $_.FullName) -ForegroundColor Green
    }
}

Write-Section "Summary"

$missing = @()
if (-not $javaOk)        { $missing += "java (run -InstallRuntime)" }
if (-not $pythonOk)      { $missing += "python (run -InstallRuntime)" }
if (-not $dotnet.Found)  { $missing += ".NET" }
if (-not $uv.Found)      { $missing += "uv" }
if (-not (Test-Path -LiteralPath $toolsGhidra)) { $missing += "Ghidra (run -InstallGhidra)" }
if (-not $il2cppOk)      { $missing += "Il2CppDumper (run -InstallIl2CppDumper)" }
$ripperOk = Test-Path -LiteralPath $toolsRipper
if (-not $mcpOk)         { $missing += "Ghidra MCP (run -InstallGhidraMcp)" }
if (-not $ripperOk)      { $missing += "AssetRipper (run -InstallAssetRipper)" }

if ($missing.Count -eq 0) {
    Write-Host "All required components present. Toolkit ready." -ForegroundColor Green
} else {
    Write-Host ("Missing: " + ($missing -join ", ")) -ForegroundColor Yellow
    Write-Host "The toolkit will still work for commands whose dependencies are present."
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  .\install-re-toolkit.ps1 -InstallRuntime                # portable JDK + toolkit-local Python 3.12"
Write-Host "  .\install-re-toolkit.ps1 -InstallGhidra                 # Ghidra"
Write-Host "  .\install-re-toolkit.ps1 -InstallIl2CppDumper           # wklin8607/Il2CppDumper v6.7.48"
Write-Host "  .\install-re-toolkit.ps1 -InstallGhidraMcp              # bethington/ghidra-mcp plugin + bridge"
Write-Host "  .\install-re-toolkit.ps1 -InstallAssetRipper            # AssetRipper/AssetRipper latest"
Write-Host "  .\re.ps1 doctor                                        # check toolkit health"
Write-Host "  .\re.ps1 init    <GameName>"
Write-Host "  .\re.ps1 scan    <GameName> <ExtractedPath>             # detect libil2cpp.so / GameAssembly.dll"
Write-Host "  .\re.ps1 dump    <GameName>                             # run Il2CppDumper"
Write-Host "  .\re.ps1 import  <GameName>                             # Ghidra headless import, no analysis"
Write-Host "  .\re.ps1 flow    <GameName> <ExtractedPath>             # prepare project and open PyGhidra"
Write-Host "  .\re.ps1 ghidra-gui                                     # full GUI"
Write-Host "  .\re.ps1 mcp                                            # Ghidra MCP bridge"
Write-Host "  In Ghidra: File > Configure > Configure All Plugins > GhidraMCP"
Write-Host "  In Ghidra: Tools > GhidraMCP > Start MCP Server"

$endSweep = Clear-RetkTemp
if ($endSweep -gt 0) {
    Write-Host ""
    Write-Host ("Final temp sweep: cleared {0} leftover item(s) at script exit." -f $endSweep) -ForegroundColor DarkGray
}
