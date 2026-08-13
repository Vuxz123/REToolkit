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

function Start-RetkGui {
    # Filled in by Task 4.
}

if ($MyInvocation.InvocationName -ne '.') {
    Start-RetkGui
}
