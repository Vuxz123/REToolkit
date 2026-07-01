[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [switch]$InstallGhidra,
    [switch]$InstallGhidraMcp,
    [switch]$InstallIl2CppDumper,
    [switch]$InstallAssetRipper,
    [switch]$InstallRuntime,
    [int]$JdkVersion = 21,
    [string]$PythonVersion = "3.12",
    [string]$GhidraVersion = "",
    [string]$Il2CppDumperVersion = "6.7.48",
    [string]$GhidraMcpReleaseApi = "https://api.github.com/repos/bethington/ghidra-mcp/releases/latest",
    [string]$AssetRipperRepo = "AssetRipper/AssetRipper"
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        $InstallDir = $PSScriptRoot
    }
    elseif (-not [string]::IsNullOrWhiteSpace($PSCommandPath)) {
        $InstallDir = Split-Path -Parent $PSCommandPath
    }
    elseif ($MyInvocation.MyCommand.Path) {
        $InstallDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    else {
        $InstallDir = (Get-Location).Path
    }
}
Set-Location -LiteralPath $InstallDir

$Runtime      = Join-Path $InstallDir "runtime"
$PortableJava = Join-Path $Runtime "java\jdk-21"
$PythonDir    = Join-Path $Runtime "python"

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "== $Title ==" -ForegroundColor Cyan
}

function Test-Command {
    param([string]$Name)
    $cmd = Get-Command $Name -ErrorAction SilentlyContinue
    return [pscustomobject]@{
        Name  = $Name
        Found = [bool]$cmd
        Path  = if ($cmd) { $cmd.Source } else { "<not found>" }
    }
}

function Test-PathExists {
    param([string]$Path, [string]$Label)
    $exists = Test-Path -LiteralPath $Path
    if ($exists) {
        Write-Host ("  [OK]   {0,-22} {1}" -f $Label, $Path) -ForegroundColor Green
    } else {
        Write-Host ("  [WARN] {0,-22} {1}" -f $Label, $Path) -ForegroundColor Yellow
    }
    return $exists
}

function Refresh-Path {
    $user = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $machine = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $parts = @($user, $machine, $env:Path) | Where-Object { $_ }
    $env:Path = ($parts -split ";" | Where-Object { $_ -and $_ -notmatch '^\s*$' } | Select-Object -Unique) -join ";"
}

function Clear-RetkTemp {
    $patterns = @(
        "retk-*",
        "ghidra_extract_*",
        "temurin*.zip",
        "GhidraMCP-*.zip",
        "rustup-init*.exe",
        "Il2CppDumper-v*.zip",
        "il2cppdumper_*",
        "AssetRipper_win*.zip",
        "assetripper_*"
    )
    $seen = @{}
    $removed = 0
    foreach ($pat in $patterns) {
        Get-ChildItem -LiteralPath $env:TEMP -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like $pat -and -not $seen.ContainsKey($_.FullName) } |
            ForEach-Object {
                $seen[$_.FullName] = $true
                try {
                    if ($_.PSIsContainer) {
                        Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop
                    } else {
                        Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop
                    }
                    $removed++
                } catch { }
            }
    }
    return $removed
}

function Invoke-Install {
    param([string]$Name, [scriptblock]$Action)
    try {
        & $Action
    } catch {
        Write-Host ("  [FAIL] {0} crashed: {1}" -f $Name, $_) -ForegroundColor Red
    } finally {
        $n = Clear-RetkTemp
        if ($n -gt 0) {
            Write-Host ("  [CLEAN] {0} temp item(s) cleared after {1}" -f $n, $Name) -ForegroundColor DarkGray
        }
    }
}

