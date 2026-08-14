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
    $global:AllActionButtons = New-Object System.Collections.Generic.List[System.Windows.Forms.Button]
    $global:WorkspaceButtons = New-Object System.Collections.Generic.List[System.Windows.Forms.Button]

    $form = New-Object System.Windows.Forms.Form
    $global:GuiForm = $form
    $form.Text = "REToolkit GUI"
    $form.Width = 1100
    $form.Height = 720
    $form.StartPosition = "CenterScreen"

    # --- Top bar: workspace selector ---
    $topPanel = New-Object System.Windows.Forms.Panel
    $topPanel.Dock = "Top"
    $topPanel.Height = 40

    $workspaceCombo = New-Object System.Windows.Forms.ComboBox
    $workspaceCombo.Left = 10; $workspaceCombo.Top = 8; $workspaceCombo.Width = 300
    $workspaceCombo.DropDownStyle = "DropDownList"

    $refreshButton = New-Object System.Windows.Forms.Button
    $refreshButton.Text = "Refresh"
    $refreshButton.Left = 320; $refreshButton.Top = 6

    $initButton = New-Object System.Windows.Forms.Button
    $initButton.Text = "New workspace"
    $initButton.Left = 405; $initButton.Top = 6
    $initButton.AutoSize = $true

    $openFolderButton = New-Object System.Windows.Forms.Button
    $openFolderButton.Text = "Open folder"
    $openFolderButton.Left = 530; $openFolderButton.Top = 6
    $openFolderButton.AutoSize = $true

    $topPanel.Controls.AddRange(@($workspaceCombo, $refreshButton, $initButton, $openFolderButton))

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

    # --- Right panel: log + controls ---
    $rightPanel = New-Object System.Windows.Forms.Panel
    $rightPanel.Dock = "Right"
    $rightPanel.Width = 560

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

    # --- Left panel: action groups ---
    $leftPanel = New-Object System.Windows.Forms.FlowLayoutPanel
    $leftPanel.Dock = "Fill"
    $leftPanel.FlowDirection = "TopDown"
    $leftPanel.WrapContents = $false
    $leftPanel.AutoScroll = $true

    function New-RetkGuiGroup {
        param([Parameter(Mandatory)] [string]$Title)
        $group = New-Object System.Windows.Forms.GroupBox
        $group.Text = $Title
        $group.Width = 500
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
            $flow.MaximumSize = New-Object System.Drawing.Size(480, 0)
            $flow.Width = 480
            $flow.Left = 6
            $flow.Top = 18
            $Group.Controls.Add($flow)
        }
        $button = New-Object System.Windows.Forms.Button
        $button.Text = $Text
        $button.AutoSize = $true
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
    }

    function script:Invoke-GuiCommand {
        param([Parameter(Mandatory)] [string[]]$Arguments)

        if ($global:IsRunning) { return }
        $global:IsRunning = $true
        Set-RunningState $true

        $logBox.AppendText("`r`n> re.ps1 $($Arguments -join ' ')`r`n")

        $global:ExitHandled = $false
        $global:StreamEofCount = 0
        $finalizeExit = {
            param($code)
            if ($global:ExitHandled) { return }
            $global:ExitHandled = $true
            $global:GuiLogBox.AppendText("[EXIT CODE $code]`r`n")
            $global:IsRunning = $false
            $global:CurrentProcess = $null
            Set-RunningState $false
            Refresh-Workspaces
        }.GetNewClosure()

        $onOutput = {
            param($line)
            $global:GuiForm.Invoke([Action]{
                if ($null -eq $line) {
                    $global:StreamEofCount++
                }
                else {
                    $global:GuiLogBox.AppendText("$line`r`n")
                }
            }) | Out-Null
        }.GetNewClosure()

        # Register-ObjectEvent's "Exited" action reliably does NOT fire while
        # this thread is blocked inside [System.Windows.Forms.Application]::Run()
        # (verified in isolation: OutputDataReceived fires fine there, Exited
        # never does). Keep OnExit wired to Invoke-RetkGuiCommand's contract in
        # case it ever does fire, but treat a Timer polling HasExited as the
        # real completion signal; $finalizeExit's $global:ExitHandled guard
        # makes it safe for either path to win the race.
        $onExit = {
            param($code)
            $global:GuiForm.Invoke([Action]{ & $finalizeExit $code }) | Out-Null
        }.GetNewClosure()

        $global:CurrentProcess = Invoke-RetkGuiCommand -Root $root -Arguments $Arguments -OnOutput $onOutput -OnExit $onExit

        $pollTimer = New-Object System.Windows.Forms.Timer
        $pollTimer.Interval = 250
        $pollTimer.Add_Tick({
            if ($null -eq $global:CurrentProcess) {
                $pollTimer.Stop()
                $pollTimer.Dispose()
                return
            }
            # HasExited can flip to true before the async
            # OutputDataReceived/ErrorDataReceived readers have delivered all
            # queued lines -- that's a different, unrelated signal from
            # "this stream is fully drained". The actual documented EOF
            # signal is OutputDataReceived/ErrorDataReceived firing once more
            # with Data -eq $null per stream; $onOutput passes that straight
            # through and bumps $global:StreamEofCount from inside the same
            # $global:GuiForm.Invoke() callback that already reliably
            # delivers real output lines to the log (a shared-object
            # -MessageData approach was tried first and confirmed NOT to
            # work: mutations made inside a Register-ObjectEvent action are
            # not reliably visible from a read of the same object elsewhere).
            # Gate finalization on HasExited AND both streams' EOF signals
            # having arrived (stdout, then stderr) so [EXIT CODE] is
            # genuinely the last line.
            if ($global:CurrentProcess.HasExited -and $global:StreamEofCount -ge 2) {
                $global:CurrentProcess.WaitForExit()
                $code = $global:CurrentProcess.ExitCode
                $pollTimer.Stop()
                $pollTimer.Dispose()
                & $finalizeExit $code
            }
        }.GetNewClosure())
        $pollTimer.Start()
    }

    # --- Setup group ---
    $setupGroup = New-RetkGuiGroup -Title "Setup"
    Add-RetkGuiButtonToGroup -Group $setupGroup -Text "Doctor" -OnClick { Invoke-GuiCommand -Arguments @('doctor') } | Out-Null

    # --- Pipeline group ---
    $pipelineGroup = New-RetkGuiGroup -Title "Pipeline"
    Add-RetkGuiButtonToGroup -Group $pipelineGroup -Text "Add build" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $dlg = New-Object System.Windows.Forms.OpenFileDialog
        $dlg.Filter = "Android build (*.apk;*.xapk;*.aab;*.zip)|*.apk;*.xapk;*.aab;*.zip|All files (*.*)|*.*"
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Invoke-GuiCommand -Arguments @('add', $gameName, $dlg.FileName)
        }
    }.GetNewClosure() | Out-Null
    Add-RetkGuiButtonToGroup -Group $pipelineGroup -Text "Scan" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = "Select the extracted build folder"
        if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            Invoke-GuiCommand -Arguments @('scan', $gameName, $dlg.SelectedPath)
        }
    }.GetNewClosure() | Out-Null
    Add-RetkGuiButtonToGroup -Group $pipelineGroup -Text "Dump" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        Invoke-GuiCommand -Arguments @('dump', $gameName)
    }.GetNewClosure() | Out-Null
    Add-RetkGuiButtonToGroup -Group $pipelineGroup -Text "Flow" -RequiresWorkspace -OnClick {
        $gameName = Get-SelectedGameName
        if ($null -eq $gameName) { return }
        $path = Show-RetkGuiPathPromptDialog -Title "Flow source (APK/XAPK/AAB or extracted folder)"
        if ($null -eq $path) { return }
        Invoke-GuiCommand -Arguments @('flow', $gameName, $path)
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

    $leftPanel.Controls.AddRange(@($setupGroup, $pipelineGroup, $ghidraGroup, $workspaceGroup, $extrasGroup))

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

    $form.Controls.Add($leftPanel)
    $form.Controls.Add($rightPanel)
    $form.Controls.Add($topPanel)
    $form.Controls.Add($bottomPanel)

    $form.Add_Shown({ Refresh-Workspaces }.GetNewClosure())

    [System.Windows.Forms.Application]::Run($form)
}

if ($MyInvocation.InvocationName -ne '.') {
    Start-RetkGui
}
