# Dot-sourced by re.ps1. Uses shared REToolkit variables from the entrypoint.

function Get-Il2CppDumperGhidraPy3Script {
    return @'
# -*- coding: utf-8 -*-
import json
import re
from ghidra.program.model.symbol import SourceType

PROCESS_FIELDS = [
    "ScriptMethod",
    "ScriptString",
    "ScriptMetadata",
    "ScriptMetadataMethod",
    "Addresses",
]

USER_DEFINED = SourceType.USER_DEFINED
base_address = currentProgram.getImageBase()


def as_text(value):
    if isinstance(value, bytes):
        return value.decode("utf-8", "replace")
    if value is None:
        return ""
    return str(value)


def to_offset(value):
    if isinstance(value, str):
        value = value.strip()
        if value.lower().startswith("0x"):
            return int(value, 16)
        return int(value, 10)
    return int(value)


def get_addr(addr):
    return base_address.add(to_offset(addr))


def symbol_name(name):
    text = as_text(name).strip().replace(" ", "-")
    if not text:
        text = "il2cpp_empty"
    text = re.sub(r"[^0-9A-Za-z_.$<>:@?`~-]", "_", text)
    if text[0].isdigit():
        text = "_" + text
    return text


def set_name(addr, name):
    try:
        createLabel(addr, symbol_name(name), True, USER_DEFINED)
    except Exception as exc:
        print("WARN: createLabel failed at {}: {}".format(addr, exc))


def set_comment(addr, value):
    text = as_text(value)
    if not text:
        return
    try:
        setEOLComment(addr, text)
    except Exception as exc:
        print("WARN: setEOLComment failed at {}: {}".format(addr, exc))


def make_function(start):
    if getFunctionAt(start) is not None:
        return
    try:
        createFunction(start, None)
    except Exception as exc:
        print("WARN: createFunction failed at {}: {}".format(start, exc))


def java_file_path(file_obj):
    if hasattr(file_obj, "getAbsolutePath"):
        return file_obj.getAbsolutePath()
    if hasattr(file_obj, "absolutePath"):
        return file_obj.absolutePath
    return str(file_obj)


def load_script_json():
    file_obj = askFile("script.json from Il2CppDumper", "Open")
    script_json_path = java_file_path(file_obj)
    with open(script_json_path, "r", encoding="utf-8") as fp:
        return script_json_path, json.load(fp)


def start_progress(items, message):
    try:
        monitor.initialize(len(items))
        monitor.setMessage(message)
    except Exception:
        pass


def step_progress():
    try:
        monitor.incrementProgress(1)
    except Exception:
        pass


def process_methods(data):
    if "ScriptMethod" not in data or "ScriptMethod" not in PROCESS_FIELDS:
        return
    items = data["ScriptMethod"]
    start_progress(items, "Methods")
    for item in items:
        addr = get_addr(item["Address"])
        set_name(addr, item["Name"])
        step_progress()


def process_strings(data):
    if "ScriptString" not in data or "ScriptString" not in PROCESS_FIELDS:
        return
    items = data["ScriptString"]
    start_progress(items, "Strings")
    for index, item in enumerate(items, 1):
        addr = get_addr(item["Address"])
        set_name(addr, "StringLiteral_{}".format(index))
        set_comment(addr, item["Value"])
        step_progress()


def process_metadata(data):
    if "ScriptMetadata" not in data or "ScriptMetadata" not in PROCESS_FIELDS:
        return
    items = data["ScriptMetadata"]
    start_progress(items, "Metadata")
    for item in items:
        addr = get_addr(item["Address"])
        name = item["Name"]
        set_name(addr, name)
        set_comment(addr, name)
        step_progress()


def process_metadata_methods(data):
    if "ScriptMetadataMethod" not in data or "ScriptMetadataMethod" not in PROCESS_FIELDS:
        return
    items = data["ScriptMetadataMethod"]
    start_progress(items, "Metadata Methods")
    for item in items:
        addr = get_addr(item["Address"])
        name = item["Name"]
        set_name(addr, name)
        set_comment(addr, name)
        step_progress()


def process_addresses(data):
    if "Addresses" not in data or "Addresses" not in PROCESS_FIELDS:
        return
    addresses = data["Addresses"]
    start_progress(addresses, "Addresses")
    for raw_addr in addresses[:-1]:
        make_function(get_addr(raw_addr))
        step_progress()


script_json_path, script_data = load_script_json()
print("Loaded Il2CppDumper script JSON: {}".format(script_json_path))
process_methods(script_data)
process_strings(script_data)
process_metadata(script_data)
process_metadata_methods(script_data)
process_addresses(script_data)
print("Script finished!")
'@
}

