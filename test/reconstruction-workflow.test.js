import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture,replacement} from './reconstruction-fixture.js';
import {createToolkit} from '../src/toolkit.js';
import {invokeAssetApi} from '../src/assets/api.js';
import {startJob,executeJob} from '../src/jobs/service.js';
import {runWorkflowOperation} from '../src/workflow/service.js';
import {runAgentWake} from '../src/agents/wake.js';
import {withWorkspaceLock} from '../src/state.js';
import {handleOwnedAssetOperation} from '../src/assets/service.js';

async function setup(t){
 const f=await fixture(t),toolkit=createToolkit(f.root,{log:()=>{}});await toolkit.init('Game');
 const workspace=toolkit.workspace('Game'),input=path.join(workspace,'01_Extracted');
 fs.writeFileSync(path.join(input,'libil2cpp.so'),'native');fs.writeFileSync(path.join(input,'global-metadata.dat'),'metadata');await toolkit.scan('Game',input);
 fs.cpSync(f.projectDir,path.join(workspace,'05_ReconstructedSource'),{recursive:true});
 const call=(command,params={})=>invokeAssetApi(toolkit,'Game','workflow.'+command,params);
 const goal={goal:'Recover a playable level',authorizedOperations:['assets.index','reconstruct.apply','reconstruct.verify','reconstruct.validate'],steps:[{id:'code',label:'Pool source',dimension:'source',sourcePaths:['Assets/Player.cs'],dependsOn:[]},{id:'play',label:'Play level',dimension:'gameplay',dependsOn:['code'],scenario:{entry:'Level one',actions:['spawn','return'],expected:'level remains interactive'}}]};
 const create=overrides=>call('create',{...goal,...overrides});
 const claim=run=>call('claim',{runId:run.runId,sequence:run.sequence,harness:'codex',threadId:process.env.CODEX_THREAD_ID??randomUUID()});
 return {...f,toolkit,workspace,call,create,claim};
}
const withClaim=r=>({runId:r.runId,sequence:r.sequence,claimId:r.controller.claimId});

