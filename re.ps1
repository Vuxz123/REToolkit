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

$ToolPaths = @{
    JdkRoot       = Join-Path $Root "runtime\java\jdk-21"
    JavaExe       = Join-Path $Root "runtime\java\jdk-21\bin\java.exe"
    GhidraCli     = Join-Path $Tools "ghidra-cli\ghidra.exe"
    GhidraGuiBat  = Join-Path $Tools "ghidra\ghidraRun.bat"
    PyGhidraBat   = Join-Path $Tools "ghidra\support\pyghidraRun.bat"
    Dumper        = Join-Path $Tools "Il2CppDumper\Il2CppDumper.exe"
}

function Assert-File {
    param([string]$Path, [string]$Name)
    if (-not (Test-Path -LiteralPath $Path)) {
        $hint = switch -Regex ($Name) {
            "JDK 21"        { "Run: .\install-re-toolkit.ps1 -InstallRuntime" }
            "Ghidra CLI"    { "Run: .\install-re-toolkit.ps1 -InstallGhidraCli" }
            "Ghidra GUI"    { "Run: .\install-re-toolkit.ps1 -InstallGhidra" }
            "PyGhidra"      { "Re-install Ghidra with PyGhidra support (run -InstallGhidra)" }
            "Il2CppDumper"  { "Run: .\install-re-toolkit.ps1 -InstallIl2CppDumper" }
            default         { "" }
        }
        Write-Host "[FAIL] $Name not found: $Path" -ForegroundColor Red
        if ($hint) { Write-Host "       $hint" -ForegroundColor Yellow }
        exit 2
    }
}

function Get-WorkspacePath {
    param([string]$GameName)
    return Join-Path $Workspaces $GameName
}

function Show-ProjectSummary {
    param([string]$GameName)
    $Project = Read-Project $GameName

    function _val($v) { if ($null -eq $v -or "$v" -eq "") { "<unset>" } else { "$v" } }

    Write-Host ""
    Write-Host "== Project: $GameName ==" -ForegroundColor Magenta
    Write-Host ("  Platform         : {0}" -f (_val $Project.platform))
    Write-Host ("  Native binary    : {0}" -f (_val $Project.nativeBinary))
    Write-Host ("  Metadata         : {0}" -f (_val $Project.metadata))
    Write-Host ("  Il2CppDumper out : {0}" -f $Project.il2cppDumperOutput)
    Write-Host ("  Ghidra project   : {0} (in {1})" -f $Project.ghidraProjectName, $Project.ghidraProjectDir)
    Write-Host ("  Ghidra program   : {0}" -f (_val $Project.ghidraProgramName))
    Write-Host ""
    Write-Host "  Status:" -ForegroundColor Cyan
    foreach ($k in @("scanned","dumped","imported","analyzed","symbolsApplied")) {
        $flag = if ($Project.status.$k) { "[x]" } else { "[ ]" }
        Write-Host ("    {0} {1}" -f $flag, $k)
    }
}

function Get-ProjectJsonPath {
    param([string]$GameName)
    return Join-Path (Get-WorkspacePath $GameName) "project.re.json"
}

function Read-Project {
    param([string]$GameName)
    $p = Get-ProjectJsonPath $GameName
    if (-not (Test-Path -LiteralPath $p)) {
        throw "Project config not found: $p. Run: .\re.ps1 init $GameName"
    }
    return Get-Content -LiteralPath $p -Raw | ConvertFrom-Json
}

function Save-Project {
    param([string]$GameName, [object]$Project)
    $p = Get-ProjectJsonPath $GameName
    $Project | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $p -Encoding UTF8
}

function New-Workspace {
    param([string]$GameName)

    if (-not ($GameName -match '^[A-Za-z0-9_\-\.]{1,64}$')) {
        throw "Invalid project name. Use letters, digits, '_', '-', '.' (max 64 chars)."
    }

    $Workspace = Get-WorkspacePath $GameName
    if (Test-Path -LiteralPath $Workspace) {
        Write-Host "[WARN] Workspace already exists: $Workspace" -ForegroundColor Yellow
        if (Test-Path -LiteralPath (Get-ProjectJsonPath $GameName)) {
            Write-Host "       Reusing existing project.re.json." -ForegroundColor Yellow
            return
        }
    } else {
        New-Item -ItemType Directory -Path $Workspace -Force | Out-Null
    }

    $Folders = @(
        "00_OriginalBuild", "01_Extracted", "02_Il2CppDumperOutput",
        "03_GhidraProject", "04_Notes", "05_ReconstructedSource"
    )
    foreach ($f in $Folders) {
        New-Item -ItemType Directory -Force -Path (Join-Path $Workspace $f) | Out-Null
    }

    $Project = [ordered]@{
        name               = $GameName
        platform           = $null
        extractedPath      = $null
        nativeBinary       = $null
        metadata           = $null
        il2cppDumperOutput = (Join-Path $Workspace "02_Il2CppDumperOutput")
        ghidraProjectDir   = (Join-Path $Workspace "03_GhidraProject")
        ghidraProjectName  = $GameName
        ghidraProgramName  = $null
        status = [ordered]@{
            scanned        = $false
            dumped         = $false
            imported       = $false
            analyzed       = $false
            symbolsApplied = $false
        }
    }
    Save-Project $GameName $Project
    Write-Host "Workspace created: $Workspace" -ForegroundColor Green
}

