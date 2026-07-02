# Dot-sourced by re.ps1. Uses shared REToolkit variables from the entrypoint.

function Run-Il2CppDumper {
    param([Parameter(Mandatory)] [string]$GameName)

    Assert-PathExists $ToolPaths.Dumper "Il2CppDumper"

    $project = Read-Project $GameName
    if (-not $project.status.scanned) {
        throw "Project not scanned. Run: .\re.ps1 scan $GameName <ExtractedPath>"
    }

    New-Item -ItemType Directory -Force -Path $project.il2cppDumperOutput | Out-Null

    $dumperDir = Split-Path -Parent $ToolPaths.Dumper
    $cfgPath = Join-Path $dumperDir "config.json"
    if (Test-Path -LiteralPath $cfgPath) {
        try {
            $cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
            $changed = $false
            if ($cfg.PSObject.Properties.Name -contains "RequireAnyKey" -and $cfg.RequireAnyKey -eq $true) {
                $cfg.RequireAnyKey = $false
                $changed = $true
            }
            if ($cfg.PSObject.Properties.Name -contains "GenerateScript" -and $cfg.GenerateScript -ne $true) {
                $cfg.GenerateScript = $true
                $changed = $true
            }
            if ($changed) {
                $cfg | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $cfgPath -Encoding UTF8
                Write-Host "  [FIX] Patched Il2CppDumper config.json for automation." -ForegroundColor Cyan
            }
        }
        catch {
            Write-Host "  [WARN] Could not inspect/patch Il2CppDumper config.json: $_" -ForegroundColor Yellow
        }
    }

    Push-Location $project.il2cppDumperOutput
    try {
        & $ToolPaths.Dumper $project.nativeBinary $project.metadata $project.il2cppDumperOutput
        if ($LASTEXITCODE -ne 0) {
            throw "Il2CppDumper exited with code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }

    $dumpCs = Join-Path $project.il2cppDumperOutput "dump.cs"
    $ghidraPy = Join-Path $project.il2cppDumperOutput "ghidra.py"
    $ghidraPyFallback = Join-Path $dumperDir "ghidra.py"
    Repair-Il2CppDumperGhidraTemplates -Dir $dumperDir | Out-Null

    if (-not (Test-Path -LiteralPath $dumpCs)) {
        throw "Il2CppDumper finished but dump.cs not found in $($project.il2cppDumperOutput)."
    }

    Repair-Il2CppDumperGhidraTemplates -Dir $project.il2cppDumperOutput | Out-Null

    if (-not (Test-Path -LiteralPath $ghidraPy) -and (Test-Path -LiteralPath $ghidraPyFallback)) {
        Copy-Item -LiteralPath $ghidraPyFallback -Destination $ghidraPy -Force
        Write-Host "  [FIX] Copied ghidra.py fallback from dumper folder to project output." -ForegroundColor Cyan
    }

    if (-not (Test-Path -LiteralPath $ghidraPy)) {
        Write-Host "[WARN] ghidra.py not found. Symbols step may need manual PyGhidra fallback." -ForegroundColor Yellow
    }
    else {
        Repair-Il2CppGhidraScript -Path $ghidraPy | Out-Null
    }

    $project.status.dumped = $true
    Save-Project $GameName $project
    Write-Host "Il2CppDumper output: $($project.il2cppDumperOutput)" -ForegroundColor Green
}

function Import-GhidraProgram {
    param([Parameter(Mandatory)] [string]$GameName)

    $project = Read-Project $GameName
    if (-not $project.status.scanned) {
        throw "Project not scanned. Run: .\re.ps1 scan $GameName <ExtractedPath>"
    }

    Assert-PathExists $ToolPaths.AnalyzeHeadless "Ghidra Headless Analyzer"
    Assert-PathExists $ToolPaths.JavaExe "Toolkit JDK 21"

    New-Item -ItemType Directory -Force -Path $project.ghidraProjectDir | Out-Null

    $notesDir = Get-NotesDir $GameName
    New-Item -ItemType Directory -Force -Path $notesDir | Out-Null
    $logFile = Join-Path $notesDir "import.log"

    Write-Host "== Import only: $GameName ==" -ForegroundColor Magenta
    Write-Host "Mode    : analyzeHeadless -import -overwrite -noanalysis" -ForegroundColor Cyan
    Write-Host "Project : $($project.ghidraProjectDir)\$($project.ghidraProjectName)" -ForegroundColor DarkGray
    Write-Host "Binary  : $($project.nativeBinary)" -ForegroundColor DarkGray
    Write-Host "Log     : $logFile" -ForegroundColor DarkGray
    Write-Host "Note    : this step intentionally does NOT run Ghidra analysis." -ForegroundColor DarkGray

    # Important:
    # Use Ghidra's official headless importer here, not an agent-side bridge.
    # The toolkit flow only needs a plain project import; interactive queries
    # should happen later through the GhidraMCP GUI plugin.
    $headlessArgs = @(
        [string]$project.ghidraProjectDir,
        [string]$project.ghidraProjectName,
        "-import",    [string]$project.nativeBinary,
        "-overwrite",
        "-noanalysis"
    )

    try {
        @(
            "# Import only - $GameName",
            "StartedAt: $((Get-Date).ToString('s'))",
            "Mode: analyzeHeadless -import -overwrite -noanalysis",
            "ProjectDir: $($project.ghidraProjectDir)",
            "ProjectName: $($project.ghidraProjectName)",
            "Binary: $($project.nativeBinary)",
            ""
        ) | Out-File -LiteralPath $logFile -Encoding UTF8

        $outputLines = Invoke-AnalyzeHeadless -HeadlessArgs $headlessArgs
        Add-Content -LiteralPath $logFile -Encoding UTF8 -Value $outputLines
        Add-Content -LiteralPath $logFile -Encoding UTF8 -Value ""
        Add-Content -LiteralPath $logFile -Encoding UTF8 -Value "FinishedAt: $((Get-Date).ToString('s')); ExitCode: 0"
    }
    catch {
        $message = $_.Exception.Message
        Add-Content -LiteralPath $logFile -Encoding UTF8 -Value ""
        Add-Content -LiteralPath $logFile -Encoding UTF8 -Value "Import failed: $message"

        if (Test-GhidraLockError $message) {
            $lockMessage = New-GhidraProjectLockedMessage -Project $project
            Add-Content -LiteralPath $logFile -Encoding UTF8 -Value ""
            Add-Content -LiteralPath $logFile -Encoding UTF8 -Value $lockMessage
            throw $lockMessage
        }

        throw "Ghidra import failed.`n$message`nCheck log: $logFile"
    }

    $project.status.imported = $true
    # This import mode intentionally skips analysis.
    Set-ProjectStatusValue -Project $project -Name "analyzed" -Value $false
    Set-ProjectStatusValue -Project $project -Name "analyzing" -Value $false
    Save-Project $GameName $project

    Write-Host "Imported without analysis: $($project.ghidraProjectName) <- $($project.nativeBinary)" -ForegroundColor Green
    Write-Host "Next: .\re.ps1 open $GameName" -ForegroundColor Cyan
}

function Analyze-GhidraProgram {
    param([Parameter(Mandatory)] [string]$GameName)

    $project = Read-Project $GameName
    if (-not $project.status.imported) {
        throw "Program not imported. Run: .\re.ps1 import $GameName"
    }

    $notesDir = Get-NotesDir $GameName
    New-Item -ItemType Directory -Force -Path $notesDir | Out-Null
    $logFile = Join-Path $notesDir "analyze.log"

    Set-ProjectStatusValue -Project $project -Name "analyzing" -Value $true
    Set-ProjectStatusValue -Project $project -Name "analyzeStartedAt" -Value ((Get-Date).ToString("s"))
    Set-ProjectStatusValue -Project $project -Name "analyzeCompletedAt" -Value $null
    Save-Project $GameName $project

    Write-Host "== Analyze: $GameName ==" -ForegroundColor Magenta
    Write-Host "Program : $($project.ghidraProgramName)" -ForegroundColor DarkGray
    Write-Host "Log     : $logFile" -ForegroundColor DarkGray
    Write-Host "Mode    : analyzeHeadless -process with heartbeat; MCP queries stay in the GUI/plugin." -ForegroundColor DarkGray

    $success = $false
    try {
        try {
            Invoke-AnalyzeHeadlessHeartbeat @(
                $project.ghidraProjectDir,
                $project.ghidraProjectName,
                "-process", $project.ghidraProgramName
            ) -Activity "Ghidra analyze: $GameName" -LogFile $logFile | Out-Null
            $success = $true
        }
        catch {
            $message = $_.Exception.Message
            Add-Content -LiteralPath $logFile -Encoding UTF8 -Value ""
            Add-Content -LiteralPath $logFile -Encoding UTF8 -Value "analyzeHeadless failed: $message"

            if (Test-GhidraLockError $message) {
                $lockMessage = New-GhidraProjectLockedMessage -Project $project
                Add-Content -LiteralPath $logFile -Encoding UTF8 -Value ""
                Add-Content -LiteralPath $logFile -Encoding UTF8 -Value $lockMessage
                throw $lockMessage
            }
            throw
        }
    }
    finally {
        $project = Read-Project $GameName
        Set-ProjectStatusValue -Project $project -Name "analyzing" -Value $false
        if ($success) {
            Set-ProjectStatusValue -Project $project -Name "analyzed" -Value $true
            Set-ProjectStatusValue -Project $project -Name "analyzeCompletedAt" -Value ((Get-Date).ToString("s"))
        }
        Save-Project $GameName $project
    }

    if ($success) {
        Write-Host "Analysis completed." -ForegroundColor Green
        Write-Host "Wrote heartbeat log: $logFile" -ForegroundColor Green
    }
}

function Apply-GhidraSymbols {
    param([Parameter(Mandatory)] [string]$GameName)

    $project = Read-Project $GameName
    if (-not $project.status.imported) {
        throw "Program not imported. Run: .\re.ps1 import $GameName"
    }

    $ghidraPy = Join-Path $project.il2cppDumperOutput "ghidra.py"
    $dumperDir = Split-Path -Parent $ToolPaths.Dumper
    $ghidraPyFallback = Join-Path $dumperDir "ghidra.py"

    Repair-Il2CppDumperGhidraTemplates -Dir $dumperDir | Out-Null
    Repair-Il2CppDumperGhidraTemplates -Dir $project.il2cppDumperOutput | Out-Null

    if (-not (Test-Path -LiteralPath $ghidraPy) -and (Test-Path -LiteralPath $ghidraPyFallback)) {
        Repair-Il2CppGhidraScript -Path $ghidraPyFallback | Out-Null
        Copy-Item -LiteralPath $ghidraPyFallback -Destination $ghidraPy -Force
        Write-Host "  [FIX] Copied ghidra.py fallback from dumper folder." -ForegroundColor Cyan
    }

    if (-not (Test-Path -LiteralPath $ghidraPy)) {
        Write-Host "[WARN] ghidra.py not found. Open PyGhidra manually: .\re.ps1 pyghidra-gui" -ForegroundColor Yellow
        return
    }

    Repair-Il2CppGhidraScript -Path $ghidraPy | Out-Null

    Write-Host "== Apply symbols manually: $GameName ==" -ForegroundColor Magenta
    Write-Host ("Project dir : {0}" -f $project.ghidraProjectDir) -ForegroundColor Gray
    Write-Host ("Project name: {0}" -f $project.ghidraProjectName) -ForegroundColor Gray
    Write-Host ("Program     : {0}" -f $project.ghidraProgramName) -ForegroundColor Gray
    Write-Host ("Script      : {0}" -f $ghidraPy) -ForegroundColor Gray
    Write-Host ""
    Write-Host "MCP-first mode does not run ghidra.py through ghidra-cli." -ForegroundColor Cyan
    Write-Host "Manual steps in Ghidra/PyGhidra GUI:" -ForegroundColor Cyan
    Write-Host "  1. Open the project and program above." -ForegroundColor Gray
    Write-Host "  2. Run Auto Analysis if it has not already completed." -ForegroundColor Gray
    Write-Host "  3. Open Script Manager and run the ghidra.py path above." -ForegroundColor Gray
    Write-Host "  4. Start MCP server with: Tools > GhidraMCP > Start MCP Server" -ForegroundColor Gray
}

function Get-NotesDir {
    param([Parameter(Mandatory)] [string]$GameName)
    return Join-Path (Get-WorkspacePath $GameName) "04_Notes"
}

function New-CandidatesList {
    param([Parameter(Mandatory)] [string]$GameName)

    $project = Read-Project $GameName
    $dump = Join-Path $project.il2cppDumperOutput "dump.cs"
    if (-not (Test-Path -LiteralPath $dump)) {
        throw "dump.cs not found: $dump"
    }

    $text = Get-Content -LiteralPath $dump -Raw
    $classPattern = '(?m)^\s*(?:public|internal|protected|private)?\s*(?:sealed\s+|abstract\s+|partial\s+|static\s+|readonly\s+)*(?:class|interface|struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*<[^>]+>)?'
    $matches = [regex]::Matches($text, $classPattern)

    $allTypes = New-Object System.Collections.Generic.List[string]
    foreach ($m in $matches) {
        $name = $m.Groups[1].Value
        if (-not $allTypes.Contains($name)) { $allTypes.Add($name) }
    }

    $suffixes = @(
        @{ pat='Controller$'; label='*Controller' },
        @{ pat='Manager$';    label='*Manager' },
        @{ pat='Service$';    label='*Service' },
        @{ pat='Provider$';   label='*Provider' },
        @{ pat='Handler$';    label='*Handler' },
        @{ pat='View$';       label='*View' },
        @{ pat='Config$';     label='*Config' },
        @{ pat='Behaviour$';  label='*Behaviour' },
        @{ pat='Component$';  label='*Component' },
        @{ pat='Factory$';    label='*Factory' },
        @{ pat='Loader$';     label='*Loader' },
        @{ pat='Store$';      label='*Store' },
        @{ pat='Repository$'; label='*Repository' },
        @{ pat='Helper$';     label='*Helper' },
        @{ pat='Utility$';    label='*Utility' }
    )

    $groups = [ordered]@{}
    foreach ($s in $suffixes) { $groups[$s.label] = @() }
    $groups['(other types)'] = @()

    foreach ($name in $allTypes) {
        $matched = $false
        foreach ($s in $suffixes) {
            if ($name -match $s.pat) {
                $groups[$s.label] += $name
                $matched = $true
                break
            }
        }
        if (-not $matched) { $groups['(other types)'] += $name }
    }

    $topPicks = @(
        'GameManager','MainController','GameController','PlayerController','LevelController','BoardController',
        'AdsManager','AdController','IAPManager','IAPController','NetworkManager','NetworkService',
        'RemoteConfig','RemoteConfigService','AudioManager','ResourceManager','SceneManager','UIManager','GUIManager','PopupManager'
    )
    $topFound = @($topPicks | Where-Object { $allTypes.Contains($_) })

    $notesDir = Get-NotesDir $GameName
    New-Item -ItemType Directory -Force -Path $notesDir | Out-Null
    $out = Join-Path $notesDir "candidates.md"

    $sb = New-Object System.Text.StringBuilder
    $null = $sb.AppendLine("# Candidate class names - $GameName")
    $null = $sb.AppendLine("")
    $null = $sb.AppendLine(("Generated from: `{0}` ({1} types declared)" -f $dump, $allTypes.Count))
    $null = $sb.AppendLine("")

    $null = $sb.AppendLine("## Top picks")
    if ($topFound.Count -gt 0) {
        foreach ($c in $topFound) { $null = $sb.AppendLine("- $c") }
    } else {
        $null = $sb.AppendLine("- (none found from default top-pick list)")
    }
    $null = $sb.AppendLine("")

    foreach ($key in $groups.Keys) {
        $list = @($groups[$key] | Sort-Object)
        if ($list.Count -eq 0) { continue }
        $null = $sb.AppendLine(("## {0} ({1})" -f $key, $list.Count))
        foreach ($name in $list) { $null = $sb.AppendLine("- $name") }
        $null = $sb.AppendLine("")
    }

    Set-Content -LiteralPath $out -Value $sb.ToString() -Encoding UTF8
    Write-Host ("  [OK] Wrote: {0}" -f $out) -ForegroundColor Green
}

function New-AgentContext {
    param([Parameter(Mandatory)] [string]$GameName)

    $project = Read-Project $GameName
    $notesDir = Get-NotesDir $GameName
    New-Item -ItemType Directory -Force -Path $notesDir | Out-Null
    $out = Join-Path $notesDir "agent-context.md"

    $dump = Join-Path $project.il2cppDumperOutput "dump.cs"
    $py = Join-Path $project.il2cppDumperOutput "ghidra.py"

    function Fallback($v) { if ($null -eq $v -or "$v" -eq "") { "<unset>" } else { "$v" } }

    $sb = New-Object System.Text.StringBuilder
    $null = $sb.AppendLine("# Agent Context - $GameName")
    $null = $sb.AppendLine("")
    $null = $sb.AppendLine("## Project state")
    $null = $sb.AppendLine("| Field | Value |")
    $null = $sb.AppendLine("|---|---|")
    $null = $sb.AppendLine(("| Project name | {0} |" -f $GameName))
    $null = $sb.AppendLine(("| Platform | {0} |" -f (Fallback $project.platform)))
    $null = $sb.AppendLine(("| Native binary | `{0}` |" -f (Fallback $project.nativeBinary)))
    $null = $sb.AppendLine(("| Metadata | `{0}` |" -f (Fallback $project.metadata)))
    $null = $sb.AppendLine(("| Il2CppDumper output | `{0}` |" -f (Fallback $project.il2cppDumperOutput)))
    $null = $sb.AppendLine(("| dump.cs | `{0}` |" -f $dump))
    $null = $sb.AppendLine(("| ghidra.py | `{0}` |" -f $py))
    $null = $sb.AppendLine(("| Ghidra project | {0} |" -f (Fallback $project.ghidraProjectName)))
    $null = $sb.AppendLine(("| Ghidra project dir | `{0}` |" -f (Fallback $project.ghidraProjectDir)))
    $null = $sb.AppendLine(("| Ghidra program | {0} |" -f (Fallback $project.ghidraProgramName)))
    $null = $sb.AppendLine("")

    $null = $sb.AppendLine("## Pipeline status")
    $null = $sb.AppendLine("| Step | Done? |")
    $null = $sb.AppendLine("|---|---|")
    foreach ($key in @("scanned", "dumped", "imported", "analyzing", "analyzed", "symbolsApplied")) {
        $flag = if ($project.status.$key) { "[x]" } else { "[ ]" }
        $null = $sb.AppendLine(("| {0} | {1} |" -f $key, $flag))
    }
    $null = $sb.AppendLine("")

    $null = $sb.AppendLine("## Useful commands")
    $null = $sb.AppendLine('```powershell')
    $null = $sb.AppendLine((".\re.ps1 status {0}" -f $GameName))
    $null = $sb.AppendLine((".\re.ps1 open {0}" -f $GameName))
    $null = $sb.AppendLine((".\re.ps1 candidates {0}" -f $GameName))
    $null = $sb.AppendLine(".\re.ps1 mcp")
    $null = $sb.AppendLine('```')
    $null = $sb.AppendLine("")

    $null = $sb.AppendLine("## MCP workflow for agents")
    $null = $sb.AppendLine("")
    $null = $sb.AppendLine("1. Open the imported project/program in Ghidra or PyGhidra GUI.")
    $null = $sb.AppendLine("2. Enable the plugin: File > Configure > Configure All Plugins > GhidraMCP.")
    $null = $sb.AppendLine("3. Start the server: Tools > GhidraMCP > Start MCP Server.")
    $null = $sb.AppendLine("4. Start the bridge from the AI client config or with `.\re.ps1 mcp`.")
    $null = $sb.AppendLine(("5. In the MCP client: `list_instances`, then `connect_instance {0}`." -f $GameName))
    $null = $sb.AppendLine("")

    $null = $sb.AppendLine("## Suggested first searches")
    $null = $sb.AppendLine('```')
    foreach ($term in @("MainController", "GameManager", "BoardController", "LevelManager", "AdsManager", "IAPManager", "RemoteConfig", "NetworkManager", "Service", "Controller", "Presenter", "View")) {
        $null = $sb.AppendLine($term)
    }
    $null = $sb.AppendLine('```')

    Set-Content -LiteralPath $out -Value $sb.ToString() -Encoding UTF8
    Write-Host ("  [OK] Wrote: {0}" -f $out) -ForegroundColor Green
}

function Run-NotesPipeline {
    param([Parameter(Mandatory)] [string]$GameName)

    $project = Read-Project $GameName
    if (-not $project.status.dumped) {
        Write-Host "[SKIP] notes pipeline: project not dumped yet." -ForegroundColor Yellow
        return
    }

    New-CandidatesList $GameName
    New-AgentContext $GameName
}

function Show-McpFirstQueryMessage {
    param([Parameter()] [string]$GameName)

    Write-Host "Ghidra CLI commands are disabled in this MCP-first toolkit." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Use GhidraMCP for summary, function, string, xref, symbol, and decompile queries:" -ForegroundColor Cyan
    Write-Host "  1. Open the project/program in Ghidra or PyGhidra GUI." -ForegroundColor Gray
    Write-Host "  2. Enable: File > Configure > Configure All Plugins > GhidraMCP" -ForegroundColor Gray
    Write-Host "  3. Start:  Tools > GhidraMCP > Start MCP Server" -ForegroundColor Gray
    Write-Host "  4. Start the MCP bridge through your AI client or run: .\re.ps1 mcp" -ForegroundColor Gray
    if ($GameName) {
        Write-Host ("  5. In the MCP client: list_instances, then connect_instance {0}" -f $GameName) -ForegroundColor Gray
    }
    else {
        Write-Host "  5. In the MCP client: list_instances, then connect_instance <GameName>" -ForegroundColor Gray
    }
    Write-Host ""
    Write-Host "Tip: .\re.ps1 status <GameName> and .\re.ps1 path <GameName> still work for local project state." -ForegroundColor DarkGray
}

function Open-PyGhidraProject {
    param([Parameter(Mandatory)] [string]$GameName)

    $project = Read-Project $GameName

    Assert-PathExists $ToolPaths.PythonExe "Toolkit Python"
    Assert-PathExists $ToolPaths.PyGhidraDist "PyGhidra package bundle" -Directory
    Assert-PathExists $ToolPaths.JavaExe "Toolkit JDK 21"

    if (-not $project.status.imported) {
        Write-Host "[WARN] Project is not marked as imported yet. Opening PyGhidra anyway." -ForegroundColor Yellow
    }

    Write-Host "== Open PyGhidra GUI: $GameName ==" -ForegroundColor Magenta
    Write-Host ("Project dir : {0}" -f $project.ghidraProjectDir) -ForegroundColor DarkGray
    Write-Host ("Project name: {0}" -f $project.ghidraProjectName) -ForegroundColor DarkGray
    Write-Host ("Program     : {0}" -f $project.ghidraProgramName) -ForegroundColor DarkGray
    Show-GhidraProjectOpenInfo -Project $project
    Write-Host "Tip: Let Ghidra run Auto Analysis in the GUI, then run ghidra.py manually if needed." -ForegroundColor Cyan
    Write-Host "Opening PyGhidra the same way as: .\re.ps1 pyghidra-gui" -ForegroundColor DarkGray
    Write-Host "Note: project arguments are not passed to the PyGhidra launcher because some versions exit silently when they receive unsupported args." -ForegroundColor DarkGray

    Set-GhidraDefaultProjectForGame -GameName $GameName | Out-Null

    # Keep this identical in behavior to the `pyghidra-gui` wrapper: do not pass
    # project dir/name args because some PyGhidra versions exit on unsupported args.
    Invoke-PyGhidraGui

    Write-Host "PyGhidra launch handed off; this wrapper can return while the GUI keeps running." -ForegroundColor Green
}

function Run-FullFlow {
    param(
        [Parameter(Mandatory)] [string]$GameName,
        [Parameter(Mandatory)] [string]$Source
    )

    Write-Host "== RE Flow: $GameName ==" -ForegroundColor Magenta
    Write-Host "Mode: scan/add -> Il2CppDumper -> Ghidra import only (-noanalysis) -> open PyGhidra GUI" -ForegroundColor Cyan
    Write-Host "Note: this flow intentionally skips headless analyze and auto symbol apply to avoid project lock/long-running CLI issues." -ForegroundColor DarkGray

    New-Workspace $GameName

    if (Test-Path -LiteralPath $Source -PathType Container) {
        Scan-UnityIl2Cpp $GameName $Source
    }
    else {
        Add-BuildToProject $GameName $Source
    }

    Run-Il2CppDumper $GameName
    Import-GhidraProgram $GameName

    try { Run-NotesPipeline $GameName }
    catch { Write-Host "[WARN] Notes pipeline failed: $_" -ForegroundColor Yellow }

    Show-ProjectSummary $GameName

    $project = Read-Project $GameName
    $ghidraPy = Join-Path $project.il2cppDumperOutput "ghidra.py"

    Write-Host "" 
    Write-Host "Next manual steps in PyGhidra:" -ForegroundColor Cyan
    Write-Host "  1. Accept/run Ghidra Auto Analysis in the GUI." -ForegroundColor Gray
    if (Test-Path -LiteralPath $ghidraPy) {
        Write-Host ("  2. Run Il2CppDumper script manually: {0}" -f $ghidraPy) -ForegroundColor Gray
    }
    else {
        Write-Host "  2. ghidra.py was not found in the dumper output; skip symbol script or copy it manually." -ForegroundColor Yellow
    }
    Write-Host "  3. Use dump.cs / DummyDll as skeleton while reading decompiled functions." -ForegroundColor Gray
    Write-Host ""

    Open-PyGhidraProject $GameName

    Write-Host "Flow completed for $GameName. PyGhidra is running separately for analysis/symbol steps." -ForegroundColor Green
}
