# AssetRipper CLI (Headless) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `re.ps1 assetripper-cli <GameName>` — headlessly drives the already-installed `AssetRipper.GUI.Free.exe` (via `--headless` + its own internal HTTP command routes) to export a workspace's extracted build into `05_ReconstructedSource\`, with no browser and no build step.

**Architecture:** New functions appended to `scripts\retk-pipeline.ps1` (no new module) launch `AssetRipper.GUI.Free.exe --headless --port <N>` as a detached hidden-window process via the existing `Start-DetachedNativeProcess`, poll until its local web server responds, then drive it with `Invoke-WebRequest` POSTs to the same command routes its own Vue frontend uses (`/LoadFolder`, `/Export/UnityProject`, `/Reset`). A new `re.ps1` dispatcher case wires it up; `project.re.json` gains a `reconstructedSourceDir` field and `status.assetRipperExported`/`assetRipperExportedAt`, following the existing `Read-Project → mutate → Save-Project` pattern.

**Tech Stack:** Windows PowerShell 5.1 compatible PowerShell, `Invoke-WebRequest`/`System.Net.Sockets.TcpListener` for HTTP/port work, the AssetRipper binary already installed by `install-re-toolkit.ps1 -InstallAssetRipper`.

## Global Constraints

- Target Windows PowerShell 5.1, not just PowerShell 7 (per `CLAUDE.md`) — avoid PS7-only syntax. Use `Invoke-WebRequest -UseBasicParsing` to avoid the IE-engine dependency in Windows PowerShell 5.1.
- No aggregating test runner. Each `tests\*.Tests.ps1` file is run standalone: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\<name>.Tests.ps1`.
- Design spec: `docs\superpowers\specs\2026-08-12-assetripper-cli-headless-design.md` (committed `75dbc54`). This plan implements it as approved; do not re-litigate decisions already made there.
- Every workspace path must go through `Get-WorkspacePath` (in `scripts\retk-project.ps1`) so `Assert-WorkspaceName` validation applies — never build `workspaces\<name>\...` paths any other way.
- Confirmed AssetRipper HTTP routes (read directly from `AssetRipper.GUI.Web` source during design, not guessed): `POST /LoadFolder` (form field `Path`), `POST /Export/UnityProject` (form fields `Path`, `CreateSubfolder`), `POST /Reset`. `CreateSubfolder` is compared as an exact lowercase string (`values == "true"`) in AssetRipper's own handler, so send `"false"`/`"true"` string literals, not PowerShell booleans.
- Fixed headless port `44399`, retry up to 5 consecutive ports before failing. Readiness poll timeout 30s. The `/LoadFolder` and `/Export/UnityProject` POSTs must use an unbounded HTTP timeout (`-TimeoutSec 0`) since load/export time scales with build size.
- Doc-content and source-text regression assertions for this feature belong in the existing `tests\retk-mcp-first.Tests.ps1` (which already `Get-Content -Raw`s `re.ps1`, `scripts\retk-pipeline.ps1`, `scripts\retk-project.ps1`, `scripts\retk-ui.ps1`, `README.md`, `Tutorial.md` into `$re`/`$pipelineModule`/`$projectModule`/`$uiModule`/`$readme`/`$tutorial`) — not a new per-feature test file, since these functions live in an existing module rather than a new one (a new module, like `retk-ldplayer.ps1`, is what earns its own `tests\retk-<name>.Tests.ps1` file).

---

### Task 1: Extend the workspace schema with `reconstructedSourceDir` and AssetRipper export status

**Files:**
- Modify: `scripts\retk-project.ps1:172-192` (the `$project` ordered hashtable inside `New-Workspace`)
- Test: `tests\workspace-archive.Tests.ps1:38-39`

**Interfaces:**
- Produces: `project.re.json`'s `reconstructedSourceDir` (string, `<workspace>\05_ReconstructedSource`), `status.assetRipperExported` (bool, default `$false`), `status.assetRipperExportedAt` (string or `$null`) — consumed by Task 2's `Invoke-AssetRipperCliPipeline`.

- [ ] **Step 1: Write the failing test**

In `tests\workspace-archive.Tests.ps1`, find:

```powershell
    New-Workspace "FoodHunt" | Out-Null
    $sourceWorkspace = Join-Path $script:Workspaces "FoodHunt"
    $binaryPath = Join-Path $sourceWorkspace "01_Extracted\lib\arm64-v8a\libil2cpp.so"
