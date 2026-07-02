[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
. (Join-Path $RepoRoot "scripts\retk-project.ps1")

function Assert-True {
    param(
        [Parameter(Mandatory)] [bool]$Condition,
        [Parameter(Mandatory)] [string]$Message
    )

    if (-not $Condition) {
        throw "ASSERT TRUE failed: $Message"
    }
}

function Assert-Equals {
    param(
        [AllowNull()] $Actual,
        [AllowNull()] $Expected,
        [Parameter(Mandatory)] [string]$Message
    )

    if ($Actual -ne $Expected) {
        throw "ASSERT EQUALS failed: $Message`nExpected: $Expected`nActual  : $Actual"
    }
}

$tempRoot = Join-Path $env:TEMP ("retk-workspace-archive-test-" + [guid]::NewGuid().ToString("N"))
try {
    $sourceRoot = Join-Path $tempRoot "source"
    $script:Root = $sourceRoot
    $script:Workspaces = Join-Path $sourceRoot "workspaces"

    New-Workspace "FoodHunt" | Out-Null
    $sourceWorkspace = Join-Path $script:Workspaces "FoodHunt"
    $binaryPath = Join-Path $sourceWorkspace "01_Extracted\lib\arm64-v8a\libil2cpp.so"
    $metadataPath = Join-Path $sourceWorkspace "01_Extracted\assets\bin\Data\Managed\Metadata\global-metadata.dat"
    $notePath = Join-Path $sourceWorkspace "04_Notes\note.txt"
    New-Item -ItemType Directory -Path (Split-Path -Parent $binaryPath) -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $metadataPath) -Force | Out-Null
    New-Item -ItemType Directory -Path (Split-Path -Parent $notePath) -Force | Out-Null
    Set-Content -LiteralPath $binaryPath -Value "binary" -Encoding ASCII
    Set-Content -LiteralPath $metadataPath -Value "metadata" -Encoding ASCII
    Set-Content -LiteralPath $notePath -Value "note" -Encoding ASCII

    $project = Read-Project "FoodHunt"
    $project.extractedPath = Join-Path $sourceWorkspace "01_Extracted"
    $project.nativeBinary = $binaryPath
    $project.metadata = $metadataPath
    $project.status.scanned = $true
    Save-Project "FoodHunt" $project

    $archive = Export-WorkspaceArchive -GameName "FoodHunt" -OutputPath (Join-Path $tempRoot "FoodHunt.zip")
    Assert-Equals ([System.IO.Path]::GetExtension($archive.ArchivePath)) ".re" "Export should force the .re extension."
    Assert-True (Test-Path -LiteralPath $archive.ArchivePath -PathType Leaf) "Export should create the archive file."

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archive.ArchivePath)
    try {
        $entryNames = @($zip.Entries | ForEach-Object { $_.FullName })
        Assert-True ($entryNames -contains "FoodHunt/project.re.json") "Archive should contain the workspace root folder."
        Assert-True ($entryNames -contains "FoodHunt/04_Notes/note.txt") "Archive should include workspace files."
    }
    finally {
        $zip.Dispose()
    }

    $importRoot = Join-Path $tempRoot "import"
    $script:Root = $importRoot
    $script:Workspaces = Join-Path $importRoot "workspaces"

    $imported = Import-WorkspaceArchive -ArchivePath $archive.ArchivePath
    $importedWorkspace = Join-Path $script:Workspaces "FoodHunt"
    Assert-Equals $imported.WorkspacePath $importedWorkspace "Import should restore to the current workspaces folder."
    Assert-True (Test-Path -LiteralPath (Join-Path $importedWorkspace "04_Notes\note.txt") -PathType Leaf) "Import should restore workspace files."

    $importedProject = Read-Project "FoodHunt"
    Assert-Equals $importedProject.name "FoodHunt" "Imported project should keep the workspace name."
    Assert-Equals $importedProject.il2cppDumperOutput (Join-Path $importedWorkspace "02_Il2CppDumperOutput") "Import should rebase il2cpp output path."
    Assert-Equals $importedProject.ghidraProjectDir (Join-Path $importedWorkspace "03_GhidraProject") "Import should rebase Ghidra project dir."
    Assert-True ([string]$importedProject.nativeBinary).StartsWith($importedWorkspace, [System.StringComparison]::OrdinalIgnoreCase) "Import should rebase native binary path."
    Assert-True ([string]$importedProject.metadata).StartsWith($importedWorkspace, [System.StringComparison]::OrdinalIgnoreCase) "Import should rebase metadata path."
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "workspace-archive checks passed"
