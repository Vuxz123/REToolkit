# Windows PowerShell 5.1; loading these helpers performs no installation or writes.
function ConvertFrom-BootstrapArguments {
    param([string[]] $RawArguments)
    $options = @{ profile = 'full'; plan = $false; noPath = $false; cache = $null; json = $false; help = $false }
    $seen = @{}
    for ($index = 0; $index -lt $RawArguments.Count; $index++) {
        $argument = $RawArguments[$index]
        if ($argument -cnotin @('--profile', '--plan', '--no-path', '--cache', '--json', '--help')) {
            throw "Unknown option: $argument"
        }
        if ($seen.ContainsKey($argument)) { throw "Duplicate option: $argument" }
        $seen[$argument] = $true
        switch -CaseSensitive ($argument) {
            '--profile' {
                $index++
                if ($index -ge $RawArguments.Count -or $RawArguments[$index] -cnotin @('cli', 'desktop', 'full')) {
                    throw '--profile requires cli, desktop or full.'
                }
                $options.profile = $RawArguments[$index]
            }
            '--cache' {
                $index++
                if ($index -ge $RawArguments.Count -or [string]::IsNullOrWhiteSpace($RawArguments[$index]) -or $RawArguments[$index].StartsWith('-') -or $RawArguments[$index].Length -gt 4096 -or $RawArguments[$index] -match '[\x00-\x1f\x7f]') {
                    throw '--cache requires a directory.'
                }
                $options.cache = $RawArguments[$index]
            }
            '--plan' { $options.plan = $true }
            '--no-path' { $options.noPath = $true }
            '--json' { $options.json = $true }
            '--help' { $options.help = $true }
        }
    }
    return $options
}

function Assert-BootstrapPlainPath {
    param([Parameter(Mandatory=$true)][string] $Path)
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Refusing link or reparse point: $current"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }
        $current = $parent
    }
}

function Assert-BootstrapChildPath {
    param([string] $Parent, [string] $Path)
    $prefix = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    if (![IO.Path]::GetFullPath($Path).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path leaves bootstrap directory: $Path"
    }
    Assert-BootstrapPlainPath -Path $Path
}

function Open-VerifiedBootstrapArchive {
    param([string] $ArchivePath, $Lock)
    Assert-BootstrapPlainPath -Path $ArchivePath
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $stream = [IO.File]::Open($ArchivePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        if ($stream.Length -ne [long]$Lock.size) { throw 'Node archive size does not match lock; preserve it for inspection.' }
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
        if ($hash -cne ([string]$Lock.sha256).ToLowerInvariant()) { throw 'Node archive SHA256 does not match lock; preserve it for inspection.' }
        $stream.Position = 0
        return New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Read, $false)
    } catch {
        $stream.Dispose()
        throw
    }
}

