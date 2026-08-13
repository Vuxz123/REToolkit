[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic

function Resolve-RetkGuiRoot {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string]$OwnDirectory)

    $ownRePs1 = Join-Path $OwnDirectory "re.ps1"
    if (Test-Path -LiteralPath $ownRePs1) {
        return $OwnDirectory
    }

    $parentDirectory = Split-Path -Parent $OwnDirectory
    if ($parentDirectory) {
        $parentRePs1 = Join-Path $parentDirectory "re.ps1"
        if (Test-Path -LiteralPath $parentRePs1) {
            return $parentDirectory
        }
    }

    throw "Could not find re.ps1 next to '$OwnDirectory' or its parent. REToolkit-GUI.exe must sit in the REToolkit repo root, or retk-gui.ps1 must run from the repo's scripts\ folder."
}

$RetkGuiScriptDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
try {
    $RetkGuiRepoRoot = Resolve-RetkGuiRoot -OwnDirectory $RetkGuiScriptDirectory
    . (Join-Path $RetkGuiRepoRoot "scripts\retk-core.ps1")
}
catch {
    if ($MyInvocation.InvocationName -ne '.') {
        [System.Windows.Forms.MessageBox]::Show(
            $_.Exception.Message,
            "REToolkit GUI",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
        exit 1
    }
    throw
}

function Split-RetkGuiCommandLine {
    [CmdletBinding()]
    param([Parameter()] [string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) { return @() }

    $tokenMatches = [System.Text.RegularExpressions.Regex]::Matches($Text, '"([^"]*)"|(\S+)')
    $tokens = New-Object System.Collections.Generic.List[string]
    foreach ($tokenMatch in $tokenMatches) {
        if ($tokenMatch.Groups[1].Success) {
            [void]$tokens.Add($tokenMatch.Groups[1].Value)
        }
        else {
            [void]$tokens.Add($tokenMatch.Groups[2].Value)
        }
    }
    return @($tokens)
}

function Get-RetkGuiWorkspaceNames {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string]$WorkspacesDir)

    if (-not (Test-Path -LiteralPath $WorkspacesDir -PathType Container)) { return @() }

    $names = Get-ChildItem -LiteralPath $WorkspacesDir -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "project.re.json") } |
        Sort-Object Name |
        ForEach-Object { $_.Name }

    return @($names)
}

function Invoke-RetkGuiCommand {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$Root,
        [Parameter(Mandatory)] [AllowEmptyCollection()] [string[]]$Arguments,
        [Parameter(Mandatory)] [scriptblock]$OnOutput,
        [Parameter(Mandatory)] [scriptblock]$OnExit
    )

    $rePs1 = Join-Path $Root "re.ps1"
    $fullArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $rePs1) + @($Arguments)

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "powershell.exe"
    $psi.Arguments = Join-NativeArgumentString $fullArgs
    $psi.WorkingDirectory = $Root
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    $proc.EnableRaisingEvents = $true

    Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -MessageData $OnOutput -Action {
        if ($null -ne $EventArgs.Data) { & $Event.MessageData $EventArgs.Data }
    } | Out-Null

    Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -MessageData $OnOutput -Action {
        if ($null -ne $EventArgs.Data) { & $Event.MessageData $EventArgs.Data }
    } | Out-Null

    Register-ObjectEvent -InputObject $proc -EventName Exited -MessageData $OnExit -Action {
        & $Event.MessageData $Event.Sender.ExitCode
    } | Out-Null

    [void]$proc.Start()
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()

    return $proc
}

function Start-RetkGui {
    # Filled in by Task 4.
}

if ($MyInvocation.InvocationName -ne '.') {
    Start-RetkGui
}
