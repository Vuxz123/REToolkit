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
Assert-Contains $re 'Invoke-PyGhidraGui -Arguments $guiArgs' "re.ps1 should launch PyGhidra through the module helper after consuming an optional project name."
Assert-Contains $pyghidraModule 'function Invoke-PyGhidraGui' "PyGhidra module should launch PyGhidra through a local-Python helper."
Assert-Contains $pyghidraModule 'function Ensure-PyGhidraPackage' "PyGhidra module should install the PyGhidra package into the local venv before launch."
Assert-Contains $processModule 'function Start-DetachedNativeProcess' "process module should expose a detached native process launcher for GUI handoff."
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

Assert-Contains $installer '[switch]$InstallGhidraMcp' "installer should expose -InstallGhidraMcp."
Assert-Contains $installer '[switch]$All' "installer should expose -All to install the recommended full toolchain."
Assert-Contains $installer 'if ($All)' "installer should expand -All before running install sections."
Assert-Contains $installer '$InstallRuntime = $true' "-All should include runtime installation."
Assert-Contains $installer '$InstallGhidra = $true' "-All should include Ghidra installation."
Assert-Contains $installer '$InstallIl2CppDumper = $true' "-All should include Il2CppDumper installation."
Assert-Contains $installer '$InstallGhidraMcp = $true' "-All should include GhidraMCP installation."
Assert-Contains $installer '$InstallAssetRipper = $true' "-All should include AssetRipper installation."
Assert-Contains $installer '[string]$PythonVersion = "3.12.10"' "installer should default to a stable Python 3.12 patch release."
Assert-Contains $installer 'python-$PythonMajorMinor' "installer should install Python into a versioned toolkit runtime folder."
Assert-Contains $installer 'function Install-PyGhidraPythonVenv' "installer should create a PyGhidra venv from toolkit Python."
Assert-Contains $installer 'function Install-PyGhidraPythonPackage' "installer should install bundled PyGhidra into the local venv."
Assert-Contains $installer 'function Install-ToolkitPythonWithUv' "installer should prefer uv-managed portable Python to avoid python.org registry install state."
Assert-Contains $installer 'UV_CACHE_DIR' "installer should keep uv cache inside the toolkit runtime."
Assert-Contains $installer 'uv python install' "installer should install a toolkit-local Python with uv."
Assert-Contains $installer '--no-registry' "installer should not resolve Python through the global py launcher or registry."
Assert-Contains $installer 'Lib\os.py' "installer should normalize the uv install from the real CPython root, not Lib\\venv script helpers."
Assert-Contains $installer 'pip install --no-index -f' "installer should install PyGhidra offline from the Ghidra bundle."
Assert-Contains $installer 'PackageNotFoundError' "installer should treat missing PyGhidra as install-needed, not as a fatal probe error."
Assert-Contains $installer 'templates\Il2CppDumper' "installer should use visible Il2CppDumper Ghidra template files."
Assert-Contains $installer 'ghidra_with_struct.py' "installer should repair/copy ghidra_with_struct.py as well as ghidra.py."
Assert-Contains $installer 'pyghidra-venv' "installer should use a local PyGhidra Python venv."
Assert-Contains $installer 'PrependPath=0' "installer should not put toolkit Python on the global PATH."
Assert-Contains $installer 'Include_launcher=0' "installer should not replace or depend on the global py launcher."
Assert-Contains $installer 'https://api.github.com/repos/bethington/ghidra-mcp/releases/latest' "installer should use the latest bethington/ghidra-mcp release API."
Assert-Contains $installer 'browser_download_url' "installer should download release assets."
Assert-Contains $installer '^GhidraMCP-.+\.zip$' "installer should find the release extension zip."
Assert-Contains $installer 'function Get-GhidraUserExtensionsDir' "installer should detect the user-level Ghidra Extensions folder."
Assert-Contains $installer 'function Install-GhidraMcpExtensionZip' "installer should auto-install the GhidraMCP extension ZIP into the user Ghidra Extensions folder."
Assert-Contains $installer 'application.version' "installer should read the installed Ghidra version instead of hardcoding ghidra_12.1.2_PUBLIC."
Assert-Contains $installer 'AppData\Roaming\ghidra' "installer should target Ghidra's user settings extension location."
Assert-Contains $installer 'extension.properties' "installer should validate the extracted Ghidra extension layout."
Assert-Contains $installer 'Module.manifest' "installer should validate the extracted Ghidra extension layout."
Assert-Contains $installer 'function Install-GhidraMcpRequirements' "installer should install Python requirements for the MCP bridge."
Assert-Contains $installer 'function Repair-Il2CppGhidraScript' "installer should repair bundled Il2CppDumper ghidra.py."
Assert-Contains $installer 'Repair-Il2CppGhidraScript -Path' "installer should repair Il2CppDumper ghidra.py when present."
Assert-Contains $installer 'scripts\ghidra-script-bundle.ps1' "installer should load the Ghidra Script Bundle helper."
Assert-Contains $installer 'function Install-Il2CppDumperGhidraScriptBundle' "installer should auto-register Il2CppDumper as a Ghidra Script Bundle."
Assert-Contains $installer 'Install-Il2CppDumperGhidraScriptBundle -ToolsDir $Tools -GhidraRoot $toolsGhidra' "installer should register the Il2CppDumper Script Bundle during tool checks."
Assert-Contains $installer 'templates\Ghidra\_code_browser.tcd' "installer should seed missing Ghidra CodeBrowser config before registering Il2CppDumper scripts."
Assert-Contains $installer 'fully close all Ghidra/PyGhidra windows and reopen' "installer should tell users to fully restart Ghidra if Script Manager does not show ghidra.py."
Assert-Contains $installer 'uv pip install --python' "installer should install requirements into a local venv with uv."
Assert-Contains $installer 'File > Install Extensions > Add' "installer should instruct GUI extension install from release zip."
Assert-NotContains $installer '[SKIP] python already at' "installer should not skip local Python just because global Python exists."
Assert-NotContains $installer 'git clone --depth 1 $Repo' "installer should not clone the ghidra-mcp repository."
Assert-NotContains $installer 'tools.setup deploy' "installer should not build/deploy from source."
Assert-Contains $installer 'Tools > GhidraMCP > Start MCP Server' "installer should print GUI startup guidance."
Assert-NotContains $installer 'Missing: ghidra-cli (run -InstallGhidraCli)' "ghidra-cli should not be a required missing component."

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
Assert-Contains $uiModule 'function Show-Usage' "UI module should contain command help."
Assert-Contains $uiModule 'export     <GameName> [OutFile.re]' "UI module should document workspace archive export."
Assert-Contains $uiModule 'import     <Archive.re> [GameName] [--force]' "UI module should document workspace archive import."
Assert-Contains $uiModule 'ghidra-gui [GameName]' "UI module should document project-aware Ghidra GUI launch."
Assert-Contains $uiModule 'pyghidra-gui [GameName]' "UI module should document project-aware PyGhidra GUI launch."

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

