import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {withWorkspaceLock} from '../src/state.js';
import {withToolchainWrite} from '../src/toolchain/lease.js';
const runner=await import('../src/unity/runner.js').catch(()=>({}));
const executor=await import('../src/unity/child.js').catch(()=>({}));
const fixture=fileURLToPath(new URL('./fixtures/unity-engine.mjs',import.meta.url));
function setup(t,fixtureOptions={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-unity-runner-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const workspace=path.join(root,'workspaces/Game'),projectDir=path.join(workspace,'run/project');fs.mkdirSync(projectDir,{recursive:true});
  const requestFile=path.join(workspace,'run/request.json'),reportFile=path.join(workspace,'run/report.json');
  fs.writeFileSync(requestFile,JSON.stringify({fixture:fixtureOptions}));
  return {workspace,options:{editor:path.join(root,'Unity.exe'),projectDir,requestFile,reportFile,lockDirectory:path.join(workspace,'.retk-lock'),toolkitRoot:root,timeoutSeconds:5},deps:{engine:{file:process.execPath,args:[fixture]}}};
}
const run=(s,options={})=>withWorkspaceLock(s.workspace,()=>runner.runUnityEditor({...s.options,...options},s.deps));
async function until(action){for(let i=0;i<200;i++){const result=action();if(result)return result;await delay(20);}throw Error('fixture did not become ready');}
const markers=s=>fs.existsSync(s.options.lockDirectory)?fs.readdirSync(s.options.lockDirectory).filter(n=>n.startsWith('unity-')):[];
const readers=s=>fs.existsSync(path.join(s.options.toolkitRoot,'.cache/toolchain/readers'))?fs.readdirSync(path.join(s.options.toolkitRoot,'.cache/toolchain/readers')):[];

test('Unity runner exposes the fixed Editor execution boundary',()=>assert.equal(typeof runner.runUnityEditor,'function'));
test('Unity runner passes fixed args and reports only an observed close',async t=>{
  const s=setup(t),result=await run(s);assert.deepEqual(Object.keys(result).sort(),['closed','exitCode','logTail','timedOut']);assert.equal(result.closed,true);assert.equal(result.exitCode,0);assert.equal(result.timedOut,false);assert.match(result.logTail,/Unity fixture closed/);
  assert.equal(fs.existsSync(s.options.reportFile),true);assert.deepEqual(readers(s),[]);assert.equal(fs.existsSync(s.options.lockDirectory),false);
});
test('Unity compile failure is a closed result, not an exception',async t=>{
  const s=setup(t,{exitCode:3});const result=await run(s);assert.equal(result.exitCode,3);assert.equal(result.closed,true);assert.equal(result.timedOut,false);
});
test('Unity library import uses a fixed asynchronous purpose without premature quit',async t=>{
 const s=setup(t,{delay:200});const ready=path.join(s.workspace,'ready.json');fs.writeFileSync(s.options.requestFile,JSON.stringify({fixture:{ready,delay:200}}));
 await run(s,{purpose:'library-import'});const {args}=JSON.parse(fs.readFileSync(ready));
 assert(!args.includes('-quit'));assert.equal(args[args.indexOf('-executeMethod')+1],'REToolkit.LibraryImport.Run');
 await assert.rejects(run(s,{purpose:'arbitrary'}),{code:'invalid_argument'});
});
test('Unity capture is bounded and keeps the diagnostic tail without a log file',async t=>{
  const s=setup(t,{flood:true}),result=await run(s);assert.ok(Buffer.byteLength(result.logTail)<=4*1024*1024);assert.match(result.logTail,/tail-error/);assert.match(result.logTail,/Unity fixture closed/);
  assert.deepEqual(fs.readdirSync(path.dirname(s.options.requestFile)).sort(),['project','report.json','request.json']);
});
test('Unity timeout kills only its owned child and waits for close',async t=>{
  const s=setup(t,{hang:true}),start=Date.now(),result=await run(s,{timeoutSeconds:0.15});assert.equal(result.closed,true);assert.equal(result.timedOut,true);assert.notEqual(result.exitCode,0);assert.ok(Date.now()-start<3000);assert.deepEqual(readers(s),[]);assert.equal(fs.existsSync(s.options.lockDirectory),false);
});
test('Unity marker and supervisor reader exist before the fixture starts',async t=>{
  const s=setup(t,{delay:600});const ready=path.join(s.workspace,'ready.json');fs.writeFileSync(s.options.requestFile,JSON.stringify({fixture:{ready,delay:600}}));
  const pending=run(s);await until(()=>fs.existsSync(ready));const {args}=JSON.parse(fs.readFileSync(ready));assert.deepEqual(args,['-batchmode','-nographics','-quit','-projectPath',s.options.projectDir,'-executeMethod','REToolkit.EditorValidation.Run','-logFile','-','-retkRequest',s.options.requestFile,'-retkReport',s.options.reportFile]);
  assert.equal(markers(s).length,1);assert.equal(readers(s).length,1);
  await assert.rejects(withToolchainWrite(s.options.toolkitRoot,async()=>{}, {inspectProcesses:async()=>({state:'idle',processes:[]})}),{code:'TOOLCHAIN_BUSY'});await pending;
});
test('Unity rejects arbitrary flags and batch scripts before launch',async t=>{
  const s=setup(t);await assert.rejects(run(s,{args:['-executeMethod','Evil.Run']}),{code:'invalid_argument'});
  const noEngine={...s,deps:{}};await assert.rejects(run(noEngine,{editor:path.join(s.options.toolkitRoot,'Unity.cmd')}),{code:'invalid_argument'});
});
test('Unity refuses request/report outputs inside Assets',async t=>{
  const s=setup(t);fs.mkdirSync(path.join(s.options.projectDir,'Assets'));
  await assert.rejects(run(s,{reportFile:path.join(s.options.projectDir,'Assets/report.json')}),{code:'invalid_argument'});
});
test('Unity failed spawn safely releases its supervisor ownership',async t=>{
  const s=setup(t);s.deps={};await assert.rejects(run(s),{code:'unity_start_failed'});assert.deepEqual(readers(s),[]);assert.equal(fs.existsSync(s.options.lockDirectory),false);
});
test('Unity unconfirmed child close requests recovery after a bounded kill grace',async t=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>false;child.unref=()=>{};
  const start=Date.now();await assert.rejects(executor.executeUnityChild({file:'Unity.exe',args:[],timeoutSeconds:0.01},{spawnImpl:()=>child}),{code:'unity_recovery_required'});assert.ok(Date.now()-start<3000);
});
test('Unity diagnostic tail remains byte bounded for malformed UTF-8 output',async()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  const pending=executor.executeUnityChild({file:'Unity.exe',args:[],timeoutSeconds:1},{spawnImpl:()=>child});
  child.stdout.write(Buffer.alloc(5*1024*1024,0xff));child.stderr.write('last compiler error');child.emit('close',2);
  const result=await pending;assert.ok(Buffer.byteLength(result.logTail)<=4*1024*1024);assert.match(result.logTail,/last compiler error$/);
});
test('Unity exit event alone does not establish child close',async()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();let finished=false;
  const pending=executor.executeUnityChild({file:'Unity.exe',args:[],timeoutSeconds:1},{spawnImpl:()=>child}).then(value=>{finished=true;return value;});
  child.emit('exit',0);await delay(20);assert.equal(finished,false);child.emit('close',0);assert.equal((await pending).closed,true);
});
test('Unity forced supervisor death leaves gates after its child exits',async t=>{
  const s=setup(t),ready=path.join(s.workspace,'ready.json');fs.writeFileSync(s.options.requestFile,JSON.stringify({fixture:{ready,delay:700}}));
  const pending=run(s);const rejected=assert.rejects(pending,{code:'unity_recovery_required'});await until(()=>fs.existsSync(ready));
  const workerPid=Number(/^unity-(\d+)-/.exec(markers(s)[0])[1]);process.kill(workerPid,'SIGKILL');await rejected;
  assert.equal(markers(s).length,1);assert.equal(readers(s).length,1);await delay(900);
  assert.equal(markers(s).length,1);assert.equal(readers(s).length,1);
});
test('Unity survives parent death and keeps ownership until Editor close',async t=>{
  const s=setup(t),ready=path.join(s.workspace,'ready.json');fs.writeFileSync(s.options.requestFile,JSON.stringify({fixture:{ready,delay:900}}));
  const runnerUrl=pathToFileURL(fileURLToPath(new URL('../src/unity/runner.js',import.meta.url))).href;
  const stateUrl=pathToFileURL(fileURLToPath(new URL('../src/state.js',import.meta.url))).href;
  const script=`import {runUnityEditor} from ${JSON.stringify(runnerUrl)};import {withWorkspaceLock} from ${JSON.stringify(stateUrl)};await withWorkspaceLock(${JSON.stringify(s.workspace)},()=>runUnityEditor(${JSON.stringify(s.options)},${JSON.stringify(s.deps)}));`;
  const parent=spawn(process.execPath,['--input-type=module','-e',script],{stdio:'ignore',windowsHide:true});
  const parentClosed=new Promise(resolve=>parent.once('close',resolve));await until(()=>fs.existsSync(ready));parent.kill('SIGKILL');await parentClosed;
  assert.equal(markers(s).length,1);assert.equal(readers(s).length,1);await assert.rejects(withWorkspaceLock(s.workspace,async()=>{}),/Workspace is busy/);
  await until(()=>fs.existsSync(s.options.reportFile));await until(()=>markers(s).length===0);assert.deepEqual(readers(s),[]);
  await withWorkspaceLock(s.workspace,async()=>{});assert.equal(fs.existsSync(s.options.lockDirectory),false);
});
