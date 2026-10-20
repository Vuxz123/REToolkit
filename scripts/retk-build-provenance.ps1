# Offline build mechanics. The entry point supplies the compiler; no module install here.
function Get-RetkGuiBuildSourcePaths {
    @('scripts/retk-gui.ps1', 'scripts/retk-core.ps1', 'scripts/build-gui.ps1', 'scripts/retk-build-provenance.ps1')
}

function Get-RetkGuiBuildSources {
    param([Parameter(Mandatory)] [string]$Root)
    foreach ($relative in (Get-RetkGuiBuildSourcePaths)) {
        $file = Get-Item -LiteralPath (Join-Path $Root $relative) -ErrorAction Stop
        if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Source must be a regular file: $relative" }
        [pscustomobject][ordered]@{ path = $relative; size = $file.Length; sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
}

function Get-RetkGuiBuildGitState {
    param([Parameter(Mandatory)] [string]$Root)
    $unknown = [pscustomobject]@{ state = 'unknown'; revision = $null; dirty = $null }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return $unknown }
    # Windows PowerShell 5.1 turns native stderr into an ErrorRecord even with
    # redirection. Expected Git failures must yield unknown, not terminate builds.
    $ErrorActionPreference = 'Continue'
    # A source archive nested inside some other repository has no Git identity of its own.
    $top = & git -C $Root rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $top -or [IO.Path]::GetFullPath($top) -ne $Root) { return $unknown }
    $revision = & git -C $Root rev-parse --verify HEAD 2>$null
    if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[a-f0-9]{40,64}$') { return $unknown }
    $status = @(& git -C $Root status --porcelain --untracked-files=normal 2>$null)
    if ($LASTEXITCODE -ne 0) { return $unknown }
    [pscustomobject]@{ state = 'known'; revision = $revision; dirty = ($status.Count -gt 0) }
}

function Assert-RetkGuiBuildNoLinks {
    param([Parameter(Mandatory)] [string]$Path)
    $cursor = $Path
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Build paths must not traverse links: $cursor" }
        }
        $parent = Split-Path -Parent $cursor
        if ($parent -eq $cursor) { break }
        $cursor = $parent
    }
}

