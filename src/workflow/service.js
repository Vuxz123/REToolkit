import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {withWorkspaceLock,fingerprint} from '../state.js';
import {workflowPaths,readRun,saveRun,listRuns,publicRun,check,inactive,actionableStep} from './store.js';
import {readCandidate,sameCandidate} from './candidate.js';
import {jobResult,jobRequest,effectiveOperation,acceptance} from './evidence.js';
import {getJob,startJob} from '../jobs/service.js';
import {validateSchema} from '../jobs/definitions.js';
import {workflowDefinitions} from './definitions.js';
import {uuid} from '../recovery/artifacts.js';
import {verifyTransitionChain} from './transitions.js';

const now=()=>new Date().toISOString();
const terminal=new Set(['succeeded','failed','unknown']);
const mutable=new Set(['reconstruct.apply','reconstruct.validate','libraries.import','migration.apply','migration.observe','data.capture','data.verify']);
mutable.add('libraries.runtime.apply');
function validateSteps(steps){
 const map=new Map(steps.map(s=>[s.id,s]));check(map.size===steps.length,'Duplicate step IDs');
 for(const s of steps){check(new Set(s.dependsOn).size===s.dependsOn.length&&s.dependsOn.every(id=>map.has(id)),'Invalid dependency');if(s.dimension==='source')check(s.sourcePaths?.length&&new Set(s.sourcePaths).size===s.sourcePaths.length&&s.sourcePaths.every(p=>/^Assets\/.+\.cs$/.test(p)&&!p.includes('\\')&&p.split('/').every(v=>v&&v!=='.'&&v!=='..')),'Source acceptance requires exact Assets/*.cs paths (at most 16 per batch)');if(s.dimension==='gameplay')check(s.scenario,'Gameplay requires entry/actions/expected');if(s.dimension==='bindings')check(s.assetIds?.length&&new Set(s.assetIds).size===s.assetIds.length,'Binding acceptance requires exact asset scope');}
 for(const s of steps)if(s.dimension==='data')check(uuid(s.baselineId)&&s.assetIds?.length&&s.assetIds.length<=64&&new Set(s.assetIds).size===s.assetIds.length&&s.assetIds.every(id=>/^asset:[a-f0-9]{32}$/.test(id)),'Data acceptance requires a baseline UUID and exact .asset scope');
 const done=new Set(),visiting=new Set();function visit(id){check(!visiting.has(id),'Dependency cycle');if(done.has(id))return;visiting.add(id);for(const dep of map.get(id).dependsOn)visit(dep);visiting.delete(id);done.add(id);}for(const id of map.keys())visit(id);
}
function requireSequence(r,p){check(r.sequence===p.sequence,'Workflow changed; read current status','workflow_sequence_stale');}
function requireClaim(r,p,env){requireSequence(r,p);check(r.controller?.claimId===p.claimId,'Exact active claim is required','workflow_claim_invalid');if(r.controller.harness==='codex'&&env.CODEX_THREAD_ID)check(env.CODEX_THREAD_ID===r.controller.threadId,'Caller Codex thread differs','workflow_thread_invalid');check(!inactive(r),'Workflow is inactive','workflow_inactive');}
function updateCandidate(r,current){
 if(sameCandidate(r.candidate,current.identity))return;
 for(const step of r.steps)if(step.state==='verified'){
  const scope=step.evidence?.files;
  if(step.dimension==='source'&&scope?.length&&scope.every(old=>current.files.some(f=>f.path===old.path&&f.sha256===old.sha256&&f.size===old.size)))continue;
  step.state='unverified';step.staleEvidence=step.evidence;delete step.evidence;
 }
 r.candidate=current.identity;
}
function decide(r){
 if(inactive(r)||r.state==='needs-inspection'||r.waiting)return null;
 const next=actionableStep(r);
 if(next){r.state=r.controller?'active':'waiting-agent';return next;}
 if(r.steps.every(s=>s.state==='verified'))r.state='completed';else r.state='blocked';return null;
}
async function reconcile(toolkit,name,r){
 if(inactive(r)||!r.waiting)return;
 const job=await getJob(toolkit,name,{jobId:r.waiting.jobId});
 if(job.state==='unknown'){r.state='needs-inspection';r.reason='workflow_job_unknown';r.inspection={jobId:job.jobId,stepId:r.waiting.stepId,operation:job.operation,operationId:job.operationId??null};return;}
 if(terminal.has(job.state)){r.state='waiting-agent';r.waiting.terminalState=job.state;}else r.state='waiting-job';
 if(r.continuation?.watcherJobId){const watcher=await getJob(toolkit,name,{jobId:r.continuation.watcherJobId});r.continuation={...r.continuation,state:watcher.result?.state??watcher.wakeProgress?.state??watcher.state,transportReady:watcher.state==='running'&&watcher.wakeProgress?.transportReady===true,agentResumed:Boolean(r.controller)&&Date.now()-Date.parse(r.controller.heartbeatAt)<=120000};}
}
function resolveRun(paths,runId){if(runId)return readRun(paths,runId);const runs=listRuns(paths).filter(r=>!['completed','canceled'].includes(r.state));check(runs.length===1,'Specify runId when no unique unfinished run exists','workflow_run_ambiguous');return runs[0];}

