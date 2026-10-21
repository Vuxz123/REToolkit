#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [string]$LockedManifest = "",
    [string]$PythonManifest = "",
    [string]$PackageCache = "",
    [switch]$Plan,
    [switch]$InstallGhidra,
    [switch]$InstallGhidraMcp,
    [switch]$InstallIl2CppDumper,
    [switch]$InstallAssetRipper,
    [switch]$InstallRuntime,
    [switch]$InstallDotNetRuntime,
    [switch]$All,
    [switch]$NativeOnly,
    [int]$JdkVersion = 21,
    [string]$JdkReleaseVersion = "21.0.11",
    [int]$DotNetRuntimeMajor = 8,
    [string]$PythonVersion = "3.12.10",
    [string]$GhidraVersion = "12.1.2",
    [string]$Il2CppDumperVersion = "6.7.48",
    [string]$GhidraMcpReleaseApi = "https://api.github.com/repos/bethington/ghidra-mcp/releases/latest",
    [string]$AssetRipperRepo = "AssetRipper/AssetRipper",
    [string]$AssetRipperVersion = "1.3.14"
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($InstallDir)) { $InstallDir = $PSScriptRoot }
$entryFile = Join-Path $PSScriptRoot 're.js'
$nodeArguments = @()

# Exact manifests retain their original offline plan/cached install routes.
if (-not [string]::IsNullOrWhiteSpace($LockedManifest) -or -not [string]::IsNullOrWhiteSpace($PythonManifest)) {
    $manifestParameter = if (-not [string]::IsNullOrWhiteSpace($PythonManifest)) { 'PythonManifest' } else { 'LockedManifest' }
    $manifestPath = if ($manifestParameter -eq 'PythonManifest') { $PythonManifest } else { $LockedManifest }
    $cliCommand = if ($manifestParameter -eq 'PythonManifest') { 'python-runtime' } else { 'toolchain' }
    foreach ($parameterName in $PSBoundParameters.Keys) {
        if ($parameterName -notin @('InstallDir', $manifestParameter, 'PackageCache', 'Plan')) {
            throw "$manifestParameter cannot be combined with other manifest or legacy install/version flags: $parameterName"
        }
    }
    if ($Plan -and -not [string]::IsNullOrWhiteSpace($PackageCache)) {
        throw 'PackageCache is only supported for locked installation, not Plan.'
    }
    $nodeArguments = @($entryFile, $cliCommand, $(if ($Plan) { 'plan' } else { 'install' }), $manifestPath, '--root', $InstallDir, '--json')
}
else {
    foreach ($parameterName in @('LockedManifest', 'PythonManifest')) {
        if ($PSBoundParameters.ContainsKey($parameterName)) { throw "$parameterName must name a non-empty exact manifest." }
    }
    if ($NativeOnly -and -not $All) { throw 'NativeOnly requires All.' }

    $selectJdk = $All -or $InstallGhidra -or $InstallRuntime
    $selectGhidra = $All -or $InstallGhidra
    $selectDumper = $All -or $InstallIl2CppDumper
    $selectAssetRipper = $All -or $InstallAssetRipper

    # Only explicitly supplied legacy options need validation. Their retained
    # parameter defaults must never block a supported native setup request.
    $versionSelections = @{
        JdkVersion = $selectJdk
        JdkReleaseVersion = $selectJdk
        GhidraVersion = $selectGhidra
        Il2CppDumperVersion = $selectDumper
        AssetRipperVersion = $selectAssetRipper
        PythonVersion = ($InstallRuntime -or ($All -and -not $NativeOnly))
        DotNetRuntimeMajor = ($InstallDotNetRuntime -or ($All -and -not $NativeOnly))
        GhidraMcpReleaseApi = ($InstallGhidraMcp -or ($All -and -not $NativeOnly))
        AssetRipperRepo = $selectAssetRipper
    }
    foreach ($parameterName in $versionSelections.Keys) {
        if ($PSBoundParameters.ContainsKey($parameterName) -and -not $versionSelections[$parameterName]) {
            throw "$parameterName requires its corresponding install component."
        }
    }
    if ($PSBoundParameters.ContainsKey('JdkVersion') -and $JdkVersion -ne 21) {
        throw 'Only JdkVersion 21 is supported. Use JdkReleaseVersion for an exact JDK21 release.'
    }
    if ($PSBoundParameters.ContainsKey('AssetRipperRepo') -and $AssetRipperRepo -cne 'AssetRipper/AssetRipper') {
        throw 'Custom AssetRipperRepo endpoints are unsupported; use a reviewed LockedManifest.'
    }
    if ($PSBoundParameters.ContainsKey('GhidraMcpReleaseApi') -and $GhidraMcpReleaseApi -cne 'https://api.github.com/repos/bethington/ghidra-mcp/releases/latest') {
        throw 'Custom GhidraMcpReleaseApi endpoints are unsupported; a GUI extension profile is required.'
    }
    if ($PSBoundParameters.ContainsKey('PythonVersion') -and $PythonVersion -cne '3.12.10') {
        throw 'Custom PythonVersion is unsupported by native setup; use an exact PythonManifest.'
    }
    if ($PSBoundParameters.ContainsKey('DotNetRuntimeMajor') -and $DotNetRuntimeMajor -ne 8) {
        throw 'Custom DotNetRuntimeMajor is unsupported; a dotnet installation profile is required.'
    }

    $components = @()
    if ($selectJdk) { $components += 'jdk' }
    if ($selectGhidra) { $components += 'ghidra' }
    if ($selectDumper) { $components += 'dumper' }
    if ($selectAssetRipper) { $components += 'assetripper' }
    $requirements = @()
    if ($InstallRuntime) { $requirements += 'python-gui' }
    if ($InstallGhidraMcp) { $requirements += 'ghidra-mcp-gui' }
    if ($InstallDotNetRuntime) { $requirements += 'dotnet' }

    $hasSelection = $All -or $components.Count -gt 0 -or $requirements.Count -gt 0
    if (-not [string]::IsNullOrWhiteSpace($PackageCache) -and ($Plan -or -not $hasSelection)) {
        throw 'PackageCache requires an installation selection and cannot be combined with Plan.'
    }
    $action = if ($Plan) { 'plan' } elseif ($hasSelection) { 'install' } else { 'status' }
    $nodeArguments = @($entryFile, 'setup', $action, '--root', $InstallDir, '--json')
    if ($All) {
        $nodeArguments += '--all'
        if ($NativeOnly) { $nodeArguments += '--native-only' }
    }
    elseif ($components.Count -gt 0) { $nodeArguments += @('--components', ($components -join ',')) }
    if ($selectJdk) { $nodeArguments += @('--jdk-version', $JdkReleaseVersion) }
    if ($selectGhidra) { $nodeArguments += @('--ghidra-version', $GhidraVersion) }
    if ($selectDumper) { $nodeArguments += @('--dumper-version', $Il2CppDumperVersion) }
    if ($selectAssetRipper) { $nodeArguments += @('--assetripper-version', $AssetRipperVersion) }
    foreach ($requirement in $requirements) { $nodeArguments += @('--require-component', $requirement) }
}
if (-not [string]::IsNullOrWhiteSpace($PackageCache)) { $nodeArguments += @('--cache', $PackageCache) }

# This check is read-only. Node owns all metadata, profile preflight and engine
# transactions; there is no PowerShell installer fallback.
try { $nodeCommand = Get-Command node -ErrorAction Stop }
catch { throw 'Node.js >=24 is required. Install Node.js 24 or newer and rerun this adapter.' }
if (-not (Test-Path -LiteralPath $entryFile -PathType Leaf)) { throw "JavaScript CLI not found: $entryFile" }
$nodeVersion = & $nodeCommand.Source --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.\d+\.\d+$' -or [int]$Matches[1] -lt 24) {
    throw 'Node.js >=24 is required. Install Node.js 24 or newer and rerun this adapter.'
}
& $nodeCommand.Source @nodeArguments
exit $LASTEXITCODE
