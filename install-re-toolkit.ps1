[CmdletBinding()]
param(
    [string]$InstallDir = (Split-Path -Parent $MyInvocation.MyCommand.Path),
    [switch]$InstallGhidra,
    [switch]$InstallGhidraCli,
    [switch]$InstallIl2CppDumper,
    [switch]$InstallAssetRipper,
    [switch]$InstallRuntime,
    [int]$JdkVersion = 21,
    [string]$PythonVersion = "3.12",
    [string]$RustToolchain = "stable",
    [string]$GhidraVersion = "",
    [string]$Il2CppDumperVersion = "6.7.48",
    [string]$AssetRipperRepo = "AssetRipper/AssetRipper"
)

$ErrorActionPreference = "Stop"
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
        "ghidra-cli-src",
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

function Install-Rust {
    param([string]$Toolchain)

    $cargo = Get-Command "cargo" -ErrorAction SilentlyContinue
    if ($cargo) {
        Write-Host "  [SKIP] cargo already at $($cargo.Source)" -ForegroundColor Yellow
        return $true
    }

    $winget = Get-Command "winget" -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host "  Installing Rust via winget..." -ForegroundColor Cyan
        & winget install --id Rustlang.Rustup -e --source winget --accept-package-agreements --accept-source-agreements
    }

    if (-not (Get-Command "cargo" -ErrorAction SilentlyContinue)) {
        $exe = Join-Path $env:TEMP "rustup-init.exe"
        try {
            Write-Host "  Fetching rustup-init..." -ForegroundColor Cyan
            Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $exe -UseBasicParsing -TimeoutSec 600
            & $exe -y --default-toolchain $Toolchain --profile minimal --no-modify-path
        } finally {
            if (Test-Path -LiteralPath $exe) { Remove-Item -LiteralPath $exe -Force -ErrorAction SilentlyContinue }
        }
    }

    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    if (Test-Path -LiteralPath $cargoBin) {
        $env:Path = "$cargoBin;$env:Path"
        [System.Environment]::SetEnvironmentVariable("Path", [System.Environment]::GetEnvironmentVariable("Path","User") + ";$cargoBin", "User")
        $env:CARGO_HOME = Join-Path $env:USERPROFILE ".cargo"
        $env:RUSTUP_HOME = Join-Path $env:USERPROFILE ".rustup"
        [System.Environment]::SetEnvironmentVariable("CARGO_HOME", $env:CARGO_HOME, "User")
        [System.Environment]::SetEnvironmentVariable("RUSTUP_HOME", $env:RUSTUP_HOME, "User")
    }

    $ver = (Get-Command "cargo" -ErrorAction SilentlyContinue)
    if ($ver) {
        Write-Host ("  [OK]   cargo installed at {0}" -f $ver.Source) -ForegroundColor Green
        return $true
    }
    Write-Host "  [FAIL] cargo not found on PATH after install." -ForegroundColor Red
    return $false
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
        Write-Host "  [FAIL] dotnet not on PATH. Run with -InstallRuntime (installs JDK+Python+Rust; .NET runtime is separate: winget install Microsoft.DotNet.Runtime.6)" -ForegroundColor Red
        return $false
    }

    $runtimes = (& dotnet --list-runtimes 2>&1 | Out-String)
    $tfm  = if ($runtimes -match "Microsoft\.NETCore\.App 8\.") { "net8.0" } else { "net6.0" }
    $tfmMatches = ($runtimes | Select-String -Pattern "Microsoft\.NETCore\.App $tfm" -SimpleMatching:$false) -as [string]
    if (-not ($runtimes -match "Microsoft\.NETCore\.App $($tfm.TrimEnd('0').TrimEnd('.'))\.")) {
        Write-Host "  [WARN] No matching .NET runtime for $tfm detected; install with:" -ForegroundColor Yellow
        if ($tfm -eq "net8.0") { Write-Host "           winget install Microsoft.DotNet.Runtime.8" -ForegroundColor Yellow }
        else                    { Write-Host "           winget install Microsoft.DotNet.Runtime.6" -ForegroundColor Yellow }
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

function Install-GhidraCli {
    param([string]$ToolsDir)

    $targetDir = Join-Path $ToolsDir "ghidra-cli"
    $targetBin = Join-Path $targetDir "ghidra.exe"

    if (Test-Path -LiteralPath $targetBin) {
        Write-Host "  [SKIP] ghidra-cli already at $targetBin" -ForegroundColor Yellow
        return $true
    }

    $existing = Get-Command "ghidra" -ErrorAction SilentlyContinue
    if ($existing) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        Copy-Item -LiteralPath $existing.Source -Destination $targetBin -Force
        Write-Host ("  [OK]   Copied existing ghidra-cli from PATH to {0}" -f $targetBin) -ForegroundColor Green
        return $true
    }

    $cargo = Get-Command "cargo" -ErrorAction SilentlyContinue
    if (-not $cargo) {
        Write-Host "  [FAIL] cargo not found. Re-run with -InstallRuntime or install Rust from https://rustup.rs/" -ForegroundColor Red
        return $false
    }

    Write-Host "  Installing ghidra-cli via cargo (this may take a few minutes)..." -ForegroundColor Cyan
    $repoDir = Join-Path $env:TEMP "ghidra-cli-src"
    if (Test-Path -LiteralPath $repoDir) { Remove-Item -LiteralPath $repoDir -Recurse -Force }
    & git clone --depth 1 https://github.com/akiselev/ghidra-cli.git $repoDir 2>&1 | Out-Null
    if (Test-Path -LiteralPath $targetDir) { Remove-Item -LiteralPath $targetDir -Recurse -Force }
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    & cargo install --path $repoDir --root $targetDir 2>&1 | Out-Null

    $cargoBin = Join-Path (Join-Path $targetDir "bin") "ghidra.exe"
    if (Test-Path -LiteralPath $cargoBin) {
        Move-Item -LiteralPath $cargoBin -Destination $targetBin -Force
        if (Test-Path -LiteralPath (Join-Path $targetDir "bin")) {
            Remove-Item -LiteralPath (Join-Path $targetDir "bin") -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -LiteralPath $repoDir -Recurse -Force -ErrorAction SilentlyContinue

    if (Test-Path -LiteralPath $targetBin) {
        Write-Host ("  [OK]   ghidra-cli installed at {0}" -f $targetBin) -ForegroundColor Green

        $ghidraRoot = Join-Path $ToolsDir "ghidra"
        if (Test-Path -LiteralPath $ghidraRoot) {
            Seed-GhidraCliConfig -GhidraExe $targetBin -GhidraRoot $ghidraRoot
        }
        return $true
    }
    Write-Host "  [FAIL] cargo install did not produce $targetBin." -ForegroundColor Red
    return $false
}

function Seed-GhidraCliConfig {
    param([string]$GhidraExe, [string]$GhidraRoot)
    $cfgDir = Join-Path $env:APPDATA "ghidra-cli"
    $cfgFile = Join-Path $cfgDir "config.yaml"
    if (Test-Path -LiteralPath $cfgFile) {
        Write-Host "  [INFO] ghidra-cli config already exists: $cfgFile" -ForegroundColor DarkGray
        return
    }
    New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null
    $yaml = "ghidra_install_dir: `"$($GhidraRoot -replace '\\','\\\\')`"`n"
    Set-Content -LiteralPath $cfgFile -Value $yaml -Encoding UTF8
    Write-Host "  [FIX] Seeded ghidra-cli config: $cfgFile" -ForegroundColor Cyan
    Write-Host "         (pointed at $GhidraRoot)" -ForegroundColor Cyan
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
    Invoke-Install "Rust"   { Install-Rust   -Toolchain $RustToolchain | Out-Null }
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
    $pyVer = & python --version 2>&1
    Write-Host ("  [OK]   python                {0}" -f $pyVer) -ForegroundColor Green
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

$cargo = Test-Command "cargo"
if ($cargo.Found) {
    Write-Host ("  [OK]   cargo                 {0}" -f (& cargo --version)) -ForegroundColor Green
} else {
    Write-Host "  [WARN] cargo                 NOT FOUND. Run with -InstallRuntime." -ForegroundColor Yellow
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
    Write-Host "         Tip: install via 'uv tool install mcp-server-ghidra' or drop a wrapper script at the path above." -ForegroundColor Yellow
}

if ($InstallAssetRipper) {
    Invoke-Install "AssetRipper" { Install-AssetRipper -ToolsDir $Tools -Repo $AssetRipperRepo | Out-Null }
}
Test-PathExists $toolsRipper "AssetRipper" | Out-Null

$ghidraCli = Get-Command "ghidra" -ErrorAction SilentlyContinue
if ($ghidraCli) {
    Write-Host ("  [OK]   ghidra-cli (binary)   {0}" -f $ghidraCli.Source) -ForegroundColor Green
    $ghidraCliOk = $true
} else {
    Write-Host "  [WARN] ghidra-cli (binary)   NOT FOUND. Run with -InstallGhidraCli (requires cargo)" -ForegroundColor Yellow
    $ghidraCliOk = $false
}

if ($InstallGhidraCli) {
    Invoke-Install "ghidra-cli" { Install-GhidraCli -ToolsDir $Tools | Out-Null }
}

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
if (-not $mcpOk)         { $missing += "Ghidra MCP" }
if (-not $ghidraCliOk)   { $missing += "ghidra-cli (run -InstallGhidraCli)" }
if (-not $ripperOk)      { $missing += "AssetRipper (run -InstallAssetRipper)" }

if ($missing.Count -eq 0) {
    Write-Host "All required components present. Toolkit ready." -ForegroundColor Green
} else {
    Write-Host ("Missing: " + ($missing -join ", ")) -ForegroundColor Yellow
    Write-Host "The toolkit will still work for commands whose dependencies are present."
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  .\install-re-toolkit.ps1 -InstallRuntime                # portable JDK + Python + Rust"
Write-Host "  .\install-re-toolkit.ps1 -InstallGhidra                 # Ghidra 11.x"
Write-Host "  .\install-re-toolkit.ps1 -InstallIl2CppDumper           # wklin8607/Il2CppDumper v6.7.48"
Write-Host "  .\install-re-toolkit.ps1 -InstallAssetRipper            # AssetRipper/AssetRipper latest"
Write-Host "  .\install-re-toolkit.ps1 -InstallGhidraCli              # ghidra-cli (needs cargo; lands at tools\ghidra-cli\ghidra.exe)"
Write-Host "  .\re.ps1 doctor                                        # check toolkit health"
Write-Host "  .\re.ps1 init    <GameName>"
Write-Host "  .\re.ps1 scan    <GameName> <ExtractedPath>             # detect libil2cpp.so / GameAssembly.dll"
Write-Host "  .\re.ps1 dump    <GameName>                             # run Il2CppDumper"
Write-Host "  .\re.ps1 import  <GameName>                             # ghidra-cli import"
Write-Host "  .\re.ps1 analyze <GameName>                             # ghidra-cli analyze"
Write-Host "  .\re.ps1 flow    <GameName> <ExtractedPath>             # all of the above, in order"
Write-Host "  .\re.ps1 summary <GameName>                             # ghidra-cli summary"
Write-Host "  .\re.ps1 ghidra-cli --% doctor                          # raw ghidra-cli passthrough"
Write-Host "  .\re.ps1 ghidra-gui                                     # full GUI"
Write-Host "  .\re.ps1 mcp                                            # Ghidra MCP bridge"
Write-Host "  .\re.ps1 install-skill                                  # gh install-ghidra-reverse-engineering-cli skill"

$endSweep = Clear-RetkTemp
if ($endSweep -gt 0) {
    Write-Host ""
    Write-Host ("Final temp sweep: cleared {0} leftover item(s) at script exit." -f $endSweep) -ForegroundColor DarkGray
}
