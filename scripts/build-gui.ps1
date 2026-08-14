[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command Invoke-ps2exe -ErrorAction SilentlyContinue)) {
    Write-Host "Installing ps2exe module (CurrentUser scope)..." -ForegroundColor Cyan
    Install-Module -Name ps2exe -Scope CurrentUser -Force -ErrorAction Stop
    Import-Module ps2exe -ErrorAction Stop
}

$inputFile = Join-Path $Root "scripts\retk-gui.ps1"
$outputFile = Join-Path $Root "REToolkit-GUI.exe"

if (-not (Test-Path -LiteralPath $inputFile)) {
    throw "GUI source not found: $inputFile"
}

Invoke-ps2exe -inputFile $inputFile -outputFile $outputFile -noConsole -title "REToolkit GUI"

Write-Host "Built: $outputFile" -ForegroundColor Green