function Get-BootstrapArchiveEntries {
    param($Archive, [string] $RootName)
    if ($RootName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw 'Invalid archive root in Node lock.' }
    $entries = @{}
    $total = [long]0
    foreach ($entry in $Archive.Entries) {
        $name = $entry.FullName
        if ($name.Contains('\') -or $name.Contains('//') -or $name.StartsWith('/') -or !$name.StartsWith($RootName + '/', [StringComparison]::Ordinal)) {
            throw "Unsafe or foreign Node archive path: $name"
        }
        $isDirectory = $name.EndsWith('/')
        $relative = $name.Substring($RootName.Length + 1).TrimEnd('/')
        if (!$relative) {
            if ($name -cne ($RootName + '/')) { throw "Unsafe Node archive root: $name" }
            continue
        }
        foreach ($segment in $relative.Split('/')) {
            if (!$segment -or $segment -in @('.', '..') -or $segment -match '[<>:"|?*\x00-\x1f]' -or $segment.EndsWith('.') -or $segment.EndsWith(' ') -or $segment -match '^(?i:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)') {
                throw "Unsafe Node archive path: $name"
            }
        }
        $unixType = ($entry.ExternalAttributes -shr 16) -band 0xf000
        if (($entry.ExternalAttributes -band 0x400) -ne 0 -or $unixType -notin @(0, 0x4000, 0x8000) -or ($unixType -eq 0x4000 -and !$isDirectory) -or ($unixType -eq 0x8000 -and $isDirectory)) {
            throw "Node archive contains a link or special entry: $name"
        }
        if ($entries.ContainsKey($relative)) { throw "Duplicate Node archive path: $name" }
        $entries[$relative] = @{ entry = $entry; directory = $isDirectory }
        $total += $entry.Length
        if ($entries.Count -gt 50000 -or $total -gt 536870912 -or $entry.Length -gt 268435456) { throw 'Node archive exceeds extraction limits.' }
    }
    foreach ($relative in @($entries.Keys)) {
        $parent = $relative
        while ($parent.Contains('/')) {
            $parent = $parent.Substring(0, $parent.LastIndexOf('/'))
            if ($entries.ContainsKey($parent) -and !$entries[$parent].directory) { throw "Node archive has conflicting paths: $relative" }
        }
    }
    if (!$entries.ContainsKey('node.exe') -or $entries['node.exe'].directory -or !$entries.ContainsKey('node_modules/npm/bin/npm-cli.js') -or $entries['node_modules/npm/bin/npm-cli.js'].directory) {
        throw 'Node archive is missing node.exe or bundled npm.'
    }
    return $entries
}

function Expand-VerifiedNodeArchive {
    param([string] $ArchivePath, [string] $Destination, $Lock)
    $archive = Open-VerifiedBootstrapArchive -ArchivePath $ArchivePath -Lock $Lock
    try {
        $entries = Get-BootstrapArchiveEntries -Archive $archive -RootName $Lock.root
        Assert-BootstrapPlainPath -Path $Destination
        if (Test-Path -LiteralPath $Destination) { throw "Extraction destination already exists; preserve it for inspection: $Destination" }
        [void][IO.Directory]::CreateDirectory($Destination)
        foreach ($relative in $entries.Keys) {
            $target = Join-Path $Destination $relative.Replace('/', '\')
            Assert-BootstrapChildPath -Parent $Destination -Path $target
            if ($entries[$relative].directory) { [void][IO.Directory]::CreateDirectory($target); continue }
            [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
            $inputStream = $entries[$relative].entry.Open()
            try {
                $outputStream = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
                try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose() }
            } finally { $inputStream.Dispose() }
        }
    } finally { $archive.Dispose() }
}

function Assert-PortableNodeDirectory {
    param([string] $ArchivePath, [string] $Directory, $Lock)
    $archive = Open-VerifiedBootstrapArchive -ArchivePath $ArchivePath -Lock $Lock
    try {
        $entries = Get-BootstrapArchiveEntries -Archive $archive -RootName $Lock.root
        Assert-BootstrapPlainPath -Path $Directory
        if (!(Test-Path -LiteralPath $Directory -PathType Container)) { throw "Portable Node directory is missing: $Directory" }
        $expectedDirectories = @{}
        foreach ($relative in $entries.Keys) {
            if ($entries[$relative].directory) { $expectedDirectories[$relative] = $true }
            $parent = $relative
            while ($parent.Contains('/')) { $parent = $parent.Substring(0, $parent.LastIndexOf('/')); $expectedDirectories[$parent] = $true }
        }
        $queue = New-Object 'Collections.Generic.Queue[string]'
        $queue.Enqueue([IO.Path]::GetFullPath($Directory))
        $prefix = [IO.Path]::GetFullPath($Directory).TrimEnd('\') + '\'
        $observed = @{}
        while ($queue.Count) {
            foreach ($target in [IO.Directory]::GetFileSystemEntries($queue.Dequeue())) {
                Assert-BootstrapChildPath -Parent $Directory -Path $target
                $relative = $target.Substring($prefix.Length).Replace('\', '/')
                $item = Get-Item -LiteralPath $target -Force
                if ($item.PSIsContainer) {
                    if (!$expectedDirectories.ContainsKey($relative)) { throw "Unexpected directory in portable Node; preserve for inspection: $target" }
                    $queue.Enqueue($target)
                    continue
                }
                if (!$entries.ContainsKey($relative) -or $entries[$relative].directory -or $item.Length -ne $entries[$relative].entry.Length) {
                    throw "Changed or unexpected portable Node file; preserve for inspection: $target"
                }
                $observed[$relative] = $true
                $archiveStream = $entries[$relative].entry.Open()
                $fileStream = [IO.File]::OpenRead($target)
                $sha = [Security.Cryptography.SHA256]::Create()
                try {
                    $expected = [BitConverter]::ToString($sha.ComputeHash($archiveStream))
                    $actual = [BitConverter]::ToString($sha.ComputeHash($fileStream))
                    if ($actual -cne $expected) { throw "Changed portable Node file; preserve for inspection: $target" }
                } finally { $archiveStream.Dispose(); $fileStream.Dispose(); $sha.Dispose() }
            }
        }
        foreach ($relative in $entries.Keys) {
            if (!$entries[$relative].directory -and !$observed.ContainsKey($relative)) { throw "Missing portable Node file; preserve for inspection: $relative" }
        }
    } finally { $archive.Dispose() }
}

function Find-BootstrapNode {
    param([string] $Repository)
    $managedPrefix = $null
    if ($Repository) { $managedPrefix = [IO.Path]::GetFullPath((Join-Path $Repository '.cache/bootstrap')).TrimEnd('\') + '\' }
    foreach ($command in @(Get-Command node.exe -CommandType Application -All -ErrorAction SilentlyContinue)) {
        $executable = $command.Source
        # A PATH entry for our own portable runtime must still pass archive checks.
        if ($managedPrefix -and [IO.Path]::GetFullPath($executable).StartsWith($managedPrefix, [StringComparison]::OrdinalIgnoreCase)) { continue }
        $npm = Join-Path ([IO.Path]::GetDirectoryName($executable)) 'node_modules/npm/bin/npm-cli.js'
        if (!(Test-Path -LiteralPath $npm -PathType Leaf)) { continue }
        try {
            $version = & $executable --version 2>$null
            if ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.\d+\.\d+$' -and [int]$Matches[1] -ge 24) { return $executable }
        } catch { continue }
    }
    return $null
}

function Copy-BoundedBootstrapStream {
    param([IO.Stream] $Source, [IO.Stream] $Destination, [long] $ExpectedSize)
    if ($ExpectedSize -le 0) { throw 'Node download size must be positive.' }
    $buffer = New-Object byte[] 65536
    $copied = [long]0
    while ($true) {
        $count = $Source.Read($buffer, 0, $buffer.Length)
        if ($count -eq 0) { break }
        if ($count -gt ($ExpectedSize - $copied)) {
            throw "Node download exceeds locked size ($copied bytes written); preserve the partial download for inspection."
        }
        $Destination.Write($buffer, 0, $count)
        $copied += $count
    }
    if ($copied -ne $ExpectedSize) {
        throw "Node download ended at $copied bytes, expected $ExpectedSize; preserve the partial download for inspection."
    }
    return $copied
}

function Save-BootstrapNodeDownload {
    param([string] $Url, [string] $Destination, [long] $ExpectedSize)
    Assert-BootstrapPlainPath -Path $Destination
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $request = [Net.HttpWebRequest]::Create($Url)
    $request.Method = 'GET'
    $request.Timeout = 15000
    $request.ReadWriteTimeout = 30000
    $response = $null
    $inputStream = $null
    $outputStream = $null
    try {
        $response = $request.GetResponse()
        if ([int]$response.StatusCode -ne 200) { throw "Node download returned HTTP $([int]$response.StatusCode)." }
        if ($response.ContentLength -ge 0 -and $response.ContentLength -ne $ExpectedSize) {
            throw "Node download Content-Length $($response.ContentLength) differs from locked size $ExpectedSize."
        }
        $inputStream = $response.GetResponseStream()
        $outputStream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        return Copy-BoundedBootstrapStream -Source $inputStream -Destination $outputStream -ExpectedSize $ExpectedSize
    } finally {
        if ($null -ne $outputStream) { $outputStream.Dispose() }
        if ($null -ne $inputStream) { $inputStream.Dispose() }
        if ($null -ne $response) { $response.Dispose() }
        $request.Abort()
    }
}

function Get-BootstrapPortableNode {
    param([string] $Repository, $Lock)
    $cache = Join-Path $Repository '.cache/bootstrap'
    Assert-BootstrapChildPath -Parent $Repository -Path $cache
    [void][IO.Directory]::CreateDirectory($cache)
    $lockPath = Join-Path $cache '.install.lock'
    $guard = $null
    try { $guard = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None) } catch {
        throw "Bootstrap is active or has an uncertain lock; inspect before retrying: $lockPath"
    }
    try {
        $archivePath = Join-Path $cache $Lock.filename
        $destination = Join-Path $cache $Lock.root
        Assert-BootstrapChildPath -Parent $cache -Path $archivePath
        Assert-BootstrapChildPath -Parent $cache -Path $destination
        foreach ($item in Get-ChildItem -LiteralPath $cache -Force) {
            if ($item.Name -notin @('.install.lock', $Lock.filename, $Lock.root)) {
                throw "Uncertain bootstrap cache state; preserve it for inspection before retrying: $($item.FullName)"
            }
        }
        if (!(Test-Path -LiteralPath $archivePath)) {
            if (Test-Path -LiteralPath $destination) { throw 'Existing portable Node has no verified source archive; preserve it for inspection.' }
            $download = Join-Path $cache ('download-' + [Guid]::NewGuid().ToString('N') + '.zip')
            Assert-BootstrapChildPath -Parent $cache -Path $download
            [Console]::Error.WriteLine("[bootstrap] downloading Node $($Lock.version) ($($Lock.size) bytes expected)")
            $downloaded = Save-BootstrapNodeDownload -Url $Lock.url -Destination $download -ExpectedSize $Lock.size
            [Console]::Error.WriteLine("[bootstrap] verifying Node archive ($downloaded bytes downloaded)")
            $verified = Open-VerifiedBootstrapArchive -ArchivePath $download -Lock $Lock
            $verified.Dispose()
            Assert-BootstrapChildPath -Parent $cache -Path $archivePath
            [IO.File]::Move($download, $archivePath)
        }
        if (Test-Path -LiteralPath $destination) {
            [Console]::Error.WriteLine('[bootstrap] verifying existing portable Node files against the locked archive')
            Assert-PortableNodeDirectory -ArchivePath $archivePath -Directory $destination -Lock $Lock
        } else {
            [Console]::Error.WriteLine('[bootstrap] extracting and verifying portable Node')
            $stage = Join-Path $cache ('stage-' + [Guid]::NewGuid().ToString('N'))
            Assert-BootstrapChildPath -Parent $cache -Path $stage
            Expand-VerifiedNodeArchive -ArchivePath $archivePath -Destination $stage -Lock $Lock
            Assert-PortableNodeDirectory -ArchivePath $archivePath -Directory $stage -Lock $Lock
            Assert-BootstrapChildPath -Parent $cache -Path $stage
            Assert-BootstrapChildPath -Parent $cache -Path $destination
            [IO.Directory]::Move($stage, $destination)
        }
        return Join-Path $destination 'node.exe'
    } finally {
        $guard.Dispose()
        Assert-BootstrapChildPath -Parent $cache -Path $lockPath
        [IO.File]::Delete($lockPath)
    }
}