function Install-Java {
    param([int]$Major)

    $javaExe = Join-Path $PortableJava "bin\java.exe"
    if (Test-Path -LiteralPath $javaExe) {
        Write-Host "  [SKIP] portable JDK already at $PortableJava" -ForegroundColor Yellow
        return $true
    }

    Write-Host "  Querying Adoptium API for Temurin JDK $Major (portable ZIP)..." -ForegroundColor Cyan
    $api = "https://api.adoptium.net/v3/assets/latest/$Major/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse"
    $tmp = $null
    $extract = $null
    try {
        $assets = Invoke-RestMethod -Uri $api -UseBasicParsing -TimeoutSec 30 -Headers @{"User-Agent"="re-toolkit"}
        $asset = $assets | Where-Object { $_.binary.os -eq "windows" -and $_.binary.image_type -eq "jdk" } | Select-Object -First 1
        if (-not $asset) {
            Write-Host "  [FAIL] No Temurin asset for JDK $Major" -ForegroundColor Red
            return $false
        }

        $tmp = Join-Path $env:TEMP "temurin$Major.zip"
        if ($asset.binary.package -and $asset.binary.package.link) {
            $url = $asset.binary.package.link
        } elseif ($asset.binary.archive -and $asset.binary.archive.link) {
            $url = $asset.binary.archive.link
        } else {
            Write-Host "  [FAIL] No portable ZIP link in Adoptium API response (only .msi installer found)." -ForegroundColor Red
            return $false
        }
        Write-Host ("  Downloading {0} ..." -f (Split-Path $url -Leaf)) -ForegroundColor Cyan
        Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -TimeoutSec 600

        $extract = Join-Path $env:TEMP ("temurin" + [guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Path $extract -Force | Out-Null
        Expand-Archive -Path $tmp -DestinationPath $extract -Force

        $inner = Get-ChildItem -LiteralPath $extract -Directory | Select-Object -First 1
        if (-not $inner) {
            Write-Host "  [FAIL] Archive did not contain a JDK folder" -ForegroundColor Red
            return $false
        }

        if (Test-Path -LiteralPath (Split-Path -Parent $PortableJava)) {
            Remove-Item -LiteralPath (Split-Path -Parent $PortableJava) -Recurse -Force -ErrorAction SilentlyContinue
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $PortableJava) -Force | Out-Null
        Move-Item -LiteralPath $inner.FullName -Destination $PortableJava -Force

        if (Test-Path -LiteralPath $javaExe) {
            $ver = (cmd /c "`"$javaExe`" -version 2>&1" | Select-Object -First 1) -replace '"',''
            Write-Host ("  [OK]   Portable JDK: {0}" -f $ver.Trim()) -ForegroundColor Green
            Write-Host ("         Path       : {0}" -f $PortableJava) -ForegroundColor Cyan
            Write-Host          "         (no global JAVA_HOME/PATH change)" -ForegroundColor DarkGray
            return $true
        }
        Write-Host "  [FAIL] java.exe missing after extraction" -ForegroundColor Red
        return $false
    } catch {
        Write-Host "  [FAIL] $_" -ForegroundColor Red
        return $false
    } finally {
        if ($tmp -and (Test-Path -LiteralPath $tmp)) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
        if ($extract -and (Test-Path -LiteralPath $extract)) { Remove-Item -LiteralPath $extract -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

function Install-Python {
    param([string]$Version)

    $py = Get-Command "python" -ErrorAction SilentlyContinue
    if ($py) {
        Write-Host "  [SKIP] python already at $($py.Source)" -ForegroundColor Yellow
        return $true
    }

    $uv = Get-Command "uv" -ErrorAction SilentlyContinue
    if ($uv) {
        Write-Host "  Installing Python $Version via uv..." -ForegroundColor Cyan
        & uv python install --python-preference only-managed $Version
        $managed = & uv python find $Version 2>$null
        if ($managed) {
            Write-Host ("  [OK]   uv managed Python: {0}" -f $managed) -ForegroundColor Green
            return $true
        }
        Write-Host "  [WARN] uv did not return a path; falling back to python.org installer" -ForegroundColor Yellow
    }

    $exe = Join-Path $env:TEMP "python-installer.exe"
    try {
        $verShort = $Version
        $url = "https://www.python.org/ftp/python/$verShort/python-$verShort-amd64.exe"
        Write-Host "  Downloading python.org $verShort installer..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing -TimeoutSec 600
        $arg = "/quiet InstallAllUsers=0 PrependPath=1 Include_test=0 Include_pip=1 Include_launcher=1 TargetDir=`"$PythonDir`""
        Write-Host "  Running installer (user scope, no test)..." -ForegroundColor Cyan
        $proc = Start-Process -FilePath $exe -ArgumentList $arg -Wait -PassThru
        if ($proc.ExitCode -ne 0) {
            Write-Host ("  [FAIL] Installer exited {0}" -f $proc.ExitCode) -ForegroundColor Red
            return $false
        }
        Refresh-Path
        Write-Host ("  [OK]   Python installed under {0}" -f $PythonDir) -ForegroundColor Green
        return $true
    } catch {
        Write-Host "  [FAIL] $_" -ForegroundColor Red
        return $false
    } finally {
        if (Test-Path -LiteralPath $exe) { Remove-Item -LiteralPath $exe -Force -ErrorAction SilentlyContinue }
    }
}

function Install-GhidraRuntime {
    param([string]$ToolsDir, [string]$Version)

    $ghidraDir = Join-Path $ToolsDir "ghidra"
    if (Test-Path -LiteralPath $ghidraDir) {
        Write-Host "  [SKIP] Ghidra already at $ghidraDir" -ForegroundColor Yellow
        return $true
    }

    $tmpZip = $null
    $tmpExtract = $null

    try {
        if (-not $Version) {
            Write-Host "  Querying GitHub for latest Ghidra release..." -ForegroundColor Cyan
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/NationalSecurityAgency/ghidra/releases/latest" -UseBasicParsing -TimeoutSec 30 -Headers @{"User-Agent"="re-toolkit"}
            $asset = $release.assets | Where-Object { $_.name -match "^ghidra_.+_PUBLIC_.+\.zip$" } | Select-Object -First 1
            if (-not $asset) {
                Write-Host "  [FAIL] No PUBLIC zip asset in latest release." -ForegroundColor Red
                return $false
            }
            $fileName = $asset.name
            $url = $asset.browser_download_url
        } else {
            $short = $Version
            $fileName = "ghidra_${short}_PUBLIC_${short}.zip"
            $url = "https://github.com/NationalSecurityAgency/ghidra/releases/download/ghidra_${short}_build/$fileName"
        }

        $tmpZip = Join-Path $env:TEMP $fileName
        $tmpExtract = Join-Path $env:TEMP ("ghidra_extract_" + [guid]::NewGuid().ToString("N"))

        Write-Host ("  Downloading {0} ..." -f $fileName) -ForegroundColor Cyan
        Invoke-WebRequest -Uri $url -OutFile $tmpZip -UseBasicParsing -TimeoutSec 600

        Write-Host "  Extracting..." -ForegroundColor Cyan
        New-Item -ItemType Directory -Path $tmpExtract -Force | Out-Null
        Expand-Archive -Path $tmpZip -DestinationPath $tmpExtract -Force

        $inner = Get-ChildItem -LiteralPath $tmpExtract -Directory | Select-Object -First 1
        if (-not $inner) {
            Write-Host "  [FAIL] Archive contained no top-level folder." -ForegroundColor Red
            return $false
        }

        New-Item -ItemType Directory -Path $ghidraDir -Force | Out-Null
        Get-ChildItem -LiteralPath $inner.FullName -Force | ForEach-Object {
            Move-Item -LiteralPath $_.FullName -Destination $ghidraDir -Force
        }

        $runBat = Join-Path $ghidraDir "ghidraRun.bat"
        if (Test-Path -LiteralPath $runBat) {
            $env:GHIDRA_INSTALL_DIR = $ghidraDir
            [System.Environment]::SetEnvironmentVariable("GHIDRA_INSTALL_DIR", $ghidraDir, "User")
            Write-Host ("  [OK]   Ghidra installed at {0}" -f $ghidraDir) -ForegroundColor Green
            return $true
        } else {
            Write-Host "  [FAIL] ghidraRun.bat missing after install." -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "  [FAIL] $_" -ForegroundColor Red
        return $false
    } finally {
        if ($tmpZip -and (Test-Path -LiteralPath $tmpZip))   { Remove-Item -LiteralPath $tmpZip -Force -ErrorAction SilentlyContinue }
        if ($tmpExtract -and (Test-Path -LiteralPath $tmpExtract)) { Remove-Item -LiteralPath $tmpExtract -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

function Install-GhidraMcp {
    param(
        [Parameter(Mandatory)] [string]$ToolsDir,
        [Parameter(Mandatory)] [string]$ReleaseApi,
        [Parameter(Mandatory)] [string]$GhidraRoot
    )

    if (-not (Test-Path -LiteralPath $GhidraRoot -PathType Container)) {
        Write-Host "  [WARN] Ghidra root not found. Downloading release assets anyway; run -InstallGhidra before GUI install." -ForegroundColor Yellow
    }

    $targetDir = Join-Path $ToolsDir "ghidra-mcp"

    try {
        Write-Host ("  Querying latest GhidraMCP release: {0}" -f $ReleaseApi) -ForegroundColor Cyan
        $release = Invoke-RestMethod -Uri $ReleaseApi -UseBasicParsing -TimeoutSec 30 -Headers @{"User-Agent"="re-toolkit"}
        if (-not $release -or -not $release.assets) {
            Write-Host "  [FAIL] Latest release response did not include assets." -ForegroundColor Red
            return $false
        }

        $extensionAsset = $release.assets | Where-Object { $_.name -match '^GhidraMCP-.+\.zip$' } | Select-Object -First 1
        $bridgeAsset = $release.assets | Where-Object { $_.name -eq "bridge_mcp_ghidra.py" } | Select-Object -First 1
        $requirementsAsset = $release.assets | Where-Object { $_.name -eq "requirements.txt" } | Select-Object -First 1

        if (-not $extensionAsset) {
            Write-Host "  [FAIL] No GhidraMCP release extension asset matched ^GhidraMCP-.+\.zip$." -ForegroundColor Red
            return $false
        }
        if (-not $bridgeAsset) {
            Write-Host "  [FAIL] No bridge_mcp_ghidra.py release asset found." -ForegroundColor Red
            return $false
        }
        if (-not $requirementsAsset) {
            Write-Host "  [FAIL] No requirements.txt release asset found." -ForegroundColor Red
            return $false
        }

        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

        $extensionPath = Join-Path $targetDir $extensionAsset.name
        $bridgePath = Join-Path $targetDir "bridge_mcp_ghidra.py"
        $requirementsPath = Join-Path $targetDir "requirements.txt"

        Write-Host ("  Downloading {0} ..." -f $extensionAsset.name) -ForegroundColor Cyan
        Invoke-WebRequest -Uri $extensionAsset.browser_download_url -OutFile $extensionPath -UseBasicParsing -TimeoutSec 600

        Write-Host "  Downloading bridge_mcp_ghidra.py ..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $bridgeAsset.browser_download_url -OutFile $bridgePath -UseBasicParsing -TimeoutSec 600

        Write-Host "  Downloading requirements.txt ..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri $requirementsAsset.browser_download_url -OutFile $requirementsPath -UseBasicParsing -TimeoutSec 600

        ("Release: {0}`nTag: {1}`nExtensionZip: {2}`nDownloadedAt: {3}`n" -f $release.name, $release.tag_name, $extensionPath, (Get-Date).ToString("s")) |
            Set-Content -LiteralPath (Join-Path $targetDir "release.txt") -Encoding UTF8

        Write-Host ("  [OK]   GhidraMCP release assets saved to {0}" -f $targetDir) -ForegroundColor Green
        Write-Host ("         Extension ZIP: {0}" -f $extensionPath) -ForegroundColor Cyan
        Write-Host "         In Ghidra GUI: File > Install Extensions > Add" -ForegroundColor Cyan
        Write-Host "         Select the extension ZIP above, restart Ghidra, then enable:" -ForegroundColor Cyan
        Write-Host "         File > Configure > Configure All Plugins > GhidraMCP" -ForegroundColor Cyan
        Write-Host "         Then start: Tools > GhidraMCP > Start MCP Server" -ForegroundColor Cyan
        return $true
    }
    catch {
        Write-Host ("  [FAIL] {0}" -f $_.Exception.Message) -ForegroundColor Red
        return $false
    }
}

function Install-AssetRipper {
    param([string]$ToolsDir, [string]$Repo)

    $targetDir = Join-Path $ToolsDir "AssetRipper"
    $targetExe = Join-Path $targetDir "AssetRipper.exe"

    if (Test-Path -LiteralPath $targetExe) {
        Write-Host "  [SKIP] AssetRipper already at $targetExe" -ForegroundColor Yellow
        return $true
    }

    $zipPath    = Join-Path $env:TEMP "AssetRipper_win_x64.zip"
    $extractDir = Join-Path $env:TEMP ("AssetRipper_" + [guid]::NewGuid().ToString("N"))

    try {
        Write-Host "  Querying $Repo latest Windows release..." -ForegroundColor Cyan
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -UseBasicParsing -TimeoutSec 30 -Headers @{"User-Agent"="re-toolkit"}

        $asset = $release.assets | Where-Object { $_.name -eq "AssetRipper_win_x64.zip" } | Select-Object -First 1
        if (-not $asset) {
            Write-Host "  [FAIL] AssetRipper_win_x64.zip not in latest release." -ForegroundColor Red
            return $false
        }

        Write-Host ("  Downloading {0} ({1} MB)..." -f $asset.name, [math]::Round($asset.size/1MB,1)) -ForegroundColor Cyan
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UseBasicParsing -TimeoutSec 900

        if (Test-Path -LiteralPath $targetDir) { Remove-Item -LiteralPath $targetDir -Recurse -Force }
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

        New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

        $items = Get-ChildItem -LiteralPath $extractDir -Force
        $inner = if ($items.Count -eq 1 -and $items[0].PSIsContainer) { $items[0].FullName } else { $extractDir }

        Get-ChildItem -LiteralPath $inner -Force | ForEach-Object {
            if ($_.PSIsContainer) {
                Copy-Item -LiteralPath $_.FullName -Destination $targetDir -Recurse -Force
            } else {
                Copy-Item -LiteralPath $_.FullName -Destination $targetDir -Force
            }
        }

        $guiFree = Get-ChildItem -LiteralPath $targetDir -Recurse -Filter "AssetRipper.GUI.Free.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($guiFree -and -not (Test-Path -LiteralPath $targetExe)) {
            Copy-Item -LiteralPath $guiFree.FullName -Destination $targetExe -Force
        }

        if (Test-Path -LiteralPath $targetExe) {
            Write-Host ("  [OK]   AssetRipper installed at {0}" -f $targetDir) -ForegroundColor Green
            if ($guiFree) {
                $relSrc = $guiFree.FullName.Substring($targetDir.Length).TrimStart('\','/')
                Write-Host  ("         Original: {0}" -f $relSrc) -ForegroundColor Cyan
                Write-Host          "         Aliased : AssetRipper.exe (clone of AssetRipper.GUI.Free.exe)" -ForegroundColor Cyan
            }
            return $true
        }
        Write-Host "  [FAIL] AssetRipper.exe not created." -ForegroundColor Red
        return $false
    } catch {
        Write-Host "  [FAIL] $_" -ForegroundColor Red
        return $false
    } finally {
        if (Test-Path -LiteralPath $zipPath)    { Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

function Install-Il2CppDumper {
    param([string]$ToolsDir, [string]$Version)

    $il2cppDir = Join-Path $ToolsDir "Il2CppDumper"
    $il2cppExe = Join-Path $il2cppDir "Il2CppDumper.exe"
    if (Test-Path -LiteralPath $il2cppExe) {
        Write-Host "  [SKIP] Il2CppDumper already at $il2cppExe" -ForegroundColor Yellow
        return $true
    }

    if (-not (Get-Command "dotnet" -ErrorAction SilentlyContinue)) {
        Write-Host "  [FAIL] dotnet not on PATH. Run with -InstallRuntime for JDK/Python; .NET runtime is separate: winget install Microsoft.DotNet.Runtime.6" -ForegroundColor Red
        return $false
    }

    $runtimesText = (& dotnet --list-runtimes 2>&1 | Out-String)

    # Il2CppDumper releases are published as framework-dependent builds such as
    # net6.0 and net8.0.  Detect the actual Microsoft.NETCore.App runtime version,
    # not Microsoft.AspNetCore.App / WindowsDesktop.App, then choose the closest
    # package.  Keep this compatible with Windows PowerShell 5.1.
    $hasNet8 = $runtimesText -match '(?m)^Microsoft\.NETCore\.App\s+8\.'
    $hasNet6 = $runtimesText -match '(?m)^Microsoft\.NETCore\.App\s+6\.'

    if ($hasNet8) {
        $tfm = "net8.0"
    } elseif ($hasNet6) {
        $tfm = "net6.0"
    } else {
        $tfm = "net6.0"
        Write-Host "  [WARN] Microsoft.NETCore.App 6.x/8.x was not detected." -ForegroundColor Yellow
        Write-Host "         Il2CppDumper will be downloaded as net6.0; install runtime if it fails:" -ForegroundColor Yellow
        Write-Host "           winget install Microsoft.DotNet.Runtime.6" -ForegroundColor Yellow
        Write-Host "           winget install Microsoft.DotNet.DesktopRuntime.6" -ForegroundColor Yellow
    }

    $url = "https://github.com/wklin8607/Il2CppDumper/releases/download/Il2CppDumper/Il2CppDumper-v$Version-$tfm.zip"
    $zipPath = Join-Path $env:TEMP "Il2CppDumper-v$Version-$tfm.zip"
    $extractDir = Join-Path $env:TEMP ("Il2CppDumper_" + [guid]::NewGuid().ToString("N"))

    try {
        Write-Host ("  Downloading Il2CppDumper v{0} ({1})..." -f $Version, $tfm) -ForegroundColor Cyan
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -TimeoutSec 600

        New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

        if (Test-Path -LiteralPath $il2cppDir) { Remove-Item -LiteralPath $il2cppDir -Recurse -Force }
        New-Item -ItemType Directory -Path $il2cppDir -Force | Out-Null

        $items = Get-ChildItem -LiteralPath $extractDir -Force
        if ($items.Count -eq 1 -and $items[0].PSIsContainer) {
            Get-ChildItem -LiteralPath $items[0].FullName -Force | ForEach-Object {
                Move-Item -LiteralPath $_.FullName -Destination $il2cppDir -Force
            }
        } else {
            $items | ForEach-Object {
                Move-Item -LiteralPath $_.FullName -Destination $il2cppDir -Force
            }
        }

        if (Test-Path -LiteralPath $il2cppExe) {
            Write-Host ("  [OK]   Il2CppDumper v{0} ({1}) installed at {2}" -f $Version, $tfm, $il2cppDir) -ForegroundColor Green
            return $true
        }
        Write-Host "  [FAIL] Il2CppDumper.exe missing after extraction." -ForegroundColor Red
        return $false
    } catch {
        Write-Host "  [FAIL] $_" -ForegroundColor Red
        return $false
    } finally {
        if (Test-Path -LiteralPath $zipPath)    { Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force -ErrorAction SilentlyContinue }
    }
}

$startSweep = Clear-RetkTemp

Write-Host "RE Toolkit Setup" -ForegroundColor Magenta
Write-Host "InstallDir : $InstallDir"
Write-Host "Host       : $env:COMPUTERNAME"
Write-Host "OS         : $([System.Environment]::OSVersion.VersionString)"
if ($startSweep -gt 0) {
    Write-Host ("Pre-run sweep: cleared {0} leftover temp item(s) from previous interrupted runs." -f $startSweep) -ForegroundColor DarkGray
}

if ($InstallRuntime) {
    Write-Section "Runtime install (auto)"
    New-Item -ItemType Directory -Path $Runtime -Force | Out-Null
    Invoke-Install "Java"   { Install-Java   -Major     $JdkVersion    | Out-Null }
    Invoke-Install "Python" { Install-Python -Version   $PythonVersion | Out-Null }
    Refresh-Path
}

Write-Section "Runtime checks"

$java = Test-Command "java"
$javaOk = $false
$javaOnPath = Get-Command "java" -ErrorAction SilentlyContinue
if ($javaOnPath) {
    try {
        $ver = (cmd /c "java -version 2>&1" | Select-Object -First 1) -replace '"',''
        if (-not $ver) { $ver = "found" }
        Write-Host ("  [OK]   java                  {0} (system)" -f $ver.Trim()) -ForegroundColor Green
        $javaOk = $true
    } catch {
        Write-Host "  [OK]   java                  (found on PATH)" -ForegroundColor Green
        $javaOk = $true
    }
} else {
    $javaOk = $false
}

$portableJavaExe = Join-Path $PortableJava "bin\java.exe"
if (Test-Path -LiteralPath $portableJavaExe) {
    try {
        $pver = (cmd /c "`"$portableJavaExe`" -version 2>&1" | Select-Object -First 1) -replace '"',''
        if (-not $pver) { $pver = "found" }
        Write-Host ("  [OK]   java (portable)       {0}" -f $pver.Trim()) -ForegroundColor Green
        Write-Host  ("                            {0}" -f $PortableJava) -ForegroundColor DarkGray
        $javaOk = $true
    } catch {
        Write-Host "  [OK]   java (portable)       found" -ForegroundColor Green
        Write-Host  ("                            {0}" -f $PortableJava) -ForegroundColor DarkGray
        $javaOk = $true
    }
} elseif (-not $javaOk) {
    Write-Host "  [WARN] java                  NOT FOUND. Run with -InstallRuntime." -ForegroundColor Yellow
}

$python = Test-Command "python"
$pythonOk = $python.Found
if ($python.Found) {
    try {
        $pyVer = & $python.Path --version 2>&1
        Write-Host ("  [OK]   python                {0}" -f $pyVer) -ForegroundColor Green
    }
    catch {
        Write-Host ("  [WARN] python                found but failed to run: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
        $pythonOk = $false
    }
} elseif (Test-Path -LiteralPath $PythonDir) {
    Write-Host ("  [OK]   python                (portable) {0}" -f $PythonDir) -ForegroundColor Green
    $pythonOk = $true
} else {
    Write-Host "  [WARN] python                NOT FOUND. Run with -InstallRuntime." -ForegroundColor Yellow
}

$dotnet = Test-Command "dotnet"
if ($dotnet.Found) {
    $runtimes = & dotnet --list-runtimes 2>&1
    $desktop = $runtimes | Where-Object { $_ -match "WindowsDesktop" } | Select-Object -First 1
    $core    = $runtimes | Where-Object { $_ -match "App" }        | Select-Object -First 1
    Write-Host ("  [OK]   dotnet                {0}" -f $core) -ForegroundColor Green
    if (-not $desktop) {
        Write-Host "         Missing WindowsDesktop runtime (needed by Il2CppDumper). Install with:" -ForegroundColor Yellow
        Write-Host "           winget install Microsoft.DotNet.DesktopRuntime.8" -ForegroundColor Yellow
    } else {
        Write-Host ("         Desktop runtime: {0}" -f $desktop) -ForegroundColor Green
    }
} else {
    Write-Host "  [WARN] dotnet                NOT FOUND. Install .NET Desktop Runtime matching Il2CppDumper." -ForegroundColor Yellow
}

$uv = Test-Command "uv"
if ($uv.Found) {
    Write-Host ("  [OK]   uv                    {0}" -f (& uv --version)) -ForegroundColor Green
} else {
    Write-Host "  [WARN] uv                    NOT FOUND. Install: irm https://astral.sh/uv/install.ps1 | iex" -ForegroundColor Yellow
}

Write-Section "Tool folders"

$Tools = Join-Path $InstallDir "tools"
$toolsGhidra   = Join-Path $Tools "ghidra"
$toolsIl2cpp   = Join-Path $Tools "Il2CppDumper\Il2CppDumper.exe"
$toolsMcp      = Join-Path $Tools "ghidra-mcp\bridge_mcp_ghidra.py"
$toolsRipper   = Join-Path $Tools "AssetRipper\AssetRipper.exe"

if ($InstallGhidra) {
    if (-not $javaOk) {
        Write-Host "  [FAIL] JDK required before Ghidra install. Run with -InstallRuntime first." -ForegroundColor Red
    } else {
        Invoke-Install "Ghidra" { Install-GhidraRuntime -ToolsDir $Tools -Version $GhidraVersion | Out-Null }
    }
} else {
    Test-PathExists $toolsGhidra "Ghidra root" | Out-Null
}

if ($InstallIl2CppDumper) {
    Invoke-Install "Il2CppDumper" { Install-Il2CppDumper -ToolsDir $Tools -Version $Il2CppDumperVersion | Out-Null }
}
$il2cppOk = Test-PathExists $toolsIl2cpp "Il2CppDumper"
if (-not ($il2cppOk)) {
    Write-Host "         Tip: re-run with -InstallIl2CppDumper, or drop the binary at tools/Il2CppDumper/Il2CppDumper.exe" -ForegroundColor Yellow
}

$mcpOk = Test-PathExists $toolsMcp "Ghidra MCP bridge"
if (-not ($mcpOk)) {
    Write-Host "         Tip: re-run with -InstallGhidraMcp to install bethington/ghidra-mcp." -ForegroundColor Yellow
}

if ($InstallGhidraMcp) {
    Invoke-Install "GhidraMCP" { Install-GhidraMcp -ToolsDir $Tools -ReleaseApi $GhidraMcpReleaseApi -GhidraRoot $toolsGhidra | Out-Null }
    $mcpOk = Test-PathExists $toolsMcp "Ghidra MCP bridge"
}

if ($InstallAssetRipper) {
    Invoke-Install "AssetRipper" { Install-AssetRipper -ToolsDir $Tools -Repo $AssetRipperRepo | Out-Null }
}
Test-PathExists $toolsRipper "AssetRipper" | Out-Null

Write-Section "Workspace template"

$template = Join-Path $InstallDir "workspace-template"
$templateFolders = @(
    "00_OriginalBuild",
    "01_Extracted",
    "02_Il2CppDumperOutput",
    "03_GhidraProject",
    "04_Notes",
    "05_ReconstructedSource"
)
foreach ($f in $templateFolders) {
    $p = Join-Path $template $f
    if (-not (Test-Path -LiteralPath $p)) {
        New-Item -ItemType Directory -Path $p -Force | Out-Null
    }
    Write-Host ("  [OK]   {0}" -f $p) -ForegroundColor Green
}

Write-Section "Sample MCP configs"
Get-ChildItem -LiteralPath (Join-Path $InstallDir "config") -Filter *.json -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ("  [OK]   {0}" -f $_.FullName) -ForegroundColor Green
}
Get-ChildItem -LiteralPath (Join-Path $InstallDir "config") -Filter *.toml -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host ("  [OK]   {0}" -f $_.FullName) -ForegroundColor Green
}
$prompts = Join-Path $InstallDir "prompts"
if (Test-Path -LiteralPath $prompts) {
    Get-ChildItem -LiteralPath $prompts -Filter *.md -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host ("  [OK]   {0}" -f $_.FullName) -ForegroundColor Green
    }
}

Write-Section "Summary"

$missing = @()
if (-not $javaOk)        { $missing += "java (run -InstallRuntime)" }
if (-not $pythonOk)      { $missing += "python (run -InstallRuntime)" }
if (-not $dotnet.Found)  { $missing += ".NET" }
if (-not $uv.Found)      { $missing += "uv" }
if (-not (Test-Path -LiteralPath $toolsGhidra)) { $missing += "Ghidra (run -InstallGhidra)" }
if (-not $il2cppOk)      { $missing += "Il2CppDumper (run -InstallIl2CppDumper)" }
$ripperOk = Test-Path -LiteralPath $toolsRipper
if (-not $mcpOk)         { $missing += "Ghidra MCP (run -InstallGhidraMcp)" }
if (-not $ripperOk)      { $missing += "AssetRipper (run -InstallAssetRipper)" }

if ($missing.Count -eq 0) {
    Write-Host "All required components present. Toolkit ready." -ForegroundColor Green
} else {
    Write-Host ("Missing: " + ($missing -join ", ")) -ForegroundColor Yellow
    Write-Host "The toolkit will still work for commands whose dependencies are present."
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  .\install-re-toolkit.ps1 -InstallRuntime                # portable JDK + Python"
Write-Host "  .\install-re-toolkit.ps1 -InstallGhidra                 # Ghidra"
Write-Host "  .\install-re-toolkit.ps1 -InstallIl2CppDumper           # wklin8607/Il2CppDumper v6.7.48"
Write-Host "  .\install-re-toolkit.ps1 -InstallGhidraMcp              # bethington/ghidra-mcp plugin + bridge"
Write-Host "  .\install-re-toolkit.ps1 -InstallAssetRipper            # AssetRipper/AssetRipper latest"
Write-Host "  .\re.ps1 doctor                                        # check toolkit health"
Write-Host "  .\re.ps1 init    <GameName>"
Write-Host "  .\re.ps1 scan    <GameName> <ExtractedPath>             # detect libil2cpp.so / GameAssembly.dll"
Write-Host "  .\re.ps1 dump    <GameName>                             # run Il2CppDumper"
Write-Host "  .\re.ps1 import  <GameName>                             # Ghidra headless import, no analysis"
Write-Host "  .\re.ps1 flow    <GameName> <ExtractedPath>             # prepare project and open PyGhidra"
Write-Host "  .\re.ps1 ghidra-gui                                     # full GUI"
Write-Host "  .\re.ps1 mcp                                            # Ghidra MCP bridge"
Write-Host "  In Ghidra: File > Configure > Configure All Plugins > GhidraMCP"
Write-Host "  In Ghidra: Tools > GhidraMCP > Start MCP Server"

$endSweep = Clear-RetkTemp
if ($endSweep -gt 0) {
    Write-Host ""
    Write-Host ("Final temp sweep: cleared {0} leftover item(s) at script exit." -f $endSweep) -ForegroundColor DarkGray
}
