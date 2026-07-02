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
