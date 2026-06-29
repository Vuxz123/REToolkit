[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$ProjectName,

    [string]$Root = (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "workspaces")
)

$ErrorActionPreference = "Stop"

if ($ProjectName -notmatch '^[A-Za-z0-9_\-\.]{1,64}$') {
    throw "Invalid project name. Use letters, digits, '_', '-', '.' (max 64 chars)."
}

$ProjectPath = Join-Path $Root $ProjectName
if (Test-Path -LiteralPath $ProjectPath) {
    Write-Host "Workspace already exists: $ProjectPath" -ForegroundColor Yellow
    return
}

$folders = @(
    "00_OriginalBuild",
    "01_Extracted",
    "02_Il2CppDumperOutput",
    "03_GhidraProject",
    "04_Notes",
    "05_ReconstructedSource"
)

New-Item -ItemType Directory -Path $ProjectPath -Force | Out-Null
foreach ($f in $folders) {
    New-Item -ItemType Directory -Path (Join-Path $ProjectPath $f) -Force | Out-Null
}

$readme = Join-Path $ProjectPath "04_Notes\README.md"
@"
# $ProjectName

| Folder | Purpose |
|---|---|
| 00_OriginalBuild | APK / IPA / original binaries (do not modify) |
| 01_Extracted | Unpacked contents from APK / Unity asset bundles |
| 02_Il2CppDumperOutput | dump.cs, il2cpp.h, script.json, stringliteral.json |
| 03_GhidraProject | Ghidra project files (import \`02_Il2CppDumperOutput/il2cpp.h\`) |
| 04_Notes | Reverse-engineering notes, function maps, hypotheses |
| 05_ReconstructedSource | Reimplemented / deobfuscated source after analysis |

## Quick start
1. Copy \`libil2cpp.so\` and \`global-metadata.dat\` into \`00_OriginalBuild/\`
2. Run: \`..\..\re.ps1 dump 00_OriginalBuild\libil2cpp.so 00_OriginalBuild\global-metadata.dat $ProjectName\`
3. Open Ghidra: \`..\..\re.ps1 ghidra $ProjectName\`
4. Import \`02_Il2CppDumperOutput\il2cpp.h\` and \`dump.cs\` into the project
"@ | Set-Content -LiteralPath $readme -Encoding UTF8

Write-Host "Created workspace: $ProjectPath" -ForegroundColor Green
Write-Host "Folders:"
foreach ($f in $folders) {
    Write-Host ("  - $ProjectPath\$f")
}