test('workflow preserves gameplay goal across restart, duplicate creation and partial progress',async t=>{
 const f=await setup(t),run=await f.create();assert.equal(run.state,'active');assert.equal(run.complete,false);
 await assert.rejects(f.create(),{code:'workflow_active_exists'});
 const c=await f.claim(run);assert.equal(c.agentResumed,true);
 const partial=await f.call('checkpoint',{...withClaim(c),stepId:'code',outcome:'progress',note:'source proposal ready'});
 assert.equal(partial.complete,false);assert.equal(partial.steps[1].state,'todo');
 const restarted=await f.call('status',{runId:run.runId});assert.equal(restarted.goal,'Recover a playable level');assert.equal(restarted.freshness,'not-rechecked');assert.equal(restarted.sequence,partial.sequence);
});
test('workflow exact claims prevent duplicate controllers and stale checkpoints',async t=>{
 const f=await setup(t),run=await f.create(),c=await f.claim(run);
 await assert.rejects(f.claim(c),{code:'workflow_controller_exists'});
 await assert.rejects(f.call('heartbeat',{...withClaim(c),claimId:randomUUID()}),{code:'workflow_claim_invalid'});
 const h=await f.call('heartbeat',withClaim(c));
 await assert.rejects(f.call('checkpoint',{...withClaim(c),stepId:'code',outcome:'progress',note:'late'}),{code:'workflow_sequence_stale'});
 const released=await f.call('release',withClaim(h));assert.equal(released.state,'waiting-agent');assert.equal(released.agentResumed,false);
});
test('missing gameplay evidence cannot be reported as complete or verified',async t=>{
 const f=await setup(t),c=await f.claim(await f.create());
 await assert.rejects(f.call('checkpoint',{...withClaim(c),stepId:'play',outcome:'verified'}));
 const r=await f.call('checkpoint',{...withClaim(c),stepId:'play',outcome:'blocked',note:'No gameplay runner configured'});
 assert.equal(r.complete,false);assert.equal(r.steps[1].state,'blocked');
 const next=await f.call('next',{runId:r.runId});assert.equal(next.nextStep.id,'code');assert.equal(next.state,'active');
});
test('pause and cancel preserve unfinished tasks and disallow automatic resumption',async t=>{
 const f=await setup(t),run=await f.create(),c=await f.claim(run);
 const paused=await f.call('pause',{runId:c.runId,sequence:c.sequence});assert.equal(paused.state,'paused');
 await assert.rejects(f.claim(paused),{code:'workflow_inactive'});
 const resumed=await f.call('resume',{runId:paused.runId,sequence:paused.sequence});assert.equal(resumed.state,'waiting-agent');
 const canceled=await f.call('cancel',{runId:resumed.runId,sequence:resumed.sequence});assert.equal(canceled.state,'canceled');
 await assert.rejects(f.call('resume',{runId:canceled.runId,sequence:canceled.sequence}),{code:'workflow_inactive'});
 assert.equal(canceled.steps.length,2);
});
test('changed candidate invalidates prior scope and blocks next work without replay',async t=>{
 const f=await setup(t),run=await f.create();fs.appendFileSync(path.join(f.workspace,'05_ReconstructedSource/Assets/Player.cs'),'// external');
 const next=await f.call('next',{runId:run.runId});assert.equal(next.state,'needs-inspection');assert.equal(next.reason,'workflow_candidate_stale');assert.equal(next.nextStep,null);
});
test('cycles, missing gameplay scenario and arbitrary operation permissions are rejected',async t=>{
 const f=await setup(t);
 for(const change of [{steps:[{id:'x',label:'x',dimension:'source',sourcePaths:['Assets/Player.cs'],dependsOn:['x']}]},{steps:[{id:'x',label:'x',dimension:'gameplay',dependsOn:[]}]},{authorizedOperations:['shell.exec']},{steps:[{id:'probe',label:'Investigation',dimension:'investigation',dependsOn:[]}]}])await assert.rejects(f.create(change));
});
test('a real apply/verify job completes only its source step, not gameplay',async t=>{
 const f=await setup(t),run=await f.create(),c=await f.claim(run);
 const graph=await invokeAssetApi(f.toolkit,'Game','assets.index',{storage:'sqlite'}),scripts=await invokeAssetApi(f.toolkit,'Game','assets.scripts',{});
 const plan=await invokeAssetApi(f.toolkit,'Game','reconstruct.plan',{request:{kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:graph.revision,changes:[{scriptId:scripts.items[0].scriptId,source:replacement}]}});
 const j=await startJob(f.toolkit,'Game',{operation:'reconstruct.apply',params:{operationId:plan.operationId}},{spawn:()=>({pid:process.pid,once(){},unref(){}})});
 const done=await executeJob(f.toolkit,'Game',j.jobId);assert.equal(done.state,'succeeded');assert(done.phaseMetrics.some(p=>p.phase==='input.verify'&&p.calls>0));assert(done.phaseMetrics.some(p=>p.phase==='inventory.verify'&&p.files>0));
 const r=await f.call('checkpoint',{...withClaim(c),stepId:'code',outcome:'job',jobId:j.jobId});assert.equal(r.steps[0].state,'verified');assert.equal(r.complete,false);
 const next=await f.call('next',{runId:r.runId});assert.equal(next.nextStep.id,'play');
});
test('unknown jobs become inspection gates and successful unrelated jobs are not acceptance',async t=>{
 const f=await setup(t),c=await f.claim(await f.create());
 const j=await startJob(f.toolkit,'Game',{operation:'assets.index',params:{}},{spawn:()=>({pid:process.pid,once(){},unref(){}})});
 await executeJob(f.toolkit,'Game',j.jobId,{invoke:async()=>{throw Object.assign(Error('closure uncertain'),{code:'cleanup_pending'});}});
 const r=await f.call('checkpoint',{...withClaim(c),stepId:'code',outcome:'job',jobId:j.jobId});assert.equal(r.state,'needs-inspection');assert.equal(r.complete,false);assert.equal(r.inspection.jobId,j.jobId);assert.equal((await f.call('status',{runId:r.runId})).inspection.stepId,'code');
});
test('unsupported harness wait retains exact job and reports missing continuation',async t=>{
 const f=await setup(t),run=await f.create(),c=await f.call('claim',{runId:run.runId,sequence:run.sequence,harness:'claude',threadId:randomUUID()});
 const j=await startJob(f.toolkit,'Game',{operation:'assets.index',params:{}},{spawn:()=>({pid:process.pid,once(){},unref(){}})});
 const w=await f.call('wait',{...withClaim(c),jobId:j.jobId,stepId:'code'});assert.equal(w.state,'waiting-job');assert.equal(w.continuation.state,'unsupported');assert.equal(w.agentResumed,true);
 const status=await f.call('status',{runId:w.runId});assert.equal(status.waiting.jobId,j.jobId);assert.equal(status.complete,false);
});
test('Codex wait dispatches at most once and queue acceptance remains unacknowledged until exact claim',async t=>{
 const f=await setup(t),c=await f.claim(await f.create());
 const j=await startJob(f.toolkit,'Game',{operation:'assets.index',params:{}},{spawn:()=>({pid:process.pid,once(){},unref(){}})});
 await executeJob(f.toolkit,'Game',j.jobId);
 let registration;
 const w=await runWorkflowOperation(f.toolkit,'Game','wait',{...withClaim(c),stepId:'code',jobId:j.jobId},{startWatcher:async(_t,_n,request)=>{registration=request;return startJob(f.toolkit,'Game',request,{spawn:()=>({pid:process.pid,once(){},unref(){}})});}});
 assert.equal(registration.params.task,'continue-reconstruction');assert.equal(w.agentResumed,false);assert.equal(w.continuation.state,'registered');
 let dispatched=0,message='';const deps={env:{},dispatch:async p=>{dispatched++;message=p.message;return {state:'accepted'};}};
 const queued=await runAgentWake(f.toolkit,'Game',registration.params,deps);assert.equal(queued.state,'queued');assert.equal(queued.agentResumed,false);assert.match(message,/workflow\.claim/);assert.match(message,/unfinished/i);
 await runAgentWake(f.toolkit,'Game',registration.params,deps);assert.equal(dispatched,1);
 const status=await f.call('status',{runId:w.runId});assert.equal(status.agentResumed,false);assert.equal(status.complete,false);
 const ack=await f.call('claim',{runId:w.runId,sequence:status.sequence,harness:'codex',threadId:c.controller.threadId});assert.equal(ack.agentResumed,true);assert.equal(ack.continuation.agentResumed,true);
 const afterClaim=await f.call('status',{runId:w.runId});assert.equal(afterClaim.continuation.agentResumed,true);
 const unrelated=await f.call('checkpoint',{...withClaim(ack),stepId:'code',outcome:'job',jobId:j.jobId});assert.equal(unrelated.steps[0].state,'unverified');assert.equal(unrelated.complete,false);
});
test('cancellation before dispatch suppresses workflow wake notification',async t=>{
 const f=await setup(t),c=await f.claim(await f.create());
 const j=await startJob(f.toolkit,'Game',{operation:'assets.index',params:{}},{spawn:()=>({pid:process.pid,once(){},unref(){}})});await executeJob(f.toolkit,'Game',j.jobId);
 let policy;const w=await runWorkflowOperation(f.toolkit,'Game','wait',{...withClaim(c),stepId:'code',jobId:j.jobId},{startWatcher:async(_t,_n,r)=>{policy=r.params;return {jobId:randomUUID()};}});
 await f.call('cancel',{runId:w.runId,sequence:w.sequence});
 let dispatched=0;const result=await runAgentWake(f.toolkit,'Game',policy,{env:{},dispatch:async()=>{dispatched++;return {state:'accepted'};}});
 assert.equal(result.state,'canceled');assert.equal(dispatched,0);
});
test('workflow cancellation and queue dispatch serialize on the same control lock',async t=>{
 const f=await setup(t),c=await f.claim(await f.create());const j=await startJob(f.toolkit,'Game',{operation:'assets.index',params:{}},{spawn:()=>({pid:process.pid,once(){},unref(){}})});await executeJob(f.toolkit,'Game',j.jobId);
 let policy;const w=await runWorkflowOperation(f.toolkit,'Game','wait',{...withClaim(c),stepId:'code',jobId:j.jobId},{startWatcher:async(_t,_n,r)=>{policy=r.params;return {jobId:randomUUID()};}});
 // A separate process would not inherit the lock's AsyncLocalStorage context.
 const cli=new URL('../re.js',import.meta.url),{spawnSync}=await import('node:child_process'),{fileURLToPath}=await import('node:url');
 const result=await runAgentWake(f.toolkit,'Game',policy,{env:{},dispatch:async()=>{
  const cancel=spawnSync(process.execPath,[fileURLToPath(cli),'workflow','cancel','Game','--run',w.runId,'--sequence',String(w.sequence),'--root',f.root,'--json'],{windowsHide:true,encoding:'utf8',timeout:5000});
  assert.equal(cancel.status,1,cancel.stdout);assert.match(cancel.stderr,/busy/);return {state:'accepted'};
 }});
 assert.equal(result.state,'queued');const canceled=await f.call('cancel',{runId:w.runId,sequence:w.sequence});assert.equal(canceled.state,'canceled');
});
test('interrupted watcher registration is retained and cannot be silently registered again',async t=>{
 const f=await setup(t),c=await f.claim(await f.create());const j=await startJob(f.toolkit,'Game',{operation:'assets.index',params:{}},{spawn:()=>({pid:process.pid,once(){},unref(){}})});
 const w=await runWorkflowOperation(f.toolkit,'Game','wait',{...withClaim(c),stepId:'code',jobId:j.jobId},{startWatcher:async()=>{throw Error('lost spawn acknowledgment');}});
 assert.equal(w.continuation.state,'unknown');assert.equal(w.waiting.jobId,j.jobId);assert.equal(w.agentResumed,false);
 const ack=await f.call('claim',{runId:w.runId,sequence:w.sequence,harness:'codex',threadId:c.controller.threadId});
 await assert.rejects(f.call('wait',{...withClaim(ack),stepId:'code',jobId:j.jobId}),{code:'workflow_wait_exists'});
});
test('source proof must cover the declared files and source-only scope can complete',async t=>{
 const f=await setup(t),run=await f.create({steps:[{id:'code',label:'Player',dimension:'source',sourcePaths:['Assets/Player.cs'],dependsOn:[]}]}),c=await f.claim(run);
 const graph=await invokeAssetApi(f.toolkit,'Game','assets.index',{}),scripts=await invokeAssetApi(f.toolkit,'Game','assets.scripts',{});
 const plan=await invokeAssetApi(f.toolkit,'Game','reconstruct.plan',{request:{kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:graph.revision,changes:[{scriptId:scripts.items[0].scriptId,source:replacement}]}});
 const j=await startJob(f.toolkit,'Game',{operation:'reconstruct.apply',params:{operationId:plan.operationId}},{spawn:()=>({pid:process.pid,once(){},unref(){}})});await executeJob(f.toolkit,'Game',j.jobId);
 const r=await f.call('checkpoint',{...withClaim(c),stepId:'code',outcome:'job',jobId:j.jobId});assert.equal(r.complete,true);assert.equal(r.state,'completed');
 const wrong=await f.create({steps:[{id:'other',label:'Other source',dimension:'source',sourcePaths:['Assets/Other.cs'],dependsOn:[]}]}),other=await f.claim(wrong);
 const rejected=await f.call('checkpoint',{...withClaim(other),stepId:'other',outcome:'job',jobId:j.jobId});assert.equal(rejected.complete,false);assert.equal(rejected.steps[0].state,'unverified');assert.equal(rejected.steps[0].evidence.reason,'source_scope_incomplete');
});
test('a stale heartbeat never authorizes a second controller',async t=>{
 const f=await setup(t),c=await f.claim(await f.create()),file=path.join(f.workspace,'04_Notes/reconstruction-runs',c.runId+'.json');
 const {seal,unseal}=await import('../src/recovery/artifacts.js');const saved=unseal(JSON.parse(fs.readFileSync(file)));saved.controller.heartbeatAt='2000-01-01T00:00:00.000Z';fs.writeFileSync(file,JSON.stringify(seal(saved)));
 const status=await f.call('status',{runId:c.runId});assert.equal(status.agentResumed,false);assert.equal(status.controller.heartbeatStale,true);
 await assert.rejects(f.claim(status),{code:'workflow_controller_exists'});
 const heartbeat=await f.call('heartbeat',withClaim(status));assert.equal(heartbeat.agentResumed,true);
});
test('completed source scope becomes stale when its candidate changes',async t=>{
 const f=await setup(t),c=await f.claim(await f.create({steps:[{id:'code',label:'Player',dimension:'source',sourcePaths:['Assets/Player.cs'],dependsOn:[]}]}));
 const graph=await invokeAssetApi(f.toolkit,'Game','assets.index',{}),scripts=await invokeAssetApi(f.toolkit,'Game','assets.scripts',{});
 const plan=await invokeAssetApi(f.toolkit,'Game','reconstruct.plan',{request:{kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:graph.revision,changes:[{scriptId:scripts.items[0].scriptId,source:replacement}]}});
 const j=await startJob(f.toolkit,'Game',{operation:'reconstruct.apply',params:{operationId:plan.operationId}},{spawn:()=>({pid:process.pid,once(){},unref(){}})});await executeJob(f.toolkit,'Game',j.jobId);
 const done=await f.call('checkpoint',{...withClaim(c),stepId:'code',outcome:'job',jobId:j.jobId});assert.equal(done.complete,true);
 const successor=await f.create();
 fs.appendFileSync(path.join(f.workspace,'05_ReconstructedSource/Assets/Player.cs'),'// later edit');
 const next=await f.call('next',{runId:done.runId});assert.equal(next.freshness,'stale');assert.equal(next.complete,false);assert.equal(next.state,'needs-inspection');
 assert.equal((await f.call('status',{})).runId,successor.runId);
 await assert.rejects(f.claim(next),{code:'workflow_inactive'});
});
test('artifact ownership stays unique when a generation advances before checkpoint',async t=>{
 const f=await setup(t),artifact=await invokeAssetApi(f.toolkit,'Game','recovery.create',{});
 await f.create({artifactId:artifact.artifactId,authorizedOperations:['recovery.run','reconstruct.apply']});
 // Editor validation forks a generation even when Editor is missing, without executing it.
 const changed=await invokeAssetApi(f.toolkit,'Game','recovery.run',{artifactId:artifact.artifactId,revision:artifact.revision,operation:'reconstruct.validate',params:{}});assert.notEqual(changed.revision,artifact.revision);
 await assert.rejects(f.create({artifactId:artifact.artifactId}),{code:'workflow_active_exists'});
});
test('another Codex thread cannot use the published controller identity to mutate a run',async t=>{
 const f=await setup(t),c=await f.claim(await f.create()),env={CODEX_THREAD_ID:randomUUID()};
 for(const [command,extra]of [['heartbeat',{}],['release',{}],['checkpoint',{stepId:'code',outcome:'progress',note:'wrong thread'}]])await assert.rejects(runWorkflowOperation(f.toolkit,'Game',command,{...withClaim(c),...extra},{env}),{code:'workflow_thread_invalid'});
 assert.equal((await f.call('status',{runId:c.runId})).sequence,c.sequence);
});
test('Unity receipt verifies compile and exact bindings while gameplay remains unfinished',async t=>{
 const f=await setup(t),assetId='opaque:Assets/Main.unity';
 const run=await f.create({steps:[{id:'compile',label:'Compile',dimension:'compilation',dependsOn:[]},{id:'bindings',label:'Bindings',dimension:'bindings',assetIds:[assetId],dependsOn:['compile']},{id:'play',label:'Play',dimension:'gameplay',dependsOn:['bindings'],scenario:{entry:'Level',actions:['play'],expected:'interactive'}}]}),c=await f.claim(run);
 fs.mkdirSync(path.join(f.root,'templates/Unity'),{recursive:true});fs.copyFileSync(new URL('../templates/Unity/REToolkitValidation.cs',import.meta.url),path.join(f.root,'templates/Unity/REToolkitValidation.cs'));
 const editor=path.join(f.root,'fixture-editor');fs.writeFileSync(editor,'inert source-owned fixture');
 const j=await startJob(f.toolkit,'Game',{operation:'reconstruct.validate',params:{assetIds:[assetId]}},{spawn:()=>({pid:process.pid,once(){},unref(){}})});
 await executeJob(f.toolkit,'Game',j.jobId,{invoke:async()=>withWorkspaceLock(f.workspace,()=>handleOwnedAssetOperation(f.toolkit,'Game','reconstruct.validate',{assetIds:[assetId]},{validation:{editor,runEditor:async config=>{
  const req=JSON.parse(fs.readFileSync(config.requestFile));fs.writeFileSync(config.reportFile,JSON.stringify({kind:'retoolkit-unity-observation',schemaVersion:1,runId:req.runId,graphRevision:req.graphRevision,unityVersion:req.unityVersion,complete:true,compilation:{state:'succeeded'},scripts:req.scripts.map(s=>({...s,guid:'a'.repeat(32),fileID:'11500000',fullName:'Game.Player',assembly:'Assembly-CSharp',resolved:true})),assets:req.assets.map(a=>({...a,loaded:true,missingScripts:0,missingReferences:0})),diagnostics:[]}));return {closed:true,exitCode:0,timedOut:false,logTail:''};
 }}}))});
 const compiled=await f.call('checkpoint',{...withClaim(c),stepId:'compile',outcome:'job',jobId:j.jobId});assert.equal(compiled.steps[0].state,'verified');
 const bound=await f.call('checkpoint',{...withClaim(compiled),stepId:'bindings',outcome:'job',jobId:j.jobId});assert.equal(bound.steps[1].state,'verified');assert.equal(bound.complete,false);assert.equal(bound.nextStep.id,'play');
 const id=bound.steps[1].evidence.operationId;fs.appendFileSync(path.join(f.workspace,'04_Notes/assets/unity-validation',id,'observation.json'),' ');
 await assert.rejects(f.call('checkpoint',{...withClaim(bound),stepId:'bindings',outcome:'job',jobId:j.jobId}),/observation bytes changed/);
});
test('artifact source job advances the run to its exact new generation without completing gameplay',async t=>{
 const f=await setup(t),a=await invokeAssetApi(f.toolkit,'Game','recovery.create',{}),run=await f.create({artifactId:a.artifactId,authorizedOperations:['recovery.run','reconstruct.apply']}),c=await f.claim(run);
 const call=(operation,params={})=>invokeAssetApi(f.toolkit,'Game','recovery.run',{artifactId:a.artifactId,revision:a.revision,operation,params});
 const index=await call('assets.index',{storage:'sqlite'}),scripts=await call('assets.scripts'),plan=await call('reconstruct.plan',{request:{kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:index.result.revision,changes:[{scriptId:scripts.result.items[0].scriptId,source:replacement}]}});
 const j=await startJob(f.toolkit,'Game',{operation:'recovery.run',params:{artifactId:a.artifactId,revision:a.revision,operation:'reconstruct.apply',params:{operationId:plan.result.operationId}}},{spawn:()=>({pid:process.pid,once(){},unref(){}})});const done=await executeJob(f.toolkit,'Game',j.jobId);assert.equal(done.state,'succeeded');
 const updated=await f.call('checkpoint',{...withClaim(c),stepId:'code',outcome:'job',jobId:j.jobId});assert.notEqual(updated.candidate.revision,a.revision);assert.equal(updated.steps[0].state,'verified');assert.equal(updated.complete,false);assert.equal(updated.nextStep.id,'play');
 assert.equal(fs.readFileSync(path.join(f.workspace,'05_ReconstructedSource/Assets/Player.cs'),'utf8'),f.files['Assets/Player.cs']);
});

