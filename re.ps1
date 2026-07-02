[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Command,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Rest
)

$ErrorActionPreference = "Stop"

$Root       = Split-Path -Parent $MyInvocation.MyCommand.Path
$Tools      = Join-Path $Root "tools"
$Workspaces = Join-Path $Root "workspaces"

if ($null -eq $Rest) { $Rest = @() }
if ($Rest.Count -gt 0 -and $Rest[0] -eq "--%") {
    if ($Rest.Count -gt 1) { $Rest = $Rest[1..($Rest.Count - 1)] } else { $Rest = @() }
}

$ToolPaths = [ordered]@{
    JdkRoot          = Join-Path $Root  "runtime\java\jdk-21"
    JavaExe          = Join-Path $Root  "runtime\java\jdk-21\bin\java.exe"
    PythonRoot       = Join-Path $Root  "runtime\python\python-3.12"
    PythonExe        = Join-Path $Root  "runtime\python\python-3.12\python.exe"
    PyGhidraVenv     = Join-Path $Root  "runtime\python\pyghidra-venv"
    PyGhidraPython   = Join-Path $Root  "runtime\python\pyghidra-venv\Scripts\python.exe"
    GhidraRoot       = Join-Path $Tools "ghidra"
    GhidraMcpBridge  = Join-Path $Tools "ghidra-mcp\bridge_mcp_ghidra.py"
    GhidraGuiBat     = Join-Path $Tools "ghidra\ghidraRun.bat"
    PyGhidraDist     = Join-Path $Tools "ghidra\Ghidra\Features\PyGhidra\pypkg\dist"
    AnalyzeHeadless  = Join-Path $Tools "ghidra\support\analyzeHeadless.bat"
    Dumper           = Join-Path $Tools "Il2CppDumper\Il2CppDumper.exe"
}

function Assert-PathExists {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$Name,
        [switch]$Directory
    )

    $ok = if ($Directory) {
        Test-Path -LiteralPath $Path -PathType Container
    } else {
        Test-Path -LiteralPath $Path
    }

    if (-not $ok) {
        $hint = switch -Regex ($Name) {
            "JDK 21"       { "Run local JDK installer, then ensure runtime\java\jdk-21\bin\java.exe exists." }
            "Python"       { "Run .\install-re-toolkit.ps1 -InstallRuntime, then ensure runtime\python\python-3.12\python.exe exists." }
            "Ghidra MCP"   { "Run .\install-re-toolkit.ps1 -InstallGhidraMcp." }
            "Ghidra GUI"   { "Install Ghidra into tools\ghidra." }
            "PyGhidra"     { "Check tools\ghidra\Ghidra\Features\PyGhidra\pypkg\dist." }
            "Headless"     { "Check tools\ghidra\support\analyzeHeadless.bat." }
            "Il2CppDumper" { "Install Il2CppDumper into tools\Il2CppDumper\Il2CppDumper.exe." }
            default         { "" }
        }
        throw "[FAIL] $Name not found: $Path`n$hint"
    }
}

function Invoke-WithToolkitEnv {
    param([Parameter(Mandatory)] [scriptblock]$ScriptBlock)

    $oldJavaHome          = $env:JAVA_HOME
    $oldJavaHomeOverride  = $env:JAVA_HOME_OVERRIDE
    $oldGhidraInstallDir  = $env:GHIDRA_INSTALL_DIR
    $oldPyGhidraPython    = $env:PYGHIDRA_PYTHON
    $oldPythonNoUserSite  = $env:PYTHONNOUSERSITE
    $oldPythonPath        = $env:PYTHONPATH
    $oldPath              = $env:Path

    try {
        # Do not permanently override the user's Java setup.
        # JAVA_HOME_OVERRIDE is what Ghidra launchers prefer.
        $env:JAVA_HOME_OVERRIDE = $ToolPaths.JdkRoot
        $env:GHIDRA_INSTALL_DIR = $ToolPaths.GhidraRoot
        if (Test-Path -LiteralPath $ToolPaths.PythonExe) {
            $selectedPython = if (Test-Path -LiteralPath $ToolPaths.PyGhidraPython) { $ToolPaths.PyGhidraPython } else { $ToolPaths.PythonExe }
            $env:PYGHIDRA_PYTHON = $selectedPython
            $env:PYTHONNOUSERSITE = "1"
            $env:PYTHONPATH = ""
            $env:Path = "$($ToolPaths.PyGhidraVenv)\Scripts;$($ToolPaths.PythonRoot);$($ToolPaths.PythonRoot)\Scripts;$($ToolPaths.JdkRoot)\bin;$oldPath"
        }
        else {
            $env:Path = "$($ToolPaths.JdkRoot)\bin;$oldPath"
        }

        # Important: return/emit the scriptblock result to the caller.
        # Without this, assignments inside the scriptblock can stay in a child scope,
        # leaving caller variables like $result as $null.
        & $ScriptBlock
    }
    finally {
        $env:JAVA_HOME          = $oldJavaHome
        $env:JAVA_HOME_OVERRIDE = $oldJavaHomeOverride
        $env:GHIDRA_INSTALL_DIR = $oldGhidraInstallDir
        $env:PYGHIDRA_PYTHON    = $oldPyGhidraPython
        $env:PYTHONNOUSERSITE   = $oldPythonNoUserSite
        $env:PYTHONPATH         = $oldPythonPath
        $env:Path               = $oldPath
    }
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

function Join-NativeArgumentString {
    param([Parameter()] [string[]]$Arguments)

    if ($null -eq $Arguments) { return "" }

    $quoted = New-Object System.Collections.Generic.List[string]
    foreach ($arg in $Arguments) {
        if ($null -eq $arg) {
            [void]$quoted.Add('""')
            continue
        }

        $s = [string]$arg

        # Windows PowerShell 5.1 compatibility:
        # ProcessStartInfo.ArgumentList is not reliable/available there, so we build
        # ProcessStartInfo.Arguments manually. Quote every argument to preserve paths
        # with spaces and options exactly enough for this toolkit use case.
        $s = $s.Replace('"', '\"')
        [void]$quoted.Add('"' + $s + '"')
    }

    return ($quoted -join ' ')
}

function Invoke-NativeProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [Parameter()] [string[]]$Arguments,
        [Parameter()] [string]$WorkingDirectory
    )

    if ($null -eq $Arguments) { $Arguments = @() }

    if (-not (Test-Path -LiteralPath $FilePath)) {
        throw "Native process not found: $FilePath"
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.Arguments = Join-NativeArgumentString $Arguments

    if ($WorkingDirectory) {
        $psi.WorkingDirectory = $WorkingDirectory
    }

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi

    $started = $proc.Start()
    if (-not $started) {
        throw "Failed to start native process: $FilePath"
    }

    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    $lines = New-Object System.Collections.Generic.List[string]

    if (-not [string]::IsNullOrWhiteSpace($stdout)) {
        foreach ($line in ($stdout -split "`r?`n")) {
            if ($line -ne "") { [void]$lines.Add($line) }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($stderr)) {
        foreach ($line in ($stderr -split "`r?`n")) {
            if ($line -ne "") { [void]$lines.Add($line) }
        }
    }

    return [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Lines    = @($lines)
        StdOut   = $stdout
        StdErr   = $stderr
        Command  = ("{0} {1}" -f $FilePath, $psi.Arguments)
    }
}

function Invoke-AnalyzeHeadless {
    param([Parameter(Mandatory)] [string[]]$HeadlessArgs)

    Assert-PathExists $ToolPaths.AnalyzeHeadless "Ghidra Headless Analyzer"
    Assert-PathExists $ToolPaths.JavaExe         "Toolkit JDK 21"

    $result = Invoke-WithToolkitEnv {
        Invoke-NativeProcess -FilePath $ToolPaths.AnalyzeHeadless -Arguments $HeadlessArgs -WorkingDirectory $Root
    }

    if ($result -is [array]) { $result = $result | Select-Object -Last 1 }
    if ($null -eq $result) { throw "Invoke-AnalyzeHeadless internal error: process result is null." }

    $outputLines = @($result.Lines)
    $outputLines | ForEach-Object { Write-Host $_ }

    if ($result.ExitCode -ne 0) {
        $errText = ($outputLines | Select-Object -Last 12) -join "`n"
        throw "analyzeHeadless exited with code $($result.ExitCode).`nLast output:`n$errText"
    }
    return $outputLines
}

function Invoke-NativeProcessHeartbeat {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [Parameter()] [string[]]$Arguments,
        [Parameter()] [string]$WorkingDirectory,
        [string]$Activity = "Running native process",
        [int]$HeartbeatSeconds = 10,
        [string]$LogFile
    )

    if ($null -eq $Arguments) { $Arguments = @() }
    if (-not (Test-Path -LiteralPath $FilePath)) {
        throw "Native process not found: $FilePath"
    }

    $argString = Join-NativeArgumentString $Arguments
    $commandLine = "{0} {1}" -f $FilePath, $argString

    if ($LogFile) {
        $dir = Split-Path -Parent $LogFile
        if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        @(
            "# $Activity",
            "StartedAt: $((Get-Date).ToString('s'))",
            "Command: $commandLine",
            ""
        ) | Out-File -LiteralPath $LogFile -Encoding UTF8
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = $argString
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $false
    $psi.RedirectStandardError = $false
    $psi.CreateNoWindow = $false
    if ($WorkingDirectory) { $psi.WorkingDirectory = $WorkingDirectory }

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi

    Write-Host ("[RUN] {0}" -f $Activity) -ForegroundColor Cyan
    Write-Host ("      {0}" -f $commandLine) -ForegroundColor DarkGray

    $started = $proc.Start()
    if (-not $started) { throw "Failed to start native process: $FilePath" }

    $startTime = Get-Date
    $lastHeartbeat = $startTime.AddSeconds(-1 * $HeartbeatSeconds)

    while (-not $proc.WaitForExit(1000)) {
        $now = Get-Date
        $elapsed = New-TimeSpan -Start $startTime -End $now
        Write-Progress -Activity $Activity -Status ("elapsed {0:hh\:mm\:ss}" -f $elapsed)

        if (($now - $lastHeartbeat).TotalSeconds -ge $HeartbeatSeconds) {
            $message = "[... still running] {0} elapsed {1:hh\:mm\:ss}" -f $Activity, $elapsed
            Write-Host $message -ForegroundColor DarkGray
            if ($LogFile) { Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value $message }
            $lastHeartbeat = $now
        }
    }

    Write-Progress -Activity $Activity -Completed
    $proc.WaitForExit()

    $endMessage = "FinishedAt: $((Get-Date).ToString('s')); ExitCode: $($proc.ExitCode)"
    if ($LogFile) { Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value $endMessage }

    return [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Lines    = @($endMessage)
        StdOut   = ""
        StdErr   = ""
        Command  = $commandLine
    }
}

function Invoke-AnalyzeHeadlessHeartbeat {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string[]]$HeadlessArgs,
        [string]$Activity = "Ghidra Headless Analyzer",
        [string]$LogFile
    )

    Assert-PathExists $ToolPaths.AnalyzeHeadless "Ghidra Headless Analyzer"
    Assert-PathExists $ToolPaths.JavaExe         "Toolkit JDK 21"

    $result = Invoke-WithToolkitEnv {
        Invoke-NativeProcessHeartbeat -FilePath $ToolPaths.AnalyzeHeadless -Arguments $HeadlessArgs -WorkingDirectory $Root -Activity $Activity -LogFile $LogFile
    }

    if ($result -is [array]) { $result = $result | Select-Object -Last 1 }
    if ($null -eq $result) { throw "Invoke-AnalyzeHeadlessHeartbeat internal error: process result is null." }

    if ($result.ExitCode -ne 0) {
        throw "analyzeHeadless exited with code $($result.ExitCode).`nCommand: $($result.Command)`nCheck console output above and log: $LogFile"
    }

    return @($result.Lines)
}


