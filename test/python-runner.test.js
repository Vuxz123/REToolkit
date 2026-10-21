import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {WINDOWS_SITE_SCRIPT} from '../src/python-runtime/windows-site.js';

const runner = await import('../src/python-runtime/runner.js').catch(() => ({}));
const temporary = t => { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'retk-python-runner-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return dir; };
const entryPoint='bridge_mcp_ghidra.cli:main';
const wheels=[{name:'ghidra-mcp-bridge',version:'6.0.0'},{name:'mcp',version:'1.26.0'}];
const probe={pythonVersion:'3.12.10',bits:64,implementation:'cpython',distributions:wheels,entryPoint};
function buildInput(dir) { return {python:path.join(dir,'python.exe'),site:path.join(dir,'site'),pipWheel:{path:path.join(dir,'pip-25.1.1-py3-none-any.whl'),name:'pip',version:'25.1.1'},wheelhouse:path.join(dir,'wheels'),requirements:path.join(dir,'requirements.txt'),expectedPython:'3.12.10',wheels,transactionDir:path.join(dir,'transaction')}; }
function fakePython(calls,outputs={}) { return async(file,args,options) => { calls.push({file,args,options}); const i=calls.length; return {exitCode:0,stderr:'',stdout: i===1?JSON.stringify({pythonVersion:'3.12.10',bits:64,implementation:'cpython',pipVersion:'25.1.1',...outputs.preflight}):i===4?JSON.stringify({...probe,...outputs.probe}):'',...outputs[i]}; }; }

test('Python runner exposes the fixed execution boundary',()=>{assert.equal(typeof runner.executePython,'function'); assert.equal(typeof runner.runPythonBuild,'function');});

test('install environment creates private homes and strips inherited secrets/configuration', t=>{
  const dir=temporary(t); const names=['PYTHONPATH','PIP_INDEX_URL','HTTPS_PROXY','EXAMPLE_API_KEY']; const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  for(const name of names)process.env[name]='secret-value'; t.after(()=>{for(const name of names) if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];});
  const env=runner.pythonInstallEnvironment(dir); assert.equal(env.PIP_CONFIG_FILE,'NUL');
  for(const name of names)assert.equal(env[name],undefined);
  for(const name of ['HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP']){ assert.ok(env[name].startsWith(dir+path.sep));assert.ok(fs.statSync(env[name]).isDirectory()); }
});

test('managed launch uses isolated Python and the one fixed entry point',()=>{
  const args=runner.managedMcpArgs('C:/selected/site'); assert.deepEqual(args.slice(0,4),['-B','-I','-S','-c']); assert.deepEqual(args.slice(5),['C:/selected/site','--transport','stdio']);
  assert.match(args[4],/bridge_mcp_ghidra\.cli/); assert.match(args[4],/sys\.path\.insert/);
  const env=runner.pythonMcpEnvironment({SystemRoot:'C:/Windows',JAVA_HOME:'C:/jdk',JAVA_HOME_OVERRIDE:'C:/jdk',GHIDRA_INSTALL_DIR:'C:/ghidra',APPDATA:'C:/data',PYTHONPATH:'evil',PIP_INDEX_URL:'secret',API_KEY:'secret',PATH:'evil'});
  assert.equal(env.JAVA_HOME,'C:/jdk');assert.equal(env.GHIDRA_INSTALL_DIR,'C:/ghidra');assert.equal(env.APPDATA,'C:/data');assert.equal(env.PYTHONPATH,undefined);assert.equal(env.API_KEY,undefined); assert.doesNotMatch(env.PATH,/evil/);
});