test('runtime provider operations can be explicitly added to an existing workflow without completing steps',async t=>{
 const f=await setup(t),c=await f.claim(await f.create());
 const r=await f.call('authorize',{...withClaim(c),operations:['libraries.runtime.plan','libraries.runtime.apply','libraries.runtime.verify'],reason:'User requested runtime DLL repair'});
 assert(r.authorizedOperations.includes('libraries.runtime.apply'));
 assert.equal(r.steps[0].state,'todo');assert.equal(r.complete,false);
 assert.equal(r.policyChanges.length,1);
 await assert.rejects(f.call('authorize',{...withClaim(r),operations:['shell.exec'],reason:'bad'}));
 await assert.rejects(f.call('reconcile',{...withClaim(r),jobIds:[randomUUID()]}));
});

test('reconcile consumes a complete ordered mutation chain, never replays jobs or verifies gameplay',async t=>{
 const f=await setup(t),a=await invokeAssetApi(f.toolkit,'Game','recovery.create',{});
 const c=await f.claim(await f.create({artifactId:a.artifactId,authorizedOperations:['recovery.run','reconstruct.validate']}));
 const jobs=[];let revision=a.revision;
 for(let i=0;i<2;i++){
  const job=await startJob(f.toolkit,'Game',{operation:'recovery.run',params:{artifactId:a.artifactId,revision,operation:'reconstruct.validate',params:{}}},{spawn:()=>({pid:process.pid,once(){},unref(){}})});
  const done=await executeJob(f.toolkit,'Game',job.jobId);assert.equal(done.state,'succeeded');
  const result=JSON.parse(fs.readFileSync(path.join(f.workspace,'04_Notes/jobs',job.jobId,'result.json')));
  revision=result.revision;jobs.push(job.jobId);
 }
 const stale=await f.call('next',{runId:c.runId});assert.equal(stale.state,'needs-inspection');
 for(const jobIds of [[jobs[0]],[jobs[1]],[...jobs].reverse(),[jobs[0],jobs[0]]])await assert.rejects(f.call('reconcile',{...withClaim(stale),jobIds}));
 const r=await f.call('reconcile',{...withClaim(stale),jobIds:jobs});
 assert.equal(r.candidate.revision,revision);assert.equal(r.complete,false);assert.equal(r.steps[1].state,'todo');assert.equal(r.steps[0].state,'todo');
 assert.equal(r.reconciliations[0].jobs.length,2);assert.equal(r.reason,null);
 await assert.rejects(f.call('reconcile',{...withClaim(r),jobIds:jobs}),{code:'workflow_candidate_stale'});
});