function Invoke-GhidraCli {
    [CmdletBinding()]
    param(
        [Parameter(ValueFromRemainingArguments)] [string[]]$CliArgs,
        [string]$OutFile
    )
    Assert-File $ToolPaths.GhidraCli "Ghidra CLI"
    Assert-File $ToolPaths.JavaExe   "Toolkit JDK 21"
    $base = @("--java-home", $ToolPaths.JdkRoot) + $CliArgs
    if ($OutFile) {
        & $ToolPaths.GhidraCli @base | Out-File -LiteralPath $OutFile -Encoding UTF8
        Write-Host ("Wrote: {0}" -f $OutFile) -ForegroundColor DarkGray
    } else {
        & $ToolPaths.GhidraCli @base
    }
}

function Add-BuildToProject {
    param([string]$GameName, [string]$ArchivePath)

    if (-not (Test-Path -LiteralPath $ArchivePath)) {
        throw "Archive not found: $ArchivePath"
    }
    $item = Get-Item -LiteralPath $ArchivePath
    if ($item.PSIsContainer) {
        throw "Source is a directory. Use scan instead: .\re.ps1 scan $GameName $ArchivePath"
    }

    $ext = [System.IO.Path]::GetExtension($ArchivePath).ToLowerInvariant()
    if ($ext -notin @('.apk','.ipa','.zip','.aab','.xapk')) {
        Write-Host "[WARN] Unrecognized extension '$ext'. Trying Expand-Archive anyway." -ForegroundColor Yellow
    }

    if (-not (Test-Path -LiteralPath (Get-ProjectJsonPath $GameName))) {
        Write-Host "[INFO] Workspace not found; running init first." -ForegroundColor Cyan
        New-Workspace $GameName
    }

    $Project = Read-Project $GameName
    $extractedDir = Join-Path (Get-WorkspacePath $GameName) "01_Extracted"

    if (Test-Path -LiteralPath $extractedDir) {
        Get-ChildItem -LiteralPath $extractedDir -Force -ErrorAction SilentlyContinue |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Path $extractedDir -Force | Out-Null

    Write-Host "Extracting: $ArchivePath" -ForegroundColor Cyan
    Write-Host "       to : $extractedDir" -ForegroundColor Cyan
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
        [System.IO.Compression.ZipFile]::ExtractToDirectory($ArchivePath, $extractedDir)
    } catch {
        throw "Extract failed: $($_.Exception.Message). File may not be a valid ZIP/APK/IPA/AAB."
    }

    $innerApks = Get-ChildItem -LiteralPath $extractedDir -Recurse -Filter "*.apk" -ErrorAction SilentlyContinue
    if ($innerApks) {
        Write-Host ""
        Write-Host ("Found {0} nested APK file(s); flattening..." -f $innerApks.Count) -ForegroundColor Cyan
        foreach ($apk in $innerApks) {
            $apkBase  = [System.IO.Path]::GetFileNameWithoutExtension($apk.Name)
            $destDir  = Join-Path $apk.DirectoryName $apkBase
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
            try {
                [System.IO.Compression.ZipFile]::ExtractToDirectory($apk.FullName, $destDir)
                Write-Host ("  [OK]   {0}  ->  {1}" -f $apk.Name, (Split-Path -Leaf $destDir)) -ForegroundColor Green
                Remove-Item -LiteralPath $apk.FullName -Force
            } catch {
                Write-Host ("  [WARN] {0}: {1}" -f $apk.Name, $_.Exception.Message) -ForegroundColor Yellow
            }
        }
    }

    $innerObbs = Get-ChildItem -LiteralPath $extractedDir -Recurse -Filter "*.obb" -ErrorAction SilentlyContinue
    if ($innerObbs) {
        Write-Host ""
        Write-Host ("Found {0} OBB file(s); flattening..." -f $innerObbs.Count) -ForegroundColor Cyan
        foreach ($obb in $innerObbs) {
            $obbBase = [System.IO.Path]::GetFileNameWithoutExtension($obb.Name)
            $destDir = Join-Path $obb.DirectoryName $obbBase
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
            try {
                [System.IO.Compression.ZipFile]::ExtractToDirectory($obb.FullName, $destDir)
                Write-Host ("  [OK]   {0}  ->  {1}" -f $obb.Name, (Split-Path -Leaf $destDir)) -ForegroundColor Green
                Remove-Item -LiteralPath $obb.FullName -Force
            } catch {
                Write-Host ("  [WARN] {0}: {1}" -f $obb.Name, $_.Exception.Message) -ForegroundColor Yellow
            }
        }
    }

    Scan-UnityIl2Cpp $GameName $extractedDir
}

