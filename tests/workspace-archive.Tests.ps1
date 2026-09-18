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

    $freshProject = Read-Project "FoodHunt"
    Assert-Equals $freshProject.reconstructedSourceDir (Join-Path $sourceWorkspace "05_ReconstructedSource") "New-Workspace should pre-populate reconstructedSourceDir like il2cppDumperOutput/ghidraProjectDir."
    Assert-Equals $freshProject.status.assetRipperExported $false "New-Workspace should initialize assetRipperExported to false."
    Assert-Equals $freshProject.status.assetRipperExportedAt $null "New-Workspace should initialize assetRipperExportedAt to null."

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
    Assert-Equals $importedProject.reconstructedSourceDir (Join-Path $importedWorkspace "05_ReconstructedSource") "Import should rebase reconstructedSourceDir."
    Assert-True ([string]$importedProject.nativeBinary).StartsWith($importedWorkspace, [System.StringComparison]::OrdinalIgnoreCase) "Import should rebase native binary path."
    Assert-True ([string]$importedProject.metadata).StartsWith($importedWorkspace, [System.StringComparison]::OrdinalIgnoreCase) "Import should rebase metadata path."
}
finally {
    if (Test-Path -LiteralPath $tempRoot) {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Expand-RetkZipArchive
$zipTempRoot = Join-Path $env:TEMP ("retk-zip-extract-test-" + [guid]::NewGuid().ToString("N"))
try {
    New-Item -ItemType Directory -Force -Path $zipTempRoot | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    function New-TestZipWithEntries {
        param(
            [Parameter(Mandatory)] [string]$ZipPath,
            # An array of @{Path=...; Content=...} pairs, NOT a hashtable
            # keyed by path: PowerShell hashtable/ordered-dictionary keys are
            # case-insensitive by default, so "res/-n.png" and "res/-N.png"
            # collide as duplicate keys before the zip is even built --
            # confirmed by direct testing (DuplicateKeyInHashLiteral).
            [Parameter(Mandatory)] [object[]]$Entries
        )
        if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
        $archive = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
        try {
            foreach ($item in $Entries) {
                $entry = $archive.CreateEntry($item.Path)
                $stream = $entry.Open()
                try {
                    $writer = New-Object System.IO.StreamWriter($stream)
                    $writer.Write($item.Content)
                    $writer.Flush()
                }
                finally {
                    $stream.Dispose()
                }
            }
        }
        finally {
            $archive.Dispose()
        }
    }

    # Regression case: a normal, non-colliding entry must still extract with
    # exact content -- confirms the manual entry-by-entry rewrite didn't
    # break the common case while fixing the collision case below.
    $normalZip = Join-Path $zipTempRoot "normal.zip"
    New-TestZipWithEntries -ZipPath $normalZip -Entries @([pscustomobject]@{ Path = "readme.txt"; Content = "hello world" })
    $normalDest = Join-Path $zipTempRoot "normal-out"
    Expand-RetkZipArchive -ArchivePath $normalZip -DestinationDir $normalDest
    Assert-Equals (Get-Content -LiteralPath (Join-Path $normalDest "readme.txt") -Raw) "hello world" "A normal, non-colliding zip entry should extract with its exact content."

    # Bug case: [System.IO.Compression.ZipFile]::ExtractToDirectory throws
    # "The file '...' already exists" when two case-sensitive ZIP entries
    # collide to the same case-insensitive Windows path -- confirmed by
    # directly reproducing this against a real Unity IL2CPP Android APK
    # (aapt2 resource-shrunk filenames "res/-n.png" and "res/-N.png").
    # Expand-RetkZipArchive must not throw in this situation.
    $collisionZip = Join-Path $zipTempRoot "collision.zip"
    New-TestZipWithEntries -ZipPath $collisionZip -Entries @(
        [pscustomobject]@{ Path = "res/-n.png"; Content = "first" },
        [pscustomobject]@{ Path = "res/-N.png"; Content = "second" }
    )
    $collisionDest = Join-Path $zipTempRoot "collision-out"
    Expand-RetkZipArchive -ArchivePath $collisionZip -DestinationDir $collisionDest
    Assert-True (Test-Path -LiteralPath (Join-Path $collisionDest "res\-n.png") -PathType Leaf) "A case-colliding zip entry must still produce a file at the collided path, not throw."
}
finally {
    if (Test-Path -LiteralPath $zipTempRoot) {
        Remove-Item -LiteralPath $zipTempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "workspace-archive checks passed"
