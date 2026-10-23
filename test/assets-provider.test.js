import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createToolkit} from '../src/toolkit.js';
import {withWorkspaceLock,fileIdentity} from '../src/state.js';
import {startAssetSession,assetSessionStatus,stopAssetSession,requestAssetSession,hasAssetSession} from '../src/assets/session.js';
import {runtimePaths,readJson} from '../src/assets/runtime.js';
const fixture=fileURLToPath(new URL('./fixtures/assetripper-engine.mjs',import.meta.url));
async function setup(t,mode='normal',allowRecovery=false) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-assets-'));const toolkit=createToolkit(root,{log:()=>{}});
 await toolkit.init('Fixture');const project=toolkit.read('Fixture');
 project.extractedPath=path.join(toolkit.workspace('Fixture'),'01_Extracted');
 project.nativeBinary=path.join(project.extractedPath,'GameAssembly.dll');project.metadata=path.join(project.extractedPath,'global-metadata.dat');
 fs.writeFileSync(project.nativeBinary,'owned-native');fs.writeFileSync(project.metadata,'owned-metadata');fs.writeFileSync(path.join(project.extractedPath,'level0'),'owned-assets');
 project.identities.native=fileIdentity(project.nativeBinary);project.identities.metadata=fileIdentity(project.metadata);await toolkit.save('Fixture',project);
 const dependencies={engine:config=>({file:process.execPath,args:[fixture,config,mode]})};
 t.after(async()=>{try{await stopAssetSession(toolkit,'Fixture',{timeoutMs:allowRecovery?100:10000});}catch(error){if(!allowRecovery)throw error;assert.equal(readJson(runtimePaths(toolkit,'Fixture').current).engineClosed,true);}finally{fs.rmSync(root,{recursive:true,force:true});}});
 return {root,toolkit,project,dependencies};
}
async function waitJob(toolkit,id) {
 for(let i=0;i<200;i++){const status=await requestAssetSession(toolkit,'Fixture','session.status');const job=status.jobs.find(j=>j.id===id);if(job&&['succeeded','failed'].includes(job.state))return job;await delay(20);}
 assert.fail('fixture job did not finish');
}
test('owned AssetRipper persists one load, exact 64-bit raw reads, private run and fresh export backup',async t=>{
 const {toolkit,project,dependencies}=await setup(t);
 const start=await startAssetSession(toolkit,'Fixture',{timeoutMs:10000},dependencies);assert.equal(start.state,'ready');assert.equal(hasAssetSession(toolkit,'Fixture'),true);
 const status=await assetSessionStatus(toolkit,'Fixture');assert.equal(status.live.engineVersion,'1.3.14');
 const load=await waitJob(toolkit,status.live.jobs[0].id);assert.equal(load.state,'succeeded');
 const raw={format:'json',bundle:[],collection:0,pathID:'-9007199254740993'};
 const first=await requestAssetSession(toolkit,'Fixture','assets.raw',raw);assert.match(first.data,/-9007199254740993/);
 const second=await requestAssetSession(toolkit,'Fixture','assets.raw',raw);assert.equal(second.data,first.data);
 const export1=await requestAssetSession(toolkit,'Fixture','assets.export',{}, {wait:false});const job1=await waitJob(toolkit,export1.job.id);assert.equal(job1.state,'succeeded',JSON.stringify(job1));
 const exported=toolkit.read('Fixture').reconstructedSourceDir;assert.ok(fs.existsSync(path.join(exported,'Assets','Player.cs')));
 fs.writeFileSync(path.join(exported,'my-edit.txt'),'preserve me');
 const export2=await requestAssetSession(toolkit,'Fixture','assets.export',{}, {wait:false});const job2=await waitJob(toolkit,export2.job.id);assert.equal(job2.state,'succeeded');assert.equal(fs.readFileSync(path.join(job2.result.backupPath,'ExportedProject/my-edit.txt'),'utf8'),'preserve me');
 const record=readJson(runtimePaths(toolkit,'Fixture').current);const config=readJson(runtimePaths(toolkit,'Fixture',record.runId).config);
 assert.equal(config.binding.assetsSha256.length,64);assert.ok(config.sourceManifest.files.some(f=>f.path==='level0'));assert.ok(!JSON.stringify(status).includes(config.token));
 const counts=readJson(path.join(toolkit.workspace('Fixture'),'04_Notes','asset-engine-fixture.json'));assert.equal(counts.loads,1);assert.equal(new Set(counts.exportPaths).size,2);assert.ok(counts.exportPaths.every(p=>p!==project.reconstructedSourceDir));
 await assert.rejects(withWorkspaceLock(toolkit.workspace('Fixture'),()=>{}),/busy/);
 await assert.rejects(startAssetSession(toolkit,'Fixture',{},dependencies),/session|startup|already/i);
 const stopped=await stopAssetSession(toolkit,'Fixture');assert.equal(stopped.state,'stopped');assert.equal(hasAssetSession(toolkit,'Fixture'),false);
 await withWorkspaceLock(toolkit.workspace('Fixture'),()=>{});assert.equal(fs.readdirSync(path.join(toolkit.root,'.cache/toolchain/readers')).length,0);
});
test('changed source, unsupported raw routes and oversized protocol are refused',async t=>{
 const {toolkit,project,dependencies}=await setup(t);await startAssetSession(toolkit,'Fixture',{timeoutMs:10000},dependencies);
 await assert.rejects(requestAssetSession(toolkit,'Fixture','assets.raw',{url:'http://example.test'}),/format|argument|parameter/);
 await assert.rejects(requestAssetSession(toolkit,'Fixture','assets.raw',{text:'x'.repeat(65536)}),/64 KiB|limit/);
 fs.writeFileSync(path.join(project.extractedPath,'level0'),'drift');
 await assert.rejects(requestAssetSession(toolkit,'Fixture','assets.export'),/changed|binding/);
 assert.equal((await assetSessionStatus(toolkit,'Fixture')).state,'ready');
});
test('silent export failure preserves previous project',async t=>{
 const {toolkit,project,dependencies}=await setup(t,'silent-export');fs.writeFileSync(path.join(project.reconstructedSourceDir,'keep.txt'),'keep');
 await startAssetSession(toolkit,'Fixture',{timeoutMs:10000},dependencies);const job=await requestAssetSession(toolkit,'Fixture','assets.export',{}, {wait:false});const result=await waitJob(toolkit,job.job.id);
 assert.equal(result.state,'failed');assert.equal(fs.readFileSync(path.join(project.reconstructedSourceDir,'keep.txt'),'utf8'),'keep');
 assert.notEqual(toolkit.read('Fixture').steps.assetripper.state,'succeeded');
});
test('missing pinned capabilities and early child exit fail startup without leaked leases',async t=>{
 for(const mode of ['capability-missing','early-exit']){const {toolkit,dependencies}=await setup(t,mode);await assert.rejects(startAssetSession(toolkit,'Fixture',{timeoutMs:10000},dependencies));await stopAssetSession(toolkit,'Fixture');await withWorkspaceLock(toolkit.workspace('Fixture'),()=>{});}
});
test('raw HTTP redirects and oversized output are rejected without following foreign endpoints',async t=>{
 for(const [mode,pattern] of [['redirect',/redirect/],['huge',/limit/]]){const {toolkit,dependencies}=await setup(t,mode);await startAssetSession(toolkit,'Fixture',{timeoutMs:10000},dependencies);await assert.rejects(requestAssetSession(toolkit,'Fixture','assets.raw',{format:'json',bundle:[],collection:0,pathID:'9223372036854775807'}),pattern);assert.equal((await assetSessionStatus(toolkit,'Fixture')).state,'ready');}
});
test('request deadlines leave owned work running and status available until true close',async t=>{
 const {toolkit,dependencies}=await setup(t,'slow-load');await startAssetSession(toolkit,'Fixture',{timeoutMs:10000},dependencies);
 await assert.rejects(requestAssetSession(toolkit,'Fixture','assets.export',{}, {timeoutMs:20}),/deadline/);
 const status=await requestAssetSession(toolkit,'Fixture','session.status');assert.ok(status.jobs.some(j=>j.kind==='export'));await assert.rejects(withWorkspaceLock(toolkit.workspace('Fixture'),()=>{}),/busy/);
 const item=status.jobs.find(j=>j.kind==='export');assert.equal((await waitJob(toolkit,item.id)).state,'succeeded');
});
test('job engine deadline does not release leases until the observed child closes',async t=>{
 const {toolkit,dependencies}=await setup(t,'slow-load');await startAssetSession(toolkit,'Fixture',{timeoutMs:10000,jobTimeoutMs:30},dependencies);
 for(let i=0;i<200;i++){const status=await assetSessionStatus(toolkit,'Fixture');if(['stopped','failed'].includes(status.state))break;await delay(20);}
 await stopAssetSession(toolkit,'Fixture');assert.equal(fs.existsSync(path.join(toolkit.workspace('Fixture'),'.retk-lock')),false);
});
test('RPC authentication and request byte caps protect the live queue',async t=>{
 const {toolkit,dependencies}=await setup(t);const start=await startAssetSession(toolkit,'Fixture',{timeoutMs:10000},dependencies);const p=runtimePaths(toolkit,'Fixture',start.runId),endpoint=readJson(p.endpoint);
 const frame={version:1,runId:start.runId,id:'unauthorized',token:'0'.repeat(64),method:'session.stop',params:{}};
 const exchange=bytes=>new Promise((resolve,reject)=>{const socket=net.connect(endpoint.port,'127.0.0.1');let data='';socket.on('connect',()=>socket.end(bytes));socket.on('data',chunk=>data+=chunk);socket.on('close',()=>resolve(data));socket.on('error',reject);});
 assert.equal(JSON.parse(await exchange(JSON.stringify(frame)+'\n')).error.code,'authentication_failed');assert.equal(await exchange('x'.repeat(64*1024+1)), '');assert.equal((await assetSessionStatus(toolkit,'Fixture')).state,'ready');
});
test('toolchain writer prevents session engine launch',async t=>{
 const {toolkit,dependencies}=await setup(t);const writer=path.join(toolkit.root,'.cache/toolchain/writer');fs.mkdirSync(writer,{recursive:true});
 try{await assert.rejects(startAssetSession(toolkit,'Fixture',{timeoutMs:10000},dependencies),/toolchain update|writer/i);assert.equal(fs.existsSync(path.join(toolkit.workspace('Fixture'),'04_Notes/asset-engine-fixture.json')),false);}finally{fs.rmdirSync(writer);}
});
test('forced owner death retains recovery and reader markers after its owned fixture child is closed',async()=>{
 // All process IDs below come from this newly created fixture run. This test
 // deliberately inspects uncertainty; production has no PID recovery action.
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-assets-death-')),toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Fixture');const project=toolkit.read('Fixture');project.extractedPath=path.join(toolkit.workspace('Fixture'),'01_Extracted');project.nativeBinary=path.join(project.extractedPath,'GameAssembly.dll');project.metadata=path.join(project.extractedPath,'global-metadata.dat');fs.writeFileSync(project.nativeBinary,'owned');fs.writeFileSync(project.metadata,'owned');project.identities.native=fileIdentity(project.nativeBinary);project.identities.metadata=fileIdentity(project.metadata);await toolkit.save('Fixture',project);
 let owner,child;
 try{
  const start=await startAssetSession(toolkit,'Fixture',{timeoutMs:10000},{engine:config=>({file:process.execPath,args:[fixture,config]})});const record=readJson(runtimePaths(toolkit,'Fixture').current),engineState=readJson(path.join(toolkit.workspace('Fixture'),'04_Notes/asset-engine-fixture.json'));assert.equal(engineState.runId,start.runId);owner=record.ownerPid;child=engineState.enginePid;
  process.kill(owner,'SIGKILL');await delay(100);try{process.kill(child,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}await delay(100);
  assert.ok(fs.readdirSync(path.join(toolkit.workspace('Fixture'),'.retk-lock')).some(n=>n.startsWith('assets-engine-')));assert.equal(fs.readdirSync(path.join(root,'.cache/toolchain/readers')).length,1);
  await assert.rejects(withWorkspaceLock(toolkit.workspace('Fixture'),()=>{}),/busy/);await assert.rejects(startAssetSession(toolkit,'Fixture',{timeoutMs:1000}),/startup|session/);
 }finally{for(const pid of [owner,child])if(pid)try{process.kill(pid,'SIGKILL');}catch{}await delay(100);fs.rmSync(root,{recursive:true,force:true});}
});
test('large typed operation uses a private bounded envelope while wire frames remain 64 KiB',async t=>{
 const {toolkit,dependencies}=await setup(t);const started=await startAssetSession(toolkit,'Fixture',{timeoutMs:10000},dependencies);await requestAssetSession(toolkit,'Fixture','assets.export');
 const indexed=await requestAssetSession(toolkit,'Fixture','operation',{method:'assets.index',params:{}}),scripts=await requestAssetSession(toolkit,'Fixture','operation',{method:'assets.scripts',params:{}});
 const source='using UnityEngine; public class Player : MonoBehaviour { public int health; void Update() { /*'+ 'source-owned-comment '.repeat(4000)+'*/ } }';
 const request={kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:indexed.revision,changes:[{scriptId:scripts.items[0].scriptId,source}]};
 const plan=await requestAssetSession(toolkit,'Fixture','operation',{method:'reconstruct.plan',params:{request}});assert.equal(plan.compileReady,false);assert.ok(plan.operationId);
 const repeated=await requestAssetSession(toolkit,'Fixture','operation',{method:'reconstruct.plan',params:{request}});assert.ok(repeated.operationId);
 const operations=path.join(runtimePaths(toolkit,'Fixture',started.runId).run,'operations');assert.equal(fs.readdirSync(operations).length,0);
});
test('failed source load cannot export or read raw assets with the selected binding',async t=>{
 const {toolkit,dependencies}=await setup(t,'load-fail');await startAssetSession(toolkit,'Fixture',{timeoutMs:10000},dependencies);
 await assert.rejects(requestAssetSession(toolkit,'Fixture','assets.export'),{code:'engine_not_loaded'});
 await assert.rejects(requestAssetSession(toolkit,'Fixture','assets.raw',{format:'json',bundle:[],collection:0,pathID:'1'}),{code:'engine_not_loaded'});
 const state=readJson(path.join(toolkit.workspace('Fixture'),'04_Notes/asset-engine-fixture.json'));assert.equal(state.exportPaths.length,0);
});
test('publication failure after state save restores exact original project JSON and prior export',async t=>{
 const {toolkit,project,dependencies}=await setup(t);fs.writeFileSync(path.join(project.reconstructedSourceDir,'keep.txt'),'keep');const file=path.join(toolkit.workspace('Fixture'),'project.re.json'),before=fs.readFileSync(file);
 await startAssetSession(toolkit,'Fixture',{timeoutMs:10000},{...dependencies,exportFault:'after-state-save'});
 await assert.rejects(requestAssetSession(toolkit,'Fixture','assets.export'),/publication failure/);assert.deepEqual(fs.readFileSync(file),before);assert.equal(fs.readFileSync(path.join(project.reconstructedSourceDir,'keep.txt'),'utf8'),'keep');
});
test('uncertain reconstruction refuses concurrent reads, closes the owned engine and preserves every ownership gate',async t=>{
 const {toolkit,dependencies}=await setup(t,'normal',true);await startAssetSession(toolkit,'Fixture',{timeoutMs:10000},{...dependencies,operationFault:'reconstruction_recovery_required'});
 const recovery=requestAssetSession(toolkit,'Fixture','operation',{method:'assets.index',params:{}});const settled=recovery.catch(error=>error);await delay(10);
 // Binding verification precedes connection. Under load this request can reach
 // the owner after shutdown; no queue admission was acknowledged. Both the
 // controlled refusal and transport closure must leave the read unexecuted.
 const concurrent=requestAssetSession(toolkit,'Fixture','assets.raw',{format:'json',bundle:[],collection:0,pathID:'1'}).catch(error=>error);
 assert.equal((await settled).code,'reconstruction_recovery_required');assert.ok(['session_stopping','connection_lost'].includes((await concurrent).code));
 assert.equal(readJson(path.join(toolkit.workspace('Fixture'),'04_Notes/asset-engine-fixture.json')).reads,0);
 for(let i=0;i<100;i++){const record=readJson(runtimePaths(toolkit,'Fixture').current);if(record.engineClosed){assert.equal(record.phase,'cleanup-pending');break;}await delay(20);}
 assert.equal(readJson(runtimePaths(toolkit,'Fixture').current).engineClosed,true);assert.ok(fs.existsSync(runtimePaths(toolkit,'Fixture').gate));assert.equal(fs.readdirSync(path.join(toolkit.root,'.cache/toolchain/readers')).length,1);
 await assert.rejects(withWorkspaceLock(toolkit.workspace('Fixture'),()=>{}),/busy/);await assert.rejects(startAssetSession(toolkit,'Fixture',{timeoutMs:1000}),/startup|session/);
});
test('export refuses reserved workspace destinations before touching control bytes',async t=>{
 const {toolkit,project,dependencies}=await setup(t,'slow-load');const workspace=toolkit.workspace('Fixture');fs.writeFileSync(path.join(workspace,'03_GhidraProject/keep.gpr'),'private project');
 await startAssetSession(toolkit,'Fixture',{timeoutMs:10000},dependencies);
 // Ready establishes the transport; wait for the asynchronous source job so
 // this test reaches the destination guard even when other tests saturate I/O.
 const status=await assetSessionStatus(toolkit,'Fixture');assert.equal((await waitJob(toolkit,status.live.jobs[0].id)).state,'succeeded');
 for(const reserved of ['03_GhidraProject','.retk-lock','project.re.json','04_Notes','backups','01_Extracted']){
  project.reconstructedSourceDir=path.join(workspace,reserved);const file=path.join(workspace,'project.re.json');fs.writeFileSync(file,JSON.stringify(project,null,2)+'\n');const before=fs.readFileSync(file),lock=path.join(workspace,'.retk-lock'),markers=fs.readdirSync(lock).map(name=>({name,bytes:fs.readFileSync(path.join(lock,name))}));
  await assert.rejects(requestAssetSession(toolkit,'Fixture','assets.export'),/export|reconstructed|destination|path|workspace/i);
  assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readdirSync(lock),markers.map(m=>m.name));for(const marker of markers)assert.deepEqual(fs.readFileSync(path.join(lock,marker.name)),marker.bytes);
  assert.equal(fs.readFileSync(path.join(workspace,'03_GhidraProject/keep.gpr'),'utf8'),'private project');assert.equal(readJson(path.join(workspace,'04_Notes/asset-engine-fixture.json')).exportPaths.length,0);
 }
});