function Scan-UnityIl2Cpp {
    param([string]$GameName, [string]$ExtractedPath)
    if (-not (Test-Path -LiteralPath $ExtractedPath)) {
        throw "Extracted path not found: $ExtractedPath"
    }
    if (-not (Test-Path -LiteralPath (Get-ProjectJsonPath $GameName))) {
        Write-Host "[INFO] Workspace not found; running init first." -ForegroundColor Cyan
        New-Workspace $GameName
    }
    $Project = Read-Project $GameName
    $ExtractedPath = (Resolve-Path -LiteralPath $ExtractedPath).Path

    $arm64 = Get-ChildItem -LiteralPath $ExtractedPath -Recurse -Filter "libil2cpp.so" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "arm64-v8a" } | Select-Object -First 1
    $armv7 = Get-ChildItem -LiteralPath $ExtractedPath -Recurse -Filter "libil2cpp.so" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match "armeabi-v7a" } | Select-Object -First 1
    $win   = Get-ChildItem -LiteralPath $ExtractedPath -Recurse -Filter "GameAssembly.dll" -ErrorAction SilentlyContinue |
        Select-Object -First 1
    $meta  = Get-ChildItem -LiteralPath $ExtractedPath -Recurse -Filter "global-metadata.dat" -ErrorAction SilentlyContinue |
        Select-Object -First 1

    if (-not $meta) {
        throw "global-metadata.dat not found under: $ExtractedPath"
    }
    if     ($arm64) { $Project.platform = "android-arm64"; $Project.nativeBinary = $arm64.FullName; $Project.ghidraProgramName = "libil2cpp.so" }
    elseif ($armv7) { $Project.platform = "android-armv7"; $Project.nativeBinary = $armv7.FullName; $Project.ghidraProgramName = "libil2cpp.so" }
    elseif ($win)   { $Project.platform = "windows-x64";   $Project.nativeBinary = $win.FullName;   $Project.ghidraProgramName = "GameAssembly.dll" }
    else            { throw "No IL2CPP native binary found. Expected libil2cpp.so or GameAssembly.dll under: $ExtractedPath" }

    $Project.extractedPath = $ExtractedPath
    $Project.metadata       = $meta.FullName
    $Project.status.scanned = $true
    Save-Project $GameName $Project

    Write-Host "Detected platform : $($Project.platform)" -ForegroundColor Cyan
    Write-Host "Native binary     : $($Project.nativeBinary)" -ForegroundColor Cyan
    Write-Host "Metadata          : $($Project.metadata)" -ForegroundColor Cyan
}

function Run-Il2CppDumper {
    param([string]$GameName)
    Assert-File $ToolPaths.Dumper "Il2CppDumper"
    $Project = Read-Project $GameName
    if (-not $Project.status.scanned) {
        throw "Project not scanned. Run: .\re.ps1 scan $GameName <ExtractedPath>"
    }
    New-Item -ItemType Directory -Force -Path $Project.il2cppDumperOutput | Out-Null
    Push-Location $Project.il2cppDumperOutput
    try {
        & $ToolPaths.Dumper $Project.nativeBinary $Project.metadata $Project.il2cppDumperOutput
    } finally {
        Pop-Location
    }
    $dumpCs   = Join-Path $Project.il2cppDumperOutput "dump.cs"
    $ghidraPy = Join-Path $Project.il2cppDumperOutput "ghidra.py"
    if (-not (Test-Path -LiteralPath $dumpCs)) {
        throw "Il2CppDumper finished but dump.cs not found in $($Project.il2cppDumperOutput)."
    }
    if (-not (Test-Path -LiteralPath $ghidraPy)) {
        Write-Host "[WARN] ghidra.py not found. Symbols step may fail." -ForegroundColor Yellow
    }
    $Project.status.dumped = $true
    Save-Project $GameName $Project
    Write-Host "Il2CppDumper output: $($Project.il2cppDumperOutput)" -ForegroundColor Green
}

