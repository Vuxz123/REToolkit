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

function Resolve-ToolkitJdkRoot {
    param([Parameter(Mandatory)] [string]$JavaRuntimeDir)

    # install-re-toolkit.ps1 -JdkVersion controls which jdk-<N> folder gets
    # installed; auto-detect it instead of hardcoding jdk-21 so a non-default
    # -JdkVersion install is actually found.
    $preferred = Join-Path $JavaRuntimeDir "jdk-21"
    if (Test-Path -LiteralPath (Join-Path $preferred "bin\java.exe")) {
        return $preferred
    }

    $candidate = Get-ChildItem -LiteralPath $JavaRuntimeDir -Directory -Filter "jdk-*" -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "bin\java.exe") } |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if ($candidate) { return $candidate.FullName }

    return $preferred
}

$JdkRoot = Resolve-ToolkitJdkRoot -JavaRuntimeDir (Join-Path $Root "runtime\java")

$ToolPaths = [ordered]@{
    JdkRoot          = $JdkRoot
    JavaExe          = Join-Path $JdkRoot "bin\java.exe"
    PythonRoot       = Join-Path $Root  "runtime\python\python-3.12"
    PythonExe        = Join-Path $Root  "runtime\python\python-3.12\python.exe"
    PyGhidraVenv     = Join-Path $Root  "runtime\python\pyghidra-venv"
    PyGhidraPython   = Join-Path $Root  "runtime\python\pyghidra-venv\Scripts\python.exe"
    GhidraRoot       = Join-Path $Tools "ghidra"
    GhidraMcpBridge  = Join-Path $Tools "ghidra-mcp\.venv\Scripts\bridge-mcp-ghidra.exe"
    GhidraGuiBat     = Join-Path $Tools "ghidra\ghidraRun.bat"
    PyGhidraDist     = Join-Path $Tools "ghidra\Ghidra\Features\PyGhidra\pypkg\dist"
    AnalyzeHeadless  = Join-Path $Tools "ghidra\support\analyzeHeadless.bat"
    Dumper           = Join-Path $Tools "Il2CppDumper\Il2CppDumper.exe"
    AssetRipper      = Join-Path $Tools "AssetRipper\AssetRipper.exe"
}

$GhidraScriptBundleHelper = Join-Path $Root "scripts\ghidra-script-bundle.ps1"
if (Test-Path -LiteralPath $GhidraScriptBundleHelper) {
    . $GhidraScriptBundleHelper
}

$GhidraPreferencesHelper = Join-Path $Root "scripts\ghidra-preferences.ps1"
if (Test-Path -LiteralPath $GhidraPreferencesHelper) {
    . $GhidraPreferencesHelper
}

