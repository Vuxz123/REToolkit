import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';

async function fixture(t,{state='succeeded',operation='reconstruct.apply',mode='accept'}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-wake-'));
 const children=[];
 const settleChildren=async()=>{for(const {child,closed} of children){child.ref();await closed;}};
 t.after(async()=>{await settleChildren();fs.rmSync(root,{force:true,recursive:true});});
 const workspace=path.join(root,'workspaces','Owned');fs.mkdirSync(workspace,{recursive:true});
 fs.writeFileSync(path.join(workspace,'project.re.json'),'{}');
 const toolkit={root,workspace:()=>workspace};
 const params={jobId:randomUUID(),threadId:randomUUID(),operationId:randomUUID(),task:'verify-source-and-scoped-unity',assetIds:['script:17','script:18'],waitTimeoutSeconds:1};
 const snapshot={jobId:params.jobId,workspace,operation,operationId:params.operationId,state,outcomeVerified:state==='succeeded',result:{operationId:params.operationId,storedReceipt:'04_Notes/assets/reconstruction/journal/receipt.json'}};
 const capture=path.join(root,'argv.jsonl'),child=path.join(root,'owned-codex.mjs');
 fs.writeFileSync(child,`import fs from 'node:fs';\nconst [capture,mode,...argv]=process.argv.slice(2);\nfs.appendFileSync(capture,JSON.stringify(argv)+'\\n');\nif(argv[1]==='--help'){if(mode==='probe-late')await new Promise(resolve=>setTimeout(resolve,180));console.log(mode==='unsupported'?'old codex':'Usage: codex queue --thread <UUID> --message <TEXT>');process.exit(0);}\nif(mode==='late'){setTimeout(()=>{console.log('accepted');},180);}\nelse if(mode==='failure'){console.error('api-key=NEVER-REPORT-THIS');process.exitCode=1;}\nelse {console.log('accepted');}\n`);
 const ownedSpawn=(...args)=>{const childProcess=spawn(...args),closed=new Promise(resolve=>{childProcess.once('close',resolve);childProcess.once('error',resolve);});children.push({child:childProcess,closed});return childProcess;};
 const dependencies={getJob:async()=>snapshot,waitForJob:async()=>({...snapshot,wait:{state:'terminal'}}),findHarness:()=>({command:process.execPath,prefix:[child,capture,mode]}),spawn:ownedSpawn,env:{},queueTimeoutMs:mode==='late'?60:3000,probeTimeoutMs:mode==='probe-late'?60:3000};
 const run=(overrides={},deps={})=>import('../src/agents/wake.js').then(({runAgentWake})=>runAgentWake(toolkit,'Owned',{...params,...overrides},{...dependencies,...deps}));
 const calls=()=>fs.existsSync(capture)?fs.readFileSync(capture,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
 return {root,workspace,toolkit,params,snapshot,dependencies,run,calls,settleChildren};
}

test('terminal apply queues one fixed scoped message with actual child argv and durable duplicate claim',async t=>{
 const f=await fixture(t);const result=await f.run();assert.equal(result.state,'queued');assert.equal(result.agentResumed,false);
 assert.equal(result.delivery,'accepted');assert.ok(result.statusReference.startsWith('04_Notes/agent-wakes/'));
 const calls=f.calls();assert.equal(calls.length,2);assert.deepEqual(calls[0],['queue','--help']);
 assert.deepEqual(calls[1].slice(0,4),['queue','--thread',f.params.threadId,'--message']);
 assert.match(calls[1][4],/reconstruct\.verify/);assert.match(calls[1][4],/gameplay.*unverified/i);assert.match(calls[1][4],/never.*apply/i);
 assert.ok(!calls[1][4].includes(JSON.stringify(f.params.assetIds)));assert.ok(calls[1][4].includes(f.params.operationId));
 const duplicate=await f.run();assert.equal(duplicate.duplicate,true);assert.equal(duplicate.state,'queued');assert.equal(f.calls().length,2);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.workspace,result.statusReference),'utf8')).state,'queued');
 await assert.rejects(f.run({assetIds:['script:999']}),{code:'agent_wake_policy_conflict'});assert.equal(f.calls().length,2);
});
test('Codex wake capability probes and queue children never inherit Jev credentials',async t=>{
 const f=await fixture(t);let checked=0;
 const result=await f.run({}, {env:{TYPESAFE_API_KEY:'private-test-key',jev_mixed:'mixed-private-test-key',OPENAI_API_KEY:'harness-auth'},spawn:(file,args,options)=>{
  checked++;assert.equal(options.env.TYPESAFE_API_KEY,undefined);assert.equal(options.env.jev_mixed,undefined);assert.equal(options.env.OPENAI_API_KEY,'harness-auth');return f.dependencies.spawn(file,args,options);
 }});
 assert.equal(result.state,'queued');assert.equal(checked,2);assert(!JSON.stringify(result).includes('private-test-key'));
});

