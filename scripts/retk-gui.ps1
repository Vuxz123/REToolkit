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

$RetkGuiScriptDirectory = if ($PSScriptRoot) {
    $PSScriptRoot
}
else {
    # A ps2exe-compiled exe leaves $PSScriptRoot empty AND
    # $MyInvocation.MyCommand.Path $null (confirmed via a standalone ps2exe
    # diagnostic build) -- Split-Path -Parent $null throws "Cannot bind
    # argument to parameter 'Path' because it is null." The running process's
    # own module path is the only reliable way to find the exe's directory
    # in that case.
    Split-Path -Parent ([System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName)
}
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

function Format-RetkGuiElapsed {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [TimeSpan]$Elapsed)

    return $Elapsed.ToString("hh\:mm\:ss")
}

function Test-RetkGuiDoctorHasIssues {
    [CmdletBinding()]
    param(
        # A Mandatory string[] parameter rejects any empty-string ELEMENT
        # (not just an overall empty value) unless AllowEmptyString is also
        # present -- confirmed by direct testing: 're.ps1 doctor' prints a
        # blank line between the tool list and the "Toolkit JDK:" header,
        # which threw "Cannot bind argument ... because it is an empty
        # string" without this attribute, even though the array itself had
        # 19 non-empty-overall elements.
        [Parameter(Mandatory)] [AllowEmptyCollection()] [AllowEmptyString()] [string[]]$Lines
    )

    return ($Lines | Where-Object { $_ -and $_.Contains('[MISS]') }).Count -gt 0
}

function Get-RetkGuiHarnessInfo {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$HomeDir,
        [Parameter()] [AllowNull()] [AllowEmptyString()] [string]$CodexHome
    )

    # [System.IO.Path]::Combine, not Join-Path: Join-Path's FileSystem
    # provider validates that a rooted second/later segment's drive actually
    # exists ("Cannot find drive") -- fatal for a CODEX_HOME override or a
    # HomeDir pointing at a drive that isn't mounted, even though this
    # function only needs to compute a path string, not touch disk.
    $codexRoot = if ([string]::IsNullOrWhiteSpace($CodexHome)) { [System.IO.Path]::Combine($HomeDir, ".codex") } else { $CodexHome }
    $openCodeRoot = [System.IO.Path]::Combine($HomeDir, ".config", "opencode")
    $claudeRoot = [System.IO.Path]::Combine($HomeDir, ".claude")

    return @(
        [pscustomobject]@{ Name = "Claude Code"; RootDir = $claudeRoot; SkillsDir = [System.IO.Path]::Combine($claudeRoot, "skills") }
        [pscustomobject]@{ Name = "Codex"; RootDir = $codexRoot; SkillsDir = [System.IO.Path]::Combine($codexRoot, "skills") }
        [pscustomobject]@{ Name = "OpenCode"; RootDir = $openCodeRoot; SkillsDir = [System.IO.Path]::Combine($openCodeRoot, "skills") }
    )
}

function Get-RetkGuiWizardStepStatus {
    [CmdletBinding()]
    param(
        [Parameter()] [AllowNull()] $Project,
        [Parameter(Mandatory)] [bool]$HealthCheckDone
    )

    $hasWorkspace = $null -ne $Project
    # PowerShell property access on $null (or a missing member) returns
    # $null rather than throwing, so this is safe even when $Project is
    # $null or has no .status property (a malformed/legacy project.re.json).
    $dumped = $hasWorkspace -and [bool]$Project.status.dumped
    $ghidraTouched = $hasWorkspace -and (
        [bool]$Project.status.imported -or
        [bool]$Project.status.analyzed -or
        [bool]$Project.status.symbolsApplied
    )

    return @(
        [pscustomobject]@{ Index = 1; Title = "Setup"; Complete = $HealthCheckDone; Unlocked = $true }
        [pscustomobject]@{ Index = 2; Title = "New workspace"; Complete = $hasWorkspace; Unlocked = $HealthCheckDone }
        [pscustomobject]@{ Index = 3; Title = "Prepare Build"; Complete = $dumped; Unlocked = $hasWorkspace }
        [pscustomobject]@{ Index = 4; Title = "Ghidra"; Complete = $ghidraTouched; Unlocked = $dumped }
        [pscustomobject]@{ Index = 5; Title = "More"; Complete = $false; Unlocked = $ghidraTouched }
    )
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

    # OutputDataReceived/ErrorDataReceived fire once per line, then exactly
    # once more with $EventArgs.Data -eq $null as the documented EOF sentinel
    # for that stream. Pass that straight through to OnOutput instead of
    # filtering it out: OnOutput is called with a [string] for each real
    # line, and with $null exactly once per stream (stdout, then stderr)
    # when that stream closes -- callers that only care about lines should
    # check if ($null -ne $line). This is simpler
    # and more reliable than trying to track stream-closed state on a shared
    # object read back later from a different execution context: confirmed
    # by direct testing that such cross-boundary reads of a Register-ObjectEvent
    # -MessageData object's mutated properties are NOT reliably visible from
    # outside the action that mutated them, even when GetHashCode() confirms
    # it's the same object instance and a Synchronized wrapper is used.
    Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -MessageData $OnOutput -Action {
        & $Event.MessageData $EventArgs.Data
    } | Out-Null

    Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -MessageData $OnOutput -Action {
        & $Event.MessageData $EventArgs.Data
    } | Out-Null

    Register-ObjectEvent -InputObject $proc -EventName Exited -MessageData $OnExit -Action {
        & $Event.MessageData $Event.Sender.ExitCode
    } | Out-Null

    [void]$proc.Start()
    $proc.BeginOutputReadLine()
    $proc.BeginErrorReadLine()

    return $proc
}

