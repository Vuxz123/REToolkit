import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const adapter=await import('../src/python-runtime/windows-site.js').catch(()=>({}));
const wheel={name:'pywin32',version:'312',filename:'pywin32-312-cp312-cp312-win_amd64.whl'};
const known='# .pth file for the PyWin32 extensions\nwin32\nwin32\\lib\npythonwin\n# And some hackery to deal with environments where the post_install script\n# isn\'t run.\nimport pywin32_bootstrap\n';
const invalid={code:'PYTHON_WHEEL_INVALID'};
const checkout=fileURLToPath(new URL('..',import.meta.url));
const python=[path.join(checkout,'runtime/python/python-3.12/python.exe'),path.resolve(checkout,'../..','runtime/python/python-3.12/python.exe')].find(file=>fs.existsSync(file));
const temporary=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'retk-windows-site-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
function fixture(t,version='312'){
  const site=temporary(t);
  for(const folder of ['win32/lib','Pythonwin','pywin32_system32',`pywin32-${version}.dist-info`])fs.mkdirSync(path.join(site,folder),{recursive:true});
  fs.writeFileSync(path.join(site,`pywin32-${version}.dist-info/METADATA`),`Metadata-Version: 2.1\nName: pywin32\nVersion: ${version}\n`);
  for(const file of ['win32/win32api.pyd','win32/win32event.pyd','win32/lib/pywintypes.py','pywin32_system32/pythoncom312.dll','pywin32_system32/pywintypes312.dll'])fs.writeFileSync(path.join(site,file),'fixture');
  return site;
}
const run=(site,extra='')=>spawnSync(python,['-B','-I','-S','-c',adapter.WINDOWS_SITE_SCRIPT+'\n'+extra,site],{encoding:'utf8',timeout:10000,windowsHide:true});

test('Windows wheel support is limited to the exact pywin32 312 Windows wheel',()=>{
  assert.equal(typeof adapter.validateWindowsWheel,'function');
  assert.doesNotThrow(()=>adapter.validateWindowsWheel(wheel));
  assert.doesNotThrow(()=>adapter.validateWindowsWheel({name:'mcp',version:'1',filename:'mcp-1-py3-none-any.whl'}));
  for(const change of [{version:'311'},{filename:'pywin32-312-cp311-cp311-win_amd64.whl'},{filename:'pywin32-312-cp312-cp312-win32.whl'},{filename:'pywin32-312-cp312-cp312-win_amd64.whl.exe'}])assert.throws(()=>adapter.validateWindowsWheel({...wheel,...change}),invalid);
});

test('only the supported wheel root hook receives a bounded exception',()=>{
  assert.equal(typeof adapter.allowWindowsHook,'function');
  assert.equal(adapter.allowWindowsHook(wheel,'pywin32.pth',Buffer.byteLength(known)),true);
  for(const [value,name,size] of [[{...wheel,name:'other'},'pywin32.pth',100],[{...wheel,version:'311'},'pywin32.pth',100],[wheel,'nested/pywin32.pth',100],[wheel,'PYWIN32.PTH',100],[wheel,'other.pth',100],[wheel,'pywin32.pth',1025],[wheel,'pywin32.pth',-1],[wheel,'pywin32.pth',1.5]])assert.equal(adapter.allowWindowsHook(value,name,size),false);
});

test('known hook validation compares exact normalized bytes without executing content',()=>{
  assert.equal(adapter.PYWIN32_PTH,known);
  for(const text of [known,known.replaceAll('\n','\r\n')])assert.doesNotThrow(()=>adapter.validateWindowsHook(wheel,'pywin32.pth',Buffer.from(text)));
  for(const text of [known+'\n',known.replace('import pywin32_bootstrap','import evil'),known.replace('win32\n','win32 \n'),'\ufeff'+known,known.replaceAll('\n','\r'),'x'.repeat(1025)])assert.throws(()=>adapter.validateWindowsHook(wheel,'pywin32.pth',Buffer.from(text)),invalid);
  assert.throws(()=>adapter.validateWindowsHook({...wheel,name:'other'},'pywin32.pth',Buffer.from(known)),invalid);
});

test('shared prefix adds controlled paths and retains only the local DLL directory handle', {skip:!python},t=>{
  const site=fixture(t);
  fs.writeFileSync(path.join(site,'pywin32.pth'),"import evil\n");
  fs.writeFileSync(path.join(site,'sitecustomize.py'),"raise RuntimeError('startup hook executed')\n");
  fs.writeFileSync(path.join(site,'pywin32_bootstrap.py'),"raise RuntimeError('vendor bootstrap executed')\n");
  const result=run(site,"import json\nprint(json.dumps({'paths': sys.path[:4], 'retained': _retk_windows_dll_directory is not None}))");
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),{paths:[site,path.join(site,'win32'),path.join(site,'win32/lib'),path.join(site,'Pythonwin')],retained:true});
  assert.equal(fs.readdirSync(site).includes('__pycache__'),false);
});

test('shared prefix refuses unsupported or duplicate metadata and missing native layout', {skip:!python},t=>{
  assert.notEqual(run(fixture(t,'311')).status,0);
  const duplicate=fixture(t);fs.mkdirSync(path.join(duplicate,'duplicate.dist-info'));fs.writeFileSync(path.join(duplicate,'duplicate.dist-info/METADATA'),'Metadata-Version: 2.1\nName: pywin32\nVersion: 312\n');assert.notEqual(run(duplicate).status,0);
  for(const file of ['win32/win32api.pyd','win32/win32event.pyd','win32/lib/pywintypes.py','pywin32_system32/pythoncom312.dll','pywin32_system32/pywintypes312.dll','Pythonwin']){
    const site=fixture(t);fs.rmSync(path.join(site,file),{recursive:true});assert.notEqual(run(site).status,0,file);
  }
});

test('shared prefix leaves sites without pywin32 independent of Windows wheel paths', {skip:!python},t=>{
  const site=temporary(t),result=run(site,"print(sys.path[0])\nprint(_retk_windows_dll_directory is None)");
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.replaceAll('\r\n','\n').trim(),site+'\nTrue');
});
