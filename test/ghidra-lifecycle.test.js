import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createToolkit} from '../src/toolkit.js';
import {startSession,stopSession,sessionStatus,querySession,mutateSession,recoverSession} from '../src/ghidra/provider.js';
import {withWorkspaceLock,setStep,outputManifest,fileIdentity} from '../src/state.js';
import {stepFingerprint} from '../src/inputs.js';
import {readSession} from '../src/ghidra/runtime.js';
const fake=fileURLToPath(new URL('./fixtures/ghidra-engine.mjs',import.meta.url));
async function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-session-'));const toolkit=createToolkit(root,{log:()=>{}});
  await toolkit.init('Fixture');fs.mkdirSync(path.join(root,'input'));
  fs.writeFileSync(path.join(root,'input/GameAssembly.dll'),'MZfixture');fs.writeFileSync(path.join(root,'input/global-metadata.dat'),'metadata');
  await toolkit.scan('Fixture',path.join(root,'input'));
  const project=toolkit.read('Fixture');project.ghidraProgramName='GameAssembly.dll';
  fs.writeFileSync(path.join(project.ghidraProjectDir,'Fixture.gpr'),'project');fs.mkdirSync(path.join(project.ghidraProjectDir,'Fixture.rep'));
  fs.writeFileSync(path.join(project.ghidraProjectDir,'Fixture.rep','owned.txt'),'data');await toolkit.save('Fixture',project);
  return {root,toolkit};
}
test('detached session owns workspace until engine closes, reuses process and detects changed inputs',async()=>{
  const {root,toolkit}=await fixture();
  try {
    const result=await startSession(toolkit,'Fixture',{timeoutMs:10000},{engine:config=>({file:process.execPath,args:[fake,config]})});
    assert.equal(result.state,'ready');
    const one=await querySession(toolkit,'Fixture','session.status');
    const two=await querySession(toolkit,'Fixture','session.status');assert.equal(one.result.enginePid,two.result.enginePid);
    await assert.rejects(withWorkspaceLock(toolkit.workspace('Fixture'),()=>{}),/busy/);
    assert.equal((await sessionStatus(toolkit,'Fixture')).live.result.state,'ready');
    assert.equal((await startSession(toolkit,'Fixture',{timeoutMs:1000})).runId,result.runId);
    await assert.rejects(startSession(toolkit,'Fixture',{reuse:false,timeoutMs:1000}),error=>error.code==='session_conflict');
    await assert.rejects(startSession(toolkit,'Fixture',{write:true,timeoutMs:1000}),error=>error.code==='session_conflict');
    fs.appendFileSync(toolkit.read('Fixture').nativeBinary,'changed');
    await assert.rejects(querySession(toolkit,'Fixture','functions.list'),error=>error.code==='input_changed');
    await stopSession(toolkit,'Fixture',{timeoutMs:10000});
    assert.ok(readSession(toolkit,'Fixture').ownerPid);
    assert.throws(()=>process.kill(readSession(toolkit,'Fixture').ownerPid,0),error=>error.code==='ESRCH');
    await withWorkspaceLock(toolkit.workspace('Fixture'),()=>{});
  } finally {await stopSession(toolkit,'Fixture',{timeoutMs:10000}).catch(()=>{});fs.rmSync(root,{recursive:true,force:true});}
});
test('write session makes verified full project backup and competing starts cannot replace ownership',async()=>{
  const {root,toolkit}=await fixture();
  try {
    const args={write:true,timeoutMs:10000};const dependencies={engine:config=>({file:process.execPath,args:[fake,config]})};
    const results=await Promise.allSettled([startSession(toolkit,'Fixture',args,dependencies),startSession(toolkit,'Fixture',args,dependencies)]);
    const successful=results.filter(result=>result.status==='fulfilled').map(result=>result.value);
    assert.ok(successful.length>=1);
    assert.equal(new Set(successful.map(result=>result.runId)).size,1);
    const started=successful[0];
    assert.equal(fs.readdirSync(path.join(toolkit.workspace('Fixture'),'backups')).filter(name=>!name.endsWith('.json')).length,1);
    assert.equal(fs.readFileSync(path.join(started.backupPath,'Fixture.rep/owned.txt'),'utf8'),'data');
    assert.ok(fs.existsSync(started.backupPath+'.manifest.json'));
    await stopSession(toolkit,'Fixture',{timeoutMs:10000});
  }finally{await stopSession(toolkit,'Fixture',{timeoutMs:10000}).catch(()=>{});fs.rmSync(root,{recursive:true,force:true});}
});
test('explicit mutation retry uses exact prepared payload and rejects UUID reused for different intent',async()=>{
  const {root,toolkit}=await fixture();
  try {
    await startSession(toolkit,'Fixture',{write:true,timeoutMs:10000},{engine:config=>({file:process.execPath,args:[fake,config]})});
    const operationId='11111111-1111-4111-8111-111111111111';
    const params={address:'0x1000',name:'Renamed'};
    const first=await mutateSession(toolkit,'Fixture','functions.rename',params,{operationId});
    const retry=await mutateSession(toolkit,'Fixture','functions.rename',params,{operationId});
    assert.deepEqual(first.result,retry.result);
    assert.equal((await querySession(toolkit,'Fixture','session.status')).result.writes,1);
    await stopSession(toolkit,'Fixture',{timeoutMs:10000});
    await startSession(toolkit,'Fixture',{write:true,timeoutMs:10000},{engine:config=>({file:process.execPath,args:[fake,config]})});
    const reopened=await mutateSession(toolkit,'Fixture','functions.rename',params,{operationId});
    assert.deepEqual(reopened.result,first.result);
    await assert.rejects(mutateSession(toolkit,'Fixture','functions.rename',{...params,name:'Other'},{operationId}),error=>error.code==='operation_conflict');
  }finally{await stopSession(toolkit,'Fixture',{timeoutMs:10000}).catch(()=>{});fs.rmSync(root,{recursive:true,force:true});}
});
test('explicit recovery refuses a live owner and recovers only after orphan engine closure',async()=>{
  const {root,toolkit}=await fixture();
  let ownerPid;
  try {
    await startSession(toolkit,'Fixture',{timeoutMs:10000},{engine:config=>({file:process.execPath,args:[fake,config]})});
    await assert.rejects(recoverSession(toolkit,'Fixture'),/busy|live|stop/);
    const lock=path.join(toolkit.workspace('Fixture'),'.retk-lock');
    const marker=fs.readdirSync(lock).find(name=>name.startsWith('owner-'));ownerPid=JSON.parse(fs.readFileSync(path.join(lock,marker))).pid;
    process.kill(ownerPid,'SIGKILL');
    const deadline=Date.now()+10000;
    while(fs.readdirSync(lock).some(name=>name.startsWith('engine-'))&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
    assert.ok(!fs.readdirSync(lock).some(name=>name.startsWith('engine-')),'orphan fixture engine must close on control loss');
    assert.equal((await recoverSession(toolkit,'Fixture')).state,'stopped');
    await withWorkspaceLock(toolkit.workspace('Fixture'),()=>{});
  }finally{await stopSession(toolkit,'Fixture',{timeoutMs:500}).catch(()=>{});fs.rmSync(root,{recursive:true,force:true});}
});
test('verified prior-run saved receipt reconciles project state under the owning lease',async()=>{
  const {root,toolkit}=await fixture();
  try {
    const prepared=toolkit.read('Fixture');fs.writeFileSync(path.join(prepared.il2cppDumperOutput,'script.json'),'{}');
    setStep(prepared,'dump','succeeded',stepFingerprint(prepared,'dump',toolkit.tools,root),outputManifest([prepared.il2cppDumperOutput]));await toolkit.save('Fixture',prepared);
    await startSession(toolkit,'Fixture',{write:true,timeoutMs:10000},{engine:config=>({file:process.execPath,args:[fake,config,'prior']})});
    const project=toolkit.read('Fixture');
    assert.equal(project.steps.symbols.state,'succeeded');assert.equal(project.status.symbolsApplied,true);
    assert.equal(project.bridgeHistory[0].operationId,'22222222-2222-4222-8222-222222222222');
  }finally{await stopSession(toolkit,'Fixture',{timeoutMs:10000}).catch(()=>{});fs.rmSync(root,{recursive:true,force:true});}
});
test('CLI symbol apply sends immutable file identity and compact expected values',async()=>{
  const {root,toolkit}=await fixture();
  try {
    const project=toolkit.read('Fixture');const script=path.join(project.il2cppDumperOutput,'script.json');fs.writeFileSync(script,'{}');
    setStep(project,'dump','succeeded',stepFingerprint(project,'dump',toolkit.tools,root),outputManifest([project.il2cppDumperOutput]));await toolkit.save('Fixture',project);
    const plan=path.join(toolkit.workspace('Fixture'),'04_Notes/plan.json');fs.writeFileSync(plan,'{"entries":[]}');
    await startSession(toolkit,'Fixture',{write:true,timeoutMs:10000},{engine:config=>({file:process.execPath,args:[fake,config]})});
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../re.js',import.meta.url)),'symbols','apply','Fixture','--plan',plan,'--root',root,'--json'],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);const response=JSON.parse(result.stdout);
    assert.equal(response.result.plan,plan);assert.equal(response.result.planHash,fileIdentity(plan).sha256);
  }finally{await stopSession(toolkit,'Fixture',{timeoutMs:10000}).catch(()=>{});fs.rmSync(root,{recursive:true,force:true});}
});
for(const mode of ['prior-noop','prior-stale'])test(`symbol reconciliation ${mode} preserves current coverage evidence`,async()=>{
  const {root,toolkit}=await fixture();
  try {
    const project=toolkit.read('Fixture');fs.writeFileSync(path.join(project.il2cppDumperOutput,'script.json'),'{}');
    setStep(project,'dump','succeeded',stepFingerprint(project,'dump',toolkit.tools,root),outputManifest([project.il2cppDumperOutput]));await toolkit.save('Fixture',project);
    await startSession(toolkit,'Fixture',{write:true,timeoutMs:10000},{engine:config=>({file:process.execPath,args:[fake,config,mode]})});
    const actual=toolkit.read('Fixture');assert.equal(actual.bridgeHistory.length,1);
    assert.equal(actual.status.symbolsApplied,mode==='prior-noop');
    if(mode==='prior-noop')assert.equal(actual.bridgeHistory[0].saveStatus,'noop');
  }finally{await stopSession(toolkit,'Fixture',{timeoutMs:10000}).catch(()=>{});fs.rmSync(root,{recursive:true,force:true});}
});
