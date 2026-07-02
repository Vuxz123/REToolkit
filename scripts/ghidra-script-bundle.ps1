[CmdletBinding()]
param()

function New-GhidraScriptBundleResult {
    param(
        [Parameter(Mandatory)] [bool]$Registered,
        [Parameter(Mandatory)] [bool]$Changed,
        [Parameter(Mandatory)] [string]$Reason,
        [string]$ToolConfigPath = "",
        [string]$BundleDir = "",
        [string]$BundleValue = "",
        [string]$TemplatePath = "",
        [string]$BackupPath = "",
        [string]$Message = ""
    )

    return [pscustomobject]@{
        Registered     = $Registered
        Changed        = $Changed
        Reason         = $Reason
        ToolConfigPath = $ToolConfigPath
        BundleDir      = $BundleDir
        BundleValue    = $BundleValue
        TemplatePath    = $TemplatePath
        BackupPath     = $BackupPath
        Message        = $Message
    }
}

function Read-GhidraApplicationPropertiesFile {
    param([Parameter(Mandatory)] [string]$GhidraRoot)

    $propsPath = Join-Path $GhidraRoot "Ghidra\application.properties"
    if (-not (Test-Path -LiteralPath $propsPath)) {
        return $null
    }

    $props = @{}
    Get-Content -LiteralPath $propsPath | ForEach-Object {
        if ($_ -match '^([^#][^=]+)=(.*)$') {
            $props[$Matches[1].Trim()] = $Matches[2].Trim()
        }
    }

    return $props
}

function Get-GhidraUserSettingsDir {
    param(
        [Parameter(Mandatory)] [string]$GhidraRoot,
        [string]$ApplicationDataRoot = ""
    )

    $props = Read-GhidraApplicationPropertiesFile -GhidraRoot $GhidraRoot
    if (-not $props -or -not $props.ContainsKey("application.version")) {
        return ""
    }

    $version = $props["application.version"]
    $releaseName = if ($props.ContainsKey("application.release.name") -and -not [string]::IsNullOrWhiteSpace($props["application.release.name"])) {
        $props["application.release.name"]
    }
    else {
        "PUBLIC"
    }

    if ([string]::IsNullOrWhiteSpace($ApplicationDataRoot)) {
        $ApplicationDataRoot = [Environment]::GetFolderPath("ApplicationData")
    }

    return (Join-Path (Join-Path $ApplicationDataRoot "ghidra") ("ghidra_{0}_{1}" -f $version, $releaseName))
}

function Get-GhidraCodeBrowserToolConfigPath {
    param(
        [Parameter(Mandatory)] [string]$GhidraRoot,
        [string]$ApplicationDataRoot = ""
    )

    $settingsDir = Get-GhidraUserSettingsDir -GhidraRoot $GhidraRoot -ApplicationDataRoot $ApplicationDataRoot
    if ([string]::IsNullOrWhiteSpace($settingsDir)) {
        return ""
    }

    return (Join-Path $settingsDir "tools\_code_browser.tcd")
}