function Import-GhidraProgram {
    param([string]$GameName)
    $Project = Read-Project $GameName
    if (-not $Project.status.dumped) {
        Write-Host "[WARN] project not dumped yet. Import will continue without symbol hints." -ForegroundColor Yellow
    }
    New-Item -ItemType Directory -Force -Path $Project.ghidraProjectDir | Out-Null

    Invoke-GhidraCli @(
        "--projects-dir", $Project.ghidraProjectDir,
        "--project",      $Project.ghidraProjectName,
        "import",         $Project.nativeBinary
    )
    $Project.status.imported = $true
    Save-Project $GameName $Project
    Write-Host "Imported: $($Project.ghidraProjectName) <- $($Project.nativeBinary)" -ForegroundColor Green
}

function Analyze-GhidraProgram {
    param([string]$GameName)
    $Project = Read-Project $GameName
    if (-not $Project.status.imported) {
        throw "Program not imported. Run: .\re.ps1 import $GameName"
    }
    Invoke-GhidraCli @(
        "--projects-dir", $Project.ghidraProjectDir,
        "--project",      $Project.ghidraProjectName,
        "--program",      $Project.ghidraProgramName,
        "analyze"
    )
    $Project.status.analyzed = $true
    Save-Project $GameName $Project
    Write-Host "Analysis completed." -ForegroundColor Green
}

function Apply-GhidraSymbols {
    param([string]$GameName)
    $Project = Read-Project $GameName
    $ghidraPy = Join-Path $Project.il2cppDumperOutput "ghidra.py"
    if (-not (Test-Path -LiteralPath $ghidraPy)) {
        throw "ghidra.py not found: $ghidraPy. Re-run Il2CppDumper."
    }
    try {
        Invoke-GhidraCli @(
            "--projects-dir", $Project.ghidraProjectDir,
            "--project",      $Project.ghidraProjectName,
            "--program",      $Project.ghidraProgramName,
            "script",         $ghidraPy
        )
        $Project.status.symbolsApplied = $true
        Save-Project $GameName $Project
        Write-Host "Symbols applied via ghidra.py." -ForegroundColor Green
    } catch {
        Write-Host "[WARN] ghidra-cli 'script' failed. Fallback: .\re.ps1 pyghidra-gui" -ForegroundColor Yellow
        throw
    }
}

function Run-FullFlow {
    param([string]$GameName, [string]$Source)
    Write-Host "== RE Flow: $GameName ==" -ForegroundColor Magenta
    New-Workspace $GameName

    if ($Source -and -not (Test-Path -LiteralPath $Source -PathType Container)) {
        Add-BuildToProject $GameName $Source
    } else {
        Scan-UnityIl2Cpp $GameName $Source
    }

    Run-Il2CppDumper      $GameName
    Import-GhidraProgram  $GameName
    Analyze-GhidraProgram $GameName
    try { Apply-GhidraSymbols $GameName }
    catch {
        Write-Host "Symbols step skipped. Open PyGhidra manually if needed: .\re.ps1 pyghidra-gui" -ForegroundColor Yellow
    }

    try { Run-NotesPipeline $GameName }
    catch {
        Write-Host "[WARN] Notes pipeline step failed: $_" -ForegroundColor Yellow
    }

    Show-ProjectSummary $GameName
    Write-Host "Flow completed for $GameName." -ForegroundColor Green
}

function Get-NotesDir {
    param([string]$GameName)
    return Join-Path (Get-WorkspacePath $GameName) "04_Notes"
}

function Run-NotesPipeline {
    param([string]$GameName)
    $Project = Read-Project $GameName
    if (-not $Project.status.dumped) {
        Write-Host "[SKIP] notes pipeline: project not dumped yet." -ForegroundColor Yellow
        return
    }
    New-CandidatesList $GameName
    New-AgentContext    $GameName
}

