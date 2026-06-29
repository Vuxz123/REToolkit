[CmdletBinding()]
param(
    [Parameter(Position=0)]
    [string]$Command,

    [Parameter(Position=1)]
    [string]$Arg1,

    [Parameter(Position=2)]
    [string]$Arg2,

    [Parameter(Position=3)]
    [string]$Arg3,

    [Parameter(Position=4)]
    [string]$Arg4
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Scripts = Join-Path $Root "scripts"
$Tools   = Join-Path $Root "tools"
$Workspaces = Join-Path $Root "workspaces"

function Show-Usage {
    Write-Host "RE Toolkit - wrapper" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "Usage:"
    Write-Host "  .\re.ps1 check"
    Write-Host "  .\re.ps1 init <ProjectName>"
    Write-Host "  .\re.ps1 ghidra <subcommand> [args]    # wraps ghidra-cli (Rust CLI bridge)"
    Write-Host "  .\re.ps1 ghidra --% <subcommand> [args] # use --% to forward --flags literally"
    Write-Host "  .\re.ps1 gui                           # launch full Ghidra GUI"
    Write-Host "  .\re.ps1 pyghidra                      # launch pyghidra console"
    Write-Host "  .\re.ps1 dump <native_binary> <global_metadata> <ProjectName>"
    Write-Host "  .\re.ps1 mcp [ProjectName]"
    Write-Host "  .\re.ps1 install-skill                 # download ghidra-reverse-engineering-cli skill"
    Write-Host "  .\re.ps1 where [ghidra|ghidra-cli|il2cpp|mcp|assetripper|python|java]"
    Write-Host "  .\re.ps1 help"
}

function Ensure-GhidraEnv {
    param([string]$GhidraRoot)

    if (-not $env:GHIDRA_INSTALL_DIR -or -not (Test-Path -LiteralPath $env:GHIDRA_INSTALL_DIR)) {
        if ($GhidraRoot -and (Test-Path -LiteralPath $GhidraRoot)) {
            $env:GHIDRA_INSTALL_DIR = $GhidraRoot
        }
    }

    $portableJdk = Join-Path $Root "runtime\java\jdk-21"
    $portableJavaExe = Join-Path $portableJdk "bin\java.exe"
    if (Test-Path -LiteralPath $portableJavaExe) {
        $env:JAVA_HOME           = $portableJdk
        $env:JAVA_HOME_OVERRIDE  = $portableJdk
        $jdkBin = Join-Path $portableJdk "bin"
        if (-not ($env:Path -split ";" | Where-Object { $_ -eq $jdkBin })) {
            $env:Path = "$jdkBin;$env:Path"
        }
    } elseif (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath $env:JAVA_HOME)) {
        $systemJava = Get-Command "java" -ErrorAction SilentlyContinue
        if ($systemJava) {
            $systemJavaHome = Split-Path -Parent (Split-Path -Parent $systemJava.Source)
            if (Test-Path -LiteralPath (Join-Path $systemJavaHome "bin\java.exe")) {
                $env:JAVA_HOME          = $systemJavaHome
                $env:JAVA_HOME_OVERRIDE = $systemJavaHome
            }
        }
    }
}

