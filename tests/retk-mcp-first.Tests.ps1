[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

function Read-Text {
    param([Parameter(Mandatory)] [string]$RelativePath)
    return Get-Content -LiteralPath (Join-Path $Root $RelativePath) -Raw
}

function Assert-Contains {
    param(
        [Parameter(Mandatory)] [string]$Text,
        [Parameter(Mandatory)] [string]$Needle,
        [Parameter(Mandatory)] [string]$Message
    )

    if (-not $Text.Contains($Needle)) {
        throw "ASSERT CONTAINS failed: $Message`nMissing: $Needle"
    }
}

function Assert-NotContains {
    param(
        [Parameter(Mandatory)] [string]$Text,
        [Parameter(Mandatory)] [string]$Needle,
        [Parameter(Mandatory)] [string]$Message
    )

    if ($Text.Contains($Needle)) {
        throw "ASSERT NOT CONTAINS failed: $Message`nUnexpected: $Needle"
    }
}

$re = Read-Text "re.ps1"
$installer = Read-Text "install-re-toolkit.ps1"
$scriptBundleHelper = Read-Text "scripts\ghidra-script-bundle.ps1"
$preferencesHelper = Read-Text "scripts\ghidra-preferences.ps1"
$coreModule = Read-Text "scripts\retk-core.ps1"
$processModule = Read-Text "scripts\retk-process.ps1"
$pyghidraModule = Read-Text "scripts\retk-pyghidra.ps1"
$il2cppModule = Read-Text "scripts\retk-il2cpp.ps1"
$projectModule = Read-Text "scripts\retk-project.ps1"
$pipelineModule = Read-Text "scripts\retk-pipeline.ps1"
$uiModule = Read-Text "scripts\retk-ui.ps1"
$ghidraWrapper = Read-Text "run-ghidra.ps1"
$pyghidraWrapper = Read-Text "run-pyghidra.ps1"
$readme = Read-Text "README.md"
$tutorial = Read-Text "Tutorial.md"
$promptInstallGhidraSkill = Read-Text "prompts\install-ghidra-skill.md"
$config = Read-Text "config\opencode-ghidra-mcp.example.json"
$templateGhidraPy = Read-Text "templates\Il2CppDumper\ghidra.py"
$templateGhidraWithStructPy = Read-Text "templates\Il2CppDumper\ghidra_with_struct.py"
$templateGhidraPreferences = Read-Text "templates\Ghidra\preferences"
$templateGhidraCodeBrowser = Read-Text "templates\Ghidra\_code_browser.tcd"
$il2cppGhidraPyPath = Join-Path $Root "tools\Il2CppDumper\ghidra.py"
$il2cppGhidraPy = if (Test-Path -LiteralPath $il2cppGhidraPyPath) { Get-Content -LiteralPath $il2cppGhidraPyPath -Raw } else { "" }
$il2cppGhidraWithStructPyPath = Join-Path $Root "tools\Il2CppDumper\ghidra_with_struct.py"
$il2cppGhidraWithStructPy = if (Test-Path -LiteralPath $il2cppGhidraWithStructPyPath) { Get-Content -LiteralPath $il2cppGhidraWithStructPyPath -Raw } else { "" }

Assert-Contains $re '"summary"' "re.ps1 should route old query commands to MCP guidance."
Assert-Contains $re 'Show-McpFirstQueryMessage' "re.ps1 should call MCP guidance for legacy query commands."
Assert-Contains $pipelineModule "function Show-McpFirstQueryMessage" "pipeline module should route old query commands to MCP guidance."
Assert-Contains $pipelineModule "Ghidra CLI commands are disabled in this MCP-first toolkit." "pipeline module should disable ghidra-cli passthroughs."
Assert-Contains $uiModule 'Tools > GhidraMCP > Start MCP Server' "UI module should tell users how to start the GUI MCP server."
foreach ($module in @(
    'scripts\retk-core.ps1',
    'scripts\retk-process.ps1',
    'scripts\retk-pyghidra.ps1',
    'scripts\retk-il2cpp.ps1',
    'scripts\retk-project.ps1',
    'scripts\retk-pipeline.ps1',
    'scripts\retk-ui.ps1'
)) {
    Assert-Contains $re $module "re.ps1 should dot-source $module instead of carrying all implementation code inline."
}
Assert-NotContains $re 'function Invoke-PyGhidraGui' "re.ps1 should keep PyGhidra implementation in scripts\retk-pyghidra.ps1."
Assert-NotContains $re 'function Run-Il2CppDumper' "re.ps1 should keep pipeline implementation in scripts\retk-pipeline.ps1."
Assert-NotContains $re 'function Scan-UnityIl2Cpp' "re.ps1 should keep project scanning implementation in scripts\retk-project.ps1."
Assert-NotContains $re 'function Show-Usage' "re.ps1 should keep UI implementation in scripts\retk-ui.ps1."
Assert-Contains $re 'PythonRoot' "re.ps1 should know the toolkit-local Python root."
Assert-Contains $re 'PythonExe' "re.ps1 should know the toolkit-local Python executable."
Assert-Contains $re 'AssetRipper      = Join-Path $Tools "AssetRipper\AssetRipper.exe"' "re.ps1 should know the AssetRipper executable path."
Assert-Contains $re '"assetripper"' "re.ps1 should expose an AssetRipper launcher command."
Assert-Contains $re 'Start-DetachedGuiProcess -FilePath $ToolPaths.AssetRipper' "re.ps1 should launch AssetRipper as a visible detached GUI process."
Assert-Contains $re 'Invoke-PyGhidraGui -Arguments $guiArgs' "re.ps1 should launch PyGhidra through the module helper after consuming an optional project name."
Assert-Contains $pyghidraModule 'function Invoke-PyGhidraGui' "PyGhidra module should launch PyGhidra through a local-Python helper."
Assert-Contains $pyghidraModule 'function Ensure-PyGhidraPackage' "PyGhidra module should install the PyGhidra package into the local venv before launch."
Assert-Contains $processModule 'function Start-DetachedNativeProcess' "process module should expose a detached native process launcher for GUI handoff."
Assert-Contains $processModule 'function Start-DetachedGuiProcess' "process module should expose a visible detached GUI launcher."
Assert-Contains $pyghidraModule 'Start-DetachedNativeProcess -FilePath $pyGhidraPython' "PyGhidra module should start the GUI detached so the caller process returns."
Assert-Contains $pyghidraModule 'pyghidra-gui-' "PyGhidra module should redirect detached GUI logs to timestamped log files."
Assert-Contains $pyghidraModule 'PyGhidra GUI started in detached mode' "PyGhidra module should tell agents that GUI launch has been handed off."
Assert-NotContains $pyghidraModule '& $pyGhidraPython @launchArgs' "PyGhidra module should not attach PyGhidra logs to the main wrapper process by default."
Assert-Contains $pyghidraModule '-m' "PyGhidra module should launch PyGhidra through the foreground module entrypoint."
Assert-Contains $pyghidraModule 'pyghidra' "PyGhidra module should launch the pyghidra module directly."
Assert-Contains $pyghidraModule '--install-dir' "PyGhidra module should pass Ghidra install dir to the direct PyGhidra launch."
Assert-Contains $coreModule 'PYGHIDRA_PYTHON' "core module should expose the selected local Python to child processes."
Assert-Contains $pyghidraModule 'PackageNotFoundError' "PyGhidra module should treat missing PyGhidra as install-needed, not as a fatal probe error."
Assert-Contains $il2cppModule 'templates\Il2CppDumper' "Il2Cpp module should use visible Il2CppDumper Ghidra template files."
Assert-Contains $il2cppModule 'ghidra_with_struct.py' "Il2Cpp module should repair/copy ghidra_with_struct.py as well as ghidra.py."
Assert-Contains $il2cppModule 'function Repair-Il2CppGhidraScript' "Il2Cpp module should repair Il2CppDumper ghidra.py for PyGhidra."
Assert-Contains $pipelineModule 'Repair-Il2CppGhidraScript -Path $ghidraPy' "pipeline module should repair generated project ghidra.py after dump/copy."
Assert-Contains $re 'scripts\ghidra-script-bundle.ps1' "re.ps1 should load the Ghidra Script Bundle helper."
Assert-Contains $re 'scripts\ghidra-preferences.ps1' "re.ps1 should load the Ghidra preferences helper."
Assert-Contains $re 'Set-GhidraDefaultProjectForGame -GameName $guiArgs[0]' "re.ps1 should set the Ghidra default project when ghidra-gui/pyghidra-gui receives a project name."
Assert-Contains $re '"export"' "re.ps1 should expose workspace archive export."
Assert-Contains $re 'Export-WorkspaceArchive -GameName $Rest[0]' "re.ps1 should route export to the workspace archive helper."
Assert-Contains $re 'Import-WorkspaceArchive -ArchivePath $first' "re.ps1 should route .re import to the workspace archive helper."
Assert-Contains $re 'Ensure-Il2CppDumperGhidraScriptBundle | Out-Null' "re.ps1 should invoke Script Bundle registration from GUI wrappers."
Assert-Contains $il2cppModule 'function Ensure-Il2CppDumperGhidraScriptBundle' "Il2Cpp module should auto-register the Il2CppDumper Script Bundle before GUI launch."
Assert-Contains $il2cppModule 'Test-Path -LiteralPath $ToolPaths.Dumper -PathType Leaf' "Il2Cpp module should only auto-register the Il2CppDumper Script Bundle when Il2CppDumper is installed."
Assert-NotContains $re '$ToolPaths.PyGhidraLauncher $ToolPaths.GhidraRoot' "re.ps1 should not launch through pyghidra_launcher.py because it hides child-process errors."
Assert-NotContains $re 'Write-Host "  .\re.ps1 ghidra-cli <args...>"' "help should not advertise ghidra-cli."
Assert-NotContains $re 'Ghidra CLI doctor:' "doctor should not call ghidra-cli."
Assert-Contains $re 'scripts\retk-ldplayer.ps1' "re.ps1 should load the LDPlayer pull module."
Assert-Contains $re '"pull-ldplayer"' "re.ps1 should expose a pull-ldplayer command."
Assert-Contains $re 'Invoke-LdPlayerPull -GameName $gameName -PackageName $packageName' "re.ps1 pull-ldplayer should call Invoke-LdPlayerPull with parsed arguments."
Assert-Contains $uiModule 'pull-ldplayer <GameName> <PackageName>' "UI module should document the pull-ldplayer command."
Assert-Contains $re '"assetripper-cli"' "re.ps1 should expose an assetripper-cli command."
Assert-Contains $re 'Invoke-AssetRipperCliPipeline -GameName $Rest[0]' "re.ps1 assetripper-cli should call Invoke-AssetRipperCliPipeline with the parsed game name."
Assert-Contains $uiModule 'assetripper-cli <GameName>' "UI module should document the headless AssetRipper CLI command."


# Installer behavior is exercised with fake Node commands and isolated roots in
# test/setup-wrapper.test.js. These source guards prevent legacy setup fallback.
Assert-Contains $installer '[switch]$InstallGhidraMcp' "adapter should retain the GUI extension request flag."
Assert-Contains $installer '[switch]$InstallDotNetRuntime' "adapter should retain the dotnet request flag."
Assert-Contains $installer '[switch]$NativeOnly' "adapter should require explicit native-only selection with All."
Assert-Contains $installer "'--all'" "adapter should forward All to Node preflight."
Assert-Contains $installer "'--native-only'" "adapter should forward NativeOnly to Node."
Assert-Contains $installer "'python-gui'" "InstallRuntime should preserve its GUI Python requirement."
Assert-Contains $installer "'ghidra-mcp-gui'" "GUI extension requests must reach Node preflight."
Assert-Contains $installer "'dotnet'" "dotnet requests must reach Node preflight."
Assert-Contains $installer "'--require-component'" "adapter should explicitly forward unsupported profile requirements."
Assert-Contains $installer "'setup'" "native requests should delegate to Node setup."
Assert-Contains $installer "'status'" "adapter should support read-only default status."
Assert-Contains $installer "'PythonManifest'" "adapter should preserve the exact Python manifest route."
Assert-Contains $installer "'LockedManifest'" "adapter should preserve the exact native manifest route."
Assert-Contains $installer "'python-runtime'" "Python manifests should delegate to the Node Python CLI."
Assert-Contains $installer "'toolchain'" "native manifests should delegate to the Node toolchain CLI."
Assert-Contains $installer 'Node.js >=24' "adapter should require Node24 or newer."
Assert-Contains $installer '& $nodeCommand.Source @nodeArguments' "adapter should invoke Node with argument boundaries."
Assert-Contains $installer 'exit $LASTEXITCODE' "adapter should preserve Node exit status."
foreach ($unsafeInstallerToken in @(
    'Invoke-WebRequest', 'Invoke-RestMethod', 'Remove-Item',
    'SetEnvironmentVariable', 'Set-Location', 'Start-Process',
    'winget install', 'function Install-DotNetRuntime', 'function Install-Ghidra'
)) {
    Assert-NotContains $installer $unsafeInstallerToken "adapter must not retain legacy downloads, cleanup, global changes or installer fallback."
}

Assert-Contains $scriptBundleHelper 'function Register-GhidraScriptBundle' "Script Bundle helper should expose the patching entrypoint."
Assert-Contains $scriptBundleHelper 'BundleHost_FILE' "Script Bundle helper should patch the Ghidra bundle file array."
Assert-Contains $scriptBundleHelper 'BundleHost_ENABLE' "Script Bundle helper should patch the Ghidra bundle enable array."
Assert-Contains $scriptBundleHelper 'BundleHost_SYSTEM' "Script Bundle helper should patch the Ghidra bundle system/user array."
Assert-Contains $scriptBundleHelper 'BundleHost_ACTIVE' "Script Bundle helper should patch the Ghidra bundle active array."
Assert-Contains $scriptBundleHelper 'MissingToolConfig' "Script Bundle helper should skip cleanly when CodeBrowser config is not created yet."
Assert-Contains $scriptBundleHelper 'TemplatePath' "Script Bundle helper should seed missing CodeBrowser config from a template."
Assert-Contains $scriptBundleHelper 'Initialize-GhidraToolConfigFromTemplate' "Script Bundle helper should create _code_browser.tcd from a template when requested."
Assert-Contains $scriptBundleHelper '$USER_HOME' "Script Bundle helper should use Ghidra user-home macro paths for portable user config."
Assert-Contains $scriptBundleHelper 'CreateBackup' "Script Bundle helper should support backups before modifying _code_browser.tcd."

Assert-Contains $preferencesHelper 'function Set-GhidraDefaultProjectPreference' "Ghidra preferences helper should set the default project preference keys."
Assert-Contains $preferencesHelper 'LastOpenedProject' "Ghidra preferences helper should set LastOpenedProject."
Assert-Contains $preferencesHelper 'LastSelectedProjectDirectory' "Ghidra preferences helper should set LastSelectedProjectDirectory."
Assert-Contains $preferencesHelper 'ProjectDirectory' "Ghidra preferences helper should set ProjectDirectory."
Assert-Contains $preferencesHelper 'RecentProjects' "Ghidra preferences helper should update RecentProjects."
Assert-Contains $preferencesHelper 'TemplatePath' "Ghidra preferences helper should seed missing preferences from a template."
Assert-Contains $preferencesHelper 'function Get-GhidraPreferencesPath' "Ghidra preferences helper should locate the user preferences file from the Ghidra install."

Assert-Contains $coreModule 'function Assert-PathExists' "core module should contain shared path assertions."
Assert-Contains $coreModule 'function Invoke-WithToolkitEnv' "core module should contain toolkit environment setup."
Assert-Contains $processModule 'function Invoke-NativeProcess' "process module should contain native process helpers."
Assert-Contains $processModule 'function Invoke-AnalyzeHeadlessHeartbeat' "process module should contain headless heartbeat helpers."
Assert-Contains $pyghidraModule 'function Invoke-PyGhidraGui' "PyGhidra module should contain the GUI launch implementation."
Assert-Contains $pyghidraModule 'function Ensure-PyGhidraPackage' "PyGhidra module should contain package setup."
Assert-Contains $il2cppModule 'function Repair-Il2CppDumperGhidraTemplates' "Il2Cpp module should contain ghidra.py template repair."
Assert-Contains $il2cppModule 'function Ensure-Il2CppDumperGhidraScriptBundle' "Il2Cpp module should contain Script Bundle registration."
Assert-Contains $il2cppModule 'templates\Ghidra\_code_browser.tcd' "Il2Cpp module should seed missing CodeBrowser config before registering the Script Bundle."
Assert-Contains $il2cppModule 'fully close all Ghidra/PyGhidra windows and reopen' "Il2Cpp module should tell users to fully restart Ghidra if Script Manager does not show ghidra.py."
Assert-Contains $projectModule 'function Scan-UnityIl2Cpp' "project module should contain IL2CPP scanning."
Assert-Contains $projectModule 'function Show-GhidraProjectOpenInfo' "project module should contain project display helpers."
Assert-Contains $projectModule 'function Set-GhidraDefaultProjectForGame' "project module should set Ghidra default project from a toolkit game name."
Assert-Contains $projectModule 'templates\Ghidra\preferences' "project module should use the Ghidra preferences template when preferences do not exist yet."
Assert-Contains $projectModule 'function Export-WorkspaceArchive' "project module should package workspaces as .re archives."
Assert-Contains $projectModule 'function Import-WorkspaceArchive' "project module should restore workspaces from .re archives."
Assert-Contains $projectModule 'Update-ImportedWorkspaceProject' "project module should rebase imported project paths."
Assert-Contains $pipelineModule 'function Run-FullFlow' "pipeline module should contain the full flow."
Assert-Contains $pipelineModule 'Set-GhidraDefaultProjectForGame -GameName $GameName' "pipeline open should set the Ghidra default project before launching PyGhidra."
Assert-Contains $pipelineModule 'function Show-McpFirstQueryMessage' "pipeline module should contain MCP-first query guidance."
Assert-Contains $pipelineModule 'function Find-AvailablePort' "pipeline module should contain the AssetRipper headless port probe."
Assert-Contains $pipelineModule 'function Wait-AssetRipperHttpReady' "pipeline module should contain the AssetRipper headless readiness poll."
Assert-Contains $pipelineModule 'function Invoke-AssetRipperCommand' "pipeline module should contain the AssetRipper headless HTTP command helper."
Assert-Contains $pipelineModule 'function Export-AssetRipperUnityProject' "pipeline module should contain the AssetRipper headless export orchestrator."
Assert-Contains $pipelineModule 'function Invoke-AssetRipperCliPipeline' "pipeline module should contain the assetripper-cli workspace pipeline."
Assert-Contains $pipelineModule '--headless' "Export-AssetRipperUnityProject should launch AssetRipper.GUI.Free.exe in headless mode."
Assert-Contains $pipelineModule '/LoadFolder' "Export-AssetRipperUnityProject should POST to the AssetRipper /LoadFolder command route."
Assert-Contains $pipelineModule '/Export/UnityProject' "Export-AssetRipperUnityProject should POST to the AssetRipper /Export/UnityProject command route."
Assert-Contains $pipelineModule '/Reset' "Export-AssetRipperUnityProject should reset AssetRipper's loaded state before loading a new build."
Assert-Contains $pipelineModule 'has no files newer than the export start. Check the log file for details' "Export-AssetRipperUnityProject should verify a fresh export actually wrote files newer than the export start, since GameFileLoader can silently no-op on a re-run without emptying the output dir."
Assert-Contains $pipelineModule '-TimeoutSec 0' "AssetRipper Load/Export POSTs should use an unbounded HTTP timeout since export time scales with build size."
Assert-Contains $pipelineModule 'CreateSubfolder = "false"' "Export-AssetRipperUnityProject should send CreateSubfolder as the literal string `"false`", not a PowerShell boolean, since AssetRipper compares it as an exact string."
Assert-Contains $pipelineModule 'Get-Process -Id $ProcessId -ErrorAction SilentlyContinue' "Wait-AssetRipperHttpReady should detect the AssetRipper process crashing before its web server becomes ready."
Assert-Contains $uiModule 'function Show-Usage' "UI module should contain command help."
Assert-Contains $uiModule 'export     <GameName> [OutFile.re]' "UI module should document workspace archive export."
Assert-Contains $uiModule 'import     <Archive.re> [GameName] [--force]' "UI module should document workspace archive import."
Assert-Contains $uiModule 'ghidra-gui [GameName]' "UI module should document project-aware Ghidra GUI launch."
Assert-Contains $uiModule 'pyghidra-gui [GameName]' "UI module should document project-aware PyGhidra GUI launch."
Assert-Contains $uiModule 'assetripper [args...]' "UI module should document the AssetRipper GUI launcher."

Assert-Contains $ghidraWrapper 'scripts\ghidra-script-bundle.ps1' "run-ghidra.ps1 should load the Ghidra Script Bundle helper."
Assert-Contains $ghidraWrapper 'function Ensure-Il2CppDumperGhidraScriptBundle' "run-ghidra.ps1 should check/register the Il2CppDumper Script Bundle before opening Ghidra."
Assert-Contains $ghidraWrapper 'Ensure-Il2CppDumperGhidraScriptBundle | Out-Null' "run-ghidra.ps1 should invoke Script Bundle registration before launch."
Assert-Contains $ghidraWrapper 'tools\Il2CppDumper' "run-ghidra.ps1 should target the installed Il2CppDumper script bundle."
Assert-Contains $ghidraWrapper 'Il2CppDumper.exe' "run-ghidra.ps1 should only auto-register the Script Bundle when Il2CppDumper is installed."
Assert-Contains $ghidraWrapper 'templates\Ghidra\_code_browser.tcd' "run-ghidra.ps1 should seed missing CodeBrowser config before registering the Script Bundle."
Assert-Contains $ghidraWrapper 'fully close all Ghidra/PyGhidra windows and reopen' "run-ghidra.ps1 should tell users to fully restart Ghidra if Script Manager does not show ghidra.py."

Assert-Contains $pyghidraWrapper 'PythonExe' "run-pyghidra.ps1 should use toolkit-local Python."
Assert-Contains $pyghidraWrapper 'Ensure-PyGhidraPackage' "run-pyghidra.ps1 should install bundled PyGhidra into the local venv."
Assert-Contains $pyghidraWrapper 'pyghidra' "run-pyghidra.ps1 should launch the pyghidra module directly."
Assert-Contains $pyghidraWrapper 'Start-Process' "run-pyghidra.ps1 should detach the GUI from the wrapper process."
Assert-Contains $pyghidraWrapper 'pyghidra-gui-' "run-pyghidra.ps1 should redirect detached GUI logs to timestamped log files."
Assert-NotContains $pyghidraWrapper '& $PyGhidraPython @launchArgs' "run-pyghidra.ps1 should not attach PyGhidra logs to the wrapper process by default."
Assert-Contains $pyghidraWrapper 'PackageNotFoundError' "run-pyghidra.ps1 should treat missing PyGhidra as install-needed, not as a fatal probe error."
Assert-NotContains $pyghidraWrapper '$PyGhidraLauncher $GhidraRoot' "run-pyghidra.ps1 should not use pyghidra_launcher.py because it hides child-process errors."
Assert-Contains $pyghidraWrapper 'PYTHONNOUSERSITE' "run-pyghidra.ps1 should avoid leaking user-site packages into PyGhidra."
Assert-Contains $pyghidraWrapper 'scripts\ghidra-script-bundle.ps1' "run-pyghidra.ps1 should load the Ghidra Script Bundle helper."
Assert-Contains $pyghidraWrapper 'function Ensure-Il2CppDumperGhidraScriptBundle' "run-pyghidra.ps1 should check/register the Il2CppDumper Script Bundle before opening PyGhidra."
Assert-Contains $pyghidraWrapper 'Ensure-Il2CppDumperGhidraScriptBundle | Out-Null' "run-pyghidra.ps1 should invoke Script Bundle registration before launch."
Assert-Contains $pyghidraWrapper 'Il2CppDumper.exe' "run-pyghidra.ps1 should only auto-register the Script Bundle when Il2CppDumper is installed."
Assert-Contains $pyghidraWrapper 'templates\Ghidra\_code_browser.tcd' "run-pyghidra.ps1 should seed missing CodeBrowser config before registering the Script Bundle."
Assert-Contains $pyghidraWrapper 'fully close all Ghidra/PyGhidra windows and reopen' "run-pyghidra.ps1 should tell users to fully restart Ghidra if Script Manager does not show ghidra.py."


Assert-Contains $tutorial '-InstallGhidraMcp' "Tutorial should document MCP installation."
Assert-Contains $tutorial '-InstallDotNetRuntime' "Tutorial should document .NET runtime installation for Il2CppDumper."
Assert-Contains $tutorial '.\install-re-toolkit.ps1 -All' "Tutorial should document one-shot recommended installation."
Assert-Contains $tutorial 'Ghidra Script Bundle' "Tutorial should document automatic Il2CppDumper Script Bundle registration."
Assert-Contains $tutorial 'Script Manager > Bundle Manager' "Tutorial should include the manual Script Bundle fallback."
Assert-Contains $tutorial 'templates/Ghidra/_code_browser.tcd' "Tutorial should document first-run CodeBrowser config seeding."
Assert-Contains $tutorial 'fully close all Ghidra/PyGhidra windows and reopen' "Tutorial should tell users to fully restart Ghidra if Script Manager does not show ghidra.py."
Assert-Contains $tutorial 'File > Configure > Configure All Plugins > GhidraMCP' "Tutorial should include GUI plugin enablement."
Assert-Contains $tutorial '.\re.ps1 pyghidra-gui FoodHunt' "Tutorial should show project-aware PyGhidra launch."
Assert-Contains $tutorial 'templates/Ghidra/preferences' "Tutorial should document first-run Ghidra preferences seeding."
Assert-Contains $tutorial '.\re.ps1 export FoodHunt' "Tutorial should show workspace archive export."
Assert-Contains $tutorial '.\re.ps1 import .\exports\FoodHunt.re' "Tutorial should show workspace archive import."
Assert-Contains $tutorial 'connect_instance <GameName>' "Tutorial should explain agent MCP connection."
Assert-NotContains $tutorial 'Bridge not responding to ping' "Tutorial should not troubleshoot ghidra-cli bridge issues."
Assert-Contains $tutorial '.\re.ps1 pull-ldplayer FoodHunt com.example.foodhunt' "Tutorial should show how to pull a build from LDPlayer."
Assert-Contains $tutorial '.\re.ps1 assetripper-cli FoodHunt' "Tutorial should show how to run the headless AssetRipper export."



Assert-Contains $templateGhidraPy 'from ghidra.program.model.symbol import SourceType' "ghidra.py template should import SourceType explicitly for PyGhidra."
Assert-Contains $templateGhidraPy 'open(script_json_path, "r", encoding="utf-8")' "ghidra.py template should load JSON through Python 3 text IO."
Assert-Contains $templateGhidraPy 'print("Script finished!")' "ghidra.py template should use Python 3 print syntax."
Assert-NotContains $templateGhidraPy "print 'Script finished!'" "ghidra.py template should not contain Python 2 print syntax."
Assert-NotContains $templateGhidraPy '.encode("utf-8")' "ghidra.py template should not pass bytes to Ghidra APIs under PyGhidra."

Assert-Contains $templateGhidraWithStructPy 'from ghidra.program.model.symbol import SourceType' "ghidra_with_struct.py template should import SourceType explicitly for PyGhidra."
Assert-Contains $templateGhidraWithStructPy 'CParserUtils' "ghidra_with_struct.py template should preserve signature parsing support."
Assert-Contains $templateGhidraWithStructPy 'ApplyFunctionSignatureCmd' "ghidra_with_struct.py template should preserve function signature application."
Assert-Contains $templateGhidraWithStructPy 'def set_type' "ghidra_with_struct.py template should preserve struct/type application."
Assert-Contains $templateGhidraWithStructPy 'def set_sig' "ghidra_with_struct.py template should preserve function signature application."
Assert-Contains $templateGhidraWithStructPy 'open(script_json_path, "r", encoding="utf-8")' "ghidra_with_struct.py template should load JSON through Python 3 text IO."
Assert-Contains $templateGhidraWithStructPy 'print("Script finished!")' "ghidra_with_struct.py template should use Python 3 print syntax."
Assert-NotContains $templateGhidraWithStructPy "print 'Script finished!'" "ghidra_with_struct.py template should not contain Python 2 print syntax."
Assert-NotContains $templateGhidraWithStructPy '.encode("utf-8")' "ghidra_with_struct.py template should not pass bytes to Ghidra APIs under PyGhidra."

Assert-Contains $templateGhidraPreferences 'USER_AGREEMENT=ACCEPT' "Ghidra preferences template should skip the first-run user agreement."
Assert-Contains $templateGhidraPreferences 'GhidraShowWhatsNew=false' "Ghidra preferences template should suppress first-run whats-new prompts."
Assert-Contains $templateGhidraPreferences 'RecentProjects=' "Ghidra preferences template should expose the recent-projects key for project injection."
Assert-NotContains $templateGhidraPreferences 'LastOpenedProject=' "Ghidra preferences template should not hardcode a machine-specific project path."

Assert-Contains $templateGhidraCodeBrowser 'ghidra.app.plugin.core.script.GhidraScriptMgrPlugin' "Ghidra CodeBrowser template should include Script Manager plugin state."
Assert-Contains $templateGhidraCodeBrowser 'BundleHost_FILE' "Ghidra CodeBrowser template should include the script bundle file array."
Assert-Contains $templateGhidraCodeBrowser '$GHIDRA_HOME/Features/Base/ghidra_scripts' "Ghidra CodeBrowser template should preserve the default Ghidra script bundle."

if ($il2cppGhidraPy) {
    Assert-Contains $il2cppGhidraPy 'from ghidra.program.model.symbol import SourceType' "Il2CppDumper ghidra.py should import SourceType explicitly for PyGhidra."
    Assert-Contains $il2cppGhidraPy 'def as_text' "Il2CppDumper ghidra.py should normalize Python 3 strings."
    Assert-Contains $il2cppGhidraPy 'open(script_json_path, "r", encoding="utf-8")' "Il2CppDumper ghidra.py should load JSON through Python 3 text IO."
    Assert-Contains $il2cppGhidraPy 'print("Script finished!")' "Il2CppDumper ghidra.py should use Python 3 print syntax."
    Assert-NotContains $il2cppGhidraPy 'ghidra.program.model.symbol.SourceType.USER_DEFINED' "Il2CppDumper ghidra.py should not rely on a global ghidra variable."
    Assert-NotContains $il2cppGhidraPy '.encode("utf-8")' "Il2CppDumper ghidra.py should not pass bytes to Ghidra APIs under PyGhidra."
    Assert-NotContains $il2cppGhidraPy "print 'Script finished!'" "Il2CppDumper ghidra.py should not contain Python 2 print syntax."
}

if ($il2cppGhidraWithStructPy) {
    Assert-Contains $il2cppGhidraWithStructPy 'from ghidra.program.model.symbol import SourceType' "Il2CppDumper ghidra_with_struct.py should import SourceType explicitly for PyGhidra."
    Assert-Contains $il2cppGhidraWithStructPy 'def set_type' "Il2CppDumper ghidra_with_struct.py should preserve struct/type application."
    Assert-Contains $il2cppGhidraWithStructPy 'def set_sig' "Il2CppDumper ghidra_with_struct.py should preserve signature application."
    Assert-Contains $il2cppGhidraWithStructPy 'print("Script finished!")' "Il2CppDumper ghidra_with_struct.py should use Python 3 print syntax."
    Assert-NotContains $il2cppGhidraWithStructPy 'ghidra.program.model.symbol.SourceType.USER_DEFINED' "Il2CppDumper ghidra_with_struct.py should not rely on a global ghidra variable."
    Assert-NotContains $il2cppGhidraWithStructPy '.encode("utf-8")' "Il2CppDumper ghidra_with_struct.py should not pass bytes to Ghidra APIs under PyGhidra."
    Assert-NotContains $il2cppGhidraWithStructPy "print 'Script finished!'" "Il2CppDumper ghidra_with_struct.py should not contain Python 2 print syntax."
}

Write-Host "retk-mcp-first checks passed"

# Documentation/config now belongs to the JavaScript CLI; retain PS source guards above.
Assert-Contains $readme "node re.js" "README should route preparation through the JavaScript CLI."
Assert-Contains $promptInstallGhidraSkill "re.js" "Install prompt should use the JavaScript entry point."
Assert-Contains $config "re.js" "MCP config should launch the JavaScript bridge wrapper."