test('unfinished recovery remains actionable after a blocked note and release',async t=>{
 const f=await setup(t),c=await f.claim(await f.create({steps:[{id:'play',label:'Startup',dimension:'gameplay',dependsOn:[],scenario:{entry:'EntryScene',actions:['start'],expected:'Gameplay'}}]}));
 const r=await f.call('checkpoint',{...withClaim(c),stepId:'play',outcome:'blocked',note:'ChangeScene and CloseLoading are still stubs'});
 assert.equal(r.nextStep.id,'play');assert.equal(r.continuationRequired,true);
 const released=await f.call('release',withClaim(r));assert.equal(released.nextStep.id,'play');assert.equal(released.continuationRequired,true);
});

test('expand adds recovery dependencies without dropping the original gameplay goal',async t=>{
 const f=await setup(t),c=await f.claim(await f.create());
 const r=await f.call('expand',{...withClaim(c),stepId:'play',reason:'Recover startup before play',steps:[{id:'startup',label:'Restore scene transition',dimension:'source',sourcePaths:['Assets/Player.cs'],dependsOn:[]}]});
 assert(r.steps.find(s=>s.id==='play').dependsOn.includes('startup'));assert.equal(r.steps.length,3);assert.equal(r.complete,false);
 await assert.rejects(f.call('expand',{...withClaim(r),stepId:'play',reason:'cycle',steps:[{id:'cycle',label:'cycle',dimension:'compilation',dependsOn:['play']}]}));
});