test('build only invokes locked offline pip then checks exact metadata and callable entry',async t=>{
  const dir=temporary(t), input=buildInput(dir), calls=[]; const actual=await runner.runPythonBuild(input,{executePython:fakePython(calls)});
  assert.deepEqual(actual,probe); assert.equal(calls.length,4);
  for(const call of calls){assert.equal(call.file,input.python); assert.deepEqual(call.args.slice(0,4),['-B','-I','-S','-c']); assert.equal(call.options.env.PIP_CONFIG_FILE,'NUL'); assert.equal(call.options.cwd,input.transactionDir);}
  const args=calls[1].args;
  for(const flag of ['--isolated','--no-index','--no-deps','--only-binary=:all:','--require-hashes','--no-compile','--no-cache-dir','--no-input','--disable-pip-version-check']) assert.ok(args.includes(flag),flag);
  assert.equal(args[args.indexOf('--target')+1],input.site);assert.equal(args[args.indexOf('--find-links')+1],input.wheelhouse); assert.equal(args[args.indexOf('--requirement')+1],input.requirements);
  assert.ok(calls[2].args.includes('check'));assert.ok(calls[2].args.includes('--disable-pip-version-check')); assert.match(calls[3].args[4],/callable/); assert.match(calls[3].args[4],/console_scripts/);
});

test('only metadata probe and MCP launch share the fixed Windows site prefix',async t=>{
  const calls=[];await runner.runPythonBuild(buildInput(temporary(t)),{executePython:fakePython(calls)});
  assert.ok(calls[3].args[4].includes(WINDOWS_SITE_SCRIPT));
  assert.ok(runner.managedMcpArgs('site')[4].includes(WINDOWS_SITE_SCRIPT));
  for(const call of calls.slice(0,3))assert.equal(call.args[4].includes(WINDOWS_SITE_SCRIPT),false);
  assert.match(calls[3].args[4],/import pywintypes, win32api, win32event/);
});

test('build refuses wrong Python and pinned pip before installation',async t=>{
  const input=buildInput(temporary(t));
  for(const preflight of [{pythonVersion:'3.13.1'},{bits:32},{implementation:'pypy'},{pipVersion:'24.0'}]){
    const calls=[];await assert.rejects(runner.runPythonBuild(input,{executePython:fakePython(calls,{preflight})}),{code:'PYTHON_PREFLIGHT_INVALID'});assert.equal(calls.length,1);
  }
});

test('build refuses extra/missing/duplicate/mismatched distributions and entry metadata',async t=>{
  const input=buildInput(temporary(t));
  for(const result of [{distributions:[...wheels,{name:'extra',version:'1'}]},{distributions:wheels.slice(0,1)},{distributions:[wheels[0],wheels[0]]},{distributions:[wheels[0],{name:'mcp',version:'99'}]},{entryPoint:'untrusted.module:run'},{hostPath:'C:/secret'}]){
    await assert.rejects(runner.runPythonBuild(input,{executePython:fakePython([],{probe:result})}),{code:'PYTHON_PROBE_INVALID'});
  }
});

test('build sanitizes malformed output and external runner errors',async t=>{
  const input=buildInput(temporary(t));
  await assert.rejects(runner.runPythonBuild(input,{executePython:fakePython([],{1:{stdout:'C:/secret API_KEY=private'}})}),error=>error.code==='PYTHON_PREFLIGHT_INVALID'&&!error.message.includes('secret'));
  await assert.rejects(runner.runPythonBuild(input,{executePython:fakePython([],{1:{stdout:'null'}})}),{code:'PYTHON_PREFLIGHT_INVALID'});
  await assert.rejects(runner.runPythonBuild(input,{executePython:fakePython([],{4:{stdout:'null'}})}),{code:'PYTHON_PROBE_INVALID'});
  await assert.rejects(runner.runPythonBuild(input,{executePython:async()=>{throw Object.assign(Error('PYTHONPATH=C:/secret API_KEY=private'),{preserveToolchainGate:true});}}),error=>error.preserveToolchainGate===true&&!error.message.includes('secret'));
});

test('process executor captures bounded output only after child closes',async()=>{
  const result=await runner.executePython(process.execPath,['-e',"process.stdout.write('ready');process.stderr.write('note');setTimeout(()=>process.exit(0),40)"],{timeoutMs:5000});
  assert.deepEqual(result,{stdout:'ready',stderr:'note',exitCode:0});
});