```

Replace with:

```powershell
    New-Workspace "FoodHunt" | Out-Null
    $sourceWorkspace = Join-Path $script:Workspaces "FoodHunt"

    $freshProject = Read-Project "FoodHunt"
    Assert-Equals $freshProject.reconstructedSourceDir (Join-Path $sourceWorkspace "05_ReconstructedSource") "New-Workspace should pre-populate reconstructedSourceDir like il2cppDumperOutput/ghidraProjectDir."
    Assert-Equals $freshProject.status.assetRipperExported $false "New-Workspace should initialize assetRipperExported to false."
    Assert-Equals $freshProject.status.assetRipperExportedAt $null "New-Workspace should initialize assetRipperExportedAt to null."

    $binaryPath = Join-Path $sourceWorkspace "01_Extracted\lib\arm64-v8a\libil2cpp.so"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\workspace-archive.Tests.ps1`
Expected: FAIL with `ASSERT EQUALS failed` (property doesn't exist yet, so `$freshProject.reconstructedSourceDir` is `$null`, not the expected path).

- [ ] **Step 3: Implement the schema change**

In `scripts\retk-project.ps1`, find:

```powershell
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
```

Replace with:

```powershell
    $project = [ordered]@{
        name                    = $GameName
        platform                = $null
        extractedPath           = $null
        nativeBinary            = $null
        metadata                = $null
        il2cppDumperOutput      = (Join-Path $workspace "02_Il2CppDumperOutput")
        ghidraProjectDir        = (Join-Path $workspace "03_GhidraProject")
        ghidraProjectName       = $GameName
        ghidraProgramName       = $null
        reconstructedSourceDir  = (Join-Path $workspace "05_ReconstructedSource")
        status = [ordered]@{
            scanned                = $false
            dumped                 = $false
            imported               = $false
            analyzing              = $false
            analyzed               = $false
            symbolsApplied         = $false
            assetRipperExported    = $false
            assetRipperExportedAt  = $null
            analyzeStartedAt       = $null
            analyzeCompletedAt     = $null
        }
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\workspace-archive.Tests.ps1`
Expected: PASS, no `ASSERT` failures, script exits 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/retk-project.ps1 tests/workspace-archive.Tests.ps1
git commit -m "Add reconstructedSourceDir and assetRipperExported fields to workspace schema"
```

---

### Task 2: Headless AssetRipper HTTP automation functions in retk-pipeline.ps1

**Files:**
- Modify: `scripts\retk-pipeline.ps1` (append after line 532, the end of the file / closing brace of `Run-FullFlow`)
- Test: `tests\retk-mcp-first.Tests.ps1:222` (append inside the existing `$pipelineModule` assertion block)

**Interfaces:**
- Consumes: `$ToolPaths.AssetRipper` / `$Root` (script-scope, set by `re.ps1`), `Start-DetachedNativeProcess -FilePath <string> -Arguments <string[]> -WorkingDirectory <string> -LogFile <string> -Activity <string> -LogRetentionFilter <string>` → `pscustomobject{ ProcessId; Command; StdOutLog; StdErrLog }` (from `scripts\retk-process.ps1`), `Read-Project -GameName <string>` / `Save-Project -GameName <string> -Project <object>` / `Get-WorkspacePath -GameName <string>` / `Set-ObjectNoteProperty -Object <object> -Name <string> -Value <object>` (from `scripts\retk-project.ps1`), `Assert-PathExists -Path <string> -Name <string>` (from `scripts\retk-core.ps1`).
- Produces:
  - `Find-AvailablePort [-StartPort <int>] [-MaxAttempts <int>]` → `int`
  - `Wait-AssetRipperHttpReady -Port <int> -ProcessId <int> [-TimeoutSeconds <int>]` → nothing; throws on failure
  - `Invoke-AssetRipperCommand -Port <int> -Path <string> -Body <hashtable>` → `Microsoft.PowerShell.Commands.WebResponseObject`
  - `Export-AssetRipperUnityProject -InputPath <string> -OutputPath <string>` → `pscustomobject{ OutputPath; LogFile }`
  - `Invoke-AssetRipperCliPipeline -GameName <string>` → nothing; consumed by Task 3's `re.ps1` dispatcher case.

- [ ] **Step 1: Write the failing test**

In `tests\retk-mcp-first.Tests.ps1`, find:

```powershell
Assert-Contains $pipelineModule 'function Show-McpFirstQueryMessage' "pipeline module should contain MCP-first query guidance."
Assert-Contains $uiModule 'function Show-Usage' "UI module should contain command help."
```

Replace with:

```powershell
Assert-Contains $pipelineModule 'function Show-McpFirstQueryMessage' "pipeline module should contain MCP-first query guidance."
Assert-Contains $pipelineModule 'function Find-AvailablePort' "pipeline module should contain the AssetRipper headless port probe."
Assert-Contains $pipelineModule 'function Wait-AssetRipperHttpReady' "pipeline module should contain the AssetRipper headless readiness poll."
Assert-Contains $pipelineModule 'function Invoke-AssetRipperCommand' "pipeline module should contain the AssetRipper headless HTTP command helper."
Assert-Contains $pipelineModule 'function Export-AssetRipperUnityProject' "pipeline module should contain the AssetRipper headless export orchestrator."
Assert-Contains $pipelineModule 'function Invoke-AssetRipperCliPipeline' "pipeline module should contain the assetripper-cli workspace pipeline."
Assert-Contains $pipelineModule '--headless' "Export-AssetRipperUnityProject should launch AssetRipper.GUI.Free.exe in headless mode."
Assert-Contains $pipelineModule '/LoadFolder' "Export-AssetRipperUnityProject should POST to the AssetRipper /LoadFolder command route."
Assert-Contains $pipelineModule '/Export/UnityProject' "Export-AssetRipperUnityProject should POST to the AssetRipper /Export/UnityProject command route."
Assert-Contains $pipelineModule '/Reset' "Export-AssetRipperUnityProject should reset AssetRipper's loaded state before loading a new build."
Assert-Contains $pipelineModule 'is empty. Check the log file' "Export-AssetRipperUnityProject should verify the export directory is non-empty, since GameFileLoader can silently no-op on failure."
Assert-Contains $uiModule 'function Show-Usage' "UI module should contain command help."
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-mcp-first.Tests.ps1`
Expected: FAIL with `ASSERT CONTAINS failed` (none of the new functions/strings exist in `scripts\retk-pipeline.ps1` yet).

- [ ] **Step 3: Implement the functions**

Append to the end of `scripts\retk-pipeline.ps1` (after the closing `}` of `Run-FullFlow`):

```powershell

function Find-AvailablePort {
    param(
        [int]$StartPort = 44399,
        [int]$MaxAttempts = 5
    )

    for ($i = 0; $i -lt $MaxAttempts; $i++) {
        $candidate = $StartPort + $i
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $candidate)
        try {
            $listener.Start()
            $listener.Stop()
            return $candidate
        }
        catch [System.Net.Sockets.SocketException] {
            continue
        }
    }

    throw "No available port found in range $StartPort-$($StartPort + $MaxAttempts - 1) for AssetRipper headless server."
}

function Wait-AssetRipperHttpReady {
    param(
        [Parameter(Mandatory)] [int]$Port,
        [Parameter(Mandatory)] [int]$ProcessId,
        [int]$TimeoutSeconds = 30
    )

    $baseUri = "http://127.0.0.1:$Port/"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

    while ((Get-Date) -lt $deadline) {
        $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($null -eq $proc) {
            throw "AssetRipper headless process (PID $ProcessId) exited before its web server became ready. Check the log file for details."
        }

        try {
            $response = Invoke-WebRequest -Uri $baseUri -Method Get -TimeoutSec 2 -UseBasicParsing
            if ($response.StatusCode -eq 200) {
                return
            }
        }
        catch {
            # Not ready yet; keep polling until the timeout.
        }

        Start-Sleep -Milliseconds 500
    }

    throw "AssetRipper headless web server did not become ready on port $Port within $TimeoutSeconds seconds."
}

function Invoke-AssetRipperCommand {
    param(
        [Parameter(Mandatory)] [int]$Port,
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [hashtable]$Body
    )

    $uri = "http://127.0.0.1:$Port$Path"
    try {
        return Invoke-WebRequest -Uri $uri -Method Post -Body $Body -ContentType "application/x-www-form-urlencoded" -TimeoutSec 0 -UseBasicParsing
    }
    catch {
        throw "AssetRipper command $Path failed: $($_.Exception.Message)"
    }
}

function Export-AssetRipperUnityProject {
    param(
        [Parameter(Mandatory)] [string]$InputPath,
        [Parameter(Mandatory)] [string]$OutputPath
    )

    Assert-PathExists $ToolPaths.AssetRipper "AssetRipper"

    $port = Find-AvailablePort -StartPort 44399 -MaxAttempts 5
    $assetRipperDir = Split-Path -Parent $ToolPaths.AssetRipper
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $logFile = Join-Path $Root ("logs\assetripper-cli-{0}.out.log" -f $stamp)

    $launch = Start-DetachedNativeProcess -FilePath $ToolPaths.AssetRipper -Arguments @("--headless", "--port", "$port") -WorkingDirectory $assetRipperDir -LogFile $logFile -Activity "AssetRipper headless server" -LogRetentionFilter "assetripper-cli-*"

    try {
        Wait-AssetRipperHttpReady -Port $port -ProcessId $launch.ProcessId -TimeoutSeconds 30

        Invoke-AssetRipperCommand -Port $port -Path "/Reset" -Body @{} | Out-Null
        Invoke-AssetRipperCommand -Port $port -Path "/LoadFolder" -Body @{ Path = $InputPath } | Out-Null
        Invoke-AssetRipperCommand -Port $port -Path "/Export/UnityProject" -Body @{ Path = $OutputPath; CreateSubfolder = "false" } | Out-Null

        $exportedFiles = if (Test-Path -LiteralPath $OutputPath -PathType Container) {
            Get-ChildItem -LiteralPath $OutputPath -Force -ErrorAction SilentlyContinue
        } else { $null }

        if (-not $exportedFiles) {
            throw "AssetRipper export finished but $OutputPath is empty. Check the log file for details: $logFile"
        }
    }
    finally {
        $proc = Get-Process -Id $launch.ProcessId -ErrorAction SilentlyContinue
        if ($proc) { Stop-Process -Id $launch.ProcessId -Force -ErrorAction SilentlyContinue }
    }

    return [pscustomobject]@{
        OutputPath = $OutputPath
        LogFile    = $logFile
    }
}

function Invoke-AssetRipperCliPipeline {
    param([Parameter(Mandatory)] [string]$GameName)

    $project = Read-Project $GameName
    if (-not $project.status.scanned) {
        throw "Project not scanned. Run: .\re.ps1 scan $GameName <ExtractedPath>"
    }
    if ([string]::IsNullOrWhiteSpace([string]$project.extractedPath)) {
        throw "Project has no extractedPath. Run: .\re.ps1 scan $GameName <ExtractedPath>"
    }

    $workspace = Get-WorkspacePath $GameName
    Set-ObjectNoteProperty -Object $project -Name "reconstructedSourceDir" -Value (Join-Path $workspace "05_ReconstructedSource")
    $outputPath = [string]$project.reconstructedSourceDir

    Write-Host "== AssetRipper CLI (headless): $GameName ==" -ForegroundColor Magenta
    Write-Host "Input : $($project.extractedPath)" -ForegroundColor DarkGray
    Write-Host "Output: $outputPath" -ForegroundColor DarkGray

    $result = Export-AssetRipperUnityProject -InputPath $project.extractedPath -OutputPath $outputPath

    Set-ObjectNoteProperty -Object $project.status -Name "assetRipperExported" -Value $true
    Set-ObjectNoteProperty -Object $project.status -Name "assetRipperExportedAt" -Value ((Get-Date).ToString("s"))
    Save-Project $GameName $project

    Write-Host ("AssetRipper export complete: {0}" -f $result.OutputPath) -ForegroundColor Green
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-mcp-first.Tests.ps1`
Expected: PASS, `retk-mcp-first checks passed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add scripts/retk-pipeline.ps1 tests/retk-mcp-first.Tests.ps1
git commit -m "Add headless AssetRipper HTTP automation functions to retk-pipeline.ps1"
```

---

### Task 3: Wire `assetripper-cli` into the re.ps1 dispatcher and usage text

**Files:**
- Modify: `re.ps1:226-231` (add a new dispatcher case after the existing `assetripper`/`asset-ripper` case)
- Modify: `scripts\retk-ui.ps1:30` (`Show-Usage`)
- Test: `tests\retk-mcp-first.Tests.ps1:120-121`

**Interfaces:**
- Consumes: `Invoke-AssetRipperCliPipeline -GameName <string>` (Task 2, `scripts\retk-pipeline.ps1`, already dot-sourced by `re.ps1` via `$RetkScriptModules`).

- [ ] **Step 1: Write the failing test**

In `tests\retk-mcp-first.Tests.ps1`, find:

```powershell
Assert-Contains $re 'Invoke-LdPlayerPull -GameName $gameName -PackageName $packageName' "re.ps1 pull-ldplayer should call Invoke-LdPlayerPull with parsed arguments."
Assert-Contains $uiModule 'pull-ldplayer <GameName> <PackageName>' "UI module should document the pull-ldplayer command."
```

Replace with:

```powershell
Assert-Contains $re 'Invoke-LdPlayerPull -GameName $gameName -PackageName $packageName' "re.ps1 pull-ldplayer should call Invoke-LdPlayerPull with parsed arguments."
Assert-Contains $uiModule 'pull-ldplayer <GameName> <PackageName>' "UI module should document the pull-ldplayer command."
Assert-Contains $re '"assetripper-cli"' "re.ps1 should expose an assetripper-cli command."
Assert-Contains $re 'Invoke-AssetRipperCliPipeline -GameName $Rest[0]' "re.ps1 assetripper-cli should call Invoke-AssetRipperCliPipeline with the parsed game name."
Assert-Contains $uiModule 'assetripper-cli <GameName>' "UI module should document the headless AssetRipper CLI command."
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-mcp-first.Tests.ps1`
Expected: FAIL with `ASSERT CONTAINS failed` (the dispatcher case and usage line don't exist yet).

- [ ] **Step 3: Implement the dispatcher case and usage text**

In `re.ps1`, find:

```powershell
    { $_ -in @("assetripper", "asset-ripper") } {
        Assert-PathExists $ToolPaths.AssetRipper "AssetRipper"
        $assetRipperDir = Split-Path -Parent $ToolPaths.AssetRipper
        $result = Start-DetachedGuiProcess -FilePath $ToolPaths.AssetRipper -Arguments @($Rest) -WorkingDirectory $assetRipperDir -Activity "AssetRipper GUI"
        Write-Host ("AssetRipper GUI started (PID {0})." -f $result.ProcessId) -ForegroundColor Green
    }
```

Replace with:

```powershell
    { $_ -in @("assetripper", "asset-ripper") } {
        Assert-PathExists $ToolPaths.AssetRipper "AssetRipper"
        $assetRipperDir = Split-Path -Parent $ToolPaths.AssetRipper
        $result = Start-DetachedGuiProcess -FilePath $ToolPaths.AssetRipper -Arguments @($Rest) -WorkingDirectory $assetRipperDir -Activity "AssetRipper GUI"
        Write-Host ("AssetRipper GUI started (PID {0})." -f $result.ProcessId) -ForegroundColor Green
    }

    "assetripper-cli" {
        if (-not $Rest[0]) { throw "Usage: .\re.ps1 assetripper-cli <GameName>" }
        Invoke-AssetRipperCliPipeline -GameName $Rest[0]
    }
```

In `scripts\retk-ui.ps1`, find:

```powershell
    Write-Host "  .\re.ps1 assetripper [args...]        # open AssetRipper GUI"
    Write-Host "  .\re.ps1 mcp                         # MCP bridge for AI clients"
```

Replace with:

```powershell
    Write-Host "  .\re.ps1 assetripper [args...]        # open AssetRipper GUI"
    Write-Host "  .\re.ps1 assetripper-cli <GameName>   # headless AssetRipper export into 05_ReconstructedSource"
    Write-Host "  .\re.ps1 mcp                         # MCP bridge for AI clients"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-mcp-first.Tests.ps1`
Expected: PASS, `retk-mcp-first checks passed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add re.ps1 scripts/retk-ui.ps1 tests/retk-mcp-first.Tests.ps1
git commit -m "Wire assetripper-cli into the re.ps1 dispatcher and usage text"
```

---

### Task 4: Document assetripper-cli in README and Tutorial

**Files:**
- Modify: `README.md:394` (`## re.ps1 Commands` table)
- Modify: `Tutorial.md:89` (AssetRipper optional-install/usage block)
- Test: `tests\retk-mcp-first.Tests.ps1:289`

- [ ] **Step 1: Write the failing test**

In `tests\retk-mcp-first.Tests.ps1`, find:

```powershell
Assert-Contains $tutorial '.\re.ps1 pull-ldplayer FoodHunt com.example.foodhunt' "Tutorial should show how to pull a build from LDPlayer."
```

Replace with:

```powershell
Assert-Contains $tutorial '.\re.ps1 pull-ldplayer FoodHunt com.example.foodhunt' "Tutorial should show how to pull a build from LDPlayer."
Assert-Contains $readme 'assetripper-cli <GameName>' "README should document the headless assetripper-cli command."
Assert-Contains $tutorial '.\re.ps1 assetripper-cli FoodHunt' "Tutorial should show how to run the headless AssetRipper export."
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-mcp-first.Tests.ps1`
Expected: FAIL with `ASSERT CONTAINS failed` (README/Tutorial don't mention `assetripper-cli` yet).

- [ ] **Step 3: Update the docs**

In `README.md`, find:

```markdown
| `assetripper [args...]` | Open the installed AssetRipper GUI; alias: `asset-ripper`. |
| `mcp` | Start the GhidraMCP Python bridge for AI clients. |
```

Replace with:

```markdown
| `assetripper [args...]` | Open the installed AssetRipper GUI; alias: `asset-ripper`. |
| `assetripper-cli <GameName>` | Headlessly export the workspace's extracted build into `05_ReconstructedSource` via AssetRipper's `--headless` HTTP command API; no browser. |
| `mcp` | Start the GhidraMCP Python bridge for AI clients. |
```

In `Tutorial.md`, find:

```powershell
.\install-re-toolkit.ps1 -InstallAssetRipper
.\re.ps1 assetripper
```

Replace with:

```powershell
.\install-re-toolkit.ps1 -InstallAssetRipper
.\re.ps1 assetripper
.\re.ps1 assetripper-cli FoodHunt
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\retk-mcp-first.Tests.ps1`
Expected: PASS, `retk-mcp-first checks passed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add README.md Tutorial.md tests/retk-mcp-first.Tests.ps1
git commit -m "Document assetripper-cli in README and Tutorial"
```

---

## Manual Verification (post-implementation, not automatable)

Run once against a real AssetRipper install and a real workspace before considering this feature done (from the design spec's Testing section) — no CI/sandbox coverage exists for anything that actually shells out to `AssetRipper.GUI.Free.exe`:

- [ ] A workspace with a small extracted build — verify `05_ReconstructedSource` gets populated and `project.re.json` (`reconstructedSourceDir`, `status.assetRipperExported`, `status.assetRipperExportedAt`) is updated.
- [ ] Re-run against a workspace that already has a non-empty `05_ReconstructedSource` — verify the "delete existing contents" headless auto-consent works and does not hang waiting for a dialog.
- [ ] Occupy port 44399 with something else first — verify `Find-AvailablePort` falls through to the next candidate port (44400, etc.).
- [ ] Point at an empty/garbage extracted folder to simulate a silent export failure — verify the postcondition check in `Export-AssetRipperUnityProject` catches it and the error message references the log file.
- [ ] Verify `Stop-Process` actually happens (no leftover `AssetRipper.GUI.Free.exe` process in Task Manager) after both a successful run and a forced failure (e.g. Ctrl+C mid-run, or a bad `-GameName`).
