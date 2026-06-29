[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSCommandPath)
)

$ErrorActionPreference = "Stop"
if (-not $Root -or $Root -match "scripts$") {
    $Root = Split-Path -Parent $Root
}

function Write-Status {
    param([bool]$Ok, [string]$Label, [string]$Detail = "")
    if ($Ok) {
        Write-Host ("  [OK]   {0,-22} {1}" -f $Label, $Detail) -ForegroundColor Green
    } else {
        Write-Host ("  [MISS] {0,-22} {1}" -f $Label, $Detail) -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "== Environment check ==" -ForegroundColor Cyan

$java = Get-Command "java" -ErrorAction SilentlyContinue
if ($java) {
    try {
        $v = (cmd /c "java -version 2>&1" | Select-Object -First 1) -replace '"',''
        if (-not $v) { $v = "found" }
        Write-Status $true "java" $v.Trim()
    } catch {
        Write-Status $true "java" "found"
    }
} else {
    Write-Status $false "java" "not in PATH (need JDK 21 for Ghidra)"
}

$python = Get-Command "python" -ErrorAction SilentlyContinue
if ($python) {
    Write-Status $true "python" (& python --version 2>&1)
} else {
    Write-Status $false "python" "not in PATH"
}

$dotnet = Get-Command "dotnet" -ErrorAction SilentlyContinue
if ($dotnet) {
    $runtimes = & dotnet --list-runtimes 2>&1
    $desktop = ($runtimes | Where-Object { $_ -match "WindowsDesktop" }) -join "; "
    Write-Status $true "dotnet" $desktop
    if (-not $desktop) {
        Write-Host "         No WindowsDesktop runtime found - Il2CppDumper will fail to launch." -ForegroundColor Yellow
    }
} else {
    Write-Status $false "dotnet" "not in PATH"
}

$uv = Get-Command "uv" -ErrorAction SilentlyContinue
if ($uv) {
    Write-Status $true "uv" (& uv --version 2>&1)
} else {
    Write-Status $false "uv" "not in PATH (needed for Ghidra MCP)"
}

$ghidra = Join-Path $Root "tools\ghidra"
if (Test-Path -LiteralPath $ghidra) {
    $run = Join-Path $ghidra "ghidraRun.bat"
    Write-Status (Test-Path -LiteralPath $run) "Ghidra" $run
} else {
    Write-Status $false "Ghidra" "$ghidra missing"
}

$il2cpp = Join-Path $Root "tools\Il2CppDumper\Il2CppDumper.exe"
Write-Status (Test-Path -LiteralPath $il2cpp) "Il2CppDumper" $il2cpp

$mcpBridge = Join-Path $Root "tools\ghidra-mcp\bridge_mcp_ghidra.py"
Write-Status (Test-Path -LiteralPath $mcpBridge) "Ghidra MCP" $mcpBridge

$ripper = Join-Path $Root "tools\AssetRipper\AssetRipper.exe"
Write-Status (Test-Path -LiteralPath $ripper) "AssetRipper" $ripper

$workspaces = Join-Path $Root "workspaces"
if (Test-Path -LiteralPath $workspaces) {
    $list = Get-ChildItem -LiteralPath $workspaces -Directory -ErrorAction SilentlyContinue
    if ($list) {
        Write-Host ""
        Write-Host "Workspaces:" -ForegroundColor Cyan
        $list | ForEach-Object { Write-Host ("  - {0}" -f $_.Name) }
    }
}

Write-Host ""
