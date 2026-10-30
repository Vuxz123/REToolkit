import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {runProcess} from '../src/process.js';
import {createToolkit} from '../src/toolkit.js';
import {spawnSync} from 'node:child_process';
const api=()=>import('../src/toolchain/lease.js');
const idle=async()=>({state:'idle',processes:[]});
const residentId='ee8f0230-7253-4b0e-8c58-8759d05f8e5d';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-tool-lease-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('persistent resident readers block writers until exact explicit release',async t=>{
 const root=fixture(t),{acquirePersistentToolchainRead,releasePersistentToolchainRead,withToolchainWrite}=await api();
 const token=acquirePersistentToolchainRead(root,residentId);
 const marker=path.join(root,'.cache/toolchain/readers',`resident-${residentId}.json`),owner=JSON.parse(fs.readFileSync(marker,'utf8'));
 assert.equal(owner.sessionId,residentId);assert.equal(owner.token,token);assert.equal(owner.pid,undefined);
 await assert.rejects(withToolchainWrite(root,()=>assert.fail('writer must remain excluded'),{inspectProcesses:idle}),{code:'TOOLCHAIN_BUSY'});
 assert.throws(()=>acquirePersistentToolchainRead(root,residentId),{code:'TOOLCHAIN_BUSY'});
 assert.throws(()=>releasePersistentToolchainRead(root,residentId,residentId),{code:'TOOLCHAIN_BUSY'});assert.ok(fs.existsSync(marker));
 releasePersistentToolchainRead(root,residentId,token);assert.ok(!fs.existsSync(marker));
 await withToolchainWrite(root,()=>assert.throws(()=>acquirePersistentToolchainRead(root,residentId),{code:'TOOLCHAIN_BUSY'}),{inspectProcesses:idle});
});
test('persistent reader release rejects altered ownership and unsafe session names',async t=>{
 const root=fixture(t),{acquirePersistentToolchainRead,releasePersistentToolchainRead}=await api();
 assert.throws(()=>acquirePersistentToolchainRead(root,'../escape'),{code:'TOOLCHAIN_BUSY'});
 const token=acquirePersistentToolchainRead(root,residentId),marker=path.join(root,'.cache/toolchain/readers',`resident-${residentId}.json`);
 const owner=JSON.parse(fs.readFileSync(marker,'utf8'));fs.writeFileSync(marker,JSON.stringify({...owner,sessionId:token}));
 assert.throws(()=>releasePersistentToolchainRead(root,residentId,token),{code:'TOOLCHAIN_BUSY'});assert.ok(fs.existsSync(marker));
 assert.throws(()=>releasePersistentToolchainRead(root,residentId,token,{allowMissing:true}),{code:'TOOLCHAIN_BUSY'});assert.ok(fs.existsSync(marker));
});
test('confirmed-stop retry may explicitly tolerate a missing reader without relaxing ownership checks',async t=>{
 const root=fixture(t),{acquirePersistentToolchainRead,releasePersistentToolchainRead}=await api();
 const token=acquirePersistentToolchainRead(root,residentId);
 releasePersistentToolchainRead(root,residentId,token);
 assert.throws(()=>releasePersistentToolchainRead(root,residentId,token),{code:'TOOLCHAIN_BUSY'});
 assert.doesNotThrow(()=>releasePersistentToolchainRead(root,residentId,token,{allowMissing:true}));
 assert.throws(()=>releasePersistentToolchainRead(root,residentId,'invalid',{allowMissing:true}),{code:'TOOLCHAIN_BUSY'});
 const next=acquirePersistentToolchainRead(root,residentId);
 assert.throws(()=>releasePersistentToolchainRead(root,residentId,token,{allowMissing:true}),{code:'TOOLCHAIN_BUSY'});
 releasePersistentToolchainRead(root,residentId,next,{allowMissing:true});
});
test('toolchain readers and writers exclude one another and release on known failures',async t=>{
 const root=fixture(t),{acquireToolchainRead,withToolchainWrite}=await api();
 const one=acquireToolchainRead(root),two=acquireToolchainRead(root);
 await assert.rejects(withToolchainWrite(root,()=>{}, {inspectProcesses:idle}),error=>error.code==='TOOLCHAIN_BUSY');one.release();two.release();
 await withToolchainWrite(root,async()=>{assert.throws(()=>acquireToolchainRead(root),error=>error.code==='TOOLCHAIN_BUSY');await assert.rejects(withToolchainWrite(root,()=>{}, {inspectProcesses:idle}),error=>error.code==='TOOLCHAIN_BUSY');},{inspectProcesses:idle});
 await assert.rejects(withToolchainWrite(root,()=>{throw Error('known failure');},{inspectProcesses:idle}),/known failure/);acquireToolchainRead(root).release();
});
test('uncertain writer or reader markers stay blocked without PID-only reclamation',async t=>{
 const root=fixture(t),{acquireToolchainRead,withToolchainWrite}=await api();
 await assert.rejects(withToolchainWrite(root,()=>{throw Object.assign(Error('uncertain rollback'),{code:'TOOLCHAIN_RECOVERY_REQUIRED'});},{inspectProcesses:idle}),/uncertain rollback/);
 assert.throws(()=>acquireToolchainRead(root),error=>error.code==='TOOLCHAIN_BUSY');
 await assert.rejects(withToolchainWrite(root,()=>{}, {inspectProcesses:idle}),error=>error.code==='TOOLCHAIN_BUSY');
 const other=fixture(t);fs.mkdirSync(path.join(other,'.cache/toolchain/readers'),{recursive:true});fs.writeFileSync(path.join(other,'.cache/toolchain/readers/abandoned.json'),'{"pid":99999999}');
 await assert.rejects(withToolchainWrite(other,()=>{}, {inspectProcesses:idle}),error=>error.code==='TOOLCHAIN_BUSY');
});
test('workspace/project locks and busy or unknown process inspection block writes',async t=>{
 const root=fixture(t),{withToolchainWrite}=await api();
 const lock=path.join(root,'workspaces/Game/.retk-lock');fs.mkdirSync(lock,{recursive:true});
 await assert.rejects(withToolchainWrite(root,()=>{}, {inspectProcesses:idle}),error=>error.code==='TOOLCHAIN_BUSY');fs.rmdirSync(lock);
 fs.mkdirSync(path.join(root,'workspaces/Game/03_GhidraProject'),{recursive:true});const projectLock=path.join(root,'workspaces/Game/03_GhidraProject/Game.lock');fs.writeFileSync(projectLock,'');
 await assert.rejects(withToolchainWrite(root,()=>{}, {inspectProcesses:idle}),error=>error.code==='TOOLCHAIN_BUSY');fs.unlinkSync(projectLock);
 for(const state of ['busy','unknown'])await assert.rejects(withToolchainWrite(root,()=>{}, {inspectProcesses:async()=>({state,processes:[{pid:123}]})}),error=>error.code==='TOOLCHAIN_BUSY');
 await withToolchainWrite(root,()=>{}, {inspectProcesses:idle});
});
test('gate ancestors and reader ownership are verified before cleanup',async t=>{
 const root=fixture(t),{acquireToolchainRead}=await api();fs.mkdirSync(path.join(root,'actual'));fs.symlinkSync(path.join(root,'actual'),path.join(root,'.cache'),'junction');
 assert.throws(()=>acquireToolchainRead(root),/link|junction/i);
 const other=fixture(t),reader=acquireToolchainRead(other),folder=path.join(other,'.cache/toolchain/readers');const marker=path.join(folder,fs.readdirSync(folder)[0]);fs.writeFileSync(marker,'{"token":"other"}');
 assert.throws(()=>reader.release(),/ownership|owner/i);assert.ok(fs.existsSync(marker));
});
test('real child execution retains the read lease through close and refuses writer-owned launch',async t=>{
 const root=fixture(t),{withToolchainWrite}=await api(),ready=path.join(root,'ready');
 const running=runProcess(process.execPath,['-e',"require('node:fs').writeFileSync(process.argv[1],'ready');setTimeout(()=>{},250)",ready],{toolchainRoot:root});
 while(!fs.existsSync(ready))await new Promise(resolve=>setTimeout(resolve,10));
 await assert.rejects(withToolchainWrite(root,()=>{}, {inspectProcesses:idle}),error=>error.code==='TOOLCHAIN_BUSY');await running;
 await withToolchainWrite(root,async()=>{await assert.rejects(runProcess(process.execPath,['-e','process.exit(0)'],{toolchainRoot:root}),error=>error.code==='TOOLCHAIN_BUSY');},{inspectProcesses:idle});
});
test('linked reader directory is rejected before any lease publication',async t=>{
 const root=fixture(t),outside=fixture(t),{acquireToolchainRead}=await api();fs.mkdirSync(path.join(root,'.cache/toolchain'),{recursive:true});fs.symlinkSync(outside,path.join(root,'.cache/toolchain/readers'),'junction');
 assert.throws(()=>acquireToolchainRead(root),/link|junction/i);assert.deepEqual(fs.readdirSync(outside),[]);
});
test('workspace operations refuse writer ownership before pre-launch configuration changes',async t=>{
 const root=fixture(t),{withToolchainWrite}=await api(),toolkit=createToolkit(root,{log:()=>{}});
 await withToolchainWrite(root,async()=>{await assert.rejects(toolkit.init('Blocked'),error=>error.code==='TOOLCHAIN_BUSY');assert.ok(!fs.existsSync(toolkit.workspace('Blocked')));},{inspectProcesses:idle});
 await toolkit.init('Allowed');
});
test('linked project roots are not traversed during update inspection',async t=>{
 const root=fixture(t),outside=fixture(t),{withToolchainWrite}=await api();fs.mkdirSync(path.join(root,'workspaces/Game'),{recursive:true});fs.symlinkSync(outside,path.join(root,'workspaces/Game/03_GhidraProject'),'junction');
 await assert.rejects(withToolchainWrite(root,()=>{}, {inspectProcesses:idle}),/link|junction/i);
});
test('actual PowerShell process inspection rejects unknown engines and both Windows path separators',async t=>{
 const root=fixture(t),{inspectToolchainProcesses}=await api();
 const cases=[
  [{Name:'AssetRipper.GUI.Free.exe',ExecutablePath:null,CommandLine:null},'unknown'],
  [{Name:'java.exe',ExecutablePath:'C:\\outside\\java.exe',CommandLine:null},'unknown'],
  [{Name:'java.exe',ExecutablePath:null,CommandLine:'java.exe Example'},'unknown'],
  [{Name:'AssetRipper.exe',ExecutablePath:null,CommandLine:'AssetRipper.exe --help'},'unknown'],
  [{Name:'java.exe',ExecutablePath:'C:\\outside\\java.exe',CommandLine:`java.exe -cp ${root.replaceAll('\\','/')}/tools/ghidra/Utility.jar Example`},'busy'],
  [{Name:'javaw.exe',ExecutablePath:path.join(root,'runtime/java/jdk-21/bin/javaw.exe'),CommandLine:'javaw.exe Example'},'busy'],
  [{Name:'java.exe',ExecutablePath:'C:\\outside\\java.exe',CommandLine:'java.exe -cp C:/other/Utility.jar Example'},'idle']
 ];
 for(const [row,state] of cases){const report=await inspectToolchainProcesses(root,{spawnImpl:(file,args,options)=>{
  const mock=`function Get-CimInstance { @'\n${JSON.stringify({...row,ProcessId:123})}\n'@ | ConvertFrom-Json }\n`;
  return spawnSync(file,[...args.slice(0,-1),mock+args.at(-1)],options);
 }});assert.equal(report.state,state,JSON.stringify(row));assert.ok(!JSON.stringify(report).includes('CommandLine'));}
});
