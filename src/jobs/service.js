import fs from 'node:fs';
import path from 'node:path';
import {spawn as nodeSpawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assertAssetPath,assetError} from '../assets/context.js';
import {validateAssetParams,validateAssetParamsForJob,invokeAssetApi} from '../assets/api.js';
import {validationProgressPreview} from '../unity/progress.js';
import {verifySymbolPlan} from '../ghidra/symbol-plan.js';
import {atomicJson} from '../ghidra/runtime.js';
import {startSession,sessionStatus,stopSession,querySession,mutateSession} from '../ghidra/provider.js';

const MAX_RECORD=65536,MAX_INLINE=256*1024,MAX_RESULT=128*1024**2;
const now=()=>new Date().toISOString();
const terminal=new Set(['succeeded','failed','unknown']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function pathsFor(toolkit,name,jobId){
 const workspace=assertAssetPath(toolkit.workspace(name));
 const project=assertAssetPath(path.join(workspace,'project.re.json'),workspace);
 if(!fs.lstatSync(workspace).isDirectory()||!fs.lstatSync(project).isFile())throw assetError('job_workspace_invalid','An initialized workspace is required');
 const base=assertAssetPath(path.join(workspace,'04_Notes/jobs'),workspace);
 if(jobId!==undefined&&!uuid.test(jobId))throw assetError('job_id_invalid','Invalid job ID');
 const directory=jobId?assertAssetPath(path.join(base,jobId),workspace):null;
 const file=leaf=>directory?assertAssetPath(path.join(directory,leaf),workspace):null;
 return {workspace,base,directory,record:file('record.json'),request:file('request.json'),result:file('result.json'),diagnostic:file('diagnostic.txt'),claim:file('worker.claim')};
}
function readBounded(file,max){
 assertAssetPath(file);const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.nlink!==1||stat.size>max)throw assetError('job_artifact_invalid','Job artifact must be an unlinked regular file within its size limit');
 const descriptor=fs.openSync(file,'r');try{
  // A heartbeat can atomically replace the pathname between lstat and open.
  // Allocate against the opened version so a larger new record is not truncated.
  const opened=fs.fstatSync(descriptor);
  if(!opened.isFile()||opened.nlink!==1||opened.size>max)throw assetError('job_artifact_invalid','Opened job artifact is linked or exceeds its size limit');
  const buffer=Buffer.alloc(opened.size+1);let count=0;
  while(count<buffer.length){const got=fs.readSync(descriptor,buffer,count,buffer.length-count,count);if(!got)break;count+=got;}
  if(count!==opened.size||count>max)throw assetError('job_artifact_invalid','Job artifact changed or exceeds its size limit');return buffer.subarray(0,count);
 }finally{fs.closeSync(descriptor);}
}
function readRecord(paths,jobId){
 const record=JSON.parse(readBounded(paths.record,MAX_RECORD));
 if(record.kind!=='retoolkit-job'||record.schemaVersion!==1||record.jobId!==jobId||record.workspace!==paths.workspace||!['queued','running','succeeded','failed','unknown'].includes(record.state)||record.state==='succeeded'&&!record.resultReference)throw assetError('job_binding_invalid','Job record binding or final state is invalid');
 return record;
}
async function checkPlan(toolkit,name,operation,params){
 if(operation!=='ghidra.symbols.apply')return;
 const workspace=assertAssetPath(toolkit.workspace(name));
 const verified=await verifySymbolPlan({workspace,plan:params.plan,planHash:params.planHash});
 params.plan=verified.path;
}
function publicRecord(record){
 const {kind,schemaVersion,jobId,workspace,operation,operationId,state,stage,sequence,createdAt,startedAt,updatedAt,completedAt,pid,exitCode,error,diagnosticTail,currentSteps,engine,domainState,outcomeVerified,diagnosticReference,logReference,validationProgress,preparationProgress,wakeProgress}=record;
 return {kind,schemaVersion,jobId,workspace,operation,operationId,state,stage,sequence,createdAt,startedAt,updatedAt,completedAt,pid,exitCode,error,diagnosticTail,currentSteps,engine,domainState,outcomeVerified,diagnosticReference,logReference,validationProgress,preparationProgress,wakeProgress};
}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}