function Get-WorkspacePath {
    param([Parameter(Mandatory)] [string]$GameName)
    return Join-Path $Workspaces $GameName
}

function Get-ProjectJsonPath {
    param([Parameter(Mandatory)] [string]$GameName)
    return Join-Path (Get-WorkspacePath $GameName) "project.re.json"
}

function Read-Project {
    param([Parameter(Mandatory)] [string]$GameName)

    $path = Get-ProjectJsonPath $GameName
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Project config not found: $path. Run: .\re.ps1 init $GameName"
    }
    return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
}

function Save-Project {
    param(
        [Parameter(Mandatory)] [string]$GameName,
        [Parameter(Mandatory)] [object]$Project
    )

    $path = Get-ProjectJsonPath $GameName
    $dir = Split-Path -Parent $path
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $Project | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $path -Encoding UTF8
}


function Set-ProjectStatusValue {
    param(
        [Parameter(Mandatory)] [object]$Project,
        [Parameter(Mandatory)] [string]$Name,
        [Parameter()] $Value
    )

    if ($null -eq $Project.status) {
        $statusObject = New-Object psobject
        Add-Member -InputObject $Project -MemberType NoteProperty -Name "status" -Value $statusObject -Force
    }

    $prop = $Project.status.PSObject.Properties[$Name]
    if ($null -eq $prop) {
        Add-Member -InputObject $Project.status -MemberType NoteProperty -Name $Name -Value $Value -Force
    }
    else {
        $Project.status.$Name = $Value
    }
}


