import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {atomicJson} from '../src/ghidra/runtime.js';

async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-job-wait-'));
 t.after(()=>fs.promises.rm(root,{recursive:true,force:true,maxRetries:30,retryDelay:50}));
 const workspace=path.join(root,'Game'),jobId=randomUUID(),directory=path.join(workspace,'04_Notes/jobs',jobId);
 fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(workspace,'project.re.json'),'{}');
 const toolkit={workspace:name=>{assert.equal(name,'Game');return workspace;}};
 const file=path.join(directory,'record.json');
 const write=(state='running',extra={})=>atomicJson(file,{kind:'retoolkit-job',schemaVersion:1,jobId,workspace,state,pid:process.pid,operation:'workspace.status',createdAt:new Date().toISOString(),stage:'fixture.waiting',...extra});
 write();return {root,toolkit,workspace,jobId,directory,file,write};
}
async function waitService(){return (await import('../src/jobs/wait.js')).waitForJob;}
function watcher(){
 const instance=new EventEmitter();let callback,closed=0,target;
 instance.close=()=>{closed++;};
 return {watch:(directory,_options,listener)=>{target=directory;callback=listener;return instance;},event:(event='rename',file='record.json')=>callback(event,file),instance,get closed(){return closed;},get target(){return target;}};
}
function readFixture(f){return async()=>JSON.parse(fs.readFileSync(f.file,'utf8'));}

test('wait observes atomic record replacement through the exact job directory',async t=>{
 const f=await fixture(t),waitForJob=await waitService();
 const pending=waitForJob(f.toolkit,'Game',{jobId:f.jobId,timeoutSeconds:1});
 const change=setTimeout(()=>f.write('failed',{stage:'fixture.completed'}),30);t.after(()=>clearTimeout(change));
 const result=await pending;
 assert.equal(result.state,'failed');assert.equal(result.stage,'fixture.completed');assert.equal(result.wait.state,'terminal');assert(result.wait.elapsedMs>=0);assert(result.wait.elapsedMs<1000);
});

test('wait returns every terminal state without allocating a watcher',async t=>{
 const f=await fixture(t),waitForJob=await waitService();let calls=0;
 for(const state of ['succeeded','failed','unknown']){
  const snapshot={jobId:f.jobId,state,result:{state:'partial',data:'bounded'}};
  const result=await waitForJob(f.toolkit,'Game',{jobId:f.jobId},{getJob:async()=>snapshot,watch:()=>{calls++;throw Error('unexpected watch');}});
  assert.deepEqual(result,{...snapshot,wait:{state:'terminal',elapsedMs:result.wait.elapsedMs}});
 }
 assert.equal(calls,0);
});

test('deadline returns the active snapshot without changing job ownership or content',async t=>{
 const f=await fixture(t),waitForJob=await waitService(),fake=watcher(),before=fs.readFileSync(f.file);
 const result=await waitForJob(f.toolkit,'Game',{jobId:f.jobId,timeoutSeconds:1},{watch:fake.watch,deadlineMs:35,reconcileMs:1000});
 assert.equal(result.state,'running');assert.equal(result.wait.state,'timed-out');assert(result.wait.elapsedMs>=30);assert(result.wait.elapsedMs<500);
 assert.equal(fake.target,f.directory);assert.equal(fake.closed,1);assert.equal(fake.instance.listenerCount('error'),0);assert.deepEqual(fs.readFileSync(f.file),before);
});

test('an already elapsed deadline still reads and reports the current snapshot',async t=>{
 const f=await fixture(t),waitForJob=await waitService();let reads=0;
 const result=await waitForJob(f.toolkit,'Game',{jobId:f.jobId},{getJob:async()=>{reads++;return {jobId:f.jobId,state:'queued'};},deadlineMs:0});
 assert.equal(result.state,'queued');assert.equal(result.wait.state,'timed-out');assert.equal(reads,1);
});

test('a fresh wait reconnects to the same job after a timed-out observation',async t=>{
 const f=await fixture(t),waitForJob=await waitService(),fake=watcher();
 const first=await waitForJob(f.toolkit,'Game',{jobId:f.jobId},{watch:fake.watch,deadlineMs:10});
 assert.equal(first.wait.state,'timed-out');f.write('failed');
 const second=await waitForJob(f.toolkit,'Game',{jobId:f.jobId});
 assert.equal(second.jobId,first.jobId);assert.equal(second.wait.state,'terminal');assert.equal(second.state,'failed');
});

test('post-subscription read closes the initial read versus subscription race',async t=>{
 const f=await fixture(t),waitForJob=await waitService(),fake=watcher();
 const result=await waitForJob(f.toolkit,'Game',{jobId:f.jobId},{getJob:readFixture(f),watch:(...args)=>{f.write('unknown');return fake.watch(...args);},deadlineMs:100});
 assert.equal(result.state,'unknown');assert.equal(result.wait.state,'terminal');assert.equal(fake.closed,1);
});