test('an external blocker stops only its branch while independent work remains actionable',async t=>{
 const f=await setup(t),c=await f.claim(await f.create());
 const blocker={kind:'external-input',attempted:'Checked configured library roots',missing:'Licensed provider implementation',requiredFrom:'Project owner',resumeWhen:'Provider becomes available'};
 let r=await f.call('checkpoint',{...withClaim(c),stepId:'code',outcome:'blocked',note:'Missing provider',blocker});
 assert.equal(r.continuationRequired,false);assert.equal(r.nextStep,null);
 r=await f.call('expand',{...withClaim(r),stepId:'play',reason:'Independent startup recovery',steps:[{id:'startup',label:'Startup',dimension:'source',sourcePaths:['Assets/Startup.cs'],dependsOn:[]}]});
 assert.equal(r.nextStep.id,'startup');assert.equal(r.continuationRequired,true);assert.deepEqual(r.steps[0].blocker,blocker);
 await assert.rejects(f.call('checkpoint',{...withClaim(r),stepId:'startup',outcome:'blocked',note:'Incomplete blocker',blocker:{kind:'external-input'}}));
});

test('reconcile consumes an exact completed attachment only after the full authenticated chain',async t=>{
 const f=await setup(t),a=await invokeAssetApi(f.toolkit,'Game','recovery.create',{});
 let c=await f.claim(await f.create({artifactId:a.artifactId,authorizedOperations:['recovery.run','reconstruct.validate']}));
 const start=revision=>startJob(f.toolkit,'Game',{operation:'recovery.run',params:{artifactId:a.artifactId,revision,operation:'reconstruct.validate',params:{}}},{spawn:()=>({pid:process.pid,once(){},unref(){}})});
 const first=await start(a.revision);
 const w=await runWorkflowOperation(f.toolkit,'Game','wait',{...withClaim(c),stepId:'code',jobId:first.jobId},{startWatcher:async()=>{throw Error('dispatch unavailable');}});
 c=await f.claim(w);
 const runFile=path.join(f.workspace,'04_Notes/reconstruction-runs',c.runId+'.json');
 async function rejectsUnchanged(jobIds){const bytes=fs.readFileSync(runFile);await assert.rejects(f.call('reconcile',{...withClaim(c),jobIds}));assert.deepEqual(fs.readFileSync(runFile),bytes);}
 await rejectsUnchanged([first.jobId]); // still queued
 assert.equal((await executeJob(f.toolkit,'Game',first.jobId)).state,'succeeded');
 const resultPath=id=>path.join(f.workspace,'04_Notes/jobs',id,'result.json');
 const firstResult=JSON.parse(fs.readFileSync(resultPath(first.jobId)));
 const second=await start(firstResult.revision);
 await rejectsUnchanged([first.jobId,second.jobId]); // second producer unfinished
 assert.equal((await executeJob(f.toolkit,'Game',second.jobId)).state,'succeeded');
 const secondResult=JSON.parse(fs.readFileSync(resultPath(second.jobId)));
 for(const ids of [[first.jobId],[second.jobId],[second.jobId,first.jobId],[first.jobId,first.jobId]])await rejectsUnchanged(ids);
 const original=fs.readFileSync(resultPath(first.jobId));
 try{fs.appendFileSync(resultPath(first.jobId),' ');await rejectsUnchanged([first.jobId,second.jobId]);}finally{fs.writeFileSync(resultPath(first.jobId),original);}
 const {seal,unseal}=await import('../src/recovery/artifacts.js');
 async function rejectsEdited(file,edit,sealed=false){const bytes=fs.readFileSync(file);try{const raw=JSON.parse(bytes),value=sealed?unseal(raw):raw;edit(value);fs.writeFileSync(file,JSON.stringify(sealed?seal(value):value));await rejectsUnchanged([first.jobId,second.jobId]);}finally{fs.writeFileSync(file,bytes);}}
 const requestFile=path.join(f.workspace,'04_Notes/jobs',first.jobId,'request.json');
 await rejectsEdited(requestFile,v=>{v.params.artifactId=randomUUID();});
 await rejectsEdited(requestFile,v=>{v.params.operation='migration.apply';});
 await rejectsEdited(requestFile,v=>{v.params.revision=randomUUID();});
 const artifactBase=path.join(f.workspace,'04_Notes/recovery/artifacts',a.artifactId);
 await rejectsEdited(path.join(artifactBase,'generations',firstResult.revision,'revision.json'),v=>{v.parent=randomUUID();},true);
 await rejectsEdited(path.join(artifactBase,'artifact.json'),v=>{v.pending={operation:'reconstruct.validate'};},true);
 await rejectsEdited(runFile,v=>{v.waiting.stepId='missing-step';},true);
 const nativeFile=path.join(f.workspace,'01_Extracted/libil2cpp.so'),nativeBytes=fs.readFileSync(nativeFile);
 try{fs.appendFileSync(nativeFile,'changed');await rejectsUnchanged([first.jobId,second.jobId]);}finally{fs.writeFileSync(nativeFile,nativeBytes);}
 const r=await f.call('reconcile',{...withClaim(c),jobIds:[first.jobId,second.jobId]});
 assert.equal(r.waiting,null);assert.equal(r.candidate.revision,secondResult.revision);
 assert.deepEqual(r.reconciliations.at(-1).consumedAttachment,w.waiting);
 assert.deepEqual(r.continuation,c.continuation);assert.equal(r.steps[0].state,'unverified');
 assert.equal(r.steps[0].evidence,undefined);assert.equal(r.steps[1].state,'todo');assert.equal(r.complete,false);
 assert.equal(r.nextStep.id,'code');assert.equal(r.continuationRequired,true);
 await assert.rejects(f.call('reconcile',{...withClaim(r),jobIds:[first.jobId,second.jobId]}),{code:'workflow_candidate_stale'});
});

