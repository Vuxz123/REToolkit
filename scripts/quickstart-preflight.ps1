#requires -Version 5.1
$ErrorActionPreference = 'Stop'
try {
    $scanRoot = [IO.Path]::GetFullPath($env:RETK_QUICKSTART_ROOT).TrimEnd('\')
    $ownerPid = [int]$env:RETK_QUICKSTART_PID
    $busy = @()
    $unknown = $false
    foreach ($item in @(Get-CimInstance Win32_Process -ErrorAction Stop)) {
        if ($item.Name -notmatch '^(electron|node)[.]exe$' -or $item.ProcessId -eq $ownerPid) { continue }
        $exe = ([string]$item.ExecutablePath).Replace('/', '\')
        $line = ([string]$item.CommandLine).Replace('/', '\')
        if (!$exe -or !$line) { $unknown = $true; continue }
        if ($exe.StartsWith($scanRoot + '\node_modules\electron\', [StringComparison]::OrdinalIgnoreCase) -or
            ($line.IndexOf($scanRoot + '\', [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
             $line -match '(?:re[.]js|src\\[^"\r\n]*worker[.][mc]?js)')) {
            $busy += [int]$item.ProcessId
        }
    }
    @{ state = $(if ($busy.Count) { 'busy' } elseif ($unknown) { 'unknown' } else { 'idle' }); pids = @($busy) } | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine('Cannot inspect toolkit processes: ' + $_.Exception.Message)
    exit 1
}