function Show-RetkGuiPathPromptDialog {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string]$Title)

    $dialog = New-Object System.Windows.Forms.Form
    $dialog.Text = $Title
    $dialog.Width = 520
    $dialog.Height = 140
    $dialog.StartPosition = "CenterParent"
    $dialog.FormBorderStyle = "FixedDialog"
    $dialog.MaximizeBox = $false
    $dialog.MinimizeBox = $false

    $textBox = New-Object System.Windows.Forms.TextBox
    $textBox.Left = 10; $textBox.Top = 15; $textBox.Width = 480

    $fileButton = New-Object System.Windows.Forms.Button
    $fileButton.Text = "File..."
    $fileButton.Left = 10; $fileButton.Top = 45
    $fileButton.Add_Click({
        $fd = New-Object System.Windows.Forms.OpenFileDialog
        $fd.Filter = "Android build (*.apk;*.xapk;*.aab;*.zip)|*.apk;*.xapk;*.aab;*.zip|All files (*.*)|*.*"
        if ($fd.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $textBox.Text = $fd.FileName }
    }.GetNewClosure())

    $folderButton = New-Object System.Windows.Forms.Button
    $folderButton.Text = "Folder..."
    $folderButton.Left = 100; $folderButton.Top = 45
    $folderButton.Add_Click({
        $fbd = New-Object System.Windows.Forms.FolderBrowserDialog
        if ($fbd.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $textBox.Text = $fbd.SelectedPath }
    }.GetNewClosure())

    $okButton = New-Object System.Windows.Forms.Button
    $okButton.Text = "OK"
    $okButton.Left = 330; $okButton.Top = 70
    $okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK

    $dialogCancelButton = New-Object System.Windows.Forms.Button
    $dialogCancelButton.Text = "Cancel"
    $dialogCancelButton.Left = 415; $dialogCancelButton.Top = 70
    $dialogCancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

    $dialog.Controls.AddRange(@($textBox, $fileButton, $folderButton, $okButton, $dialogCancelButton))
    $dialog.AcceptButton = $okButton
    $dialog.CancelButton = $dialogCancelButton

    $result = $dialog.ShowDialog()
    if ($result -eq [System.Windows.Forms.DialogResult]::OK -and -not [string]::IsNullOrWhiteSpace($textBox.Text)) {
        return $textBox.Text
    }
    return $null
}