test('record read failures close watcher and error listener',async t=>{
 const f=await fixture(t),waitForJob=await waitService(),fake=watcher();let reads=0;
 await assert.rejects(waitForJob(f.toolkit,'Game',{jobId:f.jobId},{getJob:async()=>{if(++reads===1)return {state:'running'};throw Error('fixture read failure');},watch:fake.watch,deadlineMs:100}),/fixture read failure/);
 assert.equal(fake.closed,1);assert.equal(fake.instance.listenerCount('error'),0);
});

test('missed filesystem events reconcile to a terminal record',async t=>{
 const f=await fixture(t),waitForJob=await waitService(),fake=watcher();
 const pending=waitForJob(f.toolkit,'Game',{jobId:f.jobId},{watch:fake.watch,reconcileMs:15,deadlineMs:300});
 const change=setTimeout(()=>f.write('failed'),35);t.after(()=>clearTimeout(change));
 const result=await pending;assert.equal(result.wait.state,'terminal');assert.equal(result.state,'failed');assert.equal(fake.closed,1);
});

test('unrelated filenames are ignored and spurious target events do not imply completion',async t=>{
 const f=await fixture(t),waitForJob=await waitService(),fake=watcher();let reads=0;
 const pending=waitForJob(f.toolkit,'Game',{jobId:f.jobId},{getJob:async()=>{reads++;return {jobId:f.jobId,state:'running'};},watch:fake.watch,reconcileMs:1000,deadlineMs:100});
 await delay(10);assert.equal(reads,2);fake.event('rename','other.json');await delay(10);assert.equal(reads,2);
 fake.event('change','record.json');await delay(10);assert.equal(reads,3);
 const result=await pending;assert.equal(result.wait.state,'timed-out');assert.equal(result.state,'running');assert.equal(fake.closed,1);
});

test('a record event received during a read is retained for the next serialized read',async t=>{
 const f=await fixture(t),waitForJob=await waitService(),fake=watcher();let reads=0,release;
 const gate=new Promise(resolve=>{release=resolve;});
 const pending=waitForJob(f.toolkit,'Game',{jobId:f.jobId},{watch:fake.watch,deadlineMs:300,reconcileMs:1000,getJob:async()=>{reads++;if(reads===2){await gate;return {state:'running'};}return {state:reads>=3?'failed':'running'};}});
 await delay(10);fake.event();release();const result=await pending;
 assert.equal(result.state,'failed');assert.equal(result.wait.state,'terminal');assert.equal(reads,3);assert.equal(fake.closed,1);
});

test('watcher errors reject the wait and release observation resources',async t=>{
 const f=await fixture(t),waitForJob=await waitService(),fake=watcher();
 const pending=waitForJob(f.toolkit,'Game',{jobId:f.jobId},{watch:fake.watch,deadlineMs:200});
 const rejected=assert.rejects(pending,/fixture watch failure/);await delay(10);fake.instance.emit('error',Error('fixture watch failure'));await rejected;
 assert.equal(fake.closed,1);assert.equal(fake.instance.listenerCount('error'),0);
});

test('wait forwards bounded result options to getJob without wait-only fields',async t=>{
 const f=await fixture(t),waitForJob=await waitService(),resultFile=path.join(f.directory,'result.json');
 const bytes=Buffer.from(JSON.stringify({data:'x'.repeat(300000)}));fs.writeFileSync(resultFile,bytes);
 f.write('failed',{resultReference:{path:path.relative(f.workspace,resultFile).split(path.sep).join('/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});
 const result=await waitForJob(f.toolkit,'Game',{jobId:f.jobId,timeoutSeconds:1,resultOffset:7,resultLimit:37});
 assert.equal(result.wait.state,'terminal');assert.equal(result.resultChunk.offset,7);assert.equal(result.resultChunk.bytes,37);assert.equal(result.result,undefined);
});

test('wait rejects invalid identities, timeout and result bounds before reading or watching',async t=>{
 const f=await fixture(t),waitForJob=await waitService();let reads=0,watches=0;
 for(const params of [{jobId:'../escape'},{jobId:f.jobId,timeoutSeconds:0},{jobId:f.jobId,timeoutSeconds:31},{jobId:f.jobId,timeoutSeconds:1.5},{jobId:f.jobId,resultLimit:65537},{jobId:f.jobId,resultOffset:-1},{jobId:f.jobId,deadlineMs:1}]){
  await assert.rejects(waitForJob(f.toolkit,'Game',params,{getJob:async()=>{reads++;return {state:'running'};},watch:()=>{watches++;}}));
 }
 assert.equal(reads,0);assert.equal(watches,0);
});

test('reconciliation observes dead-worker unknown without mutating the record',async t=>{
 const f=await fixture(t),waitForJob=await waitService(),fake=watcher();
 const pending=waitForJob(f.toolkit,'Game',{jobId:f.jobId},{watch:fake.watch,reconcileMs:15,deadlineMs:300});
 const change=setTimeout(()=>f.write('running',{pid:2147483647}),30);t.after(()=>clearTimeout(change));
 const result=await pending;assert.equal(result.state,'unknown');assert.equal(result.wait.state,'terminal');assert.equal(JSON.parse(fs.readFileSync(f.file)).state,'running');
});