Assert-Contains $readme '-InstallGhidraMcp' "README should document MCP installation."
Assert-Contains $readme '.\install-re-toolkit.ps1 -All' "README should document one-shot recommended installation."
Assert-Contains $readme 'runtime/python/python-3.12' "README should document the local stable Python runtime."
Assert-Contains $readme 'Ghidra Script Bundle' "README should document automatic Il2CppDumper Script Bundle registration."
Assert-Contains $readme '_code_browser.tcd' "README should document where Ghidra stores Script Bundle config."
Assert-Contains $readme 'templates/Ghidra/_code_browser.tcd' "README should document first-run CodeBrowser config seeding."
Assert-Contains $readme 'fully close all Ghidra/PyGhidra windows and reopen' "README should tell users to fully restart Ghidra if Script Manager does not show ghidra.py."
Assert-Contains $readme 'File > Configure > Configure All Plugins > GhidraMCP' "README should document GUI plugin enablement."
Assert-Contains $readme 'tools/ghidra-mcp/.venv' "README should document the local MCP bridge virtual environment."
Assert-Contains $readme 'Tools > GhidraMCP > Start MCP Server' "README should document starting the MCP server."
Assert-Contains $readme 'ghidra-gui [GameName]' "README should document project-aware Ghidra GUI launch."
Assert-Contains $readme 'pyghidra-gui [GameName]' "README should document project-aware PyGhidra GUI launch."
Assert-Contains $readme 'templates/Ghidra/preferences' "README should document first-run Ghidra preferences seeding."
Assert-Contains $readme 'export <GameName> [OutFile.re]' "README should document workspace archive export."
Assert-Contains $readme 'import <Archive.re> [GameName] [--force]' "README should document workspace archive import."
Assert-NotContains $readme '.\re.ps1 ghidra-cli' "README should not promote ghidra-cli commands."

Assert-Contains $tutorial '-InstallGhidraMcp' "Tutorial should document MCP installation."
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

Assert-Contains $promptInstallGhidraSkill '-InstallGhidraMcp' "Prompt should document GhidraMCP installation."
Assert-Contains $promptInstallGhidraSkill '.\install-re-toolkit.ps1 -All' "Prompt should document one-shot recommended installation."
Assert-Contains $promptInstallGhidraSkill '.\re.ps1 mcp' "Prompt should document MCP bridge launch."
Assert-Contains $promptInstallGhidraSkill 'File > Configure > Configure All Plugins > GhidraMCP' "Prompt should document GUI plugin enablement."
Assert-Contains $promptInstallGhidraSkill 'Tools > GhidraMCP > Start MCP Server' "Prompt should document starting the GUI MCP server."
Assert-Contains $promptInstallGhidraSkill 'list_instances' "Prompt should document MCP instance discovery."
Assert-Contains $promptInstallGhidraSkill 'connect_instance FoodHunt' "Prompt should document connecting to a target instance."
Assert-Contains $promptInstallGhidraSkill '.\re.ps1 pyghidra-gui FoodHunt' "Prompt should document project-aware PyGhidra launch."
Assert-Contains $promptInstallGhidraSkill 'templates/Ghidra/_code_browser.tcd' "Prompt should document CodeBrowser template seeding."
Assert-Contains $promptInstallGhidraSkill 'templates/Ghidra/preferences' "Prompt should document Ghidra preferences template seeding."
Assert-Contains $promptInstallGhidraSkill 'fully close all Ghidra/PyGhidra windows and reopen' "Prompt should document restart guidance when Script Manager does not show ghidra.py."
Assert-Contains $promptInstallGhidraSkill '.\re.ps1 export FoodHunt' "Prompt should document workspace archive export."
Assert-Contains $promptInstallGhidraSkill '.\re.ps1 import .\exports\FoodHunt.re' "Prompt should document workspace archive import."
Assert-Contains $promptInstallGhidraSkill 'import <GameName>` means Ghidra import' "Prompt should distinguish Ghidra import from archive import."
Assert-NotContains $promptInstallGhidraSkill '.\re.ps1 ghidra-cli' "Prompt should not route agents through ghidra-cli."

Assert-Contains $config '"args": ["mcp"]' "OpenCode sample should continue to launch re.ps1 mcp."

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