$RetkScriptModules = @(
    "scripts\retk-core.ps1",
    "scripts\retk-process.ps1",
    "scripts\retk-il2cpp.ps1",
    "scripts\retk-pyghidra.ps1",
    "scripts\retk-project.ps1",
    "scripts\retk-pipeline.ps1",
    "scripts\retk-ldplayer.ps1",
    "scripts\retk-ui.ps1"
)
foreach ($module in $RetkScriptModules) {
    $modulePath = Join-Path $Root $module
    if (-not (Test-Path -LiteralPath $modulePath)) {
        throw "REToolkit module missing: $modulePath"
    }
    . $modulePath
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
    "pull-ldplayer" {
        if ($Rest.Count -lt 2) { throw "Usage: .\re.ps1 pull-ldplayer <GameName> <PackageName> [-DeviceSerial <serial>] [-AdbPath <path>] [-SkipLaunch]" }
        $gameName = $Rest[0]
        $packageName = $Rest[1]
        $deviceSerial = ""
        $adbPath = ""
        $skipLaunch = $false
        $i = 2
        while ($i -lt $Rest.Count) {
            switch ($Rest[$i]) {
                "-DeviceSerial" {
                    $i++
                    if ($i -ge $Rest.Count) { throw "-DeviceSerial requires a value." }
                    $deviceSerial = $Rest[$i]
                }
                "-AdbPath" {
                    $i++
                    if ($i -ge $Rest.Count) { throw "-AdbPath requires a value." }
                    $adbPath = $Rest[$i]
                }
                "-SkipLaunch" { $skipLaunch = $true }
                default { throw "Unknown pull-ldplayer option: $($Rest[$i])" }
            }
            $i++
        }
        Invoke-LdPlayerPull -GameName $gameName -PackageName $packageName -DeviceSerial $deviceSerial -AdbPath $adbPath -SkipLaunch:$skipLaunch
    }
    "scan"       { if (-not $Rest[0] -or -not $Rest[1]) { throw "Usage: .\re.ps1 scan <GameName> <ExtractedPath>" } Scan-UnityIl2Cpp $Rest[0] $Rest[1] }
    "dump"       { if (-not $Rest[0]) { throw "Usage: .\re.ps1 dump <GameName>" } Run-Il2CppDumper $Rest[0] }
    "export"     { if (-not $Rest[0]) { throw "Usage: .\re.ps1 export <GameName> [OutFile.re]" } Export-WorkspaceArchive -GameName $Rest[0] -OutputPath $Rest[1] | Out-Null }
    "import"     {
        if (-not $Rest[0]) { throw "Usage: .\re.ps1 import <GameName> | .\re.ps1 import <Archive.re> [GameName] [--force]" }
        $first = [string]$Rest[0]
        $isWorkspaceArchive = ($first -match '\.(re|zip)$') -or (Test-Path -LiteralPath $first -PathType Leaf)
        if ($isWorkspaceArchive) {
            $force = $false
            $importName = ""
            $archiveArgs = if ($Rest.Count -gt 1) { @($Rest[1..($Rest.Count - 1)]) } else { @() }
            foreach ($arg in $archiveArgs) {
                if ($arg -eq "--force") {
                    $force = $true
                }
                elseif ([string]::IsNullOrWhiteSpace($importName)) {
                    $importName = $arg
                }
                else {
                    throw "Usage: .\re.ps1 import <Archive.re> [GameName] [--force]"
                }
            }
            Import-WorkspaceArchive -ArchivePath $first -GameName $importName -Force:$force | Out-Null
        }
        else {
            Import-GhidraProgram $first
        }
    }
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
        $guiArgs = @($Rest)
        if ($guiArgs.Count -gt 0 -and -not ([string]$guiArgs[0]).StartsWith("-")) {
            Set-GhidraDefaultProjectForGame -GameName $guiArgs[0] | Out-Null
            $guiArgs = if ($guiArgs.Count -gt 1) { @($guiArgs[1..($guiArgs.Count - 1)]) } else { @() }
        }
        Ensure-Il2CppDumperGhidraScriptBundle | Out-Null
        Invoke-WithToolkitEnv {
            Push-Location $Root
            try { & $ToolPaths.GhidraGuiBat @guiArgs }
            finally { Pop-Location }
        }
    }

    "pyghidra-gui" {
        $guiArgs = @($Rest)
        if ($guiArgs.Count -gt 0 -and -not ([string]$guiArgs[0]).StartsWith("-")) {
            Set-GhidraDefaultProjectForGame -GameName $guiArgs[0] | Out-Null
            $guiArgs = if ($guiArgs.Count -gt 1) { @($guiArgs[1..($guiArgs.Count - 1)]) } else { @() }
        }
        Invoke-PyGhidraGui -Arguments $guiArgs
    }

    "il2cppdumper" {
        Assert-PathExists $ToolPaths.Dumper "Il2CppDumper"
        if ($Rest.Count -lt 2) { throw "Usage: .\re.ps1 il2cppdumper <native_binary> <global_metadata> [output_dir]" }
        & $ToolPaths.Dumper @Rest
        if ($LASTEXITCODE -ne 0) { throw "Il2CppDumper exited with code $LASTEXITCODE" }
    }

    { $_ -in @("assetripper", "asset-ripper") } {
        Assert-PathExists $ToolPaths.AssetRipper "AssetRipper"
        $assetRipperDir = Split-Path -Parent $ToolPaths.AssetRipper
        $result = Start-DetachedGuiProcess -FilePath $ToolPaths.AssetRipper -Arguments @($Rest) -WorkingDirectory $assetRipperDir -Activity "AssetRipper GUI"
        Write-Host ("AssetRipper GUI started (PID {0})." -f $result.ProcessId) -ForegroundColor Green
    }

    "mcp" {
        $venvBridge = Join-Path $Tools "ghidra-mcp\.venv\Scripts\bridge-mcp-ghidra.exe"
        $venvPython = Join-Path $Tools "ghidra-mcp\.venv\Scripts\python.exe"
        if (Test-Path -LiteralPath $venvBridge) {
            & $venvBridge --transport stdio
            if ($LASTEXITCODE -ne 0) { throw "MCP bridge exited with code $LASTEXITCODE" }
        }
        elseif (Test-Path -LiteralPath $venvPython) {
            & $venvPython -m bridge_mcp_ghidra --transport stdio
            if ($LASTEXITCODE -ne 0) { throw "MCP bridge exited with code $LASTEXITCODE" }
        }
        else {
            $cmd = Get-Command "bridge-mcp-ghidra" -ErrorAction SilentlyContinue
            if ($cmd) {
                & $cmd --transport stdio
                return
            }
            throw "No MCP bridge entrypoint found. Run '.\install-re-toolkit.ps1 -InstallGhidraMcp' to install the bridge wheel into tools\ghidra-mcp\.venv."
        }
    }

    default {
        Write-Host "Unknown command: $Command" -ForegroundColor Red
        Show-Usage
        exit 1
    }
}
