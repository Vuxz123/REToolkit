[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$InstallPs2Exe
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'retk-build-provenance.ps1')

if (-not (Get-Command Invoke-ps2exe -ErrorAction SilentlyContinue)) {
    if (-not $InstallPs2Exe) { throw 'ps2exe is not installed. Re-run with -InstallPs2Exe to allow CurrentUser module installation.' }
    Write-Host "Installing ps2exe module (CurrentUser scope)..." -ForegroundColor Cyan
    Install-Module -Name ps2exe -Scope CurrentUser -Force -ErrorAction Stop
    Import-Module ps2exe -ErrorAction Stop
}

$inputFile = Join-Path $Root "scripts\retk-gui.ps1"
$outputFile = Join-Path $Root "REToolkit-GUI.exe"

if (-not (Test-Path -LiteralPath $inputFile)) {
    throw "GUI source not found: $inputFile"
}

$compiler = Get-Command Invoke-ps2exe -ErrorAction Stop
$version = if ($compiler.Module) { $compiler.Module.Version.ToString() } else { throw 'Invoke-ps2exe must come from an identifiable module.' }
Invoke-RetkGuiBuild -Root $Root -OutputFile $outputFile -CompilerVersion $version -Force:$Force -Compile {
    param($InputFile, $OutputFile)
    Invoke-ps2exe -inputFile $InputFile -outputFile $OutputFile -noConsole -title "REToolkit GUI"
} | Out-Null

Write-Host "Built: $outputFile" -ForegroundColor Green
Write-Host "Provenance: $outputFile.provenance.json" -ForegroundColor Green