function New-CandidatesList {
    param([string]$GameName)
    $Project = Read-Project $GameName
    $dump = Join-Path $Project.il2cppDumperOutput "dump.cs"
    if (-not (Test-Path -LiteralPath $dump)) {
        throw "dump.cs not found: $dump"
    }

    $text = Get-Content -LiteralPath $dump -Raw

    $classPat = '(?m)^\s*(?:public|internal|protected|private)?\s*(?:sealed\s+|abstract\s+|partial\s+|static\s+|readonly\s+)*(?:class|interface|struct|enum)\s+(?:<[^>]+>\s+)?(\w+)'
    $allMatches = [regex]::Matches($text, $classPat)
    $allClasses = @()
    foreach ($m in $allMatches) {
        $name = $m.Groups[1].Value
        if ($allClasses -notcontains $name) { $allClasses += $name }
    }

    $suffixes = @(
        @{ pat='Controller'; label='*Controller' },
        @{ pat='Manager';   label='*Manager'   },
        @{ pat='Service';   label='*Service'   },
        @{ pat='Provider';  label='*Provider'  },
        @{ pat='Handler';   label='*Handler'   },
        @{ pat='View';      label='*View'      },
        @{ pat='Config';    label='*Config'    },
        @{ pat='Behaviour'; label='*Behaviour' },
        @{ pat='Component'; label='*Component' },
        @{ pat='Factory';   label='*Factory'   },
        @{ pat='Loader';    label='*Loader'    },
        @{ pat='Store';     label='*Store'     },
        @{ pat='Repository';label='*Repository'},
        @{ pat='Helper';    label='*Helper'    },
        @{ pat='Utility';   label='*Utility'   }
    )

    $groups = @{}
    foreach ($s in $suffixes) {
        $groups[$s.label] = @()
    }
    $groups['(other types)'] = @()

    foreach ($name in $allClasses) {
        $matched = $false
        foreach ($s in $suffixes) {
            if ($name -match $s.pat) { $groups[$s.label] += $name; $matched = $true; break }
        }
        if (-not $matched) { $groups['(other types)'] += $name }
    }

    $topPicks = @('GameManager','MainController','GameController','PlayerController','LevelController','BoardController','AdsManager','AdController','IAPManager','IAPController','NetworkManager','NetworkService','RemoteConfig','RemoteConfigService','AudioManager','ResourceManager','SceneManager','UIManager','GUIManager','PopupManager')
    $topFound = @()
    foreach ($t in $topPicks) {
        if ($allClasses -contains $t) { $topFound += $t }
    }

    $notesDir = Get-NotesDir $GameName
    New-Item -ItemType Directory -Force -Path $notesDir | Out-Null
    $out = Join-Path $notesDir "candidates.md"

    $sb = New-Object System.Text.StringBuilder
    $null = $sb.AppendLine("# Candidate class names - $GameName")
    $null = $sb.AppendLine("")
    $null = $sb.AppendLine(("Generated from: `{0}` ({1} types declared)" -f $dump, $allClasses.Count))
    $null = $sb.AppendLine(("Total lines scanned: {0}" -f ($text -split "`n").Count))
    $null = $sb.AppendLine("")

    if ($topFound.Count -gt 0) {
        $null = $sb.AppendLine("## Top picks (likely entry points)")
        foreach ($c in $topFound) { $null = $sb.AppendLine("- $c") }
        $null = $sb.AppendLine("")
    } else {
        $null = $sb.AppendLine("## Top picks (likely entry points)")
        $null = $sb.AppendLine("- (none of $topPicks found in dump.cs)")
        $null = $sb.AppendLine("")
    }

    foreach ($key in @($groups.Keys | Sort-Object)) {
        $list = $groups[$key]
        if ($list.Count -eq 0) { continue }
        $null = $sb.AppendLine(("## {0} ({1} found)" -f $key, $list.Count))
        foreach ($n in ($list | Sort-Object)) {
            $null = $sb.AppendLine("- $n")
        }
        $null = $sb.AppendLine("")
    }

    Set-Content -LiteralPath $out -Value $sb.ToString() -Encoding UTF8
    Write-Host ("  [OK]   Wrote: {0}   ({1} types, top picks: {2})" -f $out, $allClasses.Count, $topFound.Count) -ForegroundColor Green
}