test('process executor rejects failed/start/overflow output without secrets',async()=>{
  for(const [file,args,code] of [[process.execPath,['-e',"process.stderr.write('API_KEY=secret C:/private');process.exit(2)"],'PYTHON_PROCESS_FAILED'],['C:/absent-secret-python.exe',[],'PYTHON_START_FAILED'],[process.execPath,['-e',"process.stdout.write('x'.repeat(2*1024*1024))"],'PYTHON_OUTPUT_LIMIT']]){
    await assert.rejects(runner.executePython(file,args,{timeoutMs:5000}),error=>error.code===code&&!error.message.includes('secret')&&!error.message.includes('private'));
  }
});

test('process deadline terminates only its child and preserves install ownership',async()=>{
  const start=Date.now();await assert.rejects(runner.executePython(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:60}),error=>error.code==='PYTHON_TIMEOUT'&&error.preserveToolchainGate===true);assert.ok(Date.now()-start<2500);
});

const checkout=fileURLToPath(new URL('..',import.meta.url));
const installedPython=[path.join(checkout,'runtime/python/python-3.12/python.exe'),path.resolve(checkout,'../..','runtime/python/python-3.12/python.exe')].find(file=>fs.existsSync(file));
test('pip bootstrap stays ahead of a site package named pip', {skip:!installedPython},async t=>{
  const dir=temporary(t),input=buildInput(dir); fs.mkdirSync(input.site);fs.writeFileSync(path.join(input.site,'pip.py'),"raise RuntimeError('untrusted site pip was imported')\n");
  const bootstrap=path.join(dir,'bootstrap');fs.mkdirSync(path.join(bootstrap,'pip'),{recursive:true});fs.writeFileSync(path.join(bootstrap,'pip','__init__.py'),'');fs.writeFileSync(path.join(bootstrap,'pip','__main__.py'),"print('pinned-bootstrap')\n");
  let call=0;
  await runner.runPythonBuild(input,{executePython:async(file,args,options)=>{
    call++;if(call===1)return {exitCode:0,stdout:JSON.stringify({pythonVersion:'3.12.10',bits:64,implementation:'cpython',pipVersion:'25.1.1'})};
    if(call===4)return {exitCode:0,stdout:JSON.stringify(probe)};
    const actualArgs=[...args];actualArgs[5]=bootstrap;
    const result=await runner.executePython(installedPython,actualArgs,options);assert.equal(result.stdout.trim(),'pinned-bootstrap');return result;
  }});
});

test('fixed metadata and launch bootstraps import a callable without running it during probe', {skip:!installedPython},async t=>{
  const dir=temporary(t),input=buildInput(dir); fs.mkdirSync(input.site);
  const packageDir=path.join(input.site,'bridge_mcp_ghidra');fs.mkdirSync(packageDir);fs.writeFileSync(path.join(packageDir,'__init__.py'),'');
  fs.writeFileSync(path.join(packageDir,'cli.py'),"import sys, json\ndef main():\n    print(json.dumps(sys.argv))\n");
  for(const wheel of wheels){const info=path.join(input.site,`${wheel.name.replaceAll('-','_')}-${wheel.version}.dist-info`);fs.mkdirSync(info);fs.writeFileSync(path.join(info,'METADATA'),`Metadata-Version: 2.1\nName: ${wheel.name}\nVersion: ${wheel.version}\n`);if(wheel.name==='ghidra-mcp-bridge')fs.writeFileSync(path.join(info,'entry_points.txt'),`[console_scripts]\nbridge-mcp-ghidra = ${entryPoint}\n`);}
  const calls=[];
  await runner.runPythonBuild(input,{executePython:async(file,args,options)=>{
    const fake=await fakePython(calls)(file,args,options); if(calls.length!==4)return fake;
    return runner.executePython(installedPython,args,options);
  }});
  const launched=await runner.executePython(installedPython,runner.managedMcpArgs(input.site),{cwd:dir,env:runner.pythonInstallEnvironment(path.join(dir,'transaction'))});
  assert.deepEqual(JSON.parse(launched.stdout),['bridge-mcp-ghidra','--transport','stdio']);
  assert.deepEqual(fs.readdirSync(packageDir).sort(),['__init__.py','cli.py']);
  fs.writeFileSync(path.join(packageDir,'cli.py'),'main = 12\n');
  const args=calls[3].args;
  await assert.rejects(runner.executePython(installedPython,args,{cwd:dir}),{code:'PYTHON_PROCESS_FAILED'});
});