for(const uncertain of [false,true])test('attached reconciliation rejects '+(uncertain?'unknown':'failed')+' producer without changing run',async t=>{
 const f=await setup(t),a=await invokeAssetApi(f.toolkit,'Game','recovery.create',{});
 let c=await f.claim(await f.create({artifactId:a.artifactId,authorizedOperations:['recovery.run','reconstruct.validate']}));
 const j=await startJob(f.toolkit,'Game',{operation:'recovery.run',params:{artifactId:a.artifactId,revision:a.revision,operation:'reconstruct.validate',params:{}}},{spawn:()=>({pid:process.pid,once(){},unref(){}})});
 const w=await runWorkflowOperation(f.toolkit,'Game','wait',{...withClaim(c),stepId:'code',jobId:j.jobId},{startWatcher:async()=>{throw Error('unavailable');}});c=await f.claim(w);
 const done=await executeJob(f.toolkit,'Game',j.jobId,{invoke:async()=>{throw Object.assign(Error('test failure'),{code:uncertain?'cleanup_pending':'test_failure'});}});
 assert.equal(done.state,uncertain?'unknown':'failed');
 const file=path.join(f.workspace,'04_Notes/reconstruction-runs',c.runId+'.json'),bytes=fs.readFileSync(file);
 await assert.rejects(f.call('reconcile',{...withClaim(c),jobIds:[j.jobId]}),{code:'workflow_evidence_invalid'});assert.deepEqual(fs.readFileSync(file),bytes);
});