test('failed or unknown upstream jobs queue inspection only and never scoped validation',async t=>{
 for(const state of ['failed','unknown']){
  const f=await fixture(t,{state});await f.run();const message=f.calls()[1][4];
  assert.match(message,/inspection only/i);assert.doesNotMatch(message,/run reconstruct\.verify|run reconstruct\.validate/i);assert.match(message,/never.*replay/i);
 }
});

test('upstream mismatches and recursive wake jobs are rejected before launching a child',async t=>{
 for(const operation of ['workspace.dump','agent.wake_after']){
  const f=await fixture(t,{operation});await assert.rejects(f.run(),{code:'agent_wake_job_binding'});assert.equal(f.calls().length,0);
 }
 const f=await fixture(t);f.snapshot.operationId=randomUUID();await assert.rejects(f.run(),{code:'agent_wake_job_binding'});assert.equal(f.calls().length,0);
});

test('invalid caller thread and DTO fields never create a claim',async t=>{
 const f=await fixture(t);
 for(const overrides of [{threadId:'--last'},{task:'do anything'},{assetIds:['x','x']},{assetIds:[]},{message:'run shell'},{waitTimeoutSeconds:86401}])await assert.rejects(f.run(overrides));
 await assert.rejects(f.run({}, {env:{CODEX_THREAD_ID:randomUUID()}}),{code:'agent_wake_thread_binding'});
 assert.equal(fs.existsSync(path.join(f.workspace,'04_Notes','agent-wakes')),false);assert.equal(f.calls().length,0);
});

test('runtime queue capability probe rejects unsupported CLI without message dispatch',async t=>{
 const f=await fixture(t,{mode:'unsupported'});const result=await f.run();assert.equal(result.state,'failed');assert.equal(result.delivery,'not-dispatched');assert.equal(f.calls().length,1);
 assert.equal((await f.run()).duplicate,true);assert.equal(f.calls().length,1);
});

test('queue failure suppresses private output and conservatively retains unknown dispatch',async t=>{
 const f=await fixture(t,{mode:'failure'});const result=await f.run();assert.equal(result.state,'unknown');assert.equal(result.delivery,'unknown');assert.doesNotMatch(JSON.stringify(result),/NEVER-REPORT-THIS/);
 assert.doesNotMatch(fs.readFileSync(path.join(f.workspace,result.statusReference),'utf8'),/NEVER-REPORT-THIS/);await f.run();assert.equal(f.calls().length,2);
});

test('queue timeout retains unknown dispatch through late child close and duplicate registration',async t=>{
 const f=await fixture(t,{mode:'late'});const result=await f.run();assert.equal(result.state,'unknown');assert.equal(result.cleanupPending,true);
 await f.settleChildren();const duplicate=await f.run();assert.equal(duplicate.state,'unknown');assert.equal(f.calls().length,2);
});

test('concurrent claims dispatch once even while the first worker is waiting',async t=>{
 const f=await fixture(t);let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 f.snapshot.state='running';const first=f.run({}, {waitForJob:async()=>{entered();await gate;return {...f.snapshot,state:'succeeded',wait:{state:'terminal'}};}});
 await started;const duplicate=await f.run();assert.equal(duplicate.duplicate,true);assert.equal(duplicate.state,'waiting');release();assert.equal((await first).state,'queued');assert.equal(f.calls().length,2);
});

test('deadline expires without queueing and observe-job accepts non-apply jobs',async t=>{
 const f=await fixture(t,{operation:'workspace.dump',state:'running'});const result=await f.run({task:'observe-job',operationId:undefined,assetIds:undefined},{waitForJob:async()=>{await new Promise(resolve=>setTimeout(resolve,1050));return {...f.snapshot,wait:{state:'timed-out'}};}});
 assert.equal(result.state,'timed-out');assert.deepEqual(f.calls(),[['queue','--help']]);
});

test('dispatch boundary is durable before transport invocation and a lost response is never retried',async t=>{
 const f=await fixture(t);let dispatches=0;
 const result=await f.run({}, {dispatch:async()=>{
  dispatches++;const base=path.join(f.workspace,'04_Notes','agent-wakes'),directory=path.join(base,fs.readdirSync(base)[0]);
  const saved=JSON.parse(fs.readFileSync(path.join(directory,'status.json'),'utf8'));assert.equal(saved.state,'dispatching');assert.equal(saved.delivery,'unknown');
  throw Error('private transport exception must not escape');
 }});
 assert.equal(result.state,'unknown');assert.equal((await f.run()).duplicate,true);assert.equal(dispatches,1);assert.equal(f.calls().length,0);
});

