# Dot-sourced by re.ps1. Uses shared REToolkit variables from the entrypoint.

function Assert-PathExists {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$Name,
        [switch]$Directory
    )

    $ok = if ($Directory) {
        Test-Path -LiteralPath $Path -PathType Container
    } else {
        Test-Path -LiteralPath $Path
    }

    if (-not $ok) {
        $hint = switch -Regex ($Name) {
            "JDK 21"       { "Run local JDK installer, then ensure runtime\java\jdk-21\bin\java.exe exists." }
            "Python"       { "Run .\install-re-toolkit.ps1 -InstallRuntime, then ensure runtime\python\python-3.12\python.exe exists." }
            "Ghidra MCP"   { "Run .\install-re-toolkit.ps1 -InstallGhidraMcp." }
            "Ghidra GUI"   { "Install Ghidra into tools\ghidra." }
            "PyGhidra"     { "Check tools\ghidra\Ghidra\Features\PyGhidra\pypkg\dist." }
            "Headless"     { "Check tools\ghidra\support\analyzeHeadless.bat." }
            "Il2CppDumper" { "Install Il2CppDumper into tools\Il2CppDumper\Il2CppDumper.exe." }
            default         { "" }
        }
        throw "[FAIL] $Name not found: $Path`n$hint"
    }
}

function Invoke-WithToolkitEnv {
    param([Parameter(Mandatory)] [scriptblock]$ScriptBlock)

    $oldJavaHome          = $env:JAVA_HOME
    $oldJavaHomeOverride  = $env:JAVA_HOME_OVERRIDE
    $oldGhidraInstallDir  = $env:GHIDRA_INSTALL_DIR
    $oldPyGhidraPython    = $env:PYGHIDRA_PYTHON
    $oldPythonNoUserSite  = $env:PYTHONNOUSERSITE
    $oldPythonPath        = $env:PYTHONPATH
    $oldPath              = $env:Path

    try {
        # Do not permanently override the user's Java setup.
        # JAVA_HOME_OVERRIDE is what Ghidra launchers prefer.
        $env:JAVA_HOME_OVERRIDE = $ToolPaths.JdkRoot
        $env:GHIDRA_INSTALL_DIR = $ToolPaths.GhidraRoot
        if (Test-Path -LiteralPath $ToolPaths.PythonExe) {
            $selectedPython = if (Test-Path -LiteralPath $ToolPaths.PyGhidraPython) { $ToolPaths.PyGhidraPython } else { $ToolPaths.PythonExe }
            $env:PYGHIDRA_PYTHON = $selectedPython
            $env:PYTHONNOUSERSITE = "1"
            $env:PYTHONPATH = ""
            $env:Path = "$($ToolPaths.PyGhidraVenv)\Scripts;$($ToolPaths.PythonRoot);$($ToolPaths.PythonRoot)\Scripts;$($ToolPaths.JdkRoot)\bin;$oldPath"
        }
        else {
            $env:Path = "$($ToolPaths.JdkRoot)\bin;$oldPath"
        }

        # Important: return/emit the scriptblock result to the caller.
        # Without this, assignments inside the scriptblock can stay in a child scope,
        # leaving caller variables like $result as $null.
        & $ScriptBlock
    }
    finally {
        $env:JAVA_HOME          = $oldJavaHome
        $env:JAVA_HOME_OVERRIDE = $oldJavaHomeOverride
        $env:GHIDRA_INSTALL_DIR = $oldGhidraInstallDir
        $env:PYGHIDRA_PYTHON    = $oldPyGhidraPython
        $env:PYTHONNOUSERSITE   = $oldPythonNoUserSite
        $env:PYTHONPATH         = $oldPythonPath
        $env:Path               = $oldPath
    }
}

function Join-NativeArgumentString {
    param([Parameter()] [string[]]$Arguments)

    if ($null -eq $Arguments) { return "" }

    $quoted = New-Object System.Collections.Generic.List[string]
    foreach ($arg in $Arguments) {
        if ($null -eq $arg) {
            [void]$quoted.Add('""')
            continue
        }

        $s = [string]$arg

        # Windows PowerShell 5.1 compatibility:
        # ProcessStartInfo.ArgumentList is not reliable/available there, so we build
        # ProcessStartInfo.Arguments manually. Quote every argument to preserve paths
        # with spaces and options exactly enough for this toolkit use case.
        $s = $s.Replace('"', '\"')
        [void]$quoted.Add('"' + $s + '"')
    }

    return ($quoted -join ' ')
}