function Test-GhidraLockError {
    param([Parameter()] [string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    return ($Text -match "LockException|Unable to lock project|already open|in use|Project.*lock")
}

function Get-GhidraGuiProcessHint {
    param([Parameter(Mandatory)] [object]$Project)

    $projectDir = [string]$Project.ghidraProjectDir
    $projectName = [string]$Project.ghidraProjectName

    try {
        $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                ($_.Name -match "(?i)java|ghidra") -and
                ($_.CommandLine -match [regex]::Escape($projectDir) -or $_.CommandLine -match [regex]::Escape($projectName))
            } |
            Select-Object -First 5 ProcessId, Name, CommandLine

        if ($procs) {
            $lines = $procs | ForEach-Object { "PID=$($_.ProcessId) Name=$($_.Name)" }
            return ($lines -join "`n")
        }
    }
    catch {
        return ""
    }

    return ""
}

function New-GhidraProjectLockedMessage {
    param([Parameter(Mandatory)] [object]$Project)

    $hint = Get-GhidraGuiProcessHint -Project $Project
    $processText = if ([string]::IsNullOrWhiteSpace($hint)) {
        "No matching Ghidra process was found by command-line scan, but the project lock is still active."
    }
    else {
        "Possible locking process:`n$hint"
    }

    return @"
Ghidra project is locked:
$($Project.ghidraProjectDir)\$($Project.ghidraProjectName)

Most likely cause:
- The Ghidra GUI is open on this project, or another Ghidra MCP/headless process is still running.

Fix:
1. Save your work in Ghidra GUI.
2. Close the Ghidra GUI project/window for '$($Project.ghidraProjectName)'.
3. Run: .\re.ps1 ghidra stop
4. Run: .\re.ps1 analyze $($Project.name)

$processText

Note:
- analyzeHeadless cannot analyze a project that is locked by the GUI.
- If you want to keep the GUI open, use the GhidraMCP plugin from that GUI instead of headless analyze on the same project.
"@
}

function New-Workspace {
    param([Parameter(Mandatory)] [string]$GameName)

    if (-not ($GameName -match '^[A-Za-z0-9_\-.]{1,64}$')) {
        throw "Invalid project name. Use letters, digits, '_', '-', '.' only, max 64 chars."
    }

    $workspace = Get-WorkspacePath $GameName
    $projectJson = Get-ProjectJsonPath $GameName

    $folders = @(
        "00_OriginalBuild", "01_Extracted", "02_Il2CppDumperOutput",
        "03_GhidraProject", "04_Notes", "05_ReconstructedSource"
    )

    foreach ($folder in $folders) {
        New-Item -ItemType Directory -Force -Path (Join-Path $workspace $folder) | Out-Null
    }

    if (Test-Path -LiteralPath $projectJson) {
        Write-Host "[WARN] Workspace already exists. Reusing project.re.json: $projectJson" -ForegroundColor Yellow
        return
    }

    $project = [ordered]@{
        name               = $GameName
        platform           = $null
        extractedPath      = $null
        nativeBinary       = $null
        metadata           = $null
        il2cppDumperOutput = (Join-Path $workspace "02_Il2CppDumperOutput")
        ghidraProjectDir   = (Join-Path $workspace "03_GhidraProject")
        ghidraProjectName  = $GameName
        ghidraProgramName  = $null
        status = [ordered]@{
            scanned            = $false
            dumped             = $false
            imported           = $false
            analyzing          = $false
            analyzed           = $false
            symbolsApplied     = $false
            analyzeStartedAt   = $null
            analyzeCompletedAt = $null
        }
    }

    Save-Project $GameName $project
    Write-Host "Workspace created: $workspace" -ForegroundColor Green
}


function Convert-ToFileUri {
    param([Parameter(Mandatory)] [string]$Path)

    try {
        $fullPath = $Path
        if (Test-Path -LiteralPath $Path) {
            $fullPath = (Resolve-Path -LiteralPath $Path).Path
        }
        return ([System.Uri]$fullPath).AbsoluteUri
    }
    catch {
        return $Path
    }
}

function Show-GhidraProjectOpenInfo {
    param(
        [Parameter(Mandatory)] [object]$Project,
        [switch]$Compact
    )

    $projectDir  = [string]$Project.ghidraProjectDir
    $projectName = [string]$Project.ghidraProjectName
    $programName = [string]$Project.ghidraProgramName
    $gprPath     = Join-Path $projectDir ($projectName + ".gpr")

    if ($Compact) {
        Write-Host ("  Open path        : {0}" -f $projectDir)
        Write-Host ("  Open link        : {0}" -f (Convert-ToFileUri $projectDir))
        return
    }

    Write-Host ""
    Write-Host "Open this project in Ghidra GUI:" -ForegroundColor Cyan
    Write-Host ("  Project folder   : {0}" -f $projectDir) -ForegroundColor Gray
    Write-Host ("  Project link     : {0}" -f (Convert-ToFileUri $projectDir)) -ForegroundColor Gray

    if (Test-Path -LiteralPath $gprPath) {
        Write-Host ("  Ghidra .gpr      : {0}" -f $gprPath) -ForegroundColor Gray
        Write-Host ("  .gpr link        : {0}" -f (Convert-ToFileUri $gprPath)) -ForegroundColor Gray
    }
    else {
        Write-Host ("  Expected .gpr    : {0}" -f $gprPath) -ForegroundColor DarkGray
    }

    if ($programName) {
        Write-Host ("  Program          : {0}" -f $programName) -ForegroundColor Gray
    }

    Write-Host ("  Explorer command : explorer.exe `"{0}`"" -f $projectDir) -ForegroundColor DarkGray
    Write-Host ("  GUI step         : File > Open Project... > choose the folder/link above > {0}" -f $projectName) -ForegroundColor DarkGray
}

function Show-ProjectSummary {
    param([Parameter(Mandatory)] [string]$GameName)

    $project = Read-Project $GameName
    function LocalValue($v) { if ($null -eq $v -or "$v" -eq "") { "<unset>" } else { "$v" } }

    Write-Host ""
    Write-Host "== Project: $GameName ==" -ForegroundColor Magenta
    Write-Host ("  Platform         : {0}" -f (LocalValue $project.platform))
    Write-Host ("  Native binary    : {0}" -f (LocalValue $project.nativeBinary))
    Write-Host ("  Metadata         : {0}" -f (LocalValue $project.metadata))
    Write-Host ("  Il2CppDumper out : {0}" -f (LocalValue $project.il2cppDumperOutput))
    Write-Host ("  Ghidra project   : {0} (in {1})" -f (LocalValue $project.ghidraProjectName), (LocalValue $project.ghidraProjectDir))
    Show-GhidraProjectOpenInfo -Project $project -Compact
    Write-Host ("  Ghidra program   : {0}" -f (LocalValue $project.ghidraProgramName))
    Write-Host ""
    Write-Host "  Status:" -ForegroundColor Cyan
    foreach ($key in @("scanned", "dumped", "imported", "analyzing", "analyzed", "symbolsApplied")) {
        $flag = if ($project.status.$key) { "[x]" } else { "[ ]" }
        Write-Host ("    {0} {1}" -f $flag, $key)
    }
}

function Scan-UnityIl2Cpp {
    param(
        [Parameter(Mandatory)] [string]$GameName,
        [Parameter(Mandatory)] [string]$ExtractedPath
    )

    if (-not (Test-Path -LiteralPath $ExtractedPath -PathType Container)) {
        throw "Extracted path not found: $ExtractedPath"
    }

    if (-not (Test-Path -LiteralPath (Get-ProjectJsonPath $GameName))) {
        Write-Host "[INFO] Workspace not found; running init first." -ForegroundColor Cyan
        New-Workspace $GameName
    }

    $project = Read-Project $GameName
    $ExtractedPath = (Resolve-Path -LiteralPath $ExtractedPath).Path

    $arm64 = Get-ChildItem -LiteralPath $ExtractedPath -Recurse -Filter "libil2cpp.so" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "arm64-v8a" } |
        Sort-Object FullName |
        Select-Object -First 1

    $armv7 = Get-ChildItem -LiteralPath $ExtractedPath -Recurse -Filter "libil2cpp.so" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "armeabi-v7a" } |
        Sort-Object FullName |
        Select-Object -First 1

    $win = Get-ChildItem -LiteralPath $ExtractedPath -Recurse -Filter "GameAssembly.dll" -ErrorAction SilentlyContinue |
        Sort-Object FullName |
        Select-Object -First 1

    $metadataCandidates = Get-ChildItem -LiteralPath $ExtractedPath -Recurse -Filter "global-metadata.dat" -ErrorAction SilentlyContinue |
        Sort-Object FullName

    $metadata = $metadataCandidates | Select-Object -First 1
    if (-not $metadata) {
        throw "global-metadata.dat not found under: $ExtractedPath"
    }

    if ($arm64) {
        $project.platform = "android-arm64"
        $project.nativeBinary = $arm64.FullName
        $project.ghidraProgramName = "libil2cpp.so"
    }
    elseif ($armv7) {
        $project.platform = "android-armv7"
        $project.nativeBinary = $armv7.FullName
        $project.ghidraProgramName = "libil2cpp.so"
    }
    elseif ($win) {
        $project.platform = "windows-x64"
        $project.nativeBinary = $win.FullName
        $project.ghidraProgramName = "GameAssembly.dll"
    }
    else {
        throw "No IL2CPP native binary found. Expected libil2cpp.so or GameAssembly.dll under: $ExtractedPath"
    }

    $project.extractedPath = $ExtractedPath
    $project.metadata = $metadata.FullName
    $project.status.scanned = $true

    Save-Project $GameName $project

    Write-Host "Detected platform : $($project.platform)" -ForegroundColor Cyan
    Write-Host "Native binary     : $($project.nativeBinary)" -ForegroundColor Cyan
    Write-Host "Metadata          : $($project.metadata)" -ForegroundColor Cyan

    if (($metadataCandidates | Measure-Object).Count -gt 1) {
        Write-Host "[WARN] Multiple global-metadata.dat files found. Using first sorted path:" -ForegroundColor Yellow
        Write-Host "       $($metadata.FullName)" -ForegroundColor Yellow
    }
}

function Add-BuildToProject {
    param(
        [Parameter(Mandatory)] [string]$GameName,
        [Parameter(Mandatory)] [string]$ArchivePath
    )

    if (-not (Test-Path -LiteralPath $ArchivePath)) {
        throw "Archive not found: $ArchivePath"
    }

    $item = Get-Item -LiteralPath $ArchivePath
    if ($item.PSIsContainer) {
        Scan-UnityIl2Cpp $GameName $ArchivePath
        return
    }

    if (-not (Test-Path -LiteralPath (Get-ProjectJsonPath $GameName))) {
        Write-Host "[INFO] Workspace not found; running init first." -ForegroundColor Cyan
        New-Workspace $GameName
    }

    $extractedDir = Join-Path (Get-WorkspacePath $GameName) "01_Extracted"
    if (Test-Path -LiteralPath $extractedDir) {
        Get-ChildItem -LiteralPath $extractedDir -Force -ErrorAction SilentlyContinue |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Force -Path $extractedDir | Out-Null

    Write-Host "Extracting: $ArchivePath" -ForegroundColor Cyan
    Write-Host "       to : $extractedDir" -ForegroundColor Cyan

    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
        [System.IO.Compression.ZipFile]::ExtractToDirectory($ArchivePath, $extractedDir)
    }
    catch {
        throw "Extract failed: $($_.Exception.Message). File may not be a valid ZIP/APK/IPA/AAB/XAPK/APKS."
    }

    foreach ($filter in @("*.apk", "*.obb")) {
        $nested = Get-ChildItem -LiteralPath $extractedDir -Recurse -Filter $filter -ErrorAction SilentlyContinue
        if (-not $nested) { continue }

        Write-Host ""
        Write-Host ("Found {0} nested {1} file(s); flattening..." -f $nested.Count, $filter) -ForegroundColor Cyan

        foreach ($file in $nested) {
            $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
            $destDir = Join-Path $file.DirectoryName $baseName
            New-Item -ItemType Directory -Force -Path $destDir | Out-Null
            try {
                [System.IO.Compression.ZipFile]::ExtractToDirectory($file.FullName, $destDir)
                Write-Host ("  [OK]   {0} -> {1}" -f $file.Name, (Split-Path -Leaf $destDir)) -ForegroundColor Green
                Remove-Item -LiteralPath $file.FullName -Force
            }
            catch {
                Write-Host ("  [WARN] {0}: {1}" -f $file.Name, $_.Exception.Message) -ForegroundColor Yellow
            }
        }
    }

    Scan-UnityIl2Cpp $GameName $extractedDir
}

function Run-Il2CppDumper {
    param([Parameter(Mandatory)] [string]$GameName)

    Assert-PathExists $ToolPaths.Dumper "Il2CppDumper"

    $project = Read-Project $GameName
    if (-not $project.status.scanned) {
        throw "Project not scanned. Run: .\re.ps1 scan $GameName <ExtractedPath>"
    }

    New-Item -ItemType Directory -Force -Path $project.il2cppDumperOutput | Out-Null

    $dumperDir = Split-Path -Parent $ToolPaths.Dumper
    $cfgPath = Join-Path $dumperDir "config.json"
    if (Test-Path -LiteralPath $cfgPath) {
        try {
            $cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
            $changed = $false
            if ($cfg.PSObject.Properties.Name -contains "RequireAnyKey" -and $cfg.RequireAnyKey -eq $true) {
                $cfg.RequireAnyKey = $false
                $changed = $true
            }
            if ($cfg.PSObject.Properties.Name -contains "GenerateScript" -and $cfg.GenerateScript -ne $true) {
                $cfg.GenerateScript = $true
                $changed = $true
            }
            if ($changed) {
                $cfg | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $cfgPath -Encoding UTF8
                Write-Host "  [FIX] Patched Il2CppDumper config.json for automation." -ForegroundColor Cyan
            }
        }
        catch {
            Write-Host "  [WARN] Could not inspect/patch Il2CppDumper config.json: $_" -ForegroundColor Yellow
        }
    }

    Push-Location $project.il2cppDumperOutput
    try {
        & $ToolPaths.Dumper $project.nativeBinary $project.metadata $project.il2cppDumperOutput
        if ($LASTEXITCODE -ne 0) {
            throw "Il2CppDumper exited with code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }

    $dumpCs = Join-Path $project.il2cppDumperOutput "dump.cs"
    $ghidraPy = Join-Path $project.il2cppDumperOutput "ghidra.py"
    $ghidraPyFallback = Join-Path $dumperDir "ghidra.py"
    Repair-Il2CppDumperGhidraTemplates -Dir $dumperDir | Out-Null

    if (-not (Test-Path -LiteralPath $dumpCs)) {
        throw "Il2CppDumper finished but dump.cs not found in $($project.il2cppDumperOutput)."
    }

    Repair-Il2CppDumperGhidraTemplates -Dir $project.il2cppDumperOutput | Out-Null

    if (-not (Test-Path -LiteralPath $ghidraPy) -and (Test-Path -LiteralPath $ghidraPyFallback)) {
        Copy-Item -LiteralPath $ghidraPyFallback -Destination $ghidraPy -Force
        Write-Host "  [FIX] Copied ghidra.py fallback from dumper folder to project output." -ForegroundColor Cyan
    }

    if (-not (Test-Path -LiteralPath $ghidraPy)) {
        Write-Host "[WARN] ghidra.py not found. Symbols step may need manual PyGhidra fallback." -ForegroundColor Yellow
    }
    else {
        Repair-Il2CppGhidraScript -Path $ghidraPy | Out-Null
    }

    $project.status.dumped = $true
    Save-Project $GameName $project
    Write-Host "Il2CppDumper output: $($project.il2cppDumperOutput)" -ForegroundColor Green
}

function Import-GhidraProgram {
    param([Parameter(Mandatory)] [string]$GameName)

    $project = Read-Project $GameName
    if (-not $project.status.scanned) {
        throw "Project not scanned. Run: .\re.ps1 scan $GameName <ExtractedPath>"
    }

    Assert-PathExists $ToolPaths.AnalyzeHeadless "Ghidra Headless Analyzer"
    Assert-PathExists $ToolPaths.JavaExe "Toolkit JDK 21"

    New-Item -ItemType Directory -Force -Path $project.ghidraProjectDir | Out-Null

    $notesDir = Get-NotesDir $GameName
    New-Item -ItemType Directory -Force -Path $notesDir | Out-Null
    $logFile = Join-Path $notesDir "import.log"

    Write-Host "== Import only: $GameName ==" -ForegroundColor Magenta
    Write-Host "Mode    : analyzeHeadless -import -overwrite -noanalysis" -ForegroundColor Cyan
    Write-Host "Project : $($project.ghidraProjectDir)\$($project.ghidraProjectName)" -ForegroundColor DarkGray
    Write-Host "Binary  : $($project.nativeBinary)" -ForegroundColor DarkGray
    Write-Host "Log     : $logFile" -ForegroundColor DarkGray
    Write-Host "Note    : this step intentionally does NOT run Ghidra analysis." -ForegroundColor DarkGray

    # Important:
    # Use Ghidra's official headless importer here, not an agent-side bridge.
    # The toolkit flow only needs a plain project import; interactive queries
    # should happen later through the GhidraMCP GUI plugin.
    $headlessArgs = @(
        [string]$project.ghidraProjectDir,
        [string]$project.ghidraProjectName,
        "-import",    [string]$project.nativeBinary,
        "-overwrite",
        "-noanalysis"
    )

    try {
        @(
            "# Import only - $GameName",
            "StartedAt: $((Get-Date).ToString('s'))",
            "Mode: analyzeHeadless -import -overwrite -noanalysis",
            "ProjectDir: $($project.ghidraProjectDir)",
            "ProjectName: $($project.ghidraProjectName)",
            "Binary: $($project.nativeBinary)",
            ""
        ) | Out-File -LiteralPath $logFile -Encoding UTF8

        $outputLines = Invoke-AnalyzeHeadless -HeadlessArgs $headlessArgs
        Add-Content -LiteralPath $logFile -Encoding UTF8 -Value $outputLines
        Add-Content -LiteralPath $logFile -Encoding UTF8 -Value ""
        Add-Content -LiteralPath $logFile -Encoding UTF8 -Value "FinishedAt: $((Get-Date).ToString('s')); ExitCode: 0"
    }
    catch {
        $message = $_.Exception.Message
        Add-Content -LiteralPath $logFile -Encoding UTF8 -Value ""
        Add-Content -LiteralPath $logFile -Encoding UTF8 -Value "Import failed: $message"

        if (Test-GhidraLockError $message) {
            $lockMessage = New-GhidraProjectLockedMessage -Project $project
            Add-Content -LiteralPath $logFile -Encoding UTF8 -Value ""
            Add-Content -LiteralPath $logFile -Encoding UTF8 -Value $lockMessage
            throw $lockMessage
        }

        throw "Ghidra import failed.`n$message`nCheck log: $logFile"
    }

    $project.status.imported = $true
    # This import mode intentionally skips analysis.
    Set-ProjectStatusValue -Project $project -Name "analyzed" -Value $false
    Set-ProjectStatusValue -Project $project -Name "analyzing" -Value $false
    Save-Project $GameName $project

    Write-Host "Imported without analysis: $($project.ghidraProjectName) <- $($project.nativeBinary)" -ForegroundColor Green
    Write-Host "Next: .\re.ps1 open $GameName" -ForegroundColor Cyan
}

function Analyze-GhidraProgram {
    param([Parameter(Mandatory)] [string]$GameName)

    $project = Read-Project $GameName
    if (-not $project.status.imported) {
        throw "Program not imported. Run: .\re.ps1 import $GameName"
    }

    $notesDir = Get-NotesDir $GameName
    New-Item -ItemType Directory -Force -Path $notesDir | Out-Null
    $logFile = Join-Path $notesDir "analyze.log"

    Set-ProjectStatusValue -Project $project -Name "analyzing" -Value $true
    Set-ProjectStatusValue -Project $project -Name "analyzeStartedAt" -Value ((Get-Date).ToString("s"))
    Set-ProjectStatusValue -Project $project -Name "analyzeCompletedAt" -Value $null
    Save-Project $GameName $project

    Write-Host "== Analyze: $GameName ==" -ForegroundColor Magenta
    Write-Host "Program : $($project.ghidraProgramName)" -ForegroundColor DarkGray
    Write-Host "Log     : $logFile" -ForegroundColor DarkGray
    Write-Host "Mode    : analyzeHeadless -process with heartbeat; MCP queries stay in the GUI/plugin." -ForegroundColor DarkGray

    $success = $false
    try {
        try {
            Invoke-AnalyzeHeadlessHeartbeat @(
                $project.ghidraProjectDir,
                $project.ghidraProjectName,
                "-process", $project.ghidraProgramName
            ) -Activity "Ghidra analyze: $GameName" -LogFile $logFile | Out-Null
            $success = $true
        }
        catch {
            $message = $_.Exception.Message
            Add-Content -LiteralPath $logFile -Encoding UTF8 -Value ""
            Add-Content -LiteralPath $logFile -Encoding UTF8 -Value "analyzeHeadless failed: $message"

            if (Test-GhidraLockError $message) {
                $lockMessage = New-GhidraProjectLockedMessage -Project $project
                Add-Content -LiteralPath $logFile -Encoding UTF8 -Value ""
                Add-Content -LiteralPath $logFile -Encoding UTF8 -Value $lockMessage
                throw $lockMessage
            }
            throw
        }
    }
    finally {
        $project = Read-Project $GameName
        Set-ProjectStatusValue -Project $project -Name "analyzing" -Value $false
        if ($success) {
            Set-ProjectStatusValue -Project $project -Name "analyzed" -Value $true
            Set-ProjectStatusValue -Project $project -Name "analyzeCompletedAt" -Value ((Get-Date).ToString("s"))
        }
        Save-Project $GameName $project
    }

    if ($success) {
        Write-Host "Analysis completed." -ForegroundColor Green
        Write-Host "Wrote heartbeat log: $logFile" -ForegroundColor Green
    }
}


function Apply-GhidraSymbols {
    param([Parameter(Mandatory)] [string]$GameName)

    $project = Read-Project $GameName
    if (-not $project.status.imported) {
        throw "Program not imported. Run: .\re.ps1 import $GameName"
    }

    $ghidraPy = Join-Path $project.il2cppDumperOutput "ghidra.py"
    $dumperDir = Split-Path -Parent $ToolPaths.Dumper
    $ghidraPyFallback = Join-Path $dumperDir "ghidra.py"

    Repair-Il2CppDumperGhidraTemplates -Dir $dumperDir | Out-Null
    Repair-Il2CppDumperGhidraTemplates -Dir $project.il2cppDumperOutput | Out-Null

    if (-not (Test-Path -LiteralPath $ghidraPy) -and (Test-Path -LiteralPath $ghidraPyFallback)) {
        Repair-Il2CppGhidraScript -Path $ghidraPyFallback | Out-Null
        Copy-Item -LiteralPath $ghidraPyFallback -Destination $ghidraPy -Force
        Write-Host "  [FIX] Copied ghidra.py fallback from dumper folder." -ForegroundColor Cyan
    }

    if (-not (Test-Path -LiteralPath $ghidraPy)) {
        Write-Host "[WARN] ghidra.py not found. Open PyGhidra manually: .\re.ps1 pyghidra-gui" -ForegroundColor Yellow
        return
    }

    Repair-Il2CppGhidraScript -Path $ghidraPy | Out-Null

    Write-Host "== Apply symbols manually: $GameName ==" -ForegroundColor Magenta
    Write-Host ("Project dir : {0}" -f $project.ghidraProjectDir) -ForegroundColor Gray
    Write-Host ("Project name: {0}" -f $project.ghidraProjectName) -ForegroundColor Gray
    Write-Host ("Program     : {0}" -f $project.ghidraProgramName) -ForegroundColor Gray
    Write-Host ("Script      : {0}" -f $ghidraPy) -ForegroundColor Gray
    Write-Host ""
    Write-Host "MCP-first mode does not run ghidra.py through ghidra-cli." -ForegroundColor Cyan
    Write-Host "Manual steps in Ghidra/PyGhidra GUI:" -ForegroundColor Cyan
    Write-Host "  1. Open the project and program above." -ForegroundColor Gray
    Write-Host "  2. Run Auto Analysis if it has not already completed." -ForegroundColor Gray
    Write-Host "  3. Open Script Manager and run the ghidra.py path above." -ForegroundColor Gray
    Write-Host "  4. Start MCP server with: Tools > GhidraMCP > Start MCP Server" -ForegroundColor Gray
}

function Get-NotesDir {
    param([Parameter(Mandatory)] [string]$GameName)
    return Join-Path (Get-WorkspacePath $GameName) "04_Notes"
}

function New-CandidatesList {
    param([Parameter(Mandatory)] [string]$GameName)

    $project = Read-Project $GameName
    $dump = Join-Path $project.il2cppDumperOutput "dump.cs"
    if (-not (Test-Path -LiteralPath $dump)) {
        throw "dump.cs not found: $dump"
    }

    $text = Get-Content -LiteralPath $dump -Raw
    $classPattern = '(?m)^\s*(?:public|internal|protected|private)?\s*(?:sealed\s+|abstract\s+|partial\s+|static\s+|readonly\s+)*(?:class|interface|struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*<[^>]+>)?'
    $matches = [regex]::Matches($text, $classPattern)

    $allTypes = New-Object System.Collections.Generic.List[string]
    foreach ($m in $matches) {
        $name = $m.Groups[1].Value
        if (-not $allTypes.Contains($name)) { $allTypes.Add($name) }
    }

    $suffixes = @(
        @{ pat='Controller$'; label='*Controller' },
        @{ pat='Manager$';    label='*Manager' },
        @{ pat='Service$';    label='*Service' },
        @{ pat='Provider$';   label='*Provider' },
        @{ pat='Handler$';    label='*Handler' },
        @{ pat='View$';       label='*View' },
        @{ pat='Config$';     label='*Config' },
        @{ pat='Behaviour$';  label='*Behaviour' },
        @{ pat='Component$';  label='*Component' },
        @{ pat='Factory$';    label='*Factory' },
        @{ pat='Loader$';     label='*Loader' },
        @{ pat='Store$';      label='*Store' },
        @{ pat='Repository$'; label='*Repository' },
        @{ pat='Helper$';     label='*Helper' },
        @{ pat='Utility$';    label='*Utility' }
    )

    $groups = [ordered]@{}
    foreach ($s in $suffixes) { $groups[$s.label] = @() }
    $groups['(other types)'] = @()

    foreach ($name in $allTypes) {
        $matched = $false
        foreach ($s in $suffixes) {
            if ($name -match $s.pat) {
                $groups[$s.label] += $name
                $matched = $true
                break
            }
        }
        if (-not $matched) { $groups['(other types)'] += $name }
    }

    $topPicks = @(
        'GameManager','MainController','GameController','PlayerController','LevelController','BoardController',
        'AdsManager','AdController','IAPManager','IAPController','NetworkManager','NetworkService',
        'RemoteConfig','RemoteConfigService','AudioManager','ResourceManager','SceneManager','UIManager','GUIManager','PopupManager'
    )
    $topFound = @($topPicks | Where-Object { $allTypes.Contains($_) })

    $notesDir = Get-NotesDir $GameName
    New-Item -ItemType Directory -Force -Path $notesDir | Out-Null
    $out = Join-Path $notesDir "candidates.md"

    $sb = New-Object System.Text.StringBuilder
    $null = $sb.AppendLine("# Candidate class names - $GameName")
    $null = $sb.AppendLine("")
    $null = $sb.AppendLine(("Generated from: `{0}` ({1} types declared)" -f $dump, $allTypes.Count))
    $null = $sb.AppendLine("")

    $null = $sb.AppendLine("## Top picks")
    if ($topFound.Count -gt 0) {
        foreach ($c in $topFound) { $null = $sb.AppendLine("- $c") }
    } else {
        $null = $sb.AppendLine("- (none found from default top-pick list)")
    }
    $null = $sb.AppendLine("")

    foreach ($key in $groups.Keys) {
        $list = @($groups[$key] | Sort-Object)
        if ($list.Count -eq 0) { continue }
        $null = $sb.AppendLine(("## {0} ({1})" -f $key, $list.Count))
        foreach ($name in $list) { $null = $sb.AppendLine("- $name") }
        $null = $sb.AppendLine("")
    }

    Set-Content -LiteralPath $out -Value $sb.ToString() -Encoding UTF8
    Write-Host ("  [OK] Wrote: {0}" -f $out) -ForegroundColor Green
}

function New-AgentContext {
    param([Parameter(Mandatory)] [string]$GameName)

    $project = Read-Project $GameName
    $notesDir = Get-NotesDir $GameName
    New-Item -ItemType Directory -Force -Path $notesDir | Out-Null
    $out = Join-Path $notesDir "agent-context.md"

    $dump = Join-Path $project.il2cppDumperOutput "dump.cs"
    $py = Join-Path $project.il2cppDumperOutput "ghidra.py"

    function Fallback($v) { if ($null -eq $v -or "$v" -eq "") { "<unset>" } else { "$v" } }

    $sb = New-Object System.Text.StringBuilder
    $null = $sb.AppendLine("# Agent Context - $GameName")
    $null = $sb.AppendLine("")
    $null = $sb.AppendLine("## Project state")
    $null = $sb.AppendLine("| Field | Value |")
    $null = $sb.AppendLine("|---|---|")
    $null = $sb.AppendLine(("| Project name | {0} |" -f $GameName))
    $null = $sb.AppendLine(("| Platform | {0} |" -f (Fallback $project.platform)))
    $null = $sb.AppendLine(("| Native binary | `{0}` |" -f (Fallback $project.nativeBinary)))
    $null = $sb.AppendLine(("| Metadata | `{0}` |" -f (Fallback $project.metadata)))
    $null = $sb.AppendLine(("| Il2CppDumper output | `{0}` |" -f (Fallback $project.il2cppDumperOutput)))
    $null = $sb.AppendLine(("| dump.cs | `{0}` |" -f $dump))
    $null = $sb.AppendLine(("| ghidra.py | `{0}` |" -f $py))
    $null = $sb.AppendLine(("| Ghidra project | {0} |" -f (Fallback $project.ghidraProjectName)))
    $null = $sb.AppendLine(("| Ghidra project dir | `{0}` |" -f (Fallback $project.ghidraProjectDir)))
    $null = $sb.AppendLine(("| Ghidra program | {0} |" -f (Fallback $project.ghidraProgramName)))
    $null = $sb.AppendLine("")

    $null = $sb.AppendLine("## Pipeline status")
    $null = $sb.AppendLine("| Step | Done? |")
    $null = $sb.AppendLine("|---|---|")
    foreach ($key in @("scanned", "dumped", "imported", "analyzing", "analyzed", "symbolsApplied")) {
        $flag = if ($project.status.$key) { "[x]" } else { "[ ]" }
        $null = $sb.AppendLine(("| {0} | {1} |" -f $key, $flag))
    }
    $null = $sb.AppendLine("")

    $null = $sb.AppendLine("## Useful commands")
    $null = $sb.AppendLine('```powershell')
    $null = $sb.AppendLine((".\re.ps1 status {0}" -f $GameName))
    $null = $sb.AppendLine((".\re.ps1 open {0}" -f $GameName))
    $null = $sb.AppendLine((".\re.ps1 candidates {0}" -f $GameName))
    $null = $sb.AppendLine(".\re.ps1 mcp")
    $null = $sb.AppendLine('```')
    $null = $sb.AppendLine("")

    $null = $sb.AppendLine("## MCP workflow for agents")
    $null = $sb.AppendLine("")
    $null = $sb.AppendLine("1. Open the imported project/program in Ghidra or PyGhidra GUI.")
    $null = $sb.AppendLine("2. Enable the plugin: File > Configure > Configure All Plugins > GhidraMCP.")
    $null = $sb.AppendLine("3. Start the server: Tools > GhidraMCP > Start MCP Server.")
    $null = $sb.AppendLine("4. Start the bridge from the AI client config or with `.\re.ps1 mcp`.")
    $null = $sb.AppendLine(("5. In the MCP client: `list_instances`, then `connect_instance {0}`." -f $GameName))
    $null = $sb.AppendLine("")

    $null = $sb.AppendLine("## Suggested first searches")
    $null = $sb.AppendLine('```')
    foreach ($term in @("MainController", "GameManager", "BoardController", "LevelManager", "AdsManager", "IAPManager", "RemoteConfig", "NetworkManager", "Service", "Controller", "Presenter", "View")) {
        $null = $sb.AppendLine($term)
    }
    $null = $sb.AppendLine('```')

    Set-Content -LiteralPath $out -Value $sb.ToString() -Encoding UTF8
    Write-Host ("  [OK] Wrote: {0}" -f $out) -ForegroundColor Green
}

function Run-NotesPipeline {
    param([Parameter(Mandatory)] [string]$GameName)

    $project = Read-Project $GameName
    if (-not $project.status.dumped) {
        Write-Host "[SKIP] notes pipeline: project not dumped yet." -ForegroundColor Yellow
        return
    }

    New-CandidatesList $GameName
    New-AgentContext $GameName
}

function Show-McpFirstQueryMessage {
    param([Parameter()] [string]$GameName)

    Write-Host "Ghidra CLI commands are disabled in this MCP-first toolkit." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Use GhidraMCP for summary, function, string, xref, symbol, and decompile queries:" -ForegroundColor Cyan
    Write-Host "  1. Open the project/program in Ghidra or PyGhidra GUI." -ForegroundColor Gray
    Write-Host "  2. Enable: File > Configure > Configure All Plugins > GhidraMCP" -ForegroundColor Gray
    Write-Host "  3. Start:  Tools > GhidraMCP > Start MCP Server" -ForegroundColor Gray
    Write-Host "  4. Start the MCP bridge through your AI client or run: .\re.ps1 mcp" -ForegroundColor Gray
    if ($GameName) {
        Write-Host ("  5. In the MCP client: list_instances, then connect_instance {0}" -f $GameName) -ForegroundColor Gray
    }
    else {
        Write-Host "  5. In the MCP client: list_instances, then connect_instance <GameName>" -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "Tip: .\re.ps1 status <GameName> and .\re.ps1 path <GameName> still work for local project state." -ForegroundColor DarkGray
}


function Open-PyGhidraProject {
    param([Parameter(Mandatory)] [string]$GameName)

    $project = Read-Project $GameName

    Assert-PathExists $ToolPaths.PythonExe "Toolkit Python"
    Assert-PathExists $ToolPaths.PyGhidraDist "PyGhidra package bundle" -Directory
    Assert-PathExists $ToolPaths.JavaExe "Toolkit JDK 21"

    if (-not $project.status.imported) {
        Write-Host "[WARN] Project is not marked as imported yet. Opening PyGhidra anyway." -ForegroundColor Yellow
    }

    Write-Host "== Open PyGhidra GUI: $GameName ==" -ForegroundColor Magenta
    Write-Host ("Project dir : {0}" -f $project.ghidraProjectDir) -ForegroundColor DarkGray
    Write-Host ("Project name: {0}" -f $project.ghidraProjectName) -ForegroundColor DarkGray
    Write-Host ("Program     : {0}" -f $project.ghidraProgramName) -ForegroundColor DarkGray
    Show-GhidraProjectOpenInfo -Project $project
    Write-Host "Tip: Let Ghidra run Auto Analysis in the GUI, then run ghidra.py manually if needed." -ForegroundColor Cyan
    Write-Host "Opening PyGhidra the same way as: .\re.ps1 pyghidra-gui" -ForegroundColor DarkGray
    Write-Host "Note: project arguments are not passed to the PyGhidra launcher because some versions exit silently when they receive unsupported args." -ForegroundColor DarkGray

    # Keep this identical in behavior to the `pyghidra-gui` wrapper: do not pass
    # project dir/name args because some PyGhidra versions exit on unsupported args.
    Invoke-PyGhidraGui

    Write-Host "PyGhidra closed or launcher returned." -ForegroundColor Green
}

function Run-FullFlow {
    param(
        [Parameter(Mandatory)] [string]$GameName,
        [Parameter(Mandatory)] [string]$Source
    )

    Write-Host "== RE Flow: $GameName ==" -ForegroundColor Magenta
    Write-Host "Mode: scan/add -> Il2CppDumper -> Ghidra import only (-noanalysis) -> open PyGhidra GUI" -ForegroundColor Cyan
    Write-Host "Note: this flow intentionally skips headless analyze and auto symbol apply to avoid project lock/long-running CLI issues." -ForegroundColor DarkGray

    New-Workspace $GameName

    if (Test-Path -LiteralPath $Source -PathType Container) {
        Scan-UnityIl2Cpp $GameName $Source
    }
    else {
        Add-BuildToProject $GameName $Source
    }

    Run-Il2CppDumper $GameName
    Import-GhidraProgram $GameName

    try { Run-NotesPipeline $GameName }
    catch { Write-Host "[WARN] Notes pipeline failed: $_" -ForegroundColor Yellow }

    Show-ProjectSummary $GameName

    $project = Read-Project $GameName
    $ghidraPy = Join-Path $project.il2cppDumperOutput "ghidra.py"

    Write-Host "" 
    Write-Host "Next manual steps in PyGhidra:" -ForegroundColor Cyan
    Write-Host "  1. Accept/run Ghidra Auto Analysis in the GUI." -ForegroundColor Gray
    if (Test-Path -LiteralPath $ghidraPy) {
        Write-Host ("  2. Run Il2CppDumper script manually: {0}" -f $ghidraPy) -ForegroundColor Gray
    }
    else {
        Write-Host "  2. ghidra.py was not found in the dumper output; skip symbol script or copy it manually." -ForegroundColor Yellow
    }
    Write-Host "  3. Use dump.cs / DummyDll as skeleton while reading decompiled functions." -ForegroundColor Gray
    Write-Host ""

    Open-PyGhidraProject $GameName

    Write-Host "Flow completed for $GameName. PyGhidra is now responsible for analysis/symbol steps." -ForegroundColor Green
}

function Show-Usage {
    Write-Host "RE Toolkit - RE Pipeline Runner" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "Pipeline commands:"
    Write-Host "  .\re.ps1 doctor"
    Write-Host "  .\re.ps1 init       <GameName>"
    Write-Host "  .\re.ps1 add        <GameName> <apk-or-xapk-or-aab-or-zip>"
    Write-Host "  .\re.ps1 scan       <GameName> <ExtractedPath>"
    Write-Host "  .\re.ps1 dump       <GameName>"
    Write-Host "  .\re.ps1 import     <GameName>                         # import only; no Ghidra analysis"
    Write-Host "  .\re.ps1 analyze    <GameName>                         # manual/optional; not used by flow"
    Write-Host "  .\re.ps1 symbols    <GameName>                         # manual/optional; not used by flow"
    Write-Host "  .\re.ps1 flow       <GameName> <apk-or-ExtractedPath>  # dump/import/open PyGhidra; no headless analyze"
    Write-Host "  .\re.ps1 open       <GameName>                         # open imported project in PyGhidra GUI"
    Write-Host "  .\re.ps1 path       <GameName>                         # print Ghidra project folder/link for GUI open"
    Write-Host "  .\re.ps1 status     <GameName>"
    Write-Host "  .\re.ps1 candidates <GameName>"
    Write-Host "  .\re.ps1 context    <GameName>"
    Write-Host "  .\re.ps1 notes      <GameName>"
    Write-Host ""
    Write-Host "Tool wrappers:"
    Write-Host "  .\re.ps1 ghidra-gui"
    Write-Host "  .\re.ps1 pyghidra-gui"
    Write-Host "  .\re.ps1 il2cppdumper <args...>"
    Write-Host "  .\re.ps1 mcp                         # MCP bridge for AI clients"
    Write-Host ""
    Write-Host "MCP query workflow:"
    Write-Host "  1. Open project/program in Ghidra or PyGhidra GUI."
    Write-Host "  2. Enable: File > Configure > Configure All Plugins > GhidraMCP"
    Write-Host "  3. Start:  Tools > GhidraMCP > Start MCP Server"
    Write-Host "  4. Start the client bridge: .\re.ps1 mcp"
}

switch ($Command) {
    { $_ -in @($null, "", "help", "--help", "-h") } { Show-Usage; exit 0 }

    "doctor" {
        Write-Host "== Toolkit Doctor ==" -ForegroundColor Magenta
        foreach ($key in $ToolPaths.Keys) {
            $path = $ToolPaths[$key]
            if (Test-Path -LiteralPath $path) {
                Write-Host ("  [OK]   {0,-16} {1}" -f $key, $path) -ForegroundColor Green
            }
            else {
                Write-Host ("  [MISS] {0,-16} {1}" -f $key, $path) -ForegroundColor Red
            }
        }
        if (Test-Path -LiteralPath $ToolPaths.JavaExe) {
            Write-Host ""
            Write-Host "Toolkit JDK:" -ForegroundColor Cyan
            & $ToolPaths.JavaExe -version
        }
    }

    "init"       { if (-not $Rest[0]) { throw "Usage: .\re.ps1 init <GameName>" } New-Workspace $Rest[0] }
    "add"        { if (-not $Rest[0] -or -not $Rest[1]) { throw "Usage: .\re.ps1 add <GameName> <apk-or-xapk-or-aab-or-zip>" } Add-BuildToProject $Rest[0] $Rest[1] }
    "scan"       { if (-not $Rest[0] -or -not $Rest[1]) { throw "Usage: .\re.ps1 scan <GameName> <ExtractedPath>" } Scan-UnityIl2Cpp $Rest[0] $Rest[1] }
    "dump"       { if (-not $Rest[0]) { throw "Usage: .\re.ps1 dump <GameName>" } Run-Il2CppDumper $Rest[0] }
    "import"     { if (-not $Rest[0]) { throw "Usage: .\re.ps1 import <GameName>" } Import-GhidraProgram $Rest[0] }
    "analyze"    { if (-not $Rest[0]) { throw "Usage: .\re.ps1 analyze <GameName>" } Analyze-GhidraProgram $Rest[0] }
    "symbols"    { if (-not $Rest[0]) { throw "Usage: .\re.ps1 symbols <GameName>" } Apply-GhidraSymbols $Rest[0] }
    "flow"       { if (-not $Rest[0] -or -not $Rest[1]) { throw "Usage: .\re.ps1 flow <GameName> <apk-or-ExtractedPath>" } Run-FullFlow $Rest[0] $Rest[1] }
    "open"       { if (-not $Rest[0]) { throw "Usage: .\re.ps1 open <GameName>" } Open-PyGhidraProject $Rest[0] }
    "path"       { if (-not $Rest[0]) { throw "Usage: .\re.ps1 path <GameName>" } $project = Read-Project $Rest[0]; Show-GhidraProjectOpenInfo -Project $project }
    "status"     { if (-not $Rest[0]) { throw "Usage: .\re.ps1 status <GameName>" } Show-ProjectSummary $Rest[0] }
    "candidates" { if (-not $Rest[0]) { throw "Usage: .\re.ps1 candidates <GameName>" } New-CandidatesList $Rest[0] }
    "context"    { if (-not $Rest[0]) { throw "Usage: .\re.ps1 context <GameName>" } New-AgentContext $Rest[0] }
    "notes"      { if (-not $Rest[0]) { throw "Usage: .\re.ps1 notes <GameName>" } Run-NotesPipeline $Rest[0] }

    "summary" {
        if (-not $Rest[0]) { throw "Usage: .\re.ps1 summary <GameName>" }
        Show-McpFirstQueryMessage $Rest[0]
    }

    "strings"   { if (-not $Rest[0]) { throw "Usage: .\re.ps1 strings <GameName>" } Show-McpFirstQueryMessage $Rest[0] }
    "functions" { if (-not $Rest[0]) { throw "Usage: .\re.ps1 functions <GameName>" } Show-McpFirstQueryMessage $Rest[0] }
    "stats"     { if (-not $Rest[0]) { throw "Usage: .\re.ps1 stats <GameName>" } Show-McpFirstQueryMessage $Rest[0] }

    "ghidra-cli" {
        Show-McpFirstQueryMessage
        exit 1
    }

    "ghidra" {
        Show-McpFirstQueryMessage
        exit 1
    }

    "ghidra-gui" {
        Assert-PathExists $ToolPaths.GhidraGuiBat "Ghidra GUI"
        Assert-PathExists $ToolPaths.JavaExe "Toolkit JDK 21"
        Invoke-WithToolkitEnv {
            Push-Location $Root
            try { & $ToolPaths.GhidraGuiBat @Rest }
            finally { Pop-Location }
        }
    }

    "pyghidra-gui" {
        Invoke-PyGhidraGui -Arguments $Rest
    }

    "il2cppdumper" {
        Assert-PathExists $ToolPaths.Dumper "Il2CppDumper"
        if ($Rest.Count -eq 0) { throw "Usage: .\re.ps1 il2cppdumper <native_binary> <global_metadata> [output_dir]" }
        & $ToolPaths.Dumper @Rest
        if ($LASTEXITCODE -ne 0) { throw "Il2CppDumper exited with code $LASTEXITCODE" }
    }

    "mcp" {
        $bridge = Join-Path $Tools "ghidra-mcp\bridge_mcp_ghidra.py"
        if (Test-Path -LiteralPath $bridge) {
            $venvPython = Join-Path $Tools "ghidra-mcp\.venv\Scripts\python.exe"
            if (Test-Path -LiteralPath $venvPython) {
                & $venvPython $bridge --transport stdio
            }
            else {
                & uv run --script $bridge --transport stdio
            }
            if ($LASTEXITCODE -ne 0) { throw "MCP bridge exited with code $LASTEXITCODE" }
        }
        else {
            foreach ($candidate in @("ghidra-mcp-bridge", "bridge_mcp_ghidra")) {
                $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
                if ($cmd) {
                    & $cmd
                    return
                }
            }
            throw "No MCP bridge entrypoint found. Put bridge_mcp_ghidra.py in tools\ghidra-mcp or install a bridge command."
        }
    }

    default {
        Write-Host "Unknown command: $Command" -ForegroundColor Red
        Show-Usage
        exit 1
    }
}