async function pendingTransfer(t,{finishProducer=true,finishWatcher=true,wakeOverrides={}}={}){
 const f=await setup(t),c=await f.claim(await f.create());
 const job=await startJob(f.toolkit,'Game',{operation:'assets.index',params:{}},{spawn:()=>({pid:process.pid,once(){},unref(){}})});
 let watcher;
 const waiting=await runWorkflowOperation(f.toolkit,'Game','wait',{...withClaim(c),stepId:'code',jobId:job.jobId},{startWatcher:async(toolkit,name,request)=>{watcher=await startJob(toolkit,name,request,{spawn:()=>({pid:process.pid,once(){},unref(){}})});return watcher;}});
 if(finishProducer)await executeJob(f.toolkit,'Game',job.jobId);
 if(finishWatcher)await executeJob(f.toolkit,'Game',watcher.jobId,{invoke:async()=>({kind:'retoolkit-agent-wake',workspace:f.workspace,jobId:job.jobId,threadId:c.controller.threadId,task:'continue-reconstruction',state:'unknown',delivery:'unknown',cleanupPending:false,dispatchDiagnostic:{kind:'process-exit',exitCode:1,signaled:false},...wakeOverrides})});
 return {...f,waiting,job,watcher,previousThreadId:c.controller.threadId};
}