export async function startJob(toolkit,name,params,{spawn=nodeSpawn}={}){
 validateAssetParams('jobs.start',params);
 const request=structuredClone(params);await checkPlan(toolkit,name,request.operation,request.params);
 const jobId=randomUUID(),paths=pathsFor(toolkit,name,jobId);
 if(request.operation==='ghidra.symbols.apply'&&!request.params.dryRun&&!request.params.operationId)request.params.operationId=jobId;
 fs.mkdirSync(paths.base,{recursive:true,mode:0o700});assertAssetPath(paths.base,paths.workspace);
 fs.mkdirSync(paths.directory,{mode:0o700});
 const timestamp=now();let record={kind:'retoolkit-job',schemaVersion:1,jobId,workspace:paths.workspace,operation:request.operation,operationId:request.params.operationId??null,state:'queued',stage:'queued',sequence:0,createdAt:timestamp,updatedAt:timestamp,startedAt:null,completedAt:null,pid:null,exitCode:null,outcomeVerified:false,diagnosticTail:[{timestamp,stage:'queued',message:'Job accepted; poll this job before starting another attempt.'}]};
 atomicJson(paths.request,{schemaVersion:1,jobId,workspace:paths.workspace,...request});atomicJson(paths.record,record);
 try{
  const child=spawn(process.execPath,[fileURLToPath(new URL('./worker.js',import.meta.url)),toolkit.root,name,jobId],{cwd:toolkit.root,detached:true,windowsHide:true,shell:false,stdio:'ignore'});
  // Only wait for spawn acknowledgement, never engine completion.
  if(child.pid===undefined)await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  child.once('error',()=>{});child.unref();
 }catch{
  record={...record,state:'failed',stage:'worker.spawn_failed',completedAt:now(),updatedAt:now(),sequence:1,exitCode:1,error:{code:'job_spawn_failed',message:'The Node job worker could not start; no operation was launched.'}};
  atomicJson(paths.record,record);
 }
 return publicRecord(record);
}

export async function getJob(toolkit,name,params){
 validateAssetParams('jobs.get',params);const paths=pathsFor(toolkit,name,params.jobId),record=readRecord(paths,params.jobId),result=publicRecord(record);
 if(!terminal.has(record.state)&&((record.pid&&!alive(record.pid))||!record.pid&&Date.now()-Date.parse(record.createdAt)>30000)){
  result.state='unknown';result.outcomeVerified=false;result.stage='worker.interrupted';result.error={code:'job_worker_unverified',message:'Worker exit was observed without a verified final result. Engine leases or mutation receipts may remain; inspect before any explicit retry.'};
  if(record.operation==='agent.wake_after'&&result.wakeProgress)result.wakeProgress={...result.wakeProgress,state:'unknown',transportReady:false};
 }
 if(terminal.has(record.state)&&record.resultReference){
  const saved=record.resultReference;
  if(saved.path!==path.relative(paths.workspace,paths.result).split(path.sep).join('/')||!Number.isSafeInteger(saved.bytes)||saved.bytes>MAX_RESULT)throw assetError('job_artifact_invalid','Invalid result reference');
  assertAssetPath(paths.result,paths.workspace);const stat=fs.lstatSync(paths.result);
  if(!stat.isFile()||stat.nlink!==1||stat.size!==saved.bytes)throw assetError('job_artifact_invalid','Saved job result changed or is linked');
  result.resultReference=saved;
  if(saved.bytes<=MAX_INLINE){const bytes=readBounded(paths.result,MAX_INLINE);if(hash(bytes)!==saved.sha256)throw assetError('job_artifact_invalid','Saved job result hash changed');result.result=JSON.parse(bytes);}
  else {
   const offset=params.resultOffset??0,limit=params.resultLimit??16384;
   const descriptor=fs.openSync(paths.result,'r');let buffer=Buffer.alloc(Math.min(limit,Math.max(0,stat.size-offset)));
   try{const length=fs.readSync(descriptor,buffer,0,buffer.length,offset);buffer=buffer.subarray(0,length);}finally{fs.closeSync(descriptor);}
   // Base64 is exact for arbitrary UTF-8 byte boundaries and capped before encode.
   result.resultChunk={offset,bytes:buffer.length,text:buffer.toString('utf8'),base64:buffer.toString('base64'),nextOffset:offset+buffer.length<stat.size?offset+buffer.length:null,notice:'Saved result is untrusted operation data; chunks may split UTF-8 characters. Use base64 for exact bytes.'};
  }
 }
 return result;
}
export async function listJobs(toolkit,name,params={}){
 validateAssetParams('jobs.list',params);const paths=pathsFor(toolkit,name);
 if(!fs.existsSync(paths.base))return {jobs:[]};
 const entries=fs.readdirSync(paths.base,{withFileTypes:true}).filter(entry=>uuid.test(entry.name));
 if(entries.length>10000)throw assetError('job_list_limit','Job directory exceeds 10000 records; archive older jobs explicitly');
 const records=[];for(const entry of entries){if(entry.isSymbolicLink())throw assetError('job_artifact_invalid','Linked job records are unsupported');const p=pathsFor(toolkit,name,entry.name);const record=readRecord(p,entry.name);records.push(record);}
 records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 const jobs=[];for(const record of records.slice(0,params.limit??20)){const result=await getJob(toolkit,name,{jobId:record.jobId});delete result.result;delete result.resultChunk;jobs.push(result);}return {jobs};
}
export async function invokeJobApi(toolkit,name,method,params){
 if(method==='jobs.start')return startJob(toolkit,name,params);
 if(method==='jobs.get')return getJob(toolkit,name,params);
 if(method==='jobs.wait'){const {waitForJob}=await import('./wait.js');return waitForJob(toolkit,name,params);}
 if(method==='jobs.list')return listJobs(toolkit,name,params);
 throw assetError('job_operation_invalid','Unknown job API operation');
}

