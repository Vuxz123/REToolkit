import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import yazl from 'yazl';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function temp(t){const base=await fs.mkdtemp(path.join(os.tmpdir(),'retk-python-install-'));t.after(async()=>{const resolved=path.resolve(base);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(resolved).startsWith('retk-python-install-'));await fs.rm(resolved,{recursive:true,force:true});});return base;}
async function zip(root,entries){const file=path.join(root,`${randomUUID()}.zip`),archive=new yazl.ZipFile(),done=pipeline(archive.outputStream,createWriteStream(file));for(const [name,value,options] of entries)archive.addBuffer(Buffer.from(value),name,options);archive.end();await done;return fs.readFile(file);}
const idle=async()=>({state:'idle',processes:[]});
async function api(){const module=await import('../src/python-runtime/installer.js').catch(()=>({}));assert.equal(typeof module.installPythonRuntime,'function','locked generation installer must be available');return module;}
async function setup(t,{python=[['python.exe','fixture CPython']],wheel=[['bridge_mcp_ghidra/__init__.py',''],['ghidra_mcp_bridge-1.0.dist-info/METADATA','Name: ghidra-mcp-bridge\nVersion: 1.0\n']]}={}){
 const root=await temp(t),sources=new Map();
 const source=async(name,entries)=>{const bytes=await zip(root,entries),url=`https://example.invalid/releases/download/v1/${name}`;sources.set(url,bytes);return {url,sha256:sha(bytes),size:bytes.length,verification:'recorded-download'};};
 const lock={kind:'retoolkit-python-lock',schemaVersion:1,platform:'win32-x64',python:{version:'3.12.9',archiveRoot:'',source:await source('python.zip',python)},pip:{name:'pip',version:'25.0',filename:'pip-25.0-py3-none-any.whl',source:await source('pip-25.0-py3-none-any.whl',[['pip/__init__.py','fixture pip']])},wheels:[{name:'ghidra-mcp-bridge',version:'1.0',filename:'ghidra_mcp_bridge-1.0-py3-none-any.whl',source:await source('ghidra_mcp_bridge-1.0-py3-none-any.whl',wheel)}]};
 const calls=[];const executePython=async(file,args,options)=>{calls.push({file,args,options});await fs.mkdir(path.join(path.dirname(path.dirname(file)),'site'),{recursive:true});await fs.writeFile(path.join(path.dirname(path.dirname(file)),'site','fixture.py'),'installed');const script=args.join(' ');return {exitCode:0,stderr:'',stdout:JSON.stringify(script.includes('RETK_PYTHON_PREFLIGHT')?{pythonVersion:'3.12.9',bits:64,implementation:'cpython',pipVersion:'25.0'}:script.includes('RETK_PYTHON_PIP')?{}:{pythonVersion:'3.12.9',bits:64,implementation:'cpython',distributions:[{name:'ghidra-mcp-bridge',version:'1.0'}],entryPoint:'bridge_mcp_ghidra.cli:main'})};};
 return {root,lock,sources,calls,options:{inspectProcesses:idle,fetchImpl:async url=>new Response(sources.get(url)),executePython}};
}

