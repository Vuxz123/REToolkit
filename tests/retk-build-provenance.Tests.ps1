[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$helper = Join-Path $RepoRoot 'scripts\retk-build-provenance.ps1'
if (-not (Test-Path -LiteralPath $helper)) { throw 'Build provenance helper is missing.' }
. $helper
function Assert-True($Condition, $Message) { if (-not $Condition) { throw "ASSERT: $Message" } }
function Assert-Equal($Actual, $Expected, $Message) { if ($Actual -ne $Expected) { throw "ASSERT: $Message (expected $Expected, got $Actual)" } }
function Assert-Throws([scriptblock]$Action, $Message) {
    $threw = $false
    try { & $Action | Out-Null } catch { $threw = $true }
    Assert-True $threw $Message
}
$fixture = Join-Path $env:TEMP ('retk-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts') -Force | Out-Null
try {
    $expectedSources = @('scripts/retk-gui.ps1', 'scripts/retk-core.ps1', 'scripts/build-gui.ps1', 'scripts/retk-build-provenance.ps1')
    Assert-Equal ((Get-RetkGuiBuildSourcePaths) -join '|') ($expectedSources -join '|') 'Source inventory pins GUI loaded helpers and build code'
    foreach ($relative in $expectedSources) {
        Copy-Item -LiteralPath (Join-Path $RepoRoot $relative) -Destination (Join-Path $fixture $relative)
    }
    # Real git metadata in a disposable repository; never change the caller repository.
    & git -C $fixture init --quiet
    & git -C $fixture -c core.autocrlf=false add -- scripts
    & git -C $fixture -c user.name=Fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false -c core.hooksPath= commit --quiet -m fixture
    if ($LASTEXITCODE -ne 0) { throw 'Fixture git setup failed' }
    $revision = (& git -C $fixture rev-parse HEAD).Trim()
    $output = Join-Path $fixture 'REToolkit-GUI.exe'
    $sidecar = $output + '.provenance.json'
    $compile = { param($InputFile, $OutputFile) [IO.File]::WriteAllBytes($OutputFile, [byte[]](77,90,1,2,3)) }
    $result = Invoke-RetkGuiBuild -Root $fixture -OutputFile $output -CompilerVersion '1.0.17' -Compile $compile
    $receipt = Get-Content -LiteralPath $sidecar -Raw | ConvertFrom-Json
    Assert-Equal $receipt.kind 'retoolkit-gui-build' 'Versioned receipt kind'
    Assert-Equal $receipt.schemaVersion 1 'Versioned receipt schema'
    Assert-Equal $receipt.git.revision $revision 'Real Git revision retained'
    Assert-Equal $receipt.git.dirty $false 'Clean source revision retained'
    Assert-Equal $receipt.compiler.name 'ps2exe' 'Compiler identity'
    Assert-Equal $receipt.compiler.version '1.0.17' 'Compiler module version'
    Assert-Equal $receipt.output.size 5 'Artifact size from actual bytes'
    Assert-Equal $receipt.output.sha256 (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant() 'Artifact hash from actual bytes'
    Assert-Equal ($receipt.sources.path -join '|') ($expectedSources -join '|') 'All explicit source entries recorded'
    foreach ($source in $receipt.sources) {
        Assert-Equal $source.sha256 (Get-FileHash -LiteralPath (Join-Path $fixture $source.path) -Algorithm SHA256).Hash.ToLowerInvariant() 'Source bytes hashed'
    }
    $oldExe = [IO.File]::ReadAllBytes($output)
    $oldReceipt = [IO.File]::ReadAllText($sidecar)
    Assert-Throws { Invoke-RetkGuiBuild -Root $fixture -OutputFile $output -CompilerVersion '1' -Compile $compile } 'Occupied output requires explicit force'
    Assert-Equal ([IO.File]::ReadAllText($sidecar)) $oldReceipt 'Refusal preserves receipt'
    Add-Content -LiteralPath (Join-Path $fixture 'scripts\retk-core.ps1') -Value '# dirty'
    Invoke-RetkGuiBuild -Root $fixture -OutputFile $output -CompilerVersion '1' -Compile $compile -Force | Out-Null
    $receipt = Get-Content -LiteralPath $sidecar -Raw | ConvertFrom-Json
    Assert-Equal $receipt.git.dirty $true 'Dirty state reflects helper change'
    $oldReceipt = [IO.File]::ReadAllText($sidecar)
    Assert-Throws { Invoke-RetkGuiBuild -Root $fixture -OutputFile $output -CompilerVersion '1' -Compile { param($i,$o) [IO.File]::WriteAllText($o,'partial'); throw 'compiler failed' } -Force } 'Compiler failure aborts build'
    Assert-Equal ([Convert]::ToBase64String([IO.File]::ReadAllBytes($output))) ([Convert]::ToBase64String($oldExe)) 'Compiler failure keeps prior artifact'
    Assert-Equal ([IO.File]::ReadAllText($sidecar)) $oldReceipt 'Compiler failure keeps prior receipt'
    Assert-Throws { Invoke-RetkGuiBuild -Root $fixture -OutputFile $output -CompilerVersion '1' -Compile { param($i,$o) } -Force } 'Missing compiler output rejected'
    Assert-Throws { Invoke-RetkGuiBuild -Root $fixture -OutputFile $output -CompilerVersion '1' -Compile { param($i,$o) [IO.File]::WriteAllBytes($o,[byte[]]@()) } -Force } 'Empty compiler output rejected'
    Assert-Throws { Invoke-RetkGuiBuild -Root $fixture -OutputFile $output -CompilerVersion '1' -Compile $compile -Force -OnEvent { param($event) if ($event -eq 'executable-published') { throw 'publication failed' } } } 'Mid-publication failure triggers rollback'
    Assert-Equal ([Convert]::ToBase64String([IO.File]::ReadAllBytes($output))) ([Convert]::ToBase64String($oldExe)) 'Publication rollback restores artifact'
    Assert-Equal ([IO.File]::ReadAllText($sidecar)) $oldReceipt 'Publication rollback restores receipt'
    Assert-Throws { Invoke-RetkGuiBuild -Root $fixture -OutputFile $output -CompilerVersion '1' -Compile $compile -Force -OnEvent { param($event) if ($event -eq 'receipt-published') { throw 'late publication failed' } } } 'Failure after receipt publication triggers rollback'
    Assert-Equal ([IO.File]::ReadAllText($sidecar)) $oldReceipt 'Late publication rollback restores receipt'
    [IO.File]::WriteAllText(($output + '.build.lock'),'uncertain previous build')
    Assert-Throws { Invoke-RetkGuiBuild -Root $fixture -OutputFile $output -CompilerVersion '1' -Compile $compile -Force } 'An active or uncertain build marker blocks publication'
    Remove-Item -LiteralPath ($output + '.build.lock')
    Assert-Throws { Invoke-RetkGuiBuild -Root $fixture -OutputFile (Join-Path $fixture 'scripts\retk-gui.ps1') -CompilerVersion '1' -Compile $compile -Force } 'Force never overwrites a source file'
    Assert-Throws { Invoke-RetkGuiBuild -Root $fixture -OutputFile $output -CompilerVersion '1' -Compile { param($i,$o) [IO.File]::WriteAllText($o,'exe'); Add-Content -LiteralPath $i -Value '# changed during compile' } -Force } 'Source mutation during compilation invalidates provenance'
    Assert-Equal ([IO.File]::ReadAllText($sidecar)) $oldReceipt 'Source drift preserves prior receipt'
    Remove-Item -LiteralPath $output
    Assert-Throws { Invoke-RetkGuiBuild -Root $fixture -OutputFile $output -CompilerVersion '1' -Compile $compile } 'Orphan occupied sidecar also requires force'
    Invoke-RetkGuiBuild -Root $fixture -OutputFile $output -CompilerVersion '1' -Compile $compile -Force | Out-Null
    $archive = Join-Path $fixture 'source-archive'
    New-Item -ItemType Directory -Path (Join-Path $archive 'scripts') -Force | Out-Null
    foreach ($relative in $expectedSources) { Copy-Item -LiteralPath (Join-Path $RepoRoot $relative) -Destination (Join-Path $archive $relative) }
    $archiveResult = Invoke-RetkGuiBuild -Root $archive -OutputFile (Join-Path $archive 'REToolkit-GUI.exe') -CompilerVersion '1' -Compile $compile
    Assert-Equal $archiveResult.git.state 'unknown' 'Nested source archive does not borrow enclosing Git revision'
    Assert-True ($null -eq $archiveResult.git.dirty) 'Unknown dirty state never reports clean'
    [IO.Directory]::Move((Join-Path $fixture '.git'), (Join-Path $fixture '.git-disabled'))
    $noGit = Get-RetkGuiBuildGitState -Root $archive
    Assert-Equal $noGit.state 'unknown' 'Source archives outside any repository are supported'
    Assert-Equal @(Get-ChildItem -LiteralPath $fixture -Directory -Filter '.retk-gui-build-*').Count 0 'Successful and rolled back stages cleaned'
    # Hold the newly published artifact open to cause an actual Windows rollback
    # failure. Preserve recovery evidence and block further builds until inspected.
    $script:retkLockedArtifact = $null
    try {
        Assert-Throws { Invoke-RetkGuiBuild -Root $fixture -OutputFile $output -CompilerVersion '1' -Compile $compile -Force -OnEvent {
            param($event)
            if ($event -eq 'executable-published') {
                $script:retkLockedArtifact = [IO.File]::Open($output, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
                throw 'publication failure with locked artifact'
            }
        } } 'Uncertain rollback reports failure'
        Assert-True (Test-Path -LiteralPath ($output + '.build.lock')) 'Uncertain rollback retains exclusive marker'
        $recovery = @(Get-ChildItem -LiteralPath $fixture -Directory -Filter '.retk-gui-build-*')
        Assert-Equal $recovery.Count 1 'Uncertain rollback retains recovery stage'
        Assert-True (Test-Path -LiteralPath (Join-Path $recovery[0].FullName 'previous.exe')) 'Old artifact preserved for recovery'
        Assert-True (Test-Path -LiteralPath (Join-Path $recovery[0].FullName 'previous.provenance.json')) 'Old receipt preserved for recovery'
        Assert-Throws { Invoke-RetkGuiBuild -Root $fixture -OutputFile $output -CompilerVersion '1' -Compile $compile -Force } 'Further builds refused while recovery uncertain'
    }
    finally { if ($script:retkLockedArtifact) { $script:retkLockedArtifact.Dispose(); $script:retkLockedArtifact = $null } }
    Write-Host 'PASS: GUI build provenance, source identity, staging, refusal and rollback (fixture compiler only).'
}
finally {
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    if ($resolvedFixture.StartsWith([IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\') -and (Split-Path -Leaf $resolvedFixture) -like 'retk-build-*') {
        Remove-Item -LiteralPath $resolvedFixture -Recurse -Force -ErrorAction SilentlyContinue
    }
}