test('source-owned Windows modules load during probe and launch with retained DLL scope', {skip:!installedPython},async t=>{
  const dir=temporary(t),input=buildInput(dir);input.wheels=[...wheels,{name:'pywin32',version:'312'}];
  for(const folder of ['bridge_mcp_ghidra','win32/lib','Pythonwin','pywin32_system32'])fs.mkdirSync(path.join(input.site,folder),{recursive:true});
  for(const file of ['win32/win32api.pyd','win32/win32event.pyd','pywin32_system32/pythoncom312.dll','pywin32_system32/pywintypes312.dll'])fs.writeFileSync(path.join(input.site,file),'source-owned fixture');
  fs.writeFileSync(path.join(input.site,'bridge_mcp_ghidra/__init__.py'),'');
  fs.writeFileSync(path.join(input.site,'bridge_mcp_ghidra/cli.py'),"def main():\n    import pywintypes, win32api, win32event\n");
  const imports=path.join(input.site,'imports.txt');
  for(const [name,file] of [['pywintypes','win32/lib/pywintypes.py'],['win32api','win32api.py'],['win32event','win32event.py']])fs.writeFileSync(path.join(input.site,file),`import __main__, os\nassert __main__._retk_windows_dll_directory is not None\nwith open(os.path.join(__main__.site, 'imports.txt'), 'a') as stream:\n    stream.write('${name}\\n')\n`);
  for(const wheel of input.wheels){const info=path.join(input.site,`${wheel.name.replaceAll('-','_')}-${wheel.version}.dist-info`);fs.mkdirSync(info);fs.writeFileSync(path.join(info,'METADATA'),`Metadata-Version: 2.1\nName: ${wheel.name}\nVersion: ${wheel.version}\n`);if(wheel.name==='ghidra-mcp-bridge')fs.writeFileSync(path.join(info,'entry_points.txt'),`[console_scripts]\nbridge-mcp-ghidra = ${entryPoint}\n`);}
  for(const file of ['pywin32.pth','sitecustomize.py','pywin32_bootstrap.py'])fs.writeFileSync(path.join(input.site,file),"raise RuntimeError('startup hook executed')\n");
  const calls=[];
  const actual=await runner.runPythonBuild(input,{executePython:async(file,args,options)=>{const fake=await fakePython(calls)(file,args,options);return calls.length===4?runner.executePython(installedPython,args,options):fake;}});
  assert.deepEqual(actual.distributions,input.wheels);
  assert.deepEqual(fs.readFileSync(imports,'utf8').trim().split(/\r?\n/),['pywintypes','win32api','win32event']);
  await runner.executePython(installedPython,runner.managedMcpArgs(input.site),{cwd:dir});
  assert.deepEqual(fs.readFileSync(imports,'utf8').trim().split(/\r?\n/),['pywintypes','win32api','win32event','pywintypes','win32api','win32event']);
  fs.unlinkSync(path.join(input.site,'win32event.py'));
  await assert.rejects(runner.executePython(installedPython,calls[3].args,{cwd:dir}),{code:'PYTHON_PROCESS_FAILED'});
});

test('cancellation rejects after child close and retains install ownership',async()=>{
  const pending=runner.executePython(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:5000});
  const timer=setTimeout(()=>process.emit('SIGTERM'),50);
  try{await assert.rejects(pending,error=>error.code==='PYTHON_CANCELLED'&&error.preserveToolchainGate===true);}finally{clearTimeout(timer);}
});

test('uncertain child close is bounded and retains install ownership',async t=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>false;child.unref=()=>{};
  const mocked=t.mock.method(childProcess,'spawn',()=>child);syncBuiltinESMExports();
  const start=Date.now();try{await assert.rejects(runner.executePython(process.execPath,[],{timeoutMs:10}),error=>error.code==='PYTHON_TIMEOUT'&&error.preserveToolchainGate===true);assert.ok(Date.now()-start<2200);}finally{mocked.mock.restore();syncBuiltinESMExports();}
});