function New-AgentContext {
    param([string]$GameName)
    $Project = Read-Project $GameName
    $notesDir = Get-NotesDir $GameName
    New-Item -ItemType Directory -Force -Path $notesDir | Out-Null
    $out = Join-Path $notesDir "agent-context.md"

    $dump = Join-Path $Project.il2cppDumperOutput "dump.cs"
    $py   = Join-Path $Project.il2cppDumperOutput "ghidra.py"

    $sb = New-Object System.Text.StringBuilder
    $null = $sb.AppendLine("# Agent Context - $GameName")
    $null = $sb.AppendLine("")
    $null = $sb.AppendLine("## Project state")
    $null = $sb.AppendLine("| Field | Value |")
    $null = $sb.AppendLine("|---|---|")
    $null = $sb.AppendLine(("| Project name     | {0} |" -f $GameName))
    $null = $sb.AppendLine(("| Platform         | {0} |" -f ($(if ($Project.platform)            { $Project.platform }            else { "<unset>" }))))
    $null = $sb.AppendLine(("| Native binary    | `{0}` |" -f ($(if ($Project.nativeBinary)        { $Project.nativeBinary }        else { "<unset>" }))))
    $null = $sb.AppendLine(("| Metadata         | `{0}` |" -f ($(if ($Project.metadata)            { $Project.metadata }            else { "<unset>" }))))
    $null = $sb.AppendLine(("| il2cppDumper out | `{0}` |" -f $Project.il2cppDumperOutput))
    $null = $sb.AppendLine(("| Dump.cs          | `{0}` |" -f $dump))
    $null = $sb.AppendLine(("| ghidra.py        | `{0}` |" -f $py))
    $null = $sb.AppendLine(("| Ghidra project   | {0} (in {1}) |" -f $Project.ghidraProjectName, $Project.ghidraProjectDir))
    $null = $sb.AppendLine(("| Ghidra program   | {0} |" -f ($(if ($Project.ghidraProgramName) { $Project.ghidraProgramName } else { "<unset>" }))))
    $null = $sb.AppendLine("")

    $null = $sb.AppendLine("## Pipeline status")
    $null = $sb.AppendLine("| Step | Done? |")
    $null = $sb.AppendLine("|---|---|")
    foreach ($k in @("scanned","dumped","imported","analyzed","symbolsApplied")) {
        $flag = if ($Project.status.$k) { "[x]" } else { "[ ]" }
        $null = $sb.AppendLine(("| {0} | {1} |" -f $k, $flag))
    }
    $null = $sb.AppendLine("")

    $null = $sb.AppendLine("## Toolkit commands")
    $null = $sb.AppendLine('```powershell')
    $null = $sb.AppendLine((".\re.ps1 status    {0}" -f $GameName))
    $null = $sb.AppendLine((".\re.ps1 summary   {0}" -f $GameName))
    $null = $sb.AppendLine((".\re.ps1 strings   {0}" -f $GameName))
    $null = $sb.AppendLine((".\re.ps1 functions {0}" -f $GameName))
    $null = $sb.AppendLine((".\re.ps1 candidates {0}" -f $GameName))
    $null = $sb.AppendLine((".\re.ps1 symbols   {0}" -f $GameName))
    $null = $sb.AppendLine((".\re.ps1 ghidra-cli --% function list --project {0} --program {1}" -f $Project.ghidraProjectName, $Project.ghidraProgramName))
    $null = $sb.AppendLine((".\re.ps1 ghidra-cli --% decompile <FuncName> --project {0} --program {1}" -f $Project.ghidraProjectName, $Project.ghidraProgramName))
    $null = $sb.AppendLine('```')
    $null = $sb.AppendLine("")

    $null = $sb.AppendLine("## Suggested first searches")
    $null = $sb.AppendLine('```')
    $null = $sb.AppendLine("MainController")
    $null = $sb.AppendLine("GameManager")
    $null = $sb.AppendLine("BoardController")
    $null = $sb.AppendLine("LevelManager")
    $null = $sb.AppendLine("AdsManager")
    $null = $sb.AppendLine("AdController")
    $null = $sb.AppendLine("IAPManager")
    $null = $sb.AppendLine("IAPController")
    $null = $sb.AppendLine("RemoteConfig")
    $null = $sb.AppendLine("NetworkManager")
    $null = $sb.AppendLine("Service")
    $null = $sb.AppendLine("Controller")
    $null = $sb.AppendLine("Presenter")
    $null = $sb.AppendLine("View")
    $null = $sb.AppendLine('```')
    $null = $sb.AppendLine("")

    Set-Content -LiteralPath $out -Value $sb.ToString() -Encoding UTF8
    Write-Host ("  [OK]   Wrote: {0}" -f $out) -ForegroundColor Green
}

function Run-GhidraQueryAndCapture {
    param(
        [string]$GameName,
        [string]$SubCmd,
        [string]$OutFileName
    )
    $Project = Read-Project $GameName
    if (-not $Project.status.imported) {
        throw "Program not imported. Run: .\re.ps1 import $GameName"
    }
    $notesDir = Get-NotesDir $GameName
    New-Item -ItemType Directory -Force -Path $notesDir | Out-Null
    $out = Join-Path $notesDir $OutFileName
    Invoke-GhidraCli -OutFile $out @(
        "--projects-dir", $Project.ghidraProjectDir,
        "--project",      $Project.ghidraProjectName,
        "--program",      $Project.ghidraProgramName,
        $SubCmd
    )
    Write-Host ("Wrote: {0}" -f $out) -ForegroundColor Green
}