test('shared archive IO exports reusable checked primitives and aggregate expanded accounting',async t=>{
 const shared=await import('../src/toolchain/archive-io.js').catch(()=>({}));assert.equal(typeof shared.extractChecked,'function');const root=await temp(t),bytes=await zip(root,[['a','abc']]),file=path.join(root,'input.zip');await fs.writeFile(file,bytes);const budget={entries:99999,total:0};await shared.extractChecked(file,path.join(root,'one'),{budget});assert.equal(budget.entries,100000);await assert.rejects(shared.extractChecked(file,path.join(root,'two'),{budget}),{code:'TOOLCHAIN_ARCHIVE_INVALID'});
 const expanded={entries:0,total:8*1024**3-2};await assert.rejects(shared.extractChecked(file,path.join(root,'three'),{budget:expanded}),{code:'TOOLCHAIN_ARCHIVE_INVALID'});
});
test('wheel preflight rejects startup hooks, oversized metadata and CRC before Python execution',async t=>{
 const {installPythonRuntime}=await api();for(const entries of [[['bad.pth','import bad']],[['nested/sitecustomize.py','x']],[['usercustomize.py','x']],[['bad.dist-info/METADATA','x'.repeat(1024**2+1)]]]){const f=await setup(t,{wheel:entries});await assert.rejects(installPythonRuntime(f.root,f.lock,f.options),e=>/ARCHIVE|WHEEL/.test(e.code));assert.equal(f.calls.length,0);await assert.rejects(fs.stat(path.join(f.root,'runtime/python/active.json')),{code:'ENOENT'});}
 const f=await setup(t),url=f.lock.wheels[0].source.url,bytes=Buffer.from(f.sources.get(url)),central=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bytes.writeUInt32LE((bytes.readUInt32LE(central+16)^1)>>>0,central+16);f.sources.set(url,bytes);Object.assign(f.lock.wheels[0].source,{sha256:sha(bytes),size:bytes.length});await assert.rejects(installPythonRuntime(f.root,f.lock,f.options),{code:'TOOLCHAIN_ARCHIVE_INVALID'});assert.equal(f.calls.length,0);
});
test('Python layouts reject empty or missing executable and pyvenv before execution',async t=>{
 const {installPythonRuntime}=await api();for(const python of [[['python.exe','']],[['python.exe','fixture'],['pyvenv.cfg','home=x']],[['other','x']]]){const f=await setup(t,{python});await assert.rejects(installPythonRuntime(f.root,f.lock,f.options),{code:'PYTHON_LAYOUT_INVALID'});assert.equal(f.calls.length,0);}
});
test('cache paths and unknown journals fail closed',async t=>{
 const {installPythonRuntime}=await api();for(const cache of ['runtime/python/cache','workspaces/Game/cache','.cache/python-runtime/transactions/cache','.cache/toolchain/writer/cache']){const f=await setup(t);await assert.rejects(installPythonRuntime(f.root,f.lock,{...f.options,cache:path.join(f.root,cache)}),{code:'TOOLCHAIN_PATH_UNSAFE'});assert.equal(f.calls.length,0);}
 const f=await setup(t),tx=path.join(f.root,'.cache/python-runtime/transactions/unknown');await fs.mkdir(tx,{recursive:true});await fs.writeFile(path.join(tx,'journal.json'),'{}');await assert.rejects(installPythonRuntime(f.root,f.lock,f.options),{code:'TOOLCHAIN_RECOVERY_REQUIRED'});
});
test('generation executes only at its final name, keeps private wheel basenames and activates last',async t=>{
 const {installPythonRuntime}=await api(),f=await setup(t),phases=[];const result=await installPythonRuntime(f.root,f.lock,{...f.options,onEvent:async e=>{phases.push(e.phase);if(e.phase==='before-activate'){await assert.rejects(fs.stat(path.join(f.root,'runtime/python/active.json')),{code:'ENOENT'});assert.ok((await fs.stat(path.join(f.root,'runtime/python/generations',e.runId,'receipt.json'))).isFile());}}});
 assert.equal(result.kind,'retoolkit-python-receipt');assert.ok(f.calls.length>=4);assert.ok(f.calls.every(call=>call.file===path.join(f.root,'runtime/python/generations',result.generation,'python/python.exe')));assert.ok(result.files.some(file=>file.path==='site/fixture.py'));assert.ok(result.files.every(file=>!file.path.endsWith('.whl')));assert.ok(phases.indexOf('built')<phases.indexOf('before-activate'));const pointer=JSON.parse(await fs.readFile(path.join(f.root,'runtime/python/active.json')));assert.equal(pointer.generation,result.generation);assert.equal(pointer.receiptSha256,sha(await fs.readFile(path.join(f.root,'runtime/python/generations',result.generation,'receipt.json'))));const transactions=await fs.readdir(path.join(f.root,'.cache/python-runtime/transactions'));assert.deepEqual((await fs.readdir(path.join(f.root,'.cache/python-runtime/transactions',transactions[0],'wheelhouse'))).sort(),[f.lock.pip.filename,f.lock.wheels[0].filename].sort());
});
test('activation failure restores byte exact prior pointer and retains both generations',async t=>{
 const {installPythonRuntime}=await api(),f=await setup(t);await installPythonRuntime(f.root,f.lock,f.options);const pointerFile=path.join(f.root,'runtime/python/active.json');const value=JSON.parse(await fs.readFile(pointerFile)),previous=Buffer.from('  '+JSON.stringify(value)+'\r\n');await fs.writeFile(pointerFile,previous);let runId;await assert.rejects(installPythonRuntime(f.root,f.lock,{...f.options,onEvent:e=>{runId=e.runId;if(e.phase==='activated')throw Error('activation fixture failure');}}),/activation fixture failure/);assert.deepEqual(await fs.readFile(pointerFile),previous);assert.equal((await fs.readdir(path.join(f.root,'runtime/python/generations'))).length,2);assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'.cache/python-runtime/transactions',runId,'journal.json'))).state,'rolled-back');await assert.rejects(fs.stat(path.join(f.root,'.cache/toolchain/writer')),{code:'ENOENT'});
});
test('uncertain Python close and rollback retain the writer gate and failed journal',async t=>{
 const {installPythonRuntime}=await api();for(const mode of ['timeout','rollback']){const f=await setup(t);let runId;const options={...f.options,onEvent:e=>{runId=e.runId;if(mode==='rollback'&&['before-activate','before-rollback'].includes(e.phase))throw Error('uncertain fixture rollback');}};if(mode==='timeout')options.executePython=async()=>{throw Object.assign(Error('Python close unconfirmed'),{code:'PYTHON_TIMEOUT',preserveToolchainGate:true});};await assert.rejects(installPythonRuntime(f.root,f.lock,options),e=>e.code==='TOOLCHAIN_RECOVERY_REQUIRED'||e.preserveToolchainGate===true);assert.ok((await fs.stat(path.join(f.root,'.cache/toolchain/writer'))).isDirectory());assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'.cache/python-runtime/transactions',runId,'journal.json'))).state,'recovery-required');await assert.rejects(installPythonRuntime(f.root,f.lock,f.options),{code:'TOOLCHAIN_BUSY'});}
});
test('private source and installed bytes are rechecked before activation, cache is never executed',async t=>{
 const {installPythonRuntime}=await api();for(const phase of ['before-source-copy','before-extract','before-receipt','before-activate']){const f=await setup(t);await assert.rejects(installPythonRuntime(f.root,f.lock,{...f.options,onEvent:async e=>{if(e.phase!==phase)return;if(phase==='before-source-copy'){const file=path.join(f.root,'.cache/python-runtime/packages',`${f.lock.python.source.sha256}.zip`);await fs.writeFile(file,'cache changed');}else if(phase==='before-extract'){await fs.writeFile(path.join(f.root,'.cache/python-runtime/transactions',e.runId,'sources/python.zip'),'private changed');}else await fs.writeFile(path.join(f.root,'runtime/python/generations',e.runId,'site/fixture.py'),'changed');}}),e=>['TOOLCHAIN_INTEGRITY','TOOLCHAIN_ARCHIVE_INVALID','PYTHON_INTEGRITY'].includes(e.code));await assert.rejects(fs.stat(path.join(f.root,'runtime/python/active.json')),{code:'ENOENT'});}
});
test('pointer interference before activation preserves an uncertain writer for inspection',async t=>{
 const {installPythonRuntime}=await api(),f=await setup(t);let runId;await assert.rejects(installPythonRuntime(f.root,f.lock,{...f.options,onEvent:async e=>{runId=e.runId;if(e.phase==='before-activate')await fs.writeFile(path.join(f.root,'runtime/python/active.json'),'external change');}}),{code:'TOOLCHAIN_RECOVERY_REQUIRED'});assert.equal(await fs.readFile(path.join(f.root,'runtime/python/active.json'),'utf8'),'external change');assert.ok((await fs.stat(path.join(f.root,'.cache/toolchain/writer'))).isDirectory());assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'.cache/python-runtime/transactions',runId,'journal.json'))).state,'recovery-required');
});
test('build cannot silently alter locked Python files when producing its site inventory',async t=>{
 const {installPythonRuntime}=await api(),f=await setup(t);await assert.rejects(installPythonRuntime(f.root,f.lock,{...f.options,onEvent:async e=>{if(e.phase==='built')await fs.writeFile(path.join(f.root,'runtime/python/generations',e.runId,'python/python.exe'),'changed interpreter');}}),{code:'PYTHON_INTEGRITY'});await assert.rejects(fs.stat(path.join(f.root,'runtime/python/active.json')),{code:'ENOENT'});
});
test('idleness is checked after activation observers and prevents pointer publication',async t=>{
 const {installPythonRuntime}=await api(),f=await setup(t);let busy=false;await assert.rejects(installPythonRuntime(f.root,f.lock,{...f.options,inspectProcesses:async()=>({state:busy?'busy':'idle',processes:busy?[{pid:99,name:'fixture.exe'}]:[]}),onEvent:e=>{if(e.phase==='before-activate')busy=true;}}),{code:'TOOLCHAIN_BUSY'});await assert.rejects(fs.stat(path.join(f.root,'runtime/python/active.json')),{code:'ENOENT'});
});
test('cache and generation parent junctions cannot change outside files',async t=>{
 const {installPythonRuntime}=await api();for(const relative of ['runtime/python/generations','cache']){const f=await setup(t),outside=await temp(t),link=path.join(f.root,relative);await fs.mkdir(path.dirname(link),{recursive:true});await fs.symlink(outside,link,'junction');await assert.rejects(installPythonRuntime(f.root,f.lock,{...f.options,...(relative==='cache'?{cache:link}:{})}),{code:'TOOLCHAIN_PATH_UNSAFE'});assert.deepEqual(await fs.readdir(outside),[]);assert.equal(f.calls.length,0);}
});
test('failed transport leaves prior active state intact',async t=>{
 const {installPythonRuntime}=await api(),f=await setup(t);await installPythonRuntime(f.root,f.lock,f.options);const active=path.join(f.root,'runtime/python/active.json'),previous=await fs.readFile(active);const next=structuredClone(f.lock);next.python.source.sha256='b'.repeat(64);await assert.rejects(installPythonRuntime(f.root,next,f.options),{code:'TOOLCHAIN_INTEGRITY'});assert.deepEqual(await fs.readFile(active),previous);await assert.rejects(fs.stat(path.join(f.root,'.cache/toolchain/writer')),{code:'ENOENT'});
});
test('Python and wheel archives reject traversal, case collisions and links before execution',async t=>{
 const {installPythonRuntime}=await api();
 for(const kind of ['python','wheel'])for(const unsafe of ['traversal','collision','link']){
  const entries=unsafe==='collision'?[['Folder/a','a'],['folder/b','b']]:unsafe==='link'?[['linked','target',{mode:0o120777}]]:[['xxxxxxxxxxxxx','outside']];
  const f=await setup(t,{...(kind==='python'?{python:[['python.exe','fixture'],...entries]}:{wheel:entries})}),source=kind==='python'?f.lock.python.source:f.lock.wheels[0].source;
  if(unsafe==='traversal'){const bytes=Buffer.from(f.sources.get(source.url).toString('latin1').replaceAll('xxxxxxxxxxxxx','../escape.txt'),'latin1');f.sources.set(source.url,bytes);Object.assign(source,{sha256:sha(bytes),size:bytes.length});}
  await assert.rejects(installPythonRuntime(f.root,f.lock,f.options),{code:'TOOLCHAIN_ARCHIVE_INVALID'});assert.equal(f.calls.length,0);await assert.rejects(fs.stat(path.join(f.root,'escape.txt')),{code:'ENOENT'});
 }
});

