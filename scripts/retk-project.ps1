# Dot-sourced by re.ps1. Uses shared REToolkit variables from the entrypoint.

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

function Test-RetkPathWithin {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$Parent
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\','/'))
    $fullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd([char[]]@('\','/'))

    return $fullPath.Equals($fullParent, [System.StringComparison]::OrdinalIgnoreCase) -or
        $fullPath.StartsWith($fullParent + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-WorkspaceName {
    param([Parameter(Mandatory)] [string]$GameName)

    if (-not ($GameName -match '^[A-Za-z0-9_\-.]{1,64}$')) {
        throw "Invalid workspace name. Use letters, digits, '_', '-', '.' only, max 64 chars."
    }
}

function Resolve-WorkspaceArchiveOutputPath {
    param(
        [Parameter(Mandatory)] [string]$GameName,
        [string]$OutputPath = ""
    )

    if ([string]::IsNullOrWhiteSpace($OutputPath)) {
        $OutputPath = Join-Path (Join-Path $Root "exports") ($GameName + ".re")
    }
    elseif ((Test-Path -LiteralPath $OutputPath -PathType Container) -or $OutputPath.EndsWith("\") -or $OutputPath.EndsWith("/")) {
        $OutputPath = Join-Path $OutputPath ($GameName + ".re")
    }

    $fullPath = [System.IO.Path]::GetFullPath($OutputPath)
    if (-not $fullPath.EndsWith(".re", [System.StringComparison]::OrdinalIgnoreCase)) {
        $fullPath = [System.IO.Path]::ChangeExtension($fullPath, ".re")
    }

    return $fullPath
}

function Export-WorkspaceArchive {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$GameName,
        [string]$OutputPath = ""
    )

    Assert-WorkspaceName $GameName

    $workspace = Get-WorkspacePath $GameName
    if (-not (Test-Path -LiteralPath $workspace -PathType Container)) {
        throw "Workspace not found: $workspace"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $workspace "project.re.json") -PathType Leaf)) {
        throw "Workspace project.re.json not found: $(Join-Path $workspace "project.re.json")"
    }

    $archivePath = Resolve-WorkspaceArchiveOutputPath -GameName $GameName -OutputPath $OutputPath
    if (Test-RetkPathWithin -Path $archivePath -Parent $workspace) {
        throw "Output archive cannot be inside the workspace being exported: $archivePath"
    }

    $archiveParent = Split-Path -Parent $archivePath
    if ($archiveParent) {
        New-Item -ItemType Directory -Path $archiveParent -Force | Out-Null
    }
    if (Test-Path -LiteralPath $archivePath -PathType Leaf) {
        Remove-Item -LiteralPath $archivePath -Force
    }

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::Open($archivePath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        [void]$zip.CreateEntry(($GameName.TrimEnd('/','\') + "/"))

        $workspaceFull = [System.IO.Path]::GetFullPath($workspace).TrimEnd([char[]]@('\','/'))
        foreach ($dir in Get-ChildItem -LiteralPath $workspaceFull -Recurse -Directory -Force) {
            $relative = $dir.FullName.Substring($workspaceFull.Length).TrimStart([char[]]@('\','/')) -replace '\\','/'
            if (-not [string]::IsNullOrWhiteSpace($relative)) {
                [void]$zip.CreateEntry(("{0}/{1}/" -f $GameName, $relative.TrimEnd('/')))
            }
        }

        foreach ($file in Get-ChildItem -LiteralPath $workspaceFull -Recurse -File -Force) {
            $relative = $file.FullName.Substring($workspaceFull.Length).TrimStart([char[]]@('\','/')) -replace '\\','/'
            $entryName = "{0}/{1}" -f $GameName, $relative
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal)
        }
    }
    finally {
        $zip.Dispose()
    }

    Write-Host ("  [OK]   Exported workspace: {0}" -f $archivePath) -ForegroundColor Green
    return [pscustomobject]@{
        GameName      = $GameName
        WorkspacePath = $workspace
        ArchivePath   = $archivePath
    }
}

function Get-WorkspaceArchiveSourceDir {
    param([Parameter(Mandatory)] [string]$ExtractDir)

    $rootProject = Join-Path $ExtractDir "project.re.json"
    if (Test-Path -LiteralPath $rootProject -PathType Leaf) {
        return $ExtractDir
    }

    $candidates = @(Get-ChildItem -LiteralPath $ExtractDir -Directory -Force | Where-Object {
        Test-Path -LiteralPath (Join-Path $_.FullName "project.re.json") -PathType Leaf
    })

    if ($candidates.Count -eq 1) {
        return $candidates[0].FullName
    }

    if ($candidates.Count -gt 1) {
        throw "Archive contains multiple workspace roots with project.re.json; pass a single-workspace .re archive."
    }

    throw "Archive does not contain project.re.json at the root or inside one top-level workspace folder."
}

function Set-ObjectNoteProperty {
    param(
        [Parameter(Mandatory)] [object]$Object,
        [Parameter(Mandatory)] [string]$Name,
        [AllowNull()] $Value
    )

    if ($null -eq $Object.PSObject.Properties[$Name]) {
        Add-Member -InputObject $Object -MemberType NoteProperty -Name $Name -Value $Value -Force
    }
    else {
        $Object.$Name = $Value
    }
}

function Find-WorkspaceFileByLeaf {
    param(
        [Parameter(Mandatory)] [string]$WorkspacePath,
        [string]$OriginalPath = "",
        [string[]]$FallbackNames = @()
    )

    $names = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($OriginalPath)) {
        $leaf = Split-Path -Leaf $OriginalPath
        if (-not [string]::IsNullOrWhiteSpace($leaf)) {
            [void]$names.Add($leaf)
        }
    }
    foreach ($fallback in $FallbackNames) {
        if (-not [string]::IsNullOrWhiteSpace($fallback) -and -not $names.Contains($fallback)) {
            [void]$names.Add($fallback)
        }
    }

    foreach ($name in $names) {
        $match = Get-ChildItem -LiteralPath $WorkspacePath -Recurse -File -Filter $name -Force -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($match) {
            return $match.FullName
        }
    }

    return $OriginalPath
}

function Update-ImportedWorkspaceProject {
    param(
        [Parameter(Mandatory)] [string]$GameName,
        [Parameter(Mandatory)] [string]$WorkspacePath
    )

    $projectPath = Join-Path $WorkspacePath "project.re.json"
    if (-not (Test-Path -LiteralPath $projectPath -PathType Leaf)) {
        throw "Imported workspace is missing project.re.json: $projectPath"
    }

    $project = Get-Content -LiteralPath $projectPath -Raw | ConvertFrom-Json
    Set-ObjectNoteProperty -Object $project -Name "name" -Value $GameName
    Set-ObjectNoteProperty -Object $project -Name "il2cppDumperOutput" -Value (Join-Path $WorkspacePath "02_Il2CppDumperOutput")
    Set-ObjectNoteProperty -Object $project -Name "ghidraProjectDir" -Value (Join-Path $WorkspacePath "03_GhidraProject")
    if ([string]::IsNullOrWhiteSpace([string]$project.ghidraProjectName)) {
        Set-ObjectNoteProperty -Object $project -Name "ghidraProjectName" -Value $GameName
    }

    $extractedPath = Join-Path $WorkspacePath "01_Extracted"
    if (Test-Path -LiteralPath $extractedPath -PathType Container) {
        Set-ObjectNoteProperty -Object $project -Name "extractedPath" -Value $extractedPath
    }

    $nativeBinary = Find-WorkspaceFileByLeaf -WorkspacePath $WorkspacePath -OriginalPath ([string]$project.nativeBinary) -FallbackNames @("libil2cpp.so", "GameAssembly.dll")
    if (-not [string]::IsNullOrWhiteSpace($nativeBinary)) {
        Set-ObjectNoteProperty -Object $project -Name "nativeBinary" -Value $nativeBinary
    }

    $metadata = Find-WorkspaceFileByLeaf -WorkspacePath $WorkspacePath -OriginalPath ([string]$project.metadata) -FallbackNames @("global-metadata.dat")
    if (-not [string]::IsNullOrWhiteSpace($metadata)) {
        Set-ObjectNoteProperty -Object $project -Name "metadata" -Value $metadata
    }

    Save-Project $GameName $project
    return $project
}

function Import-WorkspaceArchive {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$ArchivePath,
        [string]$GameName = "",
        [switch]$Force
    )

    if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
        throw "Workspace archive not found: $ArchivePath"
    }

    $archiveFull = (Resolve-Path -LiteralPath $ArchivePath).Path
    $extension = [System.IO.Path]::GetExtension($archiveFull)
    if ($extension -notin @(".re", ".zip")) {
        throw "Workspace archive must use .re or .zip extension: $archiveFull"
    }

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $extractRoot = Join-Path $env:TEMP ("retk-import-" + [guid]::NewGuid().ToString("N"))
    try {
        New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
        [System.IO.Compression.ZipFile]::ExtractToDirectory($archiveFull, $extractRoot)

        $sourceDir = Get-WorkspaceArchiveSourceDir -ExtractDir $extractRoot
        $sourceProjectPath = Join-Path $sourceDir "project.re.json"
        $sourceProject = Get-Content -LiteralPath $sourceProjectPath -Raw | ConvertFrom-Json

        if ([string]::IsNullOrWhiteSpace($GameName)) {
            $GameName = [string]$sourceProject.name
        }
        if ([string]::IsNullOrWhiteSpace($GameName)) {
            $GameName = Split-Path -Leaf $sourceDir
        }
        Assert-WorkspaceName $GameName

        $destination = Get-WorkspacePath $GameName
        if (Test-Path -LiteralPath $destination) {
            if (-not $Force) {
                throw "Workspace already exists: $destination. Use: .\re.ps1 import `"$archiveFull`" $GameName --force"
            }
            if (-not (Test-RetkPathWithin -Path $destination -Parent $Workspaces)) {
                throw "Refusing to overwrite path outside the workspaces folder: $destination"
            }
            Remove-Item -LiteralPath $destination -Recurse -Force
        }

        New-Item -ItemType Directory -Path $destination -Force | Out-Null
        Get-ChildItem -LiteralPath $sourceDir -Force | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
        }

        $project = Update-ImportedWorkspaceProject -GameName $GameName -WorkspacePath $destination

        Write-Host ("  [OK]   Imported workspace: {0}" -f $destination) -ForegroundColor Green
        return [pscustomobject]@{
            GameName      = $GameName
            ArchivePath   = $archiveFull
            WorkspacePath = $destination
            Project       = $project
        }
    }
    finally {
        if (Test-Path -LiteralPath $extractRoot) {
            Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
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

function Set-GhidraDefaultProjectForGame {
    param([Parameter(Mandatory)] [string]$GameName)

    if (-not (Get-Command "Set-GhidraDefaultProjectPreference" -CommandType Function -ErrorAction SilentlyContinue)) {
        Write-Host "  [WARN] Ghidra preferences helper missing; default project was not updated." -ForegroundColor Yellow
        return $null
    }

    $project = Read-Project $GameName
    $projectDir = [string]$project.ghidraProjectDir
    $projectName = [string]$project.ghidraProjectName

    if ([string]::IsNullOrWhiteSpace($projectDir) -or [string]::IsNullOrWhiteSpace($projectName)) {
        throw "Project '$GameName' does not have ghidraProjectDir/ghidraProjectName in project.re.json."
    }

    $preferencesPath = Get-GhidraPreferencesPath -GhidraRoot $ToolPaths.GhidraRoot
    if ([string]::IsNullOrWhiteSpace($preferencesPath)) {
        Write-Host "  [WARN] Ghidra preferences path could not be detected; default project was not updated." -ForegroundColor Yellow
        return $null
    }

    $templatePath = Join-Path $Root "templates\Ghidra\preferences"
    $result = Set-GhidraDefaultProjectPreference -PreferencesPath $preferencesPath -ProjectDir $projectDir -ProjectName $projectName -TemplatePath $templatePath
    if ($result.Changed) {
        Write-Host ("  [OK]   Ghidra default project set: {0}" -f $result.ProjectPath) -ForegroundColor Green
    }
    else {
        Write-Host ("  [OK]   Ghidra default project already set: {0}" -f $result.ProjectPath) -ForegroundColor DarkGray
    }

    return $result
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