function Show-Usage {
    Write-Host "RE Toolkit - RE Pipeline Runner" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "Tier 1 - Pipeline (state machine in project.re.json)"
    Write-Host "  .\re.ps1 doctor"
    Write-Host "  .\re.ps1 init       <GameName>"
    Write-Host "  .\re.ps1 add        <GameName> <apk-or-ipa-or-zip>   # extract + auto-scan"
    Write-Host "  .\re.ps1 scan       <GameName> <ExtractedPath>        # scan an existing folder"
    Write-Host "  .\re.ps1 dump       <GameName>"
    Write-Host "  .\re.ps1 import     <GameName>"
    Write-Host "  .\re.ps1 analyze    <GameName>"
    Write-Host "  .\re.ps1 symbols    <GameName>"
    Write-Host "  .\re.ps1 strings    <GameName>        # ghidra-cli strings  -> 04_Notes\strings.txt"
    Write-Host "  .\re.ps1 functions  <GameName>        # ghidra-cli function -> 04_Notes\functions.txt"
    Write-Host "  .\re.ps1 stats      <GameName>        # ghidra-cli stats    -> 04_Notes\stats.txt"
    Write-Host "  .\re.ps1 candidates <GameName>        # parse dump.cs -> 04_Notes\candidates.md"
    Write-Host "  .\re.ps1 context    <GameName>        # generate 04_Notes\agent-context.md"
    Write-Host "  .\re.ps1 notes      <GameName>        # candidates + context"
    Write-Host "  .\re.ps1 flow       <GameName> <apk-or-ExtractedPath>"
    Write-Host "  .\re.ps1 summary    <GameName>"
    Write-Host "  .\re.ps1 status     <GameName>"
    Write-Host "  .\re.ps1 mcp"
    Write-Host ""
    Write-Host "Tier 2 - Tool wrappers (raw passthrough)"
    Write-Host "  .\re.ps1 ghidra-cli     <args...>    # Rust CLI bridge"
    Write-Host "  .\re.ps1 ghidra-gui                  # full Ghidra GUI"
    Write-Host "  .\re.ps1 pyghidra-gui                # Ghidra GUI w/ PyGhidra console"
    Write-Host "  .\re.ps1 il2cppdumper  <args...>    # raw Il2CppDumper"
    Write-Host "  .\re.ps1 install-skill               # install ghidra-reverse-engineering-cli skill"
    Write-Host ""
    Write-Host "If PS parses --flag, prefix with --%: .\re.ps1 ghidra-cli --% import --help"
}