export async function runWorkflowOperation(toolkit,name,command,params={},dependencies={}){
 const schema=workflowDefinitions['workflow.'+command];check(schema,'Unknown workflow command');validateSchema(params,{type:'object',additionalProperties:false,...schema});
 const paths=workflowPaths(toolkit,name);
 // Observation takes no workspace lease and remains available while an engine
 // owns the project. Freshness is deliberately historical here.
 if(command==='status'){const r=resolveRun(paths,params.runId);try{await reconcile(toolkit,name,r);}catch{r.state='needs-inspection';r.reason='workflow_observation_failed';}return publicRun(r);}
 return withWorkspaceLock(paths.base,async()=>{
  if(command==='create'){
   validateSteps(params.steps);check(new Set(params.authorizedOperations).size===params.authorizedOperations.length,'Duplicate operation policy');
   const current=await readCandidate(toolkit,name,params.artifactId);
   check(!listRuns(paths).some(r=>!['completed','canceled'].includes(r.state)&&(current.identity.artifactId?r.candidate.artifactId===current.identity.artifactId:!r.candidate.artifactId&&r.candidate.project===current.identity.project)),'An unfinished workflow already owns this candidate','workflow_active_exists');
   const r={kind:'retoolkit-reconstruction-run',schemaVersion:1,runId:randomUUID(),workspace:paths.workspace,sequence:0,createdAt:now(),updatedAt:now(),goal:params.goal,authorizedOperations:params.authorizedOperations,candidate:current.identity,state:'active',controller:null,waiting:null,continuation:null,steps:params.steps.map(s=>({...s,state:'todo'}))};saveRun(paths,r);return publicRun(r,{freshness:'current',nextStep:r.steps.find(s=>!s.dependsOn.length)});
  }
  const r=readRun(paths,params.runId);
  if(command==='next'){
   await reconcile(toolkit,name,r);
   if(!['paused','canceled'].includes(r.state)&&!r.waiting&&r.state!=='needs-inspection'){
    const stale=(reason='workflow_candidate_stale')=>{if(r.state==='completed'){r.completionFreshness='stale';r.controller=null;}else r.state='needs-inspection';r.reason=reason;};
    try{const current=await readCandidate(toolkit,name,r.candidate.artifactId);if(!sameCandidate(r.candidate,current.identity))stale();else{
     for(const step of r.steps.filter(s=>s.dimension==='data'&&s.state==='verified'))try{
      const {verifyDataAcceptance}=await import('../data/service.js');const proof=await verifyDataAcceptance({toolkit:current.toolkit,name,projectDir:current.project,operationId:step.evidence.operationId,baselineId:step.baselineId,assetIds:step.assetIds});check(proof.verified,'Data acceptance is no longer verified');
     }catch{stale('workflow_data_evidence_stale');break;}
    }}
    catch{stale();}
   }
   const nextStep=decide(r);saveRun(paths,r);return publicRun(r,{freshness:r.waiting?'awaiting-job-verification':r.state==='needs-inspection'?'stale':'current',nextStep});
  }
  requireSequence(r,params);
  if(['pause','cancel'].includes(command)){
   check(!['completed','canceled'].includes(r.state),'Workflow is terminal','workflow_inactive');r.state=command==='pause'?'paused':'canceled';r.controller=null;saveRun(paths,r);return publicRun(r);
  }
  if(command==='resume'){
   check(r.state==='paused','Only an explicitly paused workflow may resume','workflow_inactive');r.state='waiting-agent';saveRun(paths,r);return publicRun(r);
  }
  check(!inactive(r),'Workflow is inactive','workflow_inactive');
  if(command==='transfer'){
   check(!r.controller,'Release the active controller before transfer','workflow_controller_exists');
   check(r.waiting&&r.continuation?.threadId===params.previousThreadId&&r.continuation?.jobId===r.waiting.jobId,'Pending continuation binding differs','workflow_thread_invalid');
   check(params.threadId!==params.previousThreadId,'Destination thread must differ','workflow_thread_invalid');
   if(params.harness==='codex')check((dependencies.env??process.env).CODEX_THREAD_ID===params.threadId,'Transfer must be requested by the actual destination Codex thread','workflow_thread_invalid');
   const producer=await getJob(toolkit,name,{jobId:r.waiting.jobId});
   check(producer.state==='succeeded'&&producer.outcomeVerified,'Attached producer must have verified success','workflow_transfer_pending');
   effectiveOperation(r,producer,jobRequest(paths.workspace,producer));jobResult(paths.workspace,producer);
   check(r.continuation.watcherJobId,'Missing watcher identity requires inspection','workflow_transfer_pending');
   const watcher=await getJob(toolkit,name,{jobId:r.continuation.watcherJobId});
   check(terminal.has(watcher.state)&&watcher.completedAt,'Watcher has not closed','workflow_transfer_pending');
   const request=jobRequest(paths.workspace,watcher),p=request.params;
   // A second transfer still verifies the original watcher, not a fictional
   // delivery to the intermediate destination.
   const originalThread=r.continuation.dispatchThreadId??r.continuation.threadId;
   check(watcher.operation==='agent.wake_after'&&p.task==='continue-reconstruction'&&p.runId===r.runId&&p.jobId===r.waiting.jobId&&p.threadId===originalThread,'Watcher binding differs','workflow_evidence_invalid');
   const wake=jobResult(paths.workspace,watcher);
   check(wake.kind==='retoolkit-agent-wake'&&wake.workspace===paths.workspace&&wake.jobId===r.waiting.jobId&&wake.threadId===originalThread,'Watcher result binding differs','workflow_evidence_invalid');
   const closed=!wake.cleanupPending&&(wake.state==='queued'&&wake.delivery==='accepted'||['failed','canceled','timed-out'].includes(wake.state)&&wake.delivery==='not-dispatched'||wake.state==='unknown'&&wake.dispatchDiagnostic?.kind==='process-exit'&&Number.isInteger(wake.dispatchDiagnostic.exitCode));
   check(closed,'Queue dispatch closure is unresolved; inspect it before transfer','workflow_transfer_pending');
   r.transfers??=[];r.transfers.push({fromThreadId:params.previousThreadId,toThreadId:params.threadId,toHarness:params.harness,reason:params.reason,jobId:producer.jobId,watcherJobId:watcher.jobId,watcherState:wake.state,watcherDelivery:wake.delivery,watcherDiagnostic:wake.dispatchDiagnostic??null,watcherResultSha256:watcher.resultReference.sha256,at:now()});
   r.continuation={...r.continuation,dispatchThreadId:originalThread,harness:params.harness,threadId:params.threadId,transferredAt:now(),agentResumed:false};delete r.continuation.acknowledgedAt;
   r.state='waiting-agent';saveRun(paths,r);return publicRun(r);
  }
  if(command==='claim'){
   check(!r.controller,'Another controller owns this run; expiry requires inspection','workflow_controller_exists');
   if(r.waiting&&r.continuation?.threadId)check(params.harness===(r.continuation.harness??'codex')&&params.threadId===r.continuation.threadId,'Pending continuation belongs to another thread','workflow_thread_invalid');
   if((dependencies.env??process.env).CODEX_THREAD_ID&&params.harness==='codex')check((dependencies.env??process.env).CODEX_THREAD_ID===params.threadId,'Caller Codex thread differs','workflow_thread_invalid');
   if(!r.waiting&&r.state!=='needs-inspection'){const current=await readCandidate(toolkit,name,r.candidate.artifactId);check(sameCandidate(r.candidate,current.identity),'Candidate changed before claim','workflow_candidate_stale');}
   r.controller={claimId:randomUUID(),harness:params.harness,threadId:params.threadId,claimedAt:now(),heartbeatAt:now()};
   if(r.state!=='needs-inspection')r.state=r.waiting?'waiting-job':'active';
   if(r.continuation)r.continuation={...r.continuation,acknowledgedAt:now(),agentResumed:true};saveRun(paths,r);return publicRun(r);
  }
  requireClaim(r,params,dependencies.env??process.env);
  if(command==='authorize'){
   const added=params.operations.filter(op=>!r.authorizedOperations.includes(op));
   check(new Set(params.operations).size===params.operations.length,'Duplicate operation policy');
   check(new Set([...r.authorizedOperations,...added]).size<=64,'Operation policy exceeds limit');
   r.authorizedOperations.push(...added);r.policyChanges??=[];
   r.policyChanges.push({operations:added,reason:params.reason,claimId:params.claimId,at:now()});
   saveRun(paths,r);return publicRun(r);
  }
  if(command==='reconcile'){
   const attachment=r.waiting;
   if(attachment)check(params.jobIds[0]===attachment.jobId&&r.steps.some(s=>s.id===attachment.stepId),'Reconciliation must start with the exact attached job','workflow_wait_exists');
   const current=await readCandidate(toolkit,name,r.candidate.artifactId),entries=[];
   for(const jobId of params.jobIds){const job=await getJob(toolkit,name,{jobId});
    check(job.state==='succeeded'&&job.outcomeVerified,'Reconciliation requires a closed successful job','workflow_evidence_invalid');
    const request=jobRequest(paths.workspace,job),operation=effectiveOperation(r,job,request);
    entries.push({jobId,request,result:jobResult(paths.workspace,job),operation,resultSha256:job.resultReference.sha256});
   }
   verifyTransitionChain(toolkit,name,r,current,entries,mutable);
   r.reconciliations??=[];r.reconciliations.push({from:r.candidate,to:current.identity,jobs:entries.map(e=>({jobId:e.jobId,operation:e.operation,resultSha256:e.resultSha256})),...(attachment?{consumedAttachment:attachment}:{}),at:now()});
   updateCandidate(r,current);
   // Only the fully authenticated chain consumes an attachment. Provenance
   // reconciliation never grants source, compile, data or gameplay acceptance.
   if(attachment){const attachedStep=r.steps.find(s=>s.id===attachment.stepId);attachedStep.state='unverified';delete attachedStep.evidence;r.waiting=null;}
   r.reason=null;delete r.inspection;r.state='active';
   const nextStep=decide(r);saveRun(paths,r);return publicRun(r,{freshness:'current',nextStep});
  }
  if(command==='heartbeat'){r.controller.heartbeatAt=now();saveRun(paths,r);return publicRun(r);}
  if(command==='release'){r.controller=null;if(r.state!=='needs-inspection')r.state=r.waiting?'waiting-job':'waiting-agent';const nextStep=decide(r);saveRun(paths,r);return publicRun(r,{nextStep});}
  const step=r.steps.find(s=>s.id===params.stepId);check(step,'Unknown step');
  if(command==='expand'){
   check(!r.waiting&&r.state!=='needs-inspection','Resolve pending or uncertain operations before expanding','workflow_inspection_required');
   check(step.state!=='verified','Cannot expand a verified step');
   const current=await readCandidate(toolkit,name,r.candidate.artifactId);check(sameCandidate(r.candidate,current.identity),'Candidate changed before expansion','workflow_candidate_stale');
   check(r.steps.length+params.steps.length<=256,'Workflow step limit reached');
   const additions=params.steps.map(s=>({...s,state:'todo'})),ids=additions.map(s=>s.id);
   const proposed=r.steps.map(s=>s.id===step.id?{...s,dependsOn:[...new Set([...s.dependsOn,...ids])]}:s).concat(additions);
   validateSteps(proposed);r.steps=proposed;
   const target=r.steps.find(s=>s.id===step.id);target.state='unverified';delete target.blocker;
   r.expansions??=[];r.expansions.push({stepId:step.id,steps:ids,reason:params.reason,at:now()});
   const nextStep=decide(r);saveRun(paths,r);return publicRun(r,{nextStep});
  }
  if(command==='wait'){
   check(!r.waiting,'A job is already attached; inspect it first','workflow_wait_exists');
   check(step.dependsOn.every(id=>r.steps.find(s=>s.id===id).state==='verified'),'Step dependencies are unfinished','workflow_dependency_pending');
   const job=await getJob(toolkit,name,{jobId:params.jobId}),request=jobRequest(paths.workspace,job);effectiveOperation(r,job,request);
   r.waiting={jobId:job.jobId,stepId:step.id,attachedAt:now()};r.state='waiting-job';step.state='running';
   const controller=r.controller;
   if(controller.harness!=='codex'){r.continuation={state:'unsupported',harness:controller.harness,reason:'Use an active jobs.wait; this harness has no resume adapter'};saveRun(paths,r);return publicRun(r);}
   r.continuation={state:'registering',jobId:job.jobId,threadId:controller.threadId,agentResumed:false};r.controller=null;
   // Save before worker registration. A crash here is observable and never
   // silently retried; the original job continues independently.
   saveRun(paths,r);
   try{const watcher=await (dependencies.startWatcher??startJob)(toolkit,name,{operation:'agent.wake_after',params:{jobId:job.jobId,threadId:controller.threadId,task:'continue-reconstruction',runId:r.runId}});r.continuation={...r.continuation,state:'registered',watcherJobId:watcher.jobId};}
   catch{r.continuation={...r.continuation,state:'unknown',reason:'workflow_wake_registration_unverified'};}
   saveRun(paths,r);return publicRun(r);
  }
  check(command==='checkpoint','Unknown workflow action');
  if(params.outcome!=='job'){
   check(!params.blocker||params.outcome==='blocked','Blocker details require a blocked outcome');
   check(r.state!=='needs-inspection','Inspect unknown/stale operation before changing progress','workflow_inspection_required');
   step.state=params.outcome==='blocked'?'blocked':'running';step.note=params.note;step.updatedAt=now();r.controller.heartbeatAt=now();
   if(params.blocker)step.blocker=params.blocker;else delete step.blocker;
   if(params.outcome==='progress')delete step.jobId;
   // A note does not clear an attached producer or attest acceptance.
   const nextStep=decide(r);saveRun(paths,r);return publicRun(r,{nextStep});
  }
  check(step.dependsOn.every(id=>r.steps.find(s=>s.id===id).state==='verified'),'Step dependencies are unfinished','workflow_dependency_pending');
  if(r.waiting)check(r.waiting.jobId===params.jobId&&r.waiting.stepId===step.id,'Checkpoint differs from attached job','workflow_scope_invalid');
  const job=await getJob(toolkit,name,{jobId:params.jobId}),request=jobRequest(paths.workspace,job),op=effectiveOperation(r,job,request);
  if(job.state==='unknown'){r.state='needs-inspection';r.reason='workflow_job_unknown';r.inspection={jobId:job.jobId,stepId:step.id,operation:op,operationId:job.operationId??request.params.operationId??null};saveRun(paths,r);return publicRun(r);}
  check(terminal.has(job.state),'Job is still running; attach it with workflow.wait','workflow_job_running');
  if(job.state==='failed'||!job.outcomeVerified){step.state='blocked';step.note='Inspect the exact failed job before a changed-input repair';step.jobId=job.jobId;r.waiting=null;const nextStep=decide(r);saveRun(paths,r);return publicRun(r,{nextStep});}
  const current=await readCandidate(toolkit,name,r.candidate.artifactId),result=jobResult(paths.workspace,job);
  check(current.identity.bindingSha256===r.candidate.bindingSha256,'Input build changed','workflow_candidate_stale');
  if(!sameCandidate(r.candidate,current.identity)){
   check(mutable.has(op),'Candidate changed outside the submitted operation','workflow_candidate_stale');
   if(r.candidate.artifactId)check(request.params.revision===r.candidate.revision&&result.revision===current.identity.revision,'Artifact transition differs','workflow_candidate_stale');
  }
  const proof=await acceptance(step,op,result,current);updateCandidate(r,current);
  step.state=proof.verified?'verified':'unverified';step.evidence={...proof,jobId:job.jobId,resultSha256:job.resultReference.sha256,candidate:current.identity,observedAt:now()};step.updatedAt=now();
  r.waiting=null;r.reason=null;r.state='active';r.controller.heartbeatAt=now();const nextStep=decide(r);saveRun(paths,r);return publicRun(r,{freshness:'current',nextStep});
 });
}

// Called by the wake worker immediately before dispatch. No project/engine
// lease: only exact durable registration and cancellation are inspected.
export function workflowWakeBinding(toolkit,name,{runId,jobId,threadId}){
 const r=readRun(workflowPaths(toolkit,name),runId);
 return !inactive(r)&&!r.controller&&!r.continuation?.transferredAt&&r.waiting?.jobId===jobId&&r.continuation?.jobId===jobId&&r.continuation?.threadId===threadId&&r.state!=='needs-inspection';
}
export async function withWorkflowDispatch(toolkit,name,policy,dispatch){
 const paths=workflowPaths(toolkit,name);
 return withWorkspaceLock(paths.base,()=>dispatch(workflowWakeBinding(toolkit,name,policy)),{timeoutMs:5000});
}
