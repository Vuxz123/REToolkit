import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {readdirSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {ACTIVE_PATH,GENERATIONS_PATH,pythonLockFingerprint} from '../src/python-runtime/manifest.js';
import {snapshotPythonGeneration} from '../src/python-runtime/verify.js';
import {prepareMcpCommand} from '../src/python-runtime/launcher.js';
import {managedMcpArgs} from '../src/python-runtime/runner.js';
import {acquireToolchainRead,withToolchainWrite} from '../src/toolchain/lease.js';
import {probeMcp} from '../src/mcp-probe.js';
import {createToolkit} from '../src/toolkit.js';
import {diagnose} from '../src/diagnostics.js';

const repo=fileURLToPath(new URL('../',import.meta.url));
const entry=path.join(repo,'re.js'),installer=path.join(repo,'install-re-toolkit.ps1');
const diagnosticFixture=fileURLToPath(new URL('./fixtures/mcp-diagnostic-engine.mjs',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=extension=>({url:`https://example.invalid/releases/download/v1/fixture.${extension}`,sha256:'a'.repeat(64),size:10,verification:'recorded-download'});
const lock=()=>({kind:'retoolkit-python-lock',schemaVersion:1,platform:'win32-x64',python:{version:'3.12.10',archiveRoot:'',source:source('zip')},pip:{name:'pip',version:'25.0.1',filename:'pip-25.0.1-py3-none-any.whl',source:source('whl')},wheels:[{name:'ghidra-mcp-bridge',version:'6.0.0',filename:'ghidra_mcp_bridge-6.0.0-py3-none-any.whl',source:source('whl')} ]});
async function temp(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-python-integration-'));t.after(async()=>{const resolved=path.resolve(root);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(resolved).startsWith('retk-python-integration-'));await fs.rm(resolved,{recursive:true,force:true});});return root;}
async function inventory(root){const entries=[];const walk=async relative=>{for(const item of await fs.readdir(path.join(root,relative),{withFileTypes:true})){const next=relative?`${relative}/${item.name}`:item.name;entries.push(item.isDirectory()?`${next}/`:`${next}:${sha(await fs.readFile(path.join(root,next)))}`);if(item.isDirectory())await walk(next);}};await walk('');return entries.sort();}
function cli(root,...args){return spawnSync(process.execPath,[entry,'python-runtime',...args,'--root',root,'--json'],{cwd:repo,encoding:'utf8',timeout:15000,maxBuffer:1024**2,windowsHide:true});}
async function selected(root){
 const generation='11111111-1111-4111-8111-111111111111',folder=path.join(root,GENERATIONS_PATH,generation),value=lock();await fs.mkdir(path.join(folder,'python'),{recursive:true});await fs.mkdir(path.join(folder,'site'),{recursive:true});await fs.writeFile(path.join(folder,'python/python.exe'),'source-owned inert interpreter fixture');await fs.writeFile(path.join(folder,'site/bridge.py'),'source-owned installed fixture');
 const receipt={kind:'retoolkit-python-receipt',schemaVersion:1,platform:value.platform,generation,createdAt:new Date().toISOString(),lockFingerprint:pythonLockFingerprint(value),python:value.python,pip:value.pip,wheels:value.wheels,probe:{pythonVersion:value.python.version,bits:64,implementation:'cpython',distributions:value.wheels.map(({name,version})=>({name,version})),entryPoint:'bridge_mcp_ghidra.cli:main'},files:await snapshotPythonGeneration(folder),limitations:[]};
 const bytes=Buffer.from(JSON.stringify(receipt,null,2)+'\n');await fs.writeFile(path.join(folder,'receipt.json'),bytes);await fs.writeFile(path.join(root,ACTIVE_PATH),JSON.stringify({kind:'retoolkit-python-active',schemaVersion:1,generation,receiptSha256:sha(bytes)}));return {generation,folder,python:path.join(folder,'python/python.exe'),site:path.join(folder,'site'),receipt};
}
const toolkit=root=>({root,tools:{bridge:path.join(root,'legacy/bridge.exe')},env:{SystemRoot:process.env.SystemRoot,PATH:'fixture legacy path',PYTHONPATH:'secret inherited injection',PIP_INDEX_URL:'https://secret.invalid'}});

test('real Python runtime CLI plan and absent verify stay offline and read only',async t=>{
 const root=await temp(t),file=path.join(root,'fixture-lock.json');await fs.writeFile(file,JSON.stringify(lock()));await fs.writeFile(path.join(root,'sentinel'),'keep');const before=await inventory(root);
 const planned=cli(root,'plan',file);assert.equal(planned.status,0,planned.stderr);const plan=JSON.parse(planned.stdout);assert.equal(plan.kind,'retoolkit-python-plan');assert.equal(plan.executesLockedCode,true);assert.equal(plan.lockFingerprint,pythonLockFingerprint(lock()));assert.deepEqual(await inventory(root),before);
 const verified=cli(root,'verify');assert.equal(verified.status,1,verified.stderr);assert.equal(JSON.parse(verified.stdout).state,'absent');assert.deepEqual(await inventory(root),before);
});
test('real Python runtime CLI verifies selected files and reports tamper without mutation',async t=>{
 const root=await temp(t),profile=await selected(root),before=await inventory(root),good=cli(root,'verify');assert.equal(good.status,0,good.stderr);assert.equal(JSON.parse(good.stdout).state,'verified');assert.deepEqual(await inventory(root),before);
 await fs.writeFile(profile.python,'tampered inert fixture');const changedBefore=await inventory(root),changed=cli(root,'verify');assert.equal(changed.status,1,changed.stderr);const report=JSON.parse(changed.stdout);assert.equal(report.state,'changed');assert.equal(report.errors[0].code,'PYTHON_FILES_CHANGED');assert.deepEqual(await inventory(root),changedBefore);
});
test('PowerShell PythonManifest plan delegates early and preserves isolated sweep sentinels',{skip:process.platform!=='win32'},async t=>{
 const root=await temp(t),file=path.join(root,'fixture-lock.json'),privateTemp=path.join(root,'isolated-temp');await fs.writeFile(file,JSON.stringify(lock()));await fs.mkdir(path.join(privateTemp,'retk-sweep-sentinel'),{recursive:true});await fs.writeFile(path.join(privateTemp,'retk-sweep-sentinel/keep'),'keep');await fs.writeFile(path.join(privateTemp,'retk-sweep-file.tmp'),'keep');const before=await inventory(root);
 const run=args=>spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',installer,'-InstallDir',root,'-PythonManifest',file,...args],{cwd:repo,env:{...process.env,TEMP:privateTemp,TMP:privateTemp},encoding:'utf8',timeout:15000,maxBuffer:1024**2,windowsHide:true});
 const planned=run(['-Plan']);assert.equal(planned.status,0,planned.stderr);assert.equal(JSON.parse(planned.stdout.replace(/^\uFEFF/,'')).kind,'retoolkit-python-plan');assert.deepEqual(await inventory(root),before);
 for(const flags of [['-Plan','-All'],['-Plan','-LockedManifest',file],['-Plan','-InstallGhidraMcp']]){const result=run(flags);assert.notEqual(result.status,0);assert.match(result.stderr,/cannot be combined/i);assert.deepEqual(await inventory(root),before);}
});
test('managed command selects exact isolated Python under a read lease and refuses all corrupt state',async t=>{
 const root=await temp(t),tk=toolkit(root),legacyLease=acquireToolchainRead(root);try{assert.deepEqual(await prepareMcpCommand(tk),{file:tk.tools.bridge,args:['--transport','stdio'],env:tk.env});}finally{legacyLease.release();}
 const profile=await selected(root),lease=acquireToolchainRead(root);try{const command=await prepareMcpCommand(tk);assert.equal(command.file,profile.python);assert.deepEqual(command.args,managedMcpArgs(profile.site));assert.equal(command.env.PYTHONPATH,undefined);assert.equal(command.env.PIP_INDEX_URL,undefined);
 await fs.writeFile(profile.python,'tamper');await assert.rejects(prepareMcpCommand(tk),{code:'PYTHON_FILES_CHANGED'});await fs.writeFile(path.join(root,ACTIVE_PATH),'broken pointer');await assert.rejects(prepareMcpCommand(tk),{code:'PYTHON_PROFILE_INVALID'});
 }finally{lease.release();}
});
test('managed probe holds its reader through child close and never spawns a tampered generation',async t=>{
 const root=await temp(t),profile=await selected(root),tk=toolkit(root),readers=path.join(root,'.cache/toolchain/readers');let readerAtSpawn=false,readerAtClose=false,calls=0;
 const spawnImpl=(file,args,options)=>{calls++;readerAtSpawn=readdirSync(readers).length===1;assert.equal(file,profile.python);assert.deepEqual(args,managedMcpArgs(profile.site));const child=spawn(process.execPath,[diagnosticFixture,'matching'],options);child.once('close',()=>{readerAtClose=readdirSync(readers).length===1;});return child;};
 const result=await probeMcp(tk,{project:'Game',program:'libil2cpp.so',timeoutMs:3000,spawnImpl});assert.equal(result.code,'MCP_IDENTITY_UNVERIFIED');assert.equal(readerAtSpawn,true);assert.equal(readerAtClose,true);assert.deepEqual(await fs.readdir(readers),[]);assert.equal(calls,1);
 await fs.writeFile(profile.python,'tamper');const failed=await probeMcp(tk,{timeoutMs:3000,spawnImpl});assert.equal(failed.code,'PYTHON_FILES_CHANGED');assert.equal(calls,1);assert.deepEqual(await fs.readdir(readers),[]);
 await withToolchainWrite(root,async()=>{const blocked=await probeMcp(tk,{timeoutMs:3000,spawnImpl});assert.equal(blocked.code,'TOOLCHAIN_BUSY');assert.equal(calls,1);},{inspectProcesses:async()=>({state:'idle',processes:[]})});
});

test('reused toolkit refreshes bridge selection in both directions',async t=>{
 const root=await temp(t),tk=createToolkit(root),legacy=tk.tools.bridge;
 const profile=await selected(root);assert.equal(tk.tools.bridge,profile.python);
 const report=await diagnose(tk);assert.equal(report.checks.bridge.path,profile.python);assert.equal(report.checks.bridge.exists,true);assert.ok(!report.diagnostics.some(d=>d.code==='MCP_BRIDGE_MISSING'));
 await fs.unlink(path.join(root,ACTIVE_PATH));assert.equal(tk.tools.bridge,legacy);assert.equal((await prepareMcpCommand(tk)).file,legacy);
 await fs.writeFile(path.join(root,ACTIVE_PATH),JSON.stringify({kind:'retoolkit-python-active',schemaVersion:1,generation:profile.generation,receiptSha256:sha(await fs.readFile(path.join(profile.folder,'receipt.json')))}));const managedToolkit=createToolkit(root);assert.equal(managedToolkit.tools.bridge,profile.python);
 await fs.unlink(path.join(root,ACTIVE_PATH));const command=await prepareMcpCommand(managedToolkit);assert.equal(command.file,legacy);assert.deepEqual(command.args,['--transport','stdio']);
});
