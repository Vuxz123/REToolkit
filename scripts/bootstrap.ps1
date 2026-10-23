# Intentionally no param block: PowerShell 5.1 must forward GNU-style arguments.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$rawArguments = @($args)
$options = $null
try {
    . (Join-Path $PSScriptRoot 'bootstrap-functions.ps1')
    $options = ConvertFrom-BootstrapArguments -RawArguments $rawArguments
    $repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    Assert-BootstrapPlainPath -Path $repository
    if ($options.help) {
        @'
Usage: install.cmd [--profile cli|desktop|full] [--plan] [--no-path] [--cache DIR] [--json] [--help]

Default profile: full. No administrator, Git or existing Node installation required.
--plan and --help are offline and write-free, including on machines without Node.
--cache DIR selects the downstream download cache; portable Node stays in .cache/bootstrap.
--no-path skips user PATH registration. Open a new terminal after registration.
Unity, LDPlayer, API keys and library archives require separate configuration.
'@
        exit 0
    }
    $lockPath = Join-Path $repository 'config/node-windows-x64.lock.json'
    Assert-BootstrapPlainPath -Path $lockPath
    $lockStream = [IO.File]::Open($lockPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        if ($lockStream.Length -gt 16384) { throw 'Node lock exceeds the 16 KiB read limit.' }
        $reader = New-Object IO.StreamReader($lockStream, [Text.Encoding]::UTF8, $true)
        try { $nodeLock = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    } finally { $lockStream.Dispose() }
    if ($null -eq $nodeLock -or $nodeLock.version -cne '24.15.0' -or $nodeLock.platform -cne 'win32' -or $nodeLock.architecture -cne 'x64' -or
        $nodeLock.root -cne 'node-v24.15.0-win-x64' -or $nodeLock.filename -cne 'node-v24.15.0-win-x64.zip' -or
        $nodeLock.url -cne 'https://nodejs.org/dist/v24.15.0/node-v24.15.0-win-x64.zip' -or
        ([string]$nodeLock.sha256) -cnotmatch '^[a-f0-9]{64}$' -or ([string]$nodeLock.size) -notmatch '^\d+$' -or [long]$nodeLock.size -le 0 -or [long]$nodeLock.size -gt 134217728) {
        throw 'Invalid Node bootstrap lock; inspect config/node-windows-x64.lock.json.'
    }
    if ($options.plan) {
        $stageIds = @('dependencies')
        if ($options.profile -in @('desktop', 'full')) { $stageIds += 'gui' }
        if ($options.profile -eq 'full') { $stageIds += @('native', 'mcp', 'desktop-runtime') }
        $stageIds += 'command'
        if ($options.profile -eq 'full') { $stageIds += 'diagnostics' }
        $downstreamWrites = @('node_modules', '.cache/quickstart', 'npm configured cache')
        if ($options.profile -in @('desktop', 'full')) { $downstreamWrites += 'Electron configured cache' }
        if ($options.profile -eq 'full') { $downstreamWrites += @('runtime/java', 'runtime/python', 'runtime/desktop', 'tools', '.cache/toolchain', '.cache/python-runtime', '.cache/desktop-runtime') }
        if ($options.cache) { $downstreamWrites += $options.cache }
        $userPath = 'unchanged'
        if (!$options.noPath) { $userPath = 'append managed command directory to HKCU\Environment\Path'; $downstreamWrites += 'HKCU\Environment\Path' }
        $report = [ordered]@{
            ok = $true; plan = $true; profile = $options.profile; noPath = $options.noPath; cache = $options.cache
            bootstrap = [ordered]@{ version = $nodeLock.version; strategy = 'existing Node >=24 with bundled npm, otherwise verified portable Node'; directory = (Join-Path $repository '.cache/bootstrap') }
            stages = @($stageIds | ForEach-Object { [ordered]@{ id = $_; status = 'planned' } })
            bootstrapWrites = @('.cache/bootstrap'); downstreamWrites = $downstreamWrites; userPath = $userPath
        }
        if ($options.json) { $report | ConvertTo-Json -Depth 8 } else {
            Write-Output ('Quick installation plan (' + $options.profile + '): ' + ($stageIds -join ' -> '))
            Write-Output 'Use Node >=24 with bundled npm, or download and verify portable Node 24.15.0 x64.'
            Write-Output ('Bootstrap destination: .cache/bootstrap. Downstream destinations: ' + ($downstreamWrites -join ', ') + '.')
            Write-Output ('User PATH: ' + $userPath + '. This plan makes no writes.')
        }
        exit 0
    }
    $node = Find-BootstrapNode -Repository $repository
    if (!$node) { $node = Get-BootstrapPortableNode -Repository $repository -Lock $nodeLock }
    [Console]::Error.WriteLine('[bootstrap] running quickstart with ' + $node)
    & $node (Join-Path $repository 'scripts/quickstart.mjs') @rawArguments
    exit $LASTEXITCODE
} catch {
    if (($null -ne $options -and $options.json) -or '--json' -cin $rawArguments) {
        [ordered]@{ ok = $false; error = $_.Exception.Message; stage = 'bootstrap' } | ConvertTo-Json -Compress
    } else { [Console]::Error.WriteLine('Bootstrap failed: ' + $_.Exception.Message) }
    exit 1
}