function Test-GhidraPathWithin {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$Parent
    )

    $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\','/'))
    $fullParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd([char[]]@('\','/'))

    return $fullPath.Equals($fullParent, [System.StringComparison]::OrdinalIgnoreCase) -or
        $fullPath.StartsWith($fullParent + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
}

function ConvertTo-GhidraBundlePathValue {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [string]$UserHome = ""
    )

    if ([string]::IsNullOrWhiteSpace($UserHome)) {
        $UserHome = [Environment]::GetFolderPath("UserProfile")
    }

    $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\','/'))
    if (-not [string]::IsNullOrWhiteSpace($UserHome)) {
        $fullUserHome = [System.IO.Path]::GetFullPath($UserHome).TrimEnd([char[]]@('\','/'))
        if (Test-GhidraPathWithin -Path $fullPath -Parent $fullUserHome) {
            $relative = $fullPath.Substring($fullUserHome.Length).TrimStart([char[]]@('\','/'))
            if ([string]::IsNullOrWhiteSpace($relative)) {
                return '$USER_HOME'
            }
            return ('$USER_HOME/' + ($relative -replace '\\','/'))
        }
    }

    return ($fullPath -replace '\\','/')
}

function Resolve-GhidraBundlePathValue {
    param(
        [Parameter(Mandatory)] [string]$Value,
        [string]$UserHome = "",
        [string]$GhidraRoot = ""
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return ""
    }

    if ([string]::IsNullOrWhiteSpace($UserHome)) {
        $UserHome = [Environment]::GetFolderPath("UserProfile")
    }

    $text = $Value -replace '/', '\'
    if ($text.StartsWith('$USER_HOME', [System.StringComparison]::OrdinalIgnoreCase)) {
        $suffix = $text.Substring('$USER_HOME'.Length).TrimStart([char[]]@('\','/'))
        $text = if ([string]::IsNullOrWhiteSpace($suffix)) { $UserHome } else { Join-Path $UserHome $suffix }
    }
    elseif (-not [string]::IsNullOrWhiteSpace($GhidraRoot) -and $text.StartsWith('$GHIDRA_HOME', [System.StringComparison]::OrdinalIgnoreCase)) {
        $suffix = $text.Substring('$GHIDRA_HOME'.Length).TrimStart([char[]]@('\','/'))
        $text = if ([string]::IsNullOrWhiteSpace($suffix)) { $GhidraRoot } else { Join-Path $GhidraRoot $suffix }
    }

    try {
        return [System.IO.Path]::GetFullPath($text).TrimEnd([char[]]@('\','/'))
    }
    catch {
        return $text.TrimEnd([char[]]@('\','/'))
    }
}

function Get-GhidraBundleArrayNode {
    param(
        [Parameter(Mandatory)] [xml]$Document,
        [Parameter(Mandatory)] [string]$Name
    )

    return $Document.SelectSingleNode("//PLUGIN_STATE[@CLASS='ghidra.app.plugin.core.script.GhidraScriptMgrPlugin']/ARRAY[@NAME='$Name']")
}

function Get-GhidraArrayItems {
    param([Parameter(Mandatory)] [System.Xml.XmlNode]$ArrayNode)

    return @($ArrayNode.SelectNodes("A"))
}

function Add-GhidraArrayValue {
    param(
        [Parameter(Mandatory)] [System.Xml.XmlNode]$ArrayNode,
        [Parameter(Mandatory)] [string]$Value
    )

    $node = $ArrayNode.OwnerDocument.CreateElement("A")
    $node.SetAttribute("VALUE", $Value)
    [void]$ArrayNode.AppendChild($node)
}

function Save-GhidraXmlDocument {
    param(
        [Parameter(Mandatory)] [xml]$Document,
        [Parameter(Mandatory)] [string]$Path
    )

    $settings = New-Object System.Xml.XmlWriterSettings
    $settings.Encoding = New-Object System.Text.UTF8Encoding($false)
    $settings.Indent = $true
    $settings.NewLineChars = "`r`n"
    $settings.OmitXmlDeclaration = $false

    $writer = [System.Xml.XmlWriter]::Create($Path, $settings)
    try {
        $Document.Save($writer)
    }
    finally {
        $writer.Close()
    }
}

function Initialize-GhidraToolConfigFromTemplate {
    param(
        [Parameter(Mandatory)] [string]$ToolConfigPath,
        [string]$TemplatePath = ""
    )

    if (Test-Path -LiteralPath $ToolConfigPath -PathType Leaf) {
        return $false
    }

    if ([string]::IsNullOrWhiteSpace($TemplatePath) -or -not (Test-Path -LiteralPath $TemplatePath -PathType Leaf)) {
        return $false
    }

    $parent = Split-Path -Parent $ToolConfigPath
    if ($parent) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    Copy-Item -LiteralPath $TemplatePath -Destination $ToolConfigPath -Force
    return $true
}

function Register-GhidraScriptBundle {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$ToolConfigPath,
        [Parameter(Mandatory)] [string]$BundleDir,
        [string]$UserHome = "",
        [string]$GhidraRoot = "",
        [string]$TemplatePath = "",
        [switch]$CreateBackup
    )

    if ([string]::IsNullOrWhiteSpace($UserHome)) {
        $UserHome = [Environment]::GetFolderPath("UserProfile")
    }

    $bundleValue = ConvertTo-GhidraBundlePathValue -Path $BundleDir -UserHome $UserHome

    if (-not (Test-Path -LiteralPath $BundleDir -PathType Container)) {
        return New-GhidraScriptBundleResult -Registered $false -Changed $false -Reason "MissingBundleDir" -ToolConfigPath $ToolConfigPath -BundleDir $BundleDir -BundleValue $bundleValue
    }

    $createdFromTemplate = Initialize-GhidraToolConfigFromTemplate -ToolConfigPath $ToolConfigPath -TemplatePath $TemplatePath

    if (-not (Test-Path -LiteralPath $ToolConfigPath -PathType Leaf)) {
        return New-GhidraScriptBundleResult -Registered $false -Changed $false -Reason "MissingToolConfig" -ToolConfigPath $ToolConfigPath -BundleDir $BundleDir -BundleValue $bundleValue -TemplatePath $TemplatePath
    }

    [xml]$document = Get-Content -LiteralPath $ToolConfigPath -Raw
    $pluginState = $document.SelectSingleNode("//PLUGIN_STATE[@CLASS='ghidra.app.plugin.core.script.GhidraScriptMgrPlugin']")
    if (-not $pluginState) {
        return New-GhidraScriptBundleResult -Registered $false -Changed $false -Reason "MissingScriptPluginState" -ToolConfigPath $ToolConfigPath -BundleDir $BundleDir -BundleValue $bundleValue
    }

    $activeArray = Get-GhidraBundleArrayNode -Document $document -Name "BundleHost_ACTIVE"
    $enableArray = Get-GhidraBundleArrayNode -Document $document -Name "BundleHost_ENABLE"
    $fileArray = Get-GhidraBundleArrayNode -Document $document -Name "BundleHost_FILE"
    $systemArray = Get-GhidraBundleArrayNode -Document $document -Name "BundleHost_SYSTEM"

    if (-not $activeArray -or -not $enableArray -or -not $fileArray -or -not $systemArray) {
        return New-GhidraScriptBundleResult -Registered $false -Changed $false -Reason "MissingBundleHostArrays" -ToolConfigPath $ToolConfigPath -BundleDir $BundleDir -BundleValue $bundleValue
    }

    $activeItems = Get-GhidraArrayItems -ArrayNode $activeArray
    $enableItems = Get-GhidraArrayItems -ArrayNode $enableArray
    $fileItems = Get-GhidraArrayItems -ArrayNode $fileArray
    $systemItems = Get-GhidraArrayItems -ArrayNode $systemArray

    if ($activeItems.Count -ne $fileItems.Count -or $enableItems.Count -ne $fileItems.Count -or $systemItems.Count -ne $fileItems.Count) {
        return New-GhidraScriptBundleResult -Registered $false -Changed $false -Reason "InvalidBundleHostArrays" -ToolConfigPath $ToolConfigPath -BundleDir $BundleDir -BundleValue $bundleValue
    }

    $targetFullPath = [System.IO.Path]::GetFullPath($BundleDir).TrimEnd([char[]]@('\','/'))
    $existingIndex = -1
    for ($i = 0; $i -lt $fileItems.Count; $i++) {
        $existingValue = $fileItems[$i].GetAttribute("VALUE")
        $existingFullPath = Resolve-GhidraBundlePathValue -Value $existingValue -UserHome $UserHome -GhidraRoot $GhidraRoot
        if ($existingFullPath.Equals($targetFullPath, [System.StringComparison]::OrdinalIgnoreCase) -or
            $existingValue.Equals($bundleValue, [System.StringComparison]::OrdinalIgnoreCase)) {
            $existingIndex = $i
            break
        }
    }

    $changed = $false
    $reason = "AlreadyRegistered"

    if ($existingIndex -ge 0) {
        if ($enableItems[$existingIndex].GetAttribute("VALUE") -ne "true") {
            $enableItems[$existingIndex].SetAttribute("VALUE", "true")
            $changed = $true
        }
        if ($systemItems[$existingIndex].GetAttribute("VALUE") -ne "false") {
            $systemItems[$existingIndex].SetAttribute("VALUE", "false")
            $changed = $true
        }
        if ($changed) {
            $reason = "Updated"
        }
    }
    else {
        Add-GhidraArrayValue -ArrayNode $activeArray -Value "false"
        Add-GhidraArrayValue -ArrayNode $enableArray -Value "true"
        Add-GhidraArrayValue -ArrayNode $fileArray -Value $bundleValue
        Add-GhidraArrayValue -ArrayNode $systemArray -Value "false"
        $changed = $true
        $reason = "Added"
    }

    $backupPath = ""
    if ($changed) {
        if ($CreateBackup -and -not $createdFromTemplate) {
            $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
            $backupPath = "{0}.bak.{1}" -f $ToolConfigPath, $timestamp
            Copy-Item -LiteralPath $ToolConfigPath -Destination $backupPath -Force
        }
        Save-GhidraXmlDocument -Document $document -Path $ToolConfigPath
    }

    return New-GhidraScriptBundleResult -Registered $true -Changed $changed -Reason $reason -ToolConfigPath $ToolConfigPath -BundleDir $BundleDir -BundleValue $bundleValue -TemplatePath $TemplatePath -BackupPath $backupPath
}