switch ($Command) {

    ""       { Show-Usage; exit 0 }
    "help"   { Show-Usage; exit 0 }
    "--help" { Show-Usage; exit 0 }
    "-h"     { Show-Usage; exit 0 }

    "doctor" {
        Write-Host "== Toolkit Doctor ==" -ForegroundColor Magenta
        foreach ($k in @("JdkRoot","JavaExe","GhidraCli","GhidraGuiBat","PyGhidraBat","Dumper")) {
            $p = $ToolPaths[$k]
            if (Test-Path -LiteralPath $p) {
                Write-Host ("  [OK]   {0,-14} {1}" -f $k, $p) -ForegroundColor Green
            } else {
                Write-Host ("  [MISS] {0,-14} {1}" -f $k, $p) -ForegroundColor Red
            }
        }
        if (Test-Path -LiteralPath $ToolPaths.JavaExe) {
            Write-Host ""
            Write-Host "  JDK version:" -ForegroundColor Cyan
            & $ToolPaths.JavaExe -version
        }
    }

    "init"    { if (-not $Rest[0]) { Write-Host "Usage: .\re.ps1 init <GameName>"; exit 1 } New-Workspace $Rest[0] }
    "add"     {
        if (-not $Rest[0] -or -not $Rest[1]) {
            Write-Host "Usage: .\re.ps1 add <GameName> <path-to-apk-or-ipa-or-zip>" -ForegroundColor Yellow
            exit 1
        }
        Add-BuildToProject $Rest[0] $Rest[1]
    }
    "scan"       { if (-not $Rest[0] -or -not $Rest[1]) { Write-Host "Usage: .\re.ps1 scan <GameName> <ExtractedPath>"; exit 1 } Scan-UnityIl2Cpp $Rest[0] $Rest[1] }
    "dump"       { if (-not $Rest[0]) { Write-Host "Usage: .\re.ps1 dump <GameName>"; exit 1 } Run-Il2CppDumper $Rest[0] }
    "import"     { if (-not $Rest[0]) { Write-Host "Usage: .\re.ps1 import <GameName>"; exit 1 } Import-GhidraProgram $Rest[0] }
    "analyze"    { if (-not $Rest[0]) { Write-Host "Usage: .\re.ps1 analyze <GameName>"; exit 1 } Analyze-GhidraProgram $Rest[0] }
    "symbols"    { if (-not $Rest[0]) { Write-Host "Usage: .\re.ps1 symbols <GameName>"; exit 1 } Apply-GhidraSymbols $Rest[0] }
    "flow"       { if (-not $Rest[0] -or -not $Rest[1]) { Write-Host "Usage: .\re.ps1 flow <GameName> <apk-or-ExtractedPath>"; exit 1 } Run-FullFlow $Rest[0] $Rest[1] }
    "strings"    { if (-not $Rest[0]) { Write-Host "Usage: .\re.ps1 strings <GameName>"; exit 1 } Run-GhidraQueryAndCapture $Rest[0] "strings"    "strings.txt" }
    "functions"  { if (-not $Rest[0]) { Write-Host "Usage: .\re.ps1 functions <GameName>"; exit 1 } Run-GhidraQueryAndCapture $Rest[0] "function"   "functions.txt" }
    "stats"      { if (-not $Rest[0]) { Write-Host "Usage: .\re.ps1 stats <GameName>"; exit 1 } Run-GhidraQueryAndCapture $Rest[0] "stats"      "stats.txt" }
    "candidates" { if (-not $Rest[0]) { Write-Host "Usage: .\re.ps1 candidates <GameName>"; exit 1 } New-CandidatesList $Rest[0] }
    "context"    { if (-not $Rest[0]) { Write-Host "Usage: .\re.ps1 context <GameName>"; exit 1 } New-AgentContext $Rest[0] }
    "notes"      { if (-not $Rest[0]) { Write-Host "Usage: .\re.ps1 notes <GameName>"; exit 1 } Run-NotesPipeline $Rest[0] }

    "summary" {
        if (-not $Rest[0]) { Write-Host "Usage: .\re.ps1 summary <GameName>"; exit 1 }
        $Project = Read-Project $Rest[0]
        Invoke-GhidraCli @(
            "--projects-dir", $Project.ghidraProjectDir,
            "--project",      $Project.ghidraProjectName,
            "--program",      $Project.ghidraProgramName,
            "summary"
        )
    }

    "status" {
        if (-not $Rest[0]) { Write-Host "Usage: .\re.ps1 status <GameName>"; exit 1 }
        Show-ProjectSummary $Rest[0]
    }

    "ghidra-cli" {
        if ($Rest.Count -eq 0) {
            Write-Host "Usage: .\re.ps1 ghidra-cli <args...>" -ForegroundColor Yellow
            Write-Host "       e.g.: .\re.ps1 ghidra-cli doctor" -ForegroundColor DarkGray
            exit 1
        }
        Invoke-GhidraCli $Rest
    }

    "ghidra-gui" {
        Assert-File $ToolPaths.GhidraGuiBat "Ghidra GUI"
        Assert-File $ToolPaths.JavaExe       "Toolkit JDK 21"
        $env:JAVA_HOME          = $ToolPaths.JdkRoot
        $env:JAVA_HOME_OVERRIDE = $ToolPaths.JdkRoot
        $env:GHIDRA_INSTALL_DIR = (Join-Path $Tools "ghidra")
        $env:Path = "$($ToolPaths.JdkRoot)\bin;$env:Path"
        Push-Location $Root
        try { & $ToolPaths.GhidraGuiBat @Rest }
        finally { Pop-Location }
    }

    "pyghidra-gui" {
        Assert-File $ToolPaths.PyGhidraBat  "PyGhidra launcher"
        Assert-File $ToolPaths.JavaExe      "Toolkit JDK 21"
        $env:JAVA_HOME          = $ToolPaths.JdkRoot
        $env:JAVA_HOME_OVERRIDE = $ToolPaths.JdkRoot
        $env:GHIDRA_INSTALL_DIR = (Join-Path $Tools "ghidra")
        $env:Path = "$($ToolPaths.JdkRoot)\bin;$env:Path"
        Push-Location $Root
        try { & $ToolPaths.PyGhidraBat @Rest }
        finally { Pop-Location }
    }

    "il2cppdumper" {
        Assert-File $ToolPaths.Dumper "Il2CppDumper"
        if ($Rest.Count -eq 0) {
            Write-Host "Usage: .\re.ps1 il2cppdumper <native_binary> <global_metadata> [output_dir]" -ForegroundColor Yellow
            exit 1
        }
        & $ToolPaths.Dumper @Rest
    }

    "mcp" {
        $bridge = Join-Path $Tools "ghidra-mcp\bridge_mcp_ghidra.py"
        if (Test-Path -LiteralPath $bridge) {
            & uv run --script $bridge --transport stdio
        } else {
            foreach ($c in @("ghidra-mcp-bridge","mcp-server-ghidra","bridge_mcp_ghidra")) {
                $cmd = Get-Command $c -ErrorAction SilentlyContinue
                if ($cmd) { & $cmd; return }
            }
            Write-Host "[FAIL] No MCP bridge entrypoint found." -ForegroundColor Red
            Write-Host "       Install via: uv tool install mcp-server-ghidra" -ForegroundColor Yellow
            exit 2
        }
    }

    "install-skill" {
        $prompt = Join-Path $Root "prompts\install-ghidra-skill.md"
        if (Test-Path -LiteralPath $prompt) {
            Get-Content -LiteralPath $prompt
        } else {
            Write-Host "Missing prompt: $prompt" -ForegroundColor Red
            exit 2
        }
    }

    default {
        Write-Host "Unknown command: $Command" -ForegroundColor Red
        Show-Usage
        exit 1
    }
}