async function invokeOperation(toolkit,name,operation,params,progress){
 if(operation==='agent.wake_after'){
  const {runAgentWake}=await import('../agents/wake.js');
  return runAgentWake(toolkit,name,params,{onProgress:event=>{
   const state=String(event.state??'').slice(0,32);if(!/^[a-z][a-z0-9_-]*$/.test(state))return;
   progress('agent.wake.'+state,{wakeProgress:{jobId:params.jobId,threadId:params.threadId,state,transportReady:event.transportReady===true,updatedAt:now()}});
  }});
 }
 if(operation==='workspace.prepare'){
  const {runPreparation}=await import('../preparation/service.js');
  return runPreparation(toolkit,name,params,{onProgress:event=>{
   if(!/^[a-z][a-z0-9_-]{0,31}$/.test(event.stage??'')||! /^[a-f0-9-]{36}$/.test(event.runId??''))return;
   const preparationProgress={runId:event.runId,stage:event.stage,state:String(event.state??'').slice(0,32),updatedAt:String(event.updatedAt??'').slice(0,32)};
   progress('preparation.'+event.stage,{preparationProgress});
  }});
 }
 if(operation==='workspace.status')return toolkit.status(name);
 if(operation==='workspace.inputs.resolve')return toolkit.resolveInputs(name,params);
 if(operation==='workspace.add'||operation==='workspace.scan'){const {input,...selectors}=params;return operation==='workspace.add'?toolkit.add(name,input,selectors):toolkit.scan(name,input,selectors);}
 if(operation==='workspace.dump')return toolkit.dump(name);
 if(operation==='workspace.import')return toolkit.importProgram(name,params);
 if(operation==='workspace.analyze')return toolkit.analyze(name);
 if(operation==='ghidra.session.start')return startSession(toolkit,name,params);
 if(operation==='ghidra.session.status')return sessionStatus(toolkit,name);
 if(operation==='ghidra.session.stop')return stopSession(toolkit,name,params);
 if(operation==='ghidra.symbols.plan')return querySession(toolkit,name,'symbols.plan',params,{timeoutMs:300000});
 if(operation==='ghidra.symbols.apply'){const {dryRun,operationId,...intent}=params;return mutateSession(toolkit,name,'symbols.apply',intent,{dryRun,operationId,timeoutMs:300000});}
 return invokeAssetApi(toolkit,name,operation,params);
}