test('pending continuation can transfer after closed uncertain delivery without replay or acceptance',async t=>{
 const f=await pendingTransfer(t),threadId=randomUUID(),p={runId:f.waiting.runId,sequence:f.waiting.sequence,previousThreadId:f.previousThreadId,harness:'codex',threadId,reason:'User requested continuation in this new conversation'};
 const call=(command,params)=>runWorkflowOperation(f.toolkit,'Game',command,params,{env:{CODEX_THREAD_ID:threadId}});
 await assert.rejects(call('claim',{runId:p.runId,sequence:p.sequence,harness:'codex',threadId}),{code:'workflow_thread_invalid'});
 const r=await call('transfer',p);
 assert.deepEqual(r.waiting,f.waiting.waiting);assert.deepEqual(r.candidate,f.waiting.candidate);assert.deepEqual(r.authorizedOperations,f.waiting.authorizedOperations);
 assert.equal(r.controller,null);assert.equal(r.agentResumed,false);assert.equal(r.complete,false);assert.equal(r.continuation.threadId,threadId);
 assert.equal(r.transfers[0].watcherDelivery,'unknown');assert.equal(r.transfers[0].watcherDiagnostic.exitCode,1);
 await assert.rejects(call('transfer',p),{code:'workflow_sequence_stale'});
 const claimed=await call('claim',{runId:r.runId,sequence:r.sequence,harness:'codex',threadId});
 const checked=await call('checkpoint',{...withClaim(claimed),stepId:'code',outcome:'job',jobId:f.job.jobId});
 assert.equal(checked.waiting,null);assert.equal(checked.complete,false);
});

test('transfer rejects running producers/watchers, uncertain cleanup and missing dispatch closure',async t=>{
 for(const options of [{finishProducer:false},{finishWatcher:false},{wakeOverrides:{cleanupPending:true}},{wakeOverrides:{dispatchDiagnostic:{kind:'timeout'}}},{wakeOverrides:{state:'dispatching'}}]){
  const f=await pendingTransfer(t,options),threadId=randomUUID();
  await assert.rejects(runWorkflowOperation(f.toolkit,'Game','transfer',{runId:f.waiting.runId,sequence:f.waiting.sequence,previousThreadId:f.previousThreadId,harness:'codex',threadId,reason:'User requested transfer'},{env:{CODEX_THREAD_ID:threadId}}),{code:'workflow_transfer_pending'});
  assert.equal((await f.call('status',{runId:f.waiting.runId})).sequence,f.waiting.sequence);
 }
});

test('transfer rejects wrong source/destination threads and revokes both old and new wake dispatch',async t=>{
 const f=await pendingTransfer(t),threadId=randomUUID(),params={runId:f.waiting.runId,sequence:f.waiting.sequence,previousThreadId:f.previousThreadId,harness:'codex',threadId,reason:'User requested transfer'};
 for(const [p,env] of [[{...params,previousThreadId:randomUUID()},{CODEX_THREAD_ID:threadId}],[params,{CODEX_THREAD_ID:randomUUID()}]])await assert.rejects(runWorkflowOperation(f.toolkit,'Game','transfer',p,{env}),{code:'workflow_thread_invalid'});
 const r=await runWorkflowOperation(f.toolkit,'Game','transfer',params,{env:{CODEX_THREAD_ID:threadId}});
 const {workflowWakeBinding}=await import('../src/workflow/service.js');
 for(const id of [threadId,f.previousThreadId])assert.equal(workflowWakeBinding(f.toolkit,'Game',{runId:r.runId,jobId:f.job.jobId,threadId:id}),false);
 await assert.rejects(runWorkflowOperation(f.toolkit,'Game','claim',{runId:r.runId,sequence:r.sequence,harness:'codex',threadId:f.previousThreadId},{env:{CODEX_THREAD_ID:f.previousThreadId}}),{code:'workflow_thread_invalid'});
 const claim=await runWorkflowOperation(f.toolkit,'Game','claim',{runId:r.runId,sequence:r.sequence,harness:'codex',threadId},{env:{CODEX_THREAD_ID:threadId}});
 await assert.rejects(runWorkflowOperation(f.toolkit,'Game','transfer',{...params,sequence:claim.sequence,previousThreadId:threadId,threadId:randomUUID()},{env:{}}),{code:'workflow_controller_exists'});
});

test('transfer cannot bypass destination identity with another harness',async t=>{
 const f=await pendingTransfer(t);
 for(const harness of ['claude','gemini','opencode'])await assert.rejects(runWorkflowOperation(f.toolkit,'Game','transfer',{runId:f.waiting.runId,sequence:f.waiting.sequence,previousThreadId:f.previousThreadId,harness,threadId:randomUUID(),reason:'Transfer'},{env:{}}));
 const paused=await f.call('pause',{runId:f.waiting.runId,sequence:f.waiting.sequence}),threadId=randomUUID();
 await assert.rejects(runWorkflowOperation(f.toolkit,'Game','transfer',{runId:paused.runId,sequence:paused.sequence,previousThreadId:f.previousThreadId,harness:'codex',threadId,reason:'Transfer'},{env:{CODEX_THREAD_ID:threadId}}),{code:'workflow_inactive'});
});