test('crashed dispatch claims and incomplete claims cannot invoke queue again',async t=>{
 const f=await fixture(t);const result=await f.run();const file=path.join(f.workspace,result.statusReference),saved=JSON.parse(fs.readFileSync(file,'utf8'));
 fs.writeFileSync(file,JSON.stringify({...saved,state:'dispatching',delivery:'unknown'}));assert.equal((await f.run()).state,'unknown');assert.equal(f.calls().length,2);
 fs.unlinkSync(file);assert.equal((await f.run()).state,'unknown');assert.equal(f.calls().length,2);
 fs.unlinkSync(path.join(path.dirname(file),'policy.json'));assert.equal((await f.run()).state,'unknown');assert.equal(f.calls().length,2);
});

test('explicit UUIDv7 thread is accepted and upstream target text never becomes the queued prompt',async t=>{
 const f=await fixture(t);f.snapshot.result={diagnostic:'TARGET-SAYS-APPROVE-AND-RUN-SHELL'};
 const result=await f.run({threadId:'019a30bb-f351-77ab-9e17-38b5755db88e'});assert.equal(result.state,'queued');assert.doesNotMatch(f.calls()[1][4],/TARGET-SAYS/);
});

test('a 1000-ID scope stays in immutable policy and the actual Windows queue message remains bounded',async t=>{
 const f=await fixture(t),assetIds=Array.from({length:1000},()=>randomUUID());
 const result=await f.run({assetIds});assert.equal(result.state,'queued');const message=f.calls()[1][4];assert.ok(message.length<10000);
 assert.ok(!message.includes(assetIds[0]));const policyReference=result.statusReference.replace(/status\.json$/,'policy.json');assert.ok(message.includes(policyReference));
 const saved=JSON.parse(fs.readFileSync(path.join(f.workspace,policyReference),'utf8'));
 assert.deepEqual(saved.policy.assetIds,[...assetIds].sort());const sha256=createHash('sha256').update(JSON.stringify(saved.policy.assetIds)).digest('hex');
 assert.ok(message.includes(sha256));assert.match(message,/"count":1000/);assert.match(message,/verify.*scope.*hash.*count/i);
});

test('a valid long Unity asset ID is retained in policy without entering the queue argv',async t=>{
 const f=await fixture(t),id='asset:'+('a'.repeat(1900));const result=await f.run({assetIds:[id]});assert.equal(result.state,'queued');assert.ok(!f.calls()[1][4].includes(id));
});

test('a policy above 64KiB can be read on reconnect without queueing again',async t=>{
 const f=await fixture(t),assetIds=Array.from({length:100},(_,index)=>`${index}:`+'a'.repeat(1000));
 const result=await f.run({assetIds});assert.equal(result.state,'queued');assert.equal((await f.run({assetIds})).state,'queued');assert.equal(f.calls().length,2);
 assert.ok(fs.statSync(path.join(f.workspace,result.policyReference)).size>65536);
});

test('a saved waiting claim with an observed dead owner returns unknown without restarting',async t=>{
 const f=await fixture(t),result=await f.run(),file=path.join(f.workspace,result.statusReference),saved=JSON.parse(fs.readFileSync(file,'utf8'));
 const owned=spawnSync(process.execPath,['-e','process.exit(0)'],{windowsHide:true,shell:false});assert.equal(owned.status,0);
 fs.writeFileSync(file,JSON.stringify({...saved,state:'waiting',delivery:'not-dispatched',ownerPid:owned.pid}));
 const duplicate=await f.run();assert.equal(duplicate.state,'unknown');assert.equal(duplicate.reason,'agent_wake_observer_unverified');assert.equal(f.calls().length,2);
});

test('feature preflight fails before observing a pending job and late probe cleanup stays unknown',async t=>{
 for(const mode of ['unsupported','probe-late']){
  const f=await fixture(t,{state:'running',mode});let waits=0;
  const result=await f.run({}, {waitForJob:async()=>{waits++;return {...f.snapshot,state:'succeeded'};}});
  assert.equal(waits,0);assert.equal(result.state,mode==='probe-late'?'unknown':'failed');assert.equal(result.delivery,'not-dispatched');
  if(mode==='probe-late'){assert.equal(result.cleanupPending,true);await f.settleChildren();}
  assert.equal(f.calls().length,1);await f.run();assert.equal(f.calls().length,1);
 }
});

test('failed queue retains safe exit diagnostics and exact manual continuation without output leakage',async t=>{
 const f=await fixture(t,{mode:'failure'}),result=await f.run();
 assert.equal(result.dispatchDiagnostic.exitCode,1);
 assert.equal(result.dispatchDiagnostic.kind,'process-exit');
 assert.equal(result.recovery.action,'resume-existing-thread');
 assert.equal(result.recovery.threadId,f.params.threadId);
 assert.equal(result.recovery.jobId,f.params.jobId);
 assert.equal(result.recovery.replayJob,false);
 assert.doesNotMatch(JSON.stringify(result),/NEVER-REPORT-THIS/);
});