function Get-Il2CppDumperGhidraTemplateRoot {
    return (Join-Path $Root "templates\Il2CppDumper")
}

function Get-Il2CppDumperGhidraTemplate {
    param([Parameter(Mandatory)] [string]$Name)

    $templateRoot = Get-Il2CppDumperGhidraTemplateRoot
    $templatePath = Join-Path $templateRoot $Name
    if (-not (Test-Path -LiteralPath $templatePath)) {
        throw "Il2CppDumper Ghidra template missing: $templatePath"
    }

    return Get-Content -LiteralPath $templatePath -Raw
}

function Repair-Il2CppGhidraScript {
    param([Parameter(Mandatory)] [string]$Path)

    $name = Split-Path -Leaf $Path
    $replacement = Get-Il2CppDumperGhidraTemplate -Name $name
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }

    $text = if (Test-Path -LiteralPath $Path) { Get-Content -LiteralPath $Path -Raw } else { "" }

    if ($text -ne $replacement) {
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($Path, $replacement, $utf8NoBom)
        Write-Host ("  [FIX] Replaced Il2CppDumper {0} with PyGhidra/Python 3 template: {1}" -f $name, $Path) -ForegroundColor Cyan
        return $true
    }

    return $false
}

function Repair-Il2CppDumperGhidraTemplates {
    param([Parameter(Mandatory)] [string]$Dir)

    $changed = $false
    foreach ($name in @("ghidra.py", "ghidra_with_struct.py")) {
        if (Repair-Il2CppGhidraScript -Path (Join-Path $Dir $name)) {
            $changed = $true
        }
    }
    return $changed
}

function Ensure-Il2CppDumperGhidraScriptBundle {
    if (-not (Get-Command "Register-GhidraScriptBundle" -CommandType Function -ErrorAction SilentlyContinue)) {
        return $false
    }

    if (-not (Test-Path -LiteralPath $ToolPaths.Dumper -PathType Leaf)) {
        return $false
    }

    $bundleDir = Join-Path $Tools "Il2CppDumper"
    if (-not (Test-Path -LiteralPath $bundleDir -PathType Container)) {
        return $false
    }

    $toolConfigPath = Get-GhidraCodeBrowserToolConfigPath -GhidraRoot $ToolPaths.GhidraRoot
    if ([string]::IsNullOrWhiteSpace($toolConfigPath)) {
        return $false
    }

    $templatePath = Join-Path $Root "templates\Ghidra\_code_browser.tcd"
    $result = Register-GhidraScriptBundle -ToolConfigPath $toolConfigPath -BundleDir $bundleDir -GhidraRoot $ToolPaths.GhidraRoot -TemplatePath $templatePath -CreateBackup
    switch ($result.Reason) {
        "Added" {
            Write-Host ("  [OK]   Ghidra Script Bundle registered: {0}" -f $result.BundleValue) -ForegroundColor Green
            Write-Host "         If Script Manager does not show ghidra.py, fully close all Ghidra/PyGhidra windows and reopen." -ForegroundColor DarkGray
            return $true
        }
        "Updated" {
            Write-Host ("  [OK]   Ghidra Script Bundle enabled: {0}" -f $result.BundleValue) -ForegroundColor Green
            Write-Host "         If Script Manager does not show ghidra.py, fully close all Ghidra/PyGhidra windows and reopen." -ForegroundColor DarkGray
            return $true
        }
        "AlreadyRegistered" {
            Write-Host ("  [OK]   Ghidra Script Bundle already registered: {0}" -f $result.BundleValue) -ForegroundColor DarkGray
            Write-Host "         If Script Manager does not show ghidra.py, fully close all Ghidra/PyGhidra windows and reopen." -ForegroundColor DarkGray
            return $true
        }
        "MissingToolConfig" {
            Write-Host "  [WARN] Ghidra Script Bundle not registered yet. Start and close Ghidra once, then rerun this command." -ForegroundColor Yellow
            return $false
        }
        default {
            Write-Host ("  [WARN] Ghidra Script Bundle not patched ({0}). Add tools\Il2CppDumper from Script Manager > Bundle Manager." -f $result.Reason) -ForegroundColor Yellow
            return $false
        }
    }
}