function Start-RetkGui {
    $root = $RetkGuiRepoRoot
    $workspacesDir = Join-Path $root "workspaces"

    $global:IsRunning = $false
    $global:CurrentProcess = $null
    $global:CommandStartedAt = $null
    $global:WasCancelled = $false
    $global:AllActionButtons = New-Object System.Collections.Generic.List[System.Windows.Forms.Button]
    $global:WorkspaceButtons = New-Object System.Collections.Generic.List[System.Windows.Forms.Button]

    $form = New-Object System.Windows.Forms.Form
    $global:GuiForm = $form
    $form.Text = "REToolkit GUI"
    $form.Width = 1300
    $form.Height = 720
    $form.StartPosition = "CenterScreen"

    # --- Top bar: minimal, persistent regardless of which wizard step is showing ---
    $topPanel = New-Object System.Windows.Forms.Panel
    $topPanel.Dock = "Top"
    $topPanel.Height = 40

    $openFolderButton = New-Object System.Windows.Forms.Button
    $openFolderButton.Text = "Open folder"
    $openFolderButton.Left = 10; $openFolderButton.Top = 6
    $openFolderButton.AutoSize = $true

    $topPanel.Controls.Add($openFolderButton)

    # Workspace combo/Refresh/New workspace move into the step 2 ("New
    # workspace") panel below instead of living in the top bar -- created
    # here (same variable names the existing handlers further down already
    # reference) but not parented into any container yet.
    $workspaceCombo = New-Object System.Windows.Forms.ComboBox
    $workspaceCombo.DropDownStyle = "DropDownList"

    $refreshButton = New-Object System.Windows.Forms.Button
    $refreshButton.Text = "Refresh"

    $initButton = New-Object System.Windows.Forms.Button
    $initButton.Text = "New workspace"
    $initButton.AutoSize = $true

    # --- Bottom bar: raw command ---
    $bottomPanel = New-Object System.Windows.Forms.Panel
    $bottomPanel.Dock = "Bottom"
    $bottomPanel.Height = 36

    $rawCommandBox = New-Object System.Windows.Forms.TextBox
    $rawCommandBox.Left = 10; $rawCommandBox.Top = 6; $rawCommandBox.Width = 900
    $rawCommandBox.Text = ""

    $runRawButton = New-Object System.Windows.Forms.Button
    $runRawButton.Text = "Run"
    $runRawButton.Left = 920; $runRawButton.Top = 4

    $bottomPanel.Controls.AddRange(@($rawCommandBox, $runRawButton))

    # --- Status bar: command state / elapsed time / busy indicator ---
    $statusStrip = New-Object System.Windows.Forms.StatusStrip

    $healthLabel = New-Object System.Windows.Forms.ToolStripStatusLabel
    $healthLabel.Text = "Checking tools..."
    $healthLabel.ForeColor = [System.Drawing.Color]::Gray
    $healthLabel.AutoToolTip = $true
    $healthLabel.ToolTipText = "Running doctor..."
    $global:GuiHealthLabel = $healthLabel

    $statusLabel = New-Object System.Windows.Forms.ToolStripStatusLabel
    $statusLabel.Text = "Idle"
    $statusLabel.Spring = $true
    $statusLabel.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
    $global:GuiStatusLabel = $statusLabel

    $elapsedLabel = New-Object System.Windows.Forms.ToolStripStatusLabel
    $elapsedLabel.Text = ""
    $elapsedLabel.AutoSize = $true
    $global:GuiElapsedLabel = $elapsedLabel

    $statusProgressBar = New-Object System.Windows.Forms.ToolStripProgressBar
    $statusProgressBar.Style = "Marquee"
    $statusProgressBar.MarqueeAnimationSpeed = 30
    $statusProgressBar.Visible = $false
    $global:GuiStatusProgressBar = $statusProgressBar

    $statusStrip.Items.AddRange(@($healthLabel, (New-Object System.Windows.Forms.ToolStripSeparator), $statusLabel, $elapsedLabel, $statusProgressBar))

    # --- Right panel: log + controls ---
    $rightPanel = New-Object System.Windows.Forms.Panel
    $rightPanel.Dock = "Fill"

    $logBox = New-Object System.Windows.Forms.TextBox
    # Also reachable as $global:GuiLogBox: .GetNewClosure() called from
    # *inside* a `function script:Name`-registered function (as
    # Invoke-GuiCommand is) cannot see that function's own enclosing
    # (Start-RetkGui's) local variables -- verified in isolation. Its
    # internally-created closures (onOutput/onExit/the exit-poll Timer) need
    # $logBox/$form, so those two are also exposed via $global: to sidestep
    # the gap; everything else keeps using the plain lexical/dynamic scope
    # chain, which works fine for ordinary function calls and top-level
    # button-click closures.
    $global:GuiLogBox = $logBox
    $logBox.Multiline = $true
    $logBox.ReadOnly = $true
    $logBox.ScrollBars = "Vertical"
    $logBox.Font = New-Object System.Drawing.Font("Consolas", 9)
    $logBox.Dock = "Fill"

    $logButtonsPanel = New-Object System.Windows.Forms.Panel
    $logButtonsPanel.Dock = "Bottom"
    $logButtonsPanel.Height = 32

    $clearLogButton = New-Object System.Windows.Forms.Button
    $clearLogButton.Text = "Clear log"
    $clearLogButton.Left = 10; $clearLogButton.Top = 4

    $cancelButton = New-Object System.Windows.Forms.Button
    $cancelButton.Text = "Cancel"
    $cancelButton.Left = 110; $cancelButton.Top = 4
    $cancelButton.Enabled = $false

    $logButtonsPanel.Controls.AddRange(@($clearLogButton, $cancelButton))
    $rightPanel.Controls.Add($logBox)
    $rightPanel.Controls.Add($logButtonsPanel)

    # --- Step rail + step content panels (replaces the old single
    # FlowLayoutPanel stack of every GroupBox at once) ---
    function New-RetkGuiGroup {
        param([Parameter(Mandatory)] [string]$Title)
        $group = New-Object System.Windows.Forms.GroupBox
        $group.Text = $Title
        $group.Width = 520
        $group.Height = 80
        return $group
    }

    function Add-RetkGuiButtonToGroup {
        param(
            [Parameter(Mandatory)] $Group,
            [Parameter(Mandatory)] [string]$Text,
            [Parameter(Mandatory)] [scriptblock]$OnClick,
            [switch]$RequiresWorkspace
        )
        $flow = $Group.Controls | Where-Object { $_ -is [System.Windows.Forms.FlowLayoutPanel] } | Select-Object -First 1
        if ($null -eq $flow) {
            $flow = New-Object System.Windows.Forms.FlowLayoutPanel
            # Deliberately NOT Dock="Top": a GroupBox with AutoSize=true cannot
            # compute its preferred size from a Dock-anchored child (WinForms
            # resolves the circular Dock<->AutoSize dependency by collapsing
            # the child to zero width). Anchor via fixed Location instead, and
            # use MaximumSize (not just Width) so WrapContents actually wraps
            # instead of growing past it on every layout pass.
            $flow.AutoSize = $true
            $flow.AutoSizeMode = "GrowAndShrink"
            $flow.WrapContents = $true
            $flow.MaximumSize = New-Object System.Drawing.Size(500, 0)
            $flow.Width = 500
            $flow.Left = 6
            $flow.Top = 18
            $Group.Controls.Add($flow)
        }
        $button = New-Object System.Windows.Forms.Button
        $button.Text = $Text
        $button.AutoSize = $false
        $button.Width = 160
        $button.Height = 28
        $button.Margin = New-Object System.Windows.Forms.Padding(3, 3, 3, 3)
        $button.Add_Click($OnClick)
        $flow.Controls.Add($button)
        $flow.PerformLayout()
        $Group.Height = $flow.Top + $flow.Height + 12
        [void]$global:AllActionButtons.Add($button)
        if ($RequiresWorkspace) { [void]$global:WorkspaceButtons.Add($button) }
        return $button
    }

    function script:Get-SelectedGameName {
        if ($null -eq $workspaceCombo.SelectedItem) { return $null }
        return [string]$workspaceCombo.SelectedItem
    }

    function script:Refresh-Workspaces {
        $selected = Get-SelectedGameName
        $names = Get-RetkGuiWorkspaceNames -WorkspacesDir $workspacesDir
        $workspaceCombo.Items.Clear()
        foreach ($name in $names) { [void]$workspaceCombo.Items.Add($name) }
        if ($selected -and ($names -contains $selected)) {
            $workspaceCombo.SelectedItem = $selected
        }
        elseif ($names.Count -gt 0) {
            $workspaceCombo.SelectedIndex = 0
        }
        Update-WorkspaceButtonsEnabled
    }

    function script:Update-WorkspaceButtonsEnabled {
        $hasSelection = $null -ne (Get-SelectedGameName)
        foreach ($b in $global:WorkspaceButtons) {
            $b.Enabled = $hasSelection -and (-not $global:IsRunning)
        }
    }

    function script:Set-RunningState {
        param([bool]$Running)
        foreach ($b in $global:AllActionButtons) { $b.Enabled = -not $Running }
        $runRawButton.Enabled = -not $Running
        $cancelButton.Enabled = $Running
        Update-WorkspaceButtonsEnabled
        Update-RetkGuiSkillsStatus
    }

    function script:Invoke-GuiCommand {
        param([Parameter(Mandatory)] [string[]]$Arguments)

        if ($global:IsRunning) { return }
        $global:IsRunning = $true
        Set-RunningState $true
        $global:CommandStartedAt = [DateTime]::UtcNow
        $global:WasCancelled = $false
        $global:GuiStatusLabel.Text = "Running: $($Arguments -join ' ')"
        $global:GuiElapsedLabel.Text = "00:00:00"
        $global:GuiStatusProgressBar.Visible = $true

        $logBox.AppendText("`r`n> re.ps1 $($Arguments -join ' ')`r`n")

        $global:ExitHandled = $false
        $global:HasExitedSeenAt = $null
        # Register-ObjectEvent actions run through a separate PowerShell
        # event-subscriber session state. A scalar $global: assignment made
        # there is not the same variable later read by this UI Timer, even
        # when the callback is marshaled through Control.Invoke(). Use a
        # shared .NET synchronization object instead: its Signal()/IsSet
        # calls operate on the same object from both execution contexts.
        $eofSignal = New-Object System.Threading.CountdownEvent -ArgumentList 2
        $finalizeExit = {
            param($code)
            if ($global:ExitHandled) { return }
            $global:ExitHandled = $true
            Get-EventSubscriber | Where-Object { $_.SourceObject -eq $global:CurrentProcess } | Unregister-Event -ErrorAction SilentlyContinue
            $global:GuiLogBox.AppendText("[EXIT CODE $code]`r`n")
            $global:GuiStatusProgressBar.Visible = $false
            $global:GuiStatusLabel.Text = if ($global:WasCancelled) { "Cancelled" } else { "Done (exit $code)" }
            $global:CommandStartedAt = $null
            $global:IsRunning = $false
            $global:CurrentProcess = $null
            $global:HasExitedSeenAt = $null
            Set-RunningState $false
            Refresh-Workspaces
        }.GetNewClosure()

        $onOutput = {
            param($line)
            if ($null -eq $line) {
                [void]$eofSignal.Signal()
                return
            }
            $global:GuiForm.Invoke([Action]{
                $global:GuiLogBox.AppendText("$line`r`n")
            }) | Out-Null
        }.GetNewClosure()

        # Register-ObjectEvent's "Exited" action reliably does NOT fire while
        # this thread is blocked inside [System.Windows.Forms.Application]::Run()
        # (verified in isolation: OutputDataReceived fires fine there, Exited
        # never does). Keep OnExit wired to Invoke-RetkGuiCommand's contract,
        # but let the Timer own finalization so an early Exited notification
        # cannot append [EXIT CODE] before the two stream EOF signals.
        $onExit = {
            param($code)
            # The polling Timer is the only finalizer. The callback is kept as
            # a no-op because Process.HasExited plus both EOF signals is the
            # reliable completion condition in this WinForms message loop.
        }.GetNewClosure()

        try {
            $global:CurrentProcess = Invoke-RetkGuiCommand -Root $root -Arguments $Arguments -OnOutput $onOutput -OnExit $onExit
        }
        catch {
            $logBox.AppendText("[FAIL] $($_.Exception.Message)`r`n")
            $global:GuiStatusProgressBar.Visible = $false
            $global:GuiStatusLabel.Text = "Failed to start"
            $global:CommandStartedAt = $null
            $global:IsRunning = $false
            $global:CurrentProcess = $null
            Set-RunningState $false
            return
        }

        # If a stream's EOF sentinel never arrives (should be unreachable given
        # the documented OutputDataReceived/ErrorDataReceived contract, but this
        # branch has already spent 5 rounds fixing a permanent hang from exactly
        # this failure mode) fall back to finalizing a fixed grace period after
        # HasExited is first observed true, even without both EOF signals.
        $pollTimer = New-Object System.Windows.Forms.Timer
        $pollTimer.Interval = 250
        $pollTimer.Add_Tick({
            if ($null -eq $global:CurrentProcess) {
                $pollTimer.Stop()
                $pollTimer.Dispose()
                return
            }
            # Application.Run() pumps WinForms messages but does not pump
            # PowerShell's Register-ObjectEvent queue. Dispatch the queued
            # stream callbacks here before checking the completion latch.
            Get-Event -ErrorAction SilentlyContinue | Out-Null

            if ($null -ne $global:CommandStartedAt) {
                $elapsed = [DateTime]::UtcNow - $global:CommandStartedAt
                $global:GuiElapsedLabel.Text = Format-RetkGuiElapsed $elapsed
            }
            # HasExited can flip to true before the async
            # OutputDataReceived/ErrorDataReceived readers have delivered all
            # queued lines -- that's a different, unrelated signal from
            # "this stream is fully drained". The actual documented EOF
            # signal is OutputDataReceived/ErrorDataReceived firing once more
            # with Data -eq $null per stream; $onOutput signals the shared .NET
            # CountdownEvent when each sentinel arrives.
            # Gate finalization on HasExited AND both streams' EOF signals
            # having arrived (stdout, then stderr) so [EXIT CODE] is
            # genuinely the last line.
            if ($global:CurrentProcess.HasExited) {
                if ($null -eq $global:HasExitedSeenAt) { $global:HasExitedSeenAt = [DateTime]::UtcNow }
                $graceExpired = ([DateTime]::UtcNow - $global:HasExitedSeenAt).TotalSeconds -ge 5
                if ($eofSignal.IsSet -or $graceExpired) {
                    $code = $global:CurrentProcess.ExitCode
                    $pollTimer.Stop()
                    $pollTimer.Dispose()
                    & $finalizeExit $code
                }
            }
        }.GetNewClosure())
        $pollTimer.Start()
    }

    function script:Start-RetkGuiHealthCheck {
        # Runs 're.ps1 doctor' once at startup to populate the status-bar
        # health indicator. Deliberately independent of Invoke-GuiCommand's
        # single-command-at-a-time $global:CurrentProcess slot so it doesn't
        # disable the action buttons or spam the log while it runs. Still
        # needs its own EOF-signal/poll-timer pair for the same reason
        # Invoke-GuiCommand does: Register-ObjectEvent's "Exited" action does
        # not reliably fire inside Application::Run, and HasExited can flip
        # true before both streams finish delivering their queued lines.
        $healthLines = [System.Collections.ArrayList]::Synchronized((New-Object System.Collections.ArrayList))
        $eofSignal = New-Object System.Threading.CountdownEvent -ArgumentList 2

        $onOutput = {
            param($line)
            if ($null -eq $line) { [void]$eofSignal.Signal(); return }
            [void]$healthLines.Add($line)
        }.GetNewClosure()
        $onExit = { param($code) }.GetNewClosure()

        $healthProcess = $null
        try {
            $healthProcess = Invoke-RetkGuiCommand -Root $root -Arguments @('doctor') -OnOutput $onOutput -OnExit $onExit
        }
        catch {
            $global:GuiHealthLabel.Text = "Tools: check failed"
            $global:GuiHealthLabel.ForeColor = [System.Drawing.Color]::Firebrick
            $global:GuiHealthLabel.ToolTipText = $_.Exception.Message
            return
        }

        # A plain local reassigned inside this closure does not persist its
        # new value to the closure's NEXT invocation as a WinForms Tick
        # handler (confirmed by direct testing: it silently reset to $null
        # every tick, so the "seconds since first seen exited" grace check
        # never advanced past ~0 and finalization never fired). Route it
        # through $global: instead, mirroring Invoke-GuiCommand's
        # $global:HasExitedSeenAt for the identical reason.
        $global:GuiHealthExitedSeenAt = $null
        $healthTimer = New-Object System.Windows.Forms.Timer
        $healthTimer.Interval = 250
        $healthTimer.Add_Tick({
            Get-Event -ErrorAction SilentlyContinue | Out-Null
            if ($healthProcess.HasExited) {
                if ($null -eq $global:GuiHealthExitedSeenAt) { $global:GuiHealthExitedSeenAt = [DateTime]::UtcNow }
                $graceExpired = ([DateTime]::UtcNow - $global:GuiHealthExitedSeenAt).TotalSeconds -ge 5
                if ($eofSignal.IsSet -or $graceExpired) {
                    $healthTimer.Stop()
                    $healthTimer.Dispose()
                    Get-EventSubscriber | Where-Object { $_.SourceObject -eq $healthProcess } | Unregister-Event -ErrorAction SilentlyContinue

                    $lines = @($healthLines)
                    if (Test-RetkGuiDoctorHasIssues -Lines $lines) {
                        $global:GuiHealthLabel.Text = "Tools: issues found"
                        $global:GuiHealthLabel.ForeColor = [System.Drawing.Color]::Firebrick
                    }
                    else {
                        $global:GuiHealthLabel.Text = "Tools: OK"
                        $global:GuiHealthLabel.ForeColor = [System.Drawing.Color]::ForestGreen
                    }
                    $global:GuiHealthLabel.ToolTipText = if ($lines.Count -gt 0) { $lines -join "`r`n" } else { "No doctor output." }
                }
            }
        }.GetNewClosure())
        $healthTimer.Start()
    }

    # --- Setup group ---
    $setupGroup = New-RetkGuiGroup -Title "Setup"
    Add-RetkGuiButtonToGroup -Group $setupGroup -Text "Doctor" -OnClick { Invoke-GuiCommand -Arguments @('doctor') } | Out-Null

    # --- Skills group: harness detection + repo-local skill install ---
    $skillsGroup = New-RetkGuiGroup -Title "Skills"
    $skillsGroup.Height = 150

    $skillsStatusLabel = New-Object System.Windows.Forms.Label
    $skillsStatusLabel.Left = 10
    $skillsStatusLabel.Top = 18
    $skillsStatusLabel.Width = 500
    $skillsStatusLabel.Height = 54
    $skillsStatusLabel.Text = "Checking harnesses..."
    $skillsGroup.Controls.Add($skillsStatusLabel)

    $skillsButtonFlow = New-Object System.Windows.Forms.FlowLayoutPanel
    $skillsButtonFlow.Left = 6
    $skillsButtonFlow.Top = 76
    $skillsButtonFlow.AutoSize = $true
    $skillsButtonFlow.AutoSizeMode = "GrowAndShrink"
    $skillsButtonFlow.WrapContents = $true
    $skillsButtonFlow.MaximumSize = New-Object System.Drawing.Size(500, 0)
    $skillsButtonFlow.Width = 500
    $skillsGroup.Controls.Add($skillsButtonFlow)

    $RetkGuiSkillNames = @('retoolkit-install', 'retoolkit-flow', 'retoolkit-mcp-analysis')
    $harnessButtons = @{}

    # Direct top-level references to Start-RetkGui's own locals (no nested
    # .GetNewClosure()) work fine here, same as Invoke-GuiCommand's direct
    # $root/$logBox references -- global exposure is only needed for
    # variables read from INSIDE a .GetNewClosure()'d scriptblock nested
    # within a `function script:`-registered function.
    function script:Update-RetkGuiSkillsStatus {
        $harnesses = Get-RetkGuiHarnessInfo -HomeDir $HOME -CodexHome $env:CODEX_HOME
        $lines = New-Object System.Collections.Generic.List[string]
        foreach ($h in $harnesses) {
            $detected = Test-Path -LiteralPath $h.RootDir
            $installed = $detected -and (@($RetkGuiSkillNames | Where-Object { Test-Path -LiteralPath (Join-Path $h.SkillsDir $_) }).Count -eq $RetkGuiSkillNames.Count)
            $statusText = if (-not $detected) { "Not detected" } elseif ($installed) { "Installed" } else { "Not installed" }
            [void]$lines.Add("$($h.Name): $statusText")
            $button = $harnessButtons[$h.Name]
            if ($null -ne $button) { $button.Enabled = $detected -and (-not $global:IsRunning) }
        }
        $skillsStatusLabel.Text = $lines -join "`r`n"
    }

    foreach ($harnessName in @('Claude Code', 'Codex', 'OpenCode')) {
        $capturedName = $harnessName
        $harnessButton = New-Object System.Windows.Forms.Button
        $harnessButton.Text = "Install: $capturedName"
        $harnessButton.AutoSize = $false
        $harnessButton.Width = 160
        $harnessButton.Height = 28
        $harnessButton.Margin = New-Object System.Windows.Forms.Padding(3, 3, 3, 3)
        $harnessButton.Add_Click({
            $harnesses = Get-RetkGuiHarnessInfo -HomeDir $HOME -CodexHome $env:CODEX_HOME
            $target = $harnesses | Where-Object { $_.Name -eq $capturedName } | Select-Object -First 1
            if ($null -eq $target) { return }
            New-Item -ItemType Directory -Force -Path $target.SkillsDir | Out-Null
            foreach ($skillName in $RetkGuiSkillNames) {
                $src = Join-Path $root "skills\$skillName"
                $dst = Join-Path $target.SkillsDir $skillName
                Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
                $logBox.AppendText("[SKILLS] $capturedName <- $skillName`r`n")
            }
            Update-RetkGuiSkillsStatus
        }.GetNewClosure())
        $skillsButtonFlow.Controls.Add($harnessButton)
        [void]$global:AllActionButtons.Add($harnessButton)
        $harnessButtons[$harnessName] = $harnessButton
    }

    # --- New workspace group (step 2): combo + Refresh + New workspace ---
    $workspaceStepGroup = New-RetkGuiGroup -Title "New workspace"
    $workspaceStepGroup.Height = 90
    $workspaceCombo.Left = 15; $workspaceCombo.Top = 28; $workspaceCombo.Width = 320
    $refreshButton.Left = 345; $refreshButton.Top = 26
    $initButton.Left = 430; $initButton.Top = 26
    $workspaceStepGroup.Controls.AddRange(@($workspaceCombo, $refreshButton, $initButton))

    # --- Prepare Build: "Automatic" (Flow, prominent) + "Manual" (Add/Scan/Dump) ---
    $flowGroup = New-RetkGuiGroup -Title "Automatic (recommended)"
    $flowGroup.Height = 90
    $flowButton = New-Object System.Windows.Forms.Button
    $flowButton.Text = "Flow: prepare + open Ghidra"
    $flowButton.Left = 15; $flowButton.Top = 25; $flowButton.Width = 380; $flowButton.Height = 44
    $flowButton.Font = New-Object System.Drawing.Font($flowButton.Font.FontFamily, 10, [System.Drawing.FontStyle]::Bold)
    $flowButton.Add_Click({
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $path = Show-RetkGuiPathPromptDialog -Title "Flow source (APK/XAPK/AAB or extracted folder)"
        if ($null -eq $path) { return }
        Invoke-GuiCommand -Arguments @('flow', $gameName, $path)
    }.GetNewClosure())
    $flowGroup.Controls.Add($flowButton)
    [void]$global:AllActionButtons.Add($flowButton)
    [void]$global:WorkspaceButtons.Add($flowButton)

    $manualGroup = New-RetkGuiGroup -Title "Manual (step by step)"
    Add-RetkGuiButtonToGroup -Group $manualGroup -Text "Add build" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $dlg = New-Object System.Windows.Forms.OpenFileDialog
        $dlg.Filter = "Android build (*.apk;*.xapk;*.aab;*.zip)|*.apk;*.xapk;*.aab;*.zip|All files (*.*)|*.*"
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Invoke-GuiCommand -Arguments @('add', $gameName, $dlg.FileName)
        }
    }.GetNewClosure() | Out-Null
    Add-RetkGuiButtonToGroup -Group $manualGroup -Text "Scan" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = "Select the extracted build folder"
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Invoke-GuiCommand -Arguments @('scan', $gameName, $dlg.SelectedPath)
        }
    }.GetNewClosure() | Out-Null
    Add-RetkGuiButtonToGroup -Group $manualGroup -Text "Dump" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        Invoke-GuiCommand -Arguments @('dump', $gameName)
    }.GetNewClosure() | Out-Null

    # --- Ghidra group ---
    $ghidraGroup = New-RetkGuiGroup -Title "Ghidra"
    foreach ($spec in @(
        @{ Label = "Open (PyGhidra)"; Verb = 'open' },
        @{ Label = "Ghidra GUI"; Verb = 'ghidra-gui' },
        @{ Label = "Analyze"; Verb = 'analyze' },
        @{ Label = "Symbols"; Verb = 'symbols' }
    )) {
        $verb = $spec.Verb
        Add-RetkGuiButtonToGroup -Group $ghidraGroup -Text $spec.Label -RequiresWorkspace -OnClick {
            $gameName = Get-SelectedGameName
            if ($null -eq $gameName) { return }
            Invoke-GuiCommand -Arguments @($verb, $gameName)
        }.GetNewClosure() | Out-Null
    }

    # --- Workspace group ---
    $workspaceGroup = New-RetkGuiGroup -Title "Workspace"
    foreach ($spec in @(
        @{ Label = "Status"; Verb = 'status' },
        @{ Label = "Notes"; Verb = 'notes' },
        @{ Label = "Candidates"; Verb = 'candidates' },
        @{ Label = "Context"; Verb = 'context' },
        @{ Label = "Summary"; Verb = 'summary' }
    )) {
        $verb = $spec.Verb
        Add-RetkGuiButtonToGroup -Group $workspaceGroup -Text $spec.Label -RequiresWorkspace -OnClick {
            $gameName = Get-SelectedGameName
            if ($null -eq $gameName) { return }
            Invoke-GuiCommand -Arguments @($verb, $gameName)
        }.GetNewClosure() | Out-Null
    }
    Add-RetkGuiButtonToGroup -Group $workspaceGroup -Text "Export" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $dlg = New-Object System.Windows.Forms.SaveFileDialog
        $dlg.Filter = "REToolkit archive (*.re)|*.re"
        $dlg.FileName = "$gameName.re"
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Invoke-GuiCommand -Arguments @('export', $gameName, $dlg.FileName)
        }
    }.GetNewClosure() | Out-Null
    Add-RetkGuiButtonToGroup -Group $workspaceGroup -Text "Import" -OnClick {
        $dlg = New-Object System.Windows.Forms.OpenFileDialog
        $dlg.Filter = "REToolkit archive (*.re;*.zip)|*.re;*.zip|All files (*.*)|*.*"
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Invoke-GuiCommand -Arguments @('import', $dlg.FileName)
        }
    }.GetNewClosure() | Out-Null

    # --- Extras group ---
    $extrasGroup = New-RetkGuiGroup -Title "Extras"
    Add-RetkGuiButtonToGroup -Group $extrasGroup -Text "AssetRipper CLI" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        Invoke-GuiCommand -Arguments @('assetripper-cli', $gameName)
    }.GetNewClosure() | Out-Null
    Add-RetkGuiButtonToGroup -Group $extrasGroup -Text "Pull LDPlayer" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $packageName = [Microsoft.VisualBasic.Interaction]::InputBox("Android package name:", "Pull from LDPlayer", "")
        if ([string]::IsNullOrWhiteSpace($packageName)) { return }
        Invoke-GuiCommand -Arguments @('pull-ldplayer', $gameName, $packageName)
    }.GetNewClosure() | Out-Null

    # --- Step rail (left, fixed width) + step content (right, one visible at a time) ---
    $stepRailPanel = New-Object System.Windows.Forms.Panel
    $stepRailPanel.Dock = "Left"
    $stepRailPanel.Width = 150

    $stepContentContainer = New-Object System.Windows.Forms.Panel
    $stepContentContainer.Dock = "Fill"

    $stepTitles = @{ 1 = "Setup"; 2 = "New workspace"; 3 = "Prepare Build"; 4 = "Ghidra"; 5 = "More" }
    $stepRailButtons = @{}
    $stepPanels = @{}
    $stepFlows = @{}

    $railTop = 10
    for ($i = 1; $i -le 5; $i++) {
        $railButton = New-Object System.Windows.Forms.Button
        $railButton.Left = 5; $railButton.Top = $railTop; $railButton.Width = 140; $railButton.Height = 40
        $railButton.TextAlign = [System.Drawing.ContentAlignment]::MiddleLeft
        $railButton.Text = "$i. $($stepTitles[$i])"
        $stepRailPanel.Controls.Add($railButton)
        $stepRailButtons[$i] = $railButton
        $railTop += 46

        $stepPanel = New-Object System.Windows.Forms.Panel
        $stepPanel.Dock = "Fill"
        $stepPanel.Visible = $false
        $stepFlow = New-Object System.Windows.Forms.FlowLayoutPanel
        $stepFlow.Dock = "Fill"
        $stepFlow.FlowDirection = "TopDown"
        $stepFlow.WrapContents = $false
        $stepFlow.AutoScroll = $true
        $stepPanel.Controls.Add($stepFlow)
        $stepContentContainer.Controls.Add($stepPanel)
        $stepPanels[$i] = $stepPanel
        $stepFlows[$i] = $stepFlow
    }

    $stepFlows[1].Controls.AddRange(@($setupGroup, $skillsGroup))
    $stepFlows[2].Controls.Add($workspaceStepGroup)
    $stepFlows[3].Controls.AddRange(@($flowGroup, $manualGroup))
    $stepFlows[4].Controls.Add($ghidraGroup)
    $stepFlows[5].Controls.AddRange(@($workspaceGroup, $extrasGroup))

    function script:Show-RetkGuiWizardStep {
        param([Parameter(Mandatory)] [int]$StepIndex)
        for ($i = 1; $i -le 5; $i++) { $stepPanels[$i].Visible = ($i -eq $StepIndex) }
    }

    for ($i = 1; $i -le 5; $i++) {
        $capturedStepIndex = $i
        $stepRailButtons[$i].Add_Click({ Show-RetkGuiWizardStep -StepIndex $capturedStepIndex }.GetNewClosure())
    }

    # --- Split container: resizable divide between actions and log ---
    $splitContainer = New-Object System.Windows.Forms.SplitContainer
    # SplitContainer starts at a small designer-default size until Dock=Fill
    # is resolved by the layout engine. Setting Panel1MinSize/Panel2MinSize
    # before it has a real size throws ("SplitterDistance must be between
    # Panel1MinSize and Width - Panel2MinSize") because the constraint is
    # checked against that tiny default width. Give it an explicit size that
    # comfortably satisfies the constraint before setting the min sizes.
    $splitContainer.Width = $form.Width
    $splitContainer.Height = $form.Height
    $splitContainer.Orientation = "Vertical"
    $splitContainer.Panel1MinSize = 380
    $splitContainer.Panel2MinSize = 300
    $splitContainer.SplitterWidth = 6
    $splitContainer.Dock = "Fill"
    # Left-docked control added before the Fill one so the rail reserves its
    # 150px and the content container gets the remainder.
    $splitContainer.Panel1.Controls.Add($stepRailPanel)
    $splitContainer.Panel1.Controls.Add($stepContentContainer)
    $splitContainer.Panel2.Controls.Add($rightPanel)
    $splitContainer.SplitterDistance = 700

    # --- Top bar handlers ---
    $refreshButton.Add_Click({ Refresh-Workspaces }.GetNewClosure())
    $workspaceCombo.Add_SelectedIndexChanged({ Update-WorkspaceButtonsEnabled }.GetNewClosure())
    $initButton.Add_Click({
        $name = [Microsoft.VisualBasic.Interaction]::InputBox("Workspace name (GameName):", "New workspace", "")
        if ([string]::IsNullOrWhiteSpace($name)) { return }
        Invoke-GuiCommand -Arguments @('init', $name)
    }.GetNewClosure())
    $openFolderButton.Add_Click({
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $path = Join-Path $workspacesDir $gameName
        Start-Process -FilePath "explorer.exe" -ArgumentList (Join-NativeArgumentString @($path))
    }.GetNewClosure())

    # --- Log panel handlers ---
    $clearLogButton.Add_Click({ $logBox.Clear() }.GetNewClosure())
    $cancelButton.Add_Click({
        if ($null -ne $global:CurrentProcess -and -not $global:CurrentProcess.HasExited) {
            $global:WasCancelled = $true
            # Process.Kill(bool entireProcessTree) is a .NET Core/.NET 5+-only
            # overload; it does not exist on classic .NET Framework, which is
            # what Windows PowerShell 5.1 (this toolkit's target platform, per
            # CLAUDE.md) runs on. Calling it there throws
            # "Cannot find an overload for 'Kill' and the argument count: '1'"
            # (confirmed via a live crash dialog). taskkill /T /F is the
            # PS5.1-compatible way to kill a process tree; Process.Kill()
            # (no args) stays as a same-process fallback in case taskkill
            # itself is unavailable.
            try {
                & taskkill.exe /T /F /PID $global:CurrentProcess.Id 2>&1 | Out-Null
            } catch {}
            if (-not $global:CurrentProcess.HasExited) {
                try { $global:CurrentProcess.Kill() } catch {}
            }
            $logBox.AppendText("[CANCELLED]`r`n")
        }
    }.GetNewClosure())

    # --- Raw command handler ---
    $runRawButton.Add_Click({
        $parsedArgs = Split-RetkGuiCommandLine -Text $rawCommandBox.Text
        if ($parsedArgs.Count -eq 0) { return }
        Invoke-GuiCommand -Arguments $parsedArgs
    }.GetNewClosure())

    # Among same-edge Dock controls, WinForms places the LAST-added control
    # closest to the parent edge. Add bottomPanel before statusStrip so the
    # status bar ends up flush against the window's bottom edge (the usual
    # desktop convention), with the raw-command bar sitting just above it.
    $form.Controls.Add($splitContainer)
    $form.Controls.Add($topPanel)
    $form.Controls.Add($bottomPanel)
    $form.Controls.Add($statusStrip)

    $form.Add_Shown({ Refresh-Workspaces; Start-RetkGuiHealthCheck; Update-RetkGuiSkillsStatus; Show-RetkGuiWizardStep -StepIndex 1 }.GetNewClosure())

    [System.Windows.Forms.Application]::Run($form)
}

if ($MyInvocation.InvocationName -ne '.') {
    Start-RetkGui
}
