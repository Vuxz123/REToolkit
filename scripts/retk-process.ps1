# Dot-sourced by re.ps1. Uses shared REToolkit variables from the entrypoint.

function Invoke-NativeProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [Parameter()] [string[]]$Arguments,
        [Parameter()] [string]$WorkingDirectory
    )

    if ($null -eq $Arguments) { $Arguments = @() }

    if (-not (Test-Path -LiteralPath $FilePath)) {
        throw "Native process not found: $FilePath"
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.Arguments = Join-NativeArgumentString $Arguments

    if ($WorkingDirectory) {
        $psi.WorkingDirectory = $WorkingDirectory
    }

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi

    $started = $proc.Start()
    if (-not $started) {
        throw "Failed to start native process: $FilePath"
    }

    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    $lines = New-Object System.Collections.Generic.List[string]

    if (-not [string]::IsNullOrWhiteSpace($stdout)) {
        foreach ($line in ($stdout -split "`r?`n")) {
            if ($line -ne "") { [void]$lines.Add($line) }
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($stderr)) {
        foreach ($line in ($stderr -split "`r?`n")) {
            if ($line -ne "") { [void]$lines.Add($line) }
        }
    }

    return [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Lines    = @($lines)
        StdOut   = $stdout
        StdErr   = $stderr
        Command  = ("{0} {1}" -f $FilePath, $psi.Arguments)
    }
}

function Start-DetachedNativeProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [Parameter()] [string[]]$Arguments,
        [Parameter()] [string]$WorkingDirectory,
        [Parameter(Mandatory)] [string]$LogFile,
        [string]$Activity = "Detached native process"
    )

    if ($null -eq $Arguments) { $Arguments = @() }
    if (-not (Test-Path -LiteralPath $FilePath)) {
        throw "Native process not found: $FilePath"
    }

    $logDir = Split-Path -Parent $LogFile
    if ($logDir) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }

    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($LogFile)
    $stderrLog = Join-Path $logDir ("{0}.err.log" -f $baseName)
    $argString = Join-NativeArgumentString $Arguments
    $commandLine = "{0} {1}" -f $FilePath, $argString

    $startArgs = @{
        FilePath               = $FilePath
        ArgumentList           = $argString
        RedirectStandardOutput = $LogFile
        RedirectStandardError  = $stderrLog
        WindowStyle            = "Hidden"
        PassThru               = $true
    }
    if ($WorkingDirectory) { $startArgs.WorkingDirectory = $WorkingDirectory }

    Write-Host ("[START] {0}" -f $Activity) -ForegroundColor Cyan
    Write-Host ("        {0}" -f $commandLine) -ForegroundColor DarkGray

    $proc = Start-Process @startArgs
    if ($null -eq $proc) {
        throw "Failed to start detached process: $FilePath"
    }

    return [pscustomobject]@{
        ProcessId = $proc.Id
        Command   = $commandLine
        StdOutLog = $LogFile
        StdErrLog = $stderrLog
    }
}

function Invoke-AnalyzeHeadless {
    param([Parameter(Mandatory)] [string[]]$HeadlessArgs)

    Assert-PathExists $ToolPaths.AnalyzeHeadless "Ghidra Headless Analyzer"
    Assert-PathExists $ToolPaths.JavaExe         "Toolkit JDK 21"

    $result = Invoke-WithToolkitEnv {
        Invoke-NativeProcess -FilePath $ToolPaths.AnalyzeHeadless -Arguments $HeadlessArgs -WorkingDirectory $Root
    }

    if ($result -is [array]) { $result = $result | Select-Object -Last 1 }
    if ($null -eq $result) { throw "Invoke-AnalyzeHeadless internal error: process result is null." }

    $outputLines = @($result.Lines)
    $outputLines | ForEach-Object { Write-Host $_ }

    if ($result.ExitCode -ne 0) {
        $errText = ($outputLines | Select-Object -Last 12) -join "`n"
        throw "analyzeHeadless exited with code $($result.ExitCode).`nLast output:`n$errText"
    }
    return $outputLines
}