function Invoke-RetkGuiBuild {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$Root,
        [Parameter(Mandatory)] [string]$OutputFile,
        [Parameter(Mandatory)] [ValidateNotNullOrEmpty()] [string]$CompilerVersion,
        [Parameter(Mandatory)] [scriptblock]$Compile,
        [switch]$Force,
        # Observes publication phases for failure testing; never read from a manifest.
        [scriptblock]$OnEvent
    )
    $ErrorActionPreference = 'Stop'
    $Root = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $OutputFile = [IO.Path]::GetFullPath($OutputFile)
    if ([IO.Path]::GetExtension($OutputFile) -ine '.exe') { throw 'GUI output must have an .exe extension.' }
    $receiptFile = $OutputFile + '.provenance.json'
    $parent = Split-Path -Parent $OutputFile
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) { throw "Output directory does not exist: $parent" }
    Assert-RetkGuiBuildNoLinks $Root
    Assert-RetkGuiBuildNoLinks $OutputFile
    Assert-RetkGuiBuildNoLinks $receiptFile
    foreach ($source in (Get-RetkGuiBuildSourcePaths)) {
        $sourceFile = [IO.Path]::GetFullPath((Join-Path $Root $source))
        Assert-RetkGuiBuildNoLinks $sourceFile
        if ($sourceFile -ieq $OutputFile -or $sourceFile -ieq $receiptFile) { throw 'Build output cannot overwrite a source file.' }
    }
    foreach ($target in @($OutputFile, $receiptFile)) {
        if (Test-Path -LiteralPath $target) {
            if (-not $Force) { throw "Build destination already exists; use -Force to replace it: $target" }
            if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Build destination must be a file: $target" }
        }
    }
    $sources = @(Get-RetkGuiBuildSources $Root)
    $gitState = Get-RetkGuiBuildGitState $Root
    $lockFile = $OutputFile + '.build.lock'
    Assert-RetkGuiBuildNoLinks $lockFile
    $lock = [IO.File]::Open($lockFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $stage = Join-Path $parent ('.retk-gui-build-' + [guid]::NewGuid().ToString('N'))
    $stagedExe = Join-Path $stage 'REToolkit-GUI.exe'
    $stagedReceipt = Join-Path $stage 'provenance.json'
    $oldExe = Join-Path $stage 'previous.exe'
    $oldReceipt = Join-Path $stage 'previous.provenance.json'
    $publishedExe = $false
    $publishedReceipt = $false
    $rollbackFailed = $false
    try {
        New-Item -ItemType Directory -Path $stage -ErrorAction Stop | Out-Null
        & $Compile (Join-Path $Root 'scripts/retk-gui.ps1') $stagedExe | Out-Null
        Assert-RetkGuiBuildNoLinks $stagedExe
        if (-not (Test-Path -LiteralPath $stagedExe -PathType Leaf) -or (Get-Item -LiteralPath $stagedExe).Length -eq 0) { throw 'Compiler did not produce a nonempty executable.' }
        $currentSources = @(Get-RetkGuiBuildSources $Root)
        if (($sources | ConvertTo-Json -Compress) -cne ($currentSources | ConvertTo-Json -Compress)) { throw 'Build sources changed during compilation; refusing inconsistent provenance.' }
        $receipt = [pscustomobject][ordered]@{
            kind = 'retoolkit-gui-build'; schemaVersion = 1; createdAt = [DateTime]::UtcNow.ToString('o')
            git = $gitState
            sources = $sources
            compiler = [pscustomobject]@{ name = 'ps2exe'; version = $CompilerVersion }
            output = [pscustomobject]@{ path = [IO.Path]::GetFileName($OutputFile); size = (Get-Item -LiteralPath $stagedExe).Length; sha256 = (Get-FileHash -LiteralPath $stagedExe -Algorithm SHA256).Hash.ToLowerInvariant() }
        }
        [IO.File]::WriteAllText($stagedReceipt, ($receipt | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
        # Recheck occupancy after compilation, before moving any previous artifacts.
        foreach ($target in @($OutputFile, $receiptFile)) {
            Assert-RetkGuiBuildNoLinks $target
            if ((Test-Path -LiteralPath $target) -and (-not $Force -or -not (Test-Path -LiteralPath $target -PathType Leaf))) { throw "Build destination became occupied: $target" }
        }
        if (Test-Path -LiteralPath $OutputFile) { [IO.File]::Move($OutputFile, $oldExe) }
        if (Test-Path -LiteralPath $receiptFile) { [IO.File]::Move($receiptFile, $oldReceipt) }
        [IO.File]::Move($stagedExe, $OutputFile)
        $publishedExe = $true
        if ($OnEvent) { & $OnEvent 'executable-published' | Out-Null }
        [IO.File]::Move($stagedReceipt, $receiptFile)
        $publishedReceipt = $true
        if ($OnEvent) { & $OnEvent 'receipt-published' | Out-Null }
        return $receipt
    }
    catch {
        $failure = $_
        try {
            if ($publishedReceipt) { [IO.File]::Delete($receiptFile) }
            if ($publishedExe) { [IO.File]::Delete($OutputFile) }
            if (Test-Path -LiteralPath $oldExe) { [IO.File]::Move($oldExe, $OutputFile) }
            if (Test-Path -LiteralPath $oldReceipt) { [IO.File]::Move($oldReceipt, $receiptFile) }
        }
        catch { $rollbackFailed = $true; throw "GUI build failed and rollback is uncertain. Preserve and inspect $stage and $lockFile. Original failure: $failure. Rollback: $_" }
        throw $failure
    }
    finally {
        $lock.Dispose()
        if (-not $rollbackFailed) {
            # Delete only known build files in this unique stage, never recursively.
            foreach ($owned in @($stagedExe, $stagedReceipt, $oldExe, $oldReceipt)) { if ([IO.File]::Exists($owned)) { [IO.File]::Delete($owned) } }
            if ([IO.Directory]::Exists($stage)) { [IO.Directory]::Delete($stage, $false) }
            [IO.File]::Delete($lockFile)
        }
    }
}