switch ($Command) {

    ""           { Show-Usage; exit 0 }
    "help"       { Show-Usage; exit 0 }
    "--help"     { Show-Usage; exit 0 }
    "-h"         { Show-Usage; exit 0 }

    "check" {
        & "$Scripts\check-env.ps1" -Root $Root
    }

    "init" {
        if (-not $Arg1) { Write-Host "Usage: .\re.ps1 init <ProjectName>"; exit 1 }
        & "$Scripts\init-workspace.ps1" -ProjectName $Arg1 -Root $Workspaces
    }

    "ghidra" {
        $bin = Get-Command "ghidra" -ErrorAction SilentlyContinue
        if (-not $bin) {
            Write-Host "ghidra-cli not on PATH." -ForegroundColor Red
            Write-Host "Install with: .\install-re-toolkit.ps1 -InstallGhidraCli" -ForegroundColor Yellow
            exit 2
        }

        $ghidraRoot = Join-Path $Tools "ghidra"
        Ensure-GhidraEnv -GhidraRoot $ghidraRoot

        $ghidraArgs = @()
        foreach ($a in @($Arg1, $Arg2, $Arg3, $Arg4) + @($args)) {
            if ("$a" -ne "") { $ghidraArgs += $a }
        }

        if ($ghidraArgs.Count -eq 0) {
            & $bin.Source doctor
        } else {
            & $bin.Source @ghidraArgs
        }
    }

    "gui" {
        $runBat = Join-Path $Tools "ghidra\ghidraRun.bat"
        if (-not (Test-Path -LiteralPath $runBat)) {
            Write-Host "Ghidra not installed. Run: .\install-re-toolkit.ps1 -InstallGhidra" -ForegroundColor Red
            exit 2
        }
        Ensure-GhidraEnv -GhidraRoot (Join-Path $Tools "ghidra")
        $projectName = $Arg1
        if ($projectName) {
            $ghidraProj = Join-Path (Join-Path $Workspaces $projectName) "03_GhidraProject"
            if (-not (Test-Path -LiteralPath $ghidraProj)) {
                New-Item -ItemType Directory -Path $ghidraProj -Force | Out-Null
            }
            Write-Host "Ghidra project dir: $ghidraProj" -ForegroundColor Cyan
        }
        & $runBat
    }

    "pyghidra" {
        $pyRun = Join-Path $Tools "ghidra\support\pyghidraRun.bat"
        if (-not (Test-Path -LiteralPath $pyRun)) {
            Write-Host "PyGhidra not found at $pyRun. Install Ghidra with PyGhidra support." -ForegroundColor Red
            exit 2
        }
        Ensure-GhidraEnv -GhidraRoot (Join-Path $Tools "ghidra")
        & $pyRun
    }

    "dump" {
        if (-not $Arg1 -or -not $Arg2 -or -not $Arg3) {
            Write-Host "Usage: .\re.ps1 dump <libil2cpp.so> <global-metadata.dat> <ProjectName>" -ForegroundColor Yellow
            exit 1
        }
        $il2cpp = Join-Path $Tools "Il2CppDumper\Il2CppDumper.exe"
        if (-not (Test-Path -LiteralPath $il2cpp)) {
            Write-Host "Missing: $il2cpp" -ForegroundColor Red
            exit 2
        }
        $native = (Resolve-Path -LiteralPath $Arg1).Path
        $meta   = (Resolve-Path -LiteralPath $Arg2).Path
        $name   = $Arg3
        $out    = Join-Path (Join-Path $Workspaces $name) "02_Il2CppDumperOutput"
        if (-not (Test-Path -LiteralPath $out)) {
            New-Item -ItemType Directory -Path $out -Force | Out-Null
        }
        Push-Location $out
        try {
            & $il2cpp $native $meta
        } finally {
            Pop-Location
        }
    }

    "mcp" {
        $bridge = Join-Path $Tools "ghidra-mcp\bridge_mcp_ghidra.py"
        if (Test-Path -LiteralPath $bridge) {
            & uv run --script $bridge --transport stdio
        } else {
            Write-Host "Bridge script not found: $bridge" -ForegroundColor Yellow
            Write-Host "Trying installed console script..." -ForegroundColor Yellow
            $candidates = @("ghidra-mcp-bridge", "mcp-server-ghidra", "bridge_mcp_ghidra")
            $found = $false
            foreach ($c in $candidates) {
                $cmd = Get-Command $c -ErrorAction SilentlyContinue
                if ($cmd) {
                    & $cmd
                    $found = $true
                    break
                }
            }
            if (-not $found) {
                Write-Host "No MCP bridge entrypoint found." -ForegroundColor Red
                Write-Host "Install with: uv tool install mcp-server-ghidra" -ForegroundColor Yellow
                exit 2
            }
        }
    }

    "install-skill" {
        $prompt = Join-Path $Root "prompts\install-ghidra-skill.md"
        if (Test-Path -LiteralPath $prompt) {
            Write-Host "Skill install instructions:" -ForegroundColor Cyan
            Write-Host "  $prompt" -ForegroundColor Cyan
            Write-Host ""
            Get-Content -LiteralPath $prompt
        } else {
            Write-Host "Missing prompt file: $prompt" -ForegroundColor Red
            exit 2
        }
    }

    "where" {
        switch ($Arg1) {
            "java"        { $b = Get-Command "java" -ErrorAction SilentlyContinue; if ($b) { Write-Host $b.Source } else { Write-Host "java (not on PATH)"; exit 2 } }
            "python"      { $b = Get-Command "python" -ErrorAction SilentlyContinue; if ($b) { Write-Host $b.Source } else { Write-Host "python (not on PATH)"; exit 2 } }
            "uv"          { $b = Get-Command "uv" -ErrorAction SilentlyContinue; if ($b) { Write-Host $b.Source } else { Write-Host "uv (not on PATH)"; exit 2 } }
            "dotnet"      { $b = Get-Command "dotnet" -ErrorAction SilentlyContinue; if ($b) { Write-Host $b.Source } else { Write-Host "dotnet (not on PATH)"; exit 2 } }
            "cargo"       { $b = Get-Command "cargo" -ErrorAction SilentlyContinue; if ($b) { Write-Host $b.Source } else { Write-Host "cargo (not on PATH)"; exit 2 } }
            "ghidra"      { Write-Host (Join-Path $Tools "ghidra") }
            "ghidra-cli"  { $b = Get-Command "ghidra" -ErrorAction SilentlyContinue; if ($b) { Write-Host $b.Source } else { Write-Host "ghidra (not on PATH)"; exit 2 } }
            "il2cpp"      { Write-Host (Join-Path $Tools "Il2CppDumper\Il2CppDumper.exe") }
            "mcp"         { Write-Host (Join-Path $Tools "ghidra-mcp") }
            "assetripper" { Write-Host (Join-Path $Tools "AssetRipper\AssetRipper.exe") }
            default       { Write-Host "Unknown tool. Use: java|python|uv|dotnet|cargo|ghidra|ghidra-cli|il2cpp|mcp|assetripper" }
        }
    }

    default {
        Write-Host "Unknown command: $Command" -ForegroundColor Red
        Show-Usage
        exit 1
    }
}
