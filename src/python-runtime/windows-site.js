// This is an archive-content exception, never a hook to evaluate at startup.
export const PYWIN32_PTH='# .pth file for the PyWin32 extensions\nwin32\nwin32\\lib\npythonwin\n# And some hackery to deal with environments where the post_install script\n# isn\'t run.\nimport pywin32_bootstrap\n';
const supported=wheel=>wheel?.name==='pywin32'&&wheel.version==='312'&&wheel.filename==='pywin32-312-cp312-cp312-win_amd64.whl';
const invalid=()=>Object.assign(new Error('The wheel is outside the supported Windows startup adapter.'),{code:'PYTHON_WHEEL_INVALID'});

export function validateWindowsWheel(wheel) {
  if(wheel?.name==='pywin32'&&!supported(wheel))throw invalid();
}

export function allowWindowsHook(wheel,relative,size) {
  return supported(wheel)&&relative==='pywin32.pth'&&Number.isInteger(size)&&size>=0&&size<=1024;
}

export function validateWindowsHook(wheel,relative,bytes) {
  if(!Buffer.isBuffer(bytes)||!allowWindowsHook(wheel,relative,bytes.length)||bytes.toString('utf8').replaceAll('\r\n','\n')!==PYWIN32_PTH)throw invalid();
}

// Shared verbatim by metadata verification and MCP launch. -I -S keeps Python
// startup hooks disabled; only these code-owned paths and DLL directory apply.
export const WINDOWS_SITE_SCRIPT=`import sys, os, re, importlib.metadata as metadata
site = sys.argv[1]
sys.path.insert(0, site)
_retk_pywin32 = [d for d in metadata.distributions(path=[site]) if re.sub(r'[-_.]+', '-', d.metadata['Name']).lower() == 'pywin32']
_retk_windows_dll_directory = None
if _retk_pywin32:
    if len(_retk_pywin32) != 1 or _retk_pywin32[0].version != '312':
        raise RuntimeError('unsupported Windows distribution metadata')
    for _retk_folder in ['win32', 'win32/lib', 'Pythonwin', 'pywin32_system32']:
        if not os.path.isdir(os.path.join(site, *_retk_folder.split('/'))):
            raise RuntimeError('Windows distribution layout differs')
    for _retk_file in ['win32/win32api.pyd', 'win32/win32event.pyd', 'win32/lib/pywintypes.py', 'pywin32_system32/pythoncom312.dll', 'pywin32_system32/pywintypes312.dll']:
        _retk_file_path = os.path.join(site, *_retk_file.split('/'))
        if not os.path.isfile(_retk_file_path) or not os.path.getsize(_retk_file_path):
            raise RuntimeError('Windows distribution native layout differs')
    for _retk_folder in reversed(['win32', 'win32/lib', 'Pythonwin']):
        sys.path.insert(1, os.path.join(site, *_retk_folder.split('/')))
    _retk_windows_dll_directory = os.add_dll_directory(os.path.join(site, 'pywin32_system32'))
`;