const knownWindowsHook='# .pth file for the PyWin32 extensions\nwin32\nwin32\\lib\npythonwin\n# And some hackery to deal with environments where the post_install script\n# isn\'t run.\nimport pywin32_bootstrap\n';
async function addWindowsWheel(f,{name='pywin32',version='312',filename='pywin32-312-cp312-cp312-win_amd64.whl',hook=knownWindowsHook,hookPath='pywin32.pth'}={}){
 const bytes=await zip(f.root,[[hookPath,hook],['win32/win32api.pyd','fixture native bytes']]),url=`https://example.invalid/releases/v1/${filename}`;f.sources.set(url,bytes);f.lock.wheels.push({name,version,filename,source:{url,sha256:sha(bytes),size:bytes.length,verification:'recorded-download'}});
 const original=f.options.executePython;f.options.executePython=async(...args)=>{const result=await original(...args);if(args[1].join(' ').includes('RETK_PYTHON_PROBE')){const report=JSON.parse(result.stdout);report.distributions.push({name,version});result.stdout=JSON.stringify(report);}return result;};
}
test('only reviewed pywin32 wheel retains its exact inert hook and remains sealed',async t=>{
 const {installPythonRuntime}=await api(),f=await setup(t);await addWindowsWheel(f);const original=f.options.executePython;f.options.executePython=async(file,...args)=>{const result=await original(file,...args);await fs.writeFile(path.join(path.dirname(path.dirname(file)),'site/pywin32.pth'),knownWindowsHook);return result;};const receipt=await installPythonRuntime(f.root,f.lock,f.options);assert.equal(receipt.files.find(file=>file.path==='site/pywin32.pth')?.sha256,sha(Buffer.from(knownWindowsHook)));assert.ok(f.calls.length>=4);
 const tx=path.join(f.root,'.cache/python-runtime/transactions',receipt.generation,'wheel-preflight/pywin32/pywin32.pth');assert.equal(await fs.readFile(tx,'utf8'),knownWindowsHook);
 const installed=path.join(f.root,'runtime/python/generations',receipt.generation,'site/pywin32.pth');assert.equal(await fs.readFile(installed,'utf8'),knownWindowsHook);await fs.writeFile(installed,'changed hook');assert.equal((await (await import('../src/python-runtime/verify.js')).verifyPythonRuntime(f.root)).ok,false);
});
test('pywin32 exception refuses altered content, alternate paths and unsupported releases before code runs',async t=>{
 const {installPythonRuntime}=await api();for(const options of [{hook:knownWindowsHook+'import arbitrary\n'},{hookPath:'nested/pywin32.pth'},{hookPath:'different.pth'},{name:'lookalike'},{version:'311',filename:'pywin32-311-cp312-cp312-win_amd64.whl'},{filename:'pywin32-312-cp311-cp311-win_amd64.whl'}]){const f=await setup(t);await addWindowsWheel(f,options);await assert.rejects(installPythonRuntime(f.root,f.lock,f.options),e=>['PYTHON_WHEEL_INVALID','TOOLCHAIN_ARCHIVE_INVALID'].includes(e.code));assert.equal(f.calls.length,0);}
});
