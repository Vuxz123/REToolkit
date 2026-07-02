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