function Invoke-NativeProcessHeartbeat {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$FilePath,
        [Parameter()] [string[]]$Arguments,
        [Parameter()] [string]$WorkingDirectory,
        [string]$Activity = "Running native process",
        [int]$HeartbeatSeconds = 10,
        [string]$LogFile
    )

    if ($null -eq $Arguments) { $Arguments = @() }
    if (-not (Test-Path -LiteralPath $FilePath)) {
        throw "Native process not found: $FilePath"
    }

    $argString = Join-NativeArgumentString $Arguments
    $commandLine = "{0} {1}" -f $FilePath, $argString

    if ($LogFile) {
        $dir = Split-Path -Parent $LogFile
        if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        @(
            "# $Activity",
            "StartedAt: $((Get-Date).ToString('s'))",
            "Command: $commandLine",
            ""
        ) | Out-File -LiteralPath $LogFile -Encoding UTF8
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $FilePath
    $psi.Arguments = $argString
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $false
    $psi.RedirectStandardError = $false
    $psi.CreateNoWindow = $false
    if ($WorkingDirectory) { $psi.WorkingDirectory = $WorkingDirectory }

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi

    Write-Host ("[RUN] {0}" -f $Activity) -ForegroundColor Cyan
    Write-Host ("      {0}" -f $commandLine) -ForegroundColor DarkGray

    $started = $proc.Start()
    if (-not $started) { throw "Failed to start native process: $FilePath" }

    $startTime = Get-Date
    $lastHeartbeat = $startTime.AddSeconds(-1 * $HeartbeatSeconds)

    while (-not $proc.WaitForExit(1000)) {
        $now = Get-Date
        $elapsed = New-TimeSpan -Start $startTime -End $now
        Write-Progress -Activity $Activity -Status ("elapsed {0:hh\:mm\:ss}" -f $elapsed)

        if (($now - $lastHeartbeat).TotalSeconds -ge $HeartbeatSeconds) {
            $message = "[... still running] {0} elapsed {1:hh\:mm\:ss}" -f $Activity, $elapsed
            Write-Host $message -ForegroundColor DarkGray
            if ($LogFile) { Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value $message }
            $lastHeartbeat = $now
        }
    }

    Write-Progress -Activity $Activity -Completed
    $proc.WaitForExit()

    $endMessage = "FinishedAt: $((Get-Date).ToString('s')); ExitCode: $($proc.ExitCode)"
    if ($LogFile) { Add-Content -LiteralPath $LogFile -Encoding UTF8 -Value $endMessage }

    return [pscustomobject]@{
        ExitCode = $proc.ExitCode
        Lines    = @($endMessage)
        StdOut   = ""
        StdErr   = ""
        Command  = $commandLine
    }
}

function Invoke-AnalyzeHeadlessHeartbeat {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string[]]$HeadlessArgs,
        [string]$Activity = "Ghidra Headless Analyzer",
        [string]$LogFile
    )

    Assert-PathExists $ToolPaths.AnalyzeHeadless "Ghidra Headless Analyzer"
    Assert-PathExists $ToolPaths.JavaExe         "Toolkit JDK 21"

    $result = Invoke-WithToolkitEnv {
        Invoke-NativeProcessHeartbeat -FilePath $ToolPaths.AnalyzeHeadless -Arguments $HeadlessArgs -WorkingDirectory $Root -Activity $Activity -LogFile $LogFile
    }

    if ($result -is [array]) { $result = $result | Select-Object -Last 1 }
    if ($null -eq $result) { throw "Invoke-AnalyzeHeadlessHeartbeat internal error: process result is null." }

    if ($result.ExitCode -ne 0) {
        throw "analyzeHeadless exited with code $($result.ExitCode).`nCommand: $($result.Command)`nCheck console output above and log: $LogFile"
    }

    return @($result.Lines)
}