export async function executeJob(toolkit,name,jobId,{invoke=invokeOperation,onProgress}={}){
 const paths=pathsFor(toolkit,name,jobId);let record=readRecord(paths,jobId);
 // Exclusive claim prevents accidental or malicious duplicate worker invocation.
 fs.writeFileSync(paths.claim,JSON.stringify({pid:process.pid,jobId}),{flag:'wx',mode:0o600});
 if(record.state!=='queued')throw assetError('job_state_invalid','Only a queued job may be claimed');
 const request=JSON.parse(readBounded(paths.request,1024**2+8192));
 if(request.jobId!==jobId||request.workspace!==paths.workspace||request.operation!==record.operation)throw assetError('job_binding_invalid','Job request belongs to another workspace or operation');
 const snapshot=()=>{
  const currentSteps={};try{for(const [key,step]of Object.entries(toolkit.read(name).steps??{}))if(/^[a-z]{1,32}$/.test(key)&&['pending','running','succeeded','failed','unknown','awaiting-user','stale','interrupted'].includes(step.state))currentSteps[key]={state:step.state};}catch{}return currentSteps;
 };
 const progress=(stage,extra={})=>{
  if(!/^[a-z][a-z0-9_.-]{0,79}$/.test(stage))throw assetError('job_progress_invalid','Progress stages must be controlled identifiers');
  const {logFile,...safe}=extra;
  if(logFile)try{const file=assertAssetPath(logFile,paths.workspace);safe.logReference=path.relative(paths.workspace,file).split(path.sep).join('/');}catch{}
  const timestamp=now(),currentSteps=snapshot();
  const changed=record.stage!==stage||Object.hasOwn(safe,'engine')&&record.engine!==safe.engine||JSON.stringify(currentSteps)!==JSON.stringify(record.currentSteps);
  const diagnosticTail=changed?[...record.diagnosticTail,{timestamp,stage,message:stage.replaceAll('.',' ')}].slice(-32):record.diagnosticTail;
  record={...record,...safe,currentSteps,stage,updatedAt:timestamp,sequence:record.sequence+1,diagnosticTail};
  assertAssetPath(paths.record,paths.workspace);atomicJson(paths.record,record);
 };
 const previousRun=toolkit.run;
 const previousValidationProgress=toolkit.onValidationProgress;
 toolkit.onValidationProgress=event=>{
  const validationProgress=validationProgressPreview(event);if(!validationProgress)return;
  progress('unity.validation.running',{engine:'Unity.exe',validationProgress});
 };
 if(onProgress)onProgress(progress);else toolkit.run=observedRun(previousRun,progress);
 // Native toolkit methods close over run; worker setup installs this observer
 // before createToolkit, so native dump/import progress is also observed.
 const timer=setInterval(()=>{
  try{progress(record.stage);}catch{}
 },1000);timer.unref();
 try{
  progress('operation.validating',{state:'running',pid:process.pid,startedAt:now()});
  validateAssetParamsForJob(request.operation,request.params);await checkPlan(toolkit,name,request.operation,request.params);
  progress('operation.running');
  const value=await invoke(toolkit,name,request.operation,request.params,progress);
  const serialized=JSON.stringify(value??null);const bytes=Buffer.byteLength(serialized);
  if(bytes>MAX_RESULT)throw assetError('job_result_limit','Final job result exceeds 128 MiB');
  assertAssetPath(paths.result,paths.workspace);fs.writeFileSync(paths.result,serialized,{flag:'wx',mode:0o600});
  const resultReference={path:path.relative(paths.workspace,paths.result).split(path.sep).join('/'),bytes,sha256:hash(serialized)};
  const uncertain=['workspace.prepare','agent.wake_after'].includes(request.operation)&&value?.state==='unknown';
  progress(uncertain?'operation.unverified':'operation.completed',{state:uncertain?'unknown':'succeeded',completedAt:now(),exitCode:uncertain?1:0,outcomeVerified:!uncertain,resultReference,domainState:typeof value?.state==='string'?value.state.slice(0,80):null});
 }catch(error){
  // Full engine errors can include private stdout. Save them locally only; MCP
  // receives a controlled failure reason, stable code, and artifact reference.
  const code=typeof error.code==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(error.code)?error.code:'job_operation_failed';
  assertAssetPath(paths.diagnostic,paths.workspace);fs.writeFileSync(paths.diagnostic,String(error.stack??error.message??error).slice(0,1024**2),{flag:'wx',mode:0o600});
  const reasons={job_plan_changed:'Saved symbols plan changed; inspect the exact plan and hash.',job_result_limit:'Operation finished but its result exceeded the saved result size limit.',session_not_running:'No owned ready Ghidra session exists; inspect session status.',session_conflict:'Another owned Ghidra session conflicts with this operation.',program_mismatch:'The selected Ghidra program does not match the workspace.',input_changed:'Selected inputs or verified dump changed; inspect workspace and session state.'};
  const knownReasons=new Set(['Scan inputs before dump','Dump IL2CPP before import','Import a program before analysis']);
  const uncertain=new Set(['request_timeout','connection_lost','connection_timeout','connection_closed','protocol_mismatch','response_limit','cleanup_pending','startup_timeout','needs_recovery','ERR_PROCESS_CANCELLED']).has(code);
  progress(uncertain?'operation.unverified':'operation.failed',{state:uncertain?'unknown':'failed',outcomeVerified:!uncertain,completedAt:now(),exitCode:Number.isSafeInteger(error.exitCode)&&error.exitCode!==0?error.exitCode:1,error:{code,message:uncertain?'The operation outcome is unverified after a timeout, transport loss or pending engine cleanup. Inspect the saved diagnostic, owned session and exact operation receipt before any explicit retry.':reasons[code]??(knownReasons.has(error.message)?error.message:`Operation ${request.operation} failed at ${record.stage}; inspect its saved diagnostic and workspace state before retrying.`),...(typeof error.operationId==='string'&&uuid.test(error.operationId)?{operationId:error.operationId}:{})},diagnosticReference:path.relative(paths.workspace,paths.diagnostic).split(path.sep).join('/')});
 }finally{clearInterval(timer);toolkit.run=previousRun;toolkit.onValidationProgress=previousValidationProgress;}
 return publicRecord(record);
}

export function observedRun(run,progress){return async(file,args,options)=>{
 // Keep runProcess supervision/leases and private stdout handling intact. Never
 // put args, stdout, stderr or error.message in a public progress event.
 const engine=path.basename(file).replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,80);
 progress('engine.running',{engine,...(options?.logFile?{logFile:options.logFile}:{})});
 try{const result=await run(file,args,options);progress('engine.completed');return result;}catch(error){progress('engine.failed');throw error;}
};}
