param([switch]$LibraryOnly)
$ErrorActionPreference = 'Stop'

function Get-CanonicalPathEntry([string]$Entry) {
    $expanded = [Environment]::ExpandEnvironmentVariables($Entry.Trim().Trim('"'))
    if ([string]::IsNullOrWhiteSpace($expanded)) { return '' }
    try { return [IO.Path]::GetFullPath($expanded).TrimEnd('\', '/').ToUpperInvariant() }
    catch { return $expanded.TrimEnd('\', '/').ToUpperInvariant() }
}

# Compare expanded entries only to recognize our managed bin. Preserve the full
# original value: two currently equal %VARIABLE% entries may diverge later.
function Merge-UserPathValue([string]$RawPath, [string]$Bin) {
    $target = Get-CanonicalPathEntry $Bin
    foreach ($entry in ($RawPath -split ';')) {
        $canonical = Get-CanonicalPathEntry $entry
        if ($canonical -eq $target) {
            return [pscustomobject]@{ value = $RawPath; state = 'present' }
        }
    }
    $value = $Bin
    if (-not [string]::IsNullOrEmpty($RawPath)) { $value = $RawPath + ';' + $Bin }
    return [pscustomobject]@{ value = $value; state = 'added' }
}

if ($LibraryOnly) { return }

$bin = $env:RETK_QUICKSTART_BIN
if ([string]::IsNullOrWhiteSpace($bin) -or -not [IO.Path]::IsPathRooted($bin) -or $bin.Contains(';') -or -not [IO.Directory]::Exists($bin)) {
    throw 'RETK_QUICKSTART_BIN must name an existing absolute managed bin directory.'
}

# Only HKCU is opened for writing. Preserve the existing registry value kind.
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
try {
    $raw = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
    if ($key.GetValueNames() -contains 'Path') { $kind = $key.GetValueKind('Path') }
    if ($kind -ne [Microsoft.Win32.RegistryValueKind]::String -and $kind -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) {
        throw 'User Path registry value has an unsupported type; inspect it manually.'
    }
    $merged = Merge-UserPathValue $raw $bin
    if ($merged.value -cne $raw) {
        $key.SetValue('Path', $merged.value, $kind)
        # Notify Explorer so subsequently opened terminals inherit the new value.
        # SetEnvironmentVariable(User) would flatten the preserved registry kind.
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RetkEnvironmentNotification {
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(IntPtr window, uint message,
        UIntPtr parameter, string value, uint flags, uint timeout, out UIntPtr result);
}
'@
        $notificationResult = [UIntPtr]::Zero
        [void][RetkEnvironmentNotification]::SendMessageTimeout([IntPtr]0xffff, 0x001a,
            [UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$notificationResult)
    }
    [pscustomobject]@{ state = $merged.state } | ConvertTo-Json -Compress
} finally { $key.Dispose() }
