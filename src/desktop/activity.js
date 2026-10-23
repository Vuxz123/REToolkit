import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertAssetPath} from '../assets/context.js';
import {validationProgressPreview} from '../unity/progress.js';
import {buildDesktopCommand} from './operations.js';
import {createGhidraActivityReader} from './ghidra-activity.js';
import {readDesktopJson,readDesktopArtifact,desktopEntries} from './history.js';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const states=new Set(['queued','running','succeeded','failed','unknown','awaiting-user','stale','pending','unverified']);
const text=(value,max=2048)=>typeof value==='string'?value.slice(0,max):undefined;
const date=value=>typeof value==='string'&&value.length<=64&&Number.isFinite(Date.parse(value))?value:null;
const pid=value=>Number.isSafeInteger(value)&&value>0?value:null;
const fail=(code,message)=>Object.assign(Error(message),{code});
function alive(value){try{process.kill(value,0);return true;}catch(error){return error.code==='ESRCH'?false:null;}}
function boundedValue(value,limit=16384){
 if(value===undefined)return undefined;
 if(Buffer.byteLength(JSON.stringify(value))<=limit)return structuredClone(value);
 return {truncated:true,notice:'Result exceeds the desktop detail preview. Inspect the exact saved job receipt with a bounded CLI query.',...(typeof value?.kind==='string'?{kind:text(value.kind,128)}:{}),...(typeof value?.state==='string'?{state:text(value.state,64)}:{})};
}

/** Read-only project observations. No leases, execution, replay or session writes. */
export function createDesktopActivityReader(root,{toolkit,ghidraActivity,isAlive=alive,now=Date.now}={}){
 root=path.resolve(root);toolkit??={workspace:name=>path.join(root,'workspaces',name)};
 const ghidra=ghidraActivity??createGhidraActivityReader(root,{isAlive,now});
 const probe=value=>{if(!pid(value))return null;try{const result=isAlive(value);return typeof result==='boolean'?result:null;}catch{return null;}};
 function selected(name){
  buildDesktopCommand('workspace.status',{name});
  const workspace=assertAssetPath(path.join(root,'workspaces',name),root);
  if(path.resolve(toolkit.workspace(name))!==workspace)throw fail('DESKTOP_ACTIVITY_BINDING','Toolkit workspace does not match the selected project');
  const project=assertAssetPath(path.join(workspace,'project.re.json'),workspace),stat=fs.lstatSync(project);
  if(!stat.isFile()||stat.nlink!==1||stat.size>16*1024**2)throw fail('DESKTOP_ACTIVITY_PROJECT','Unsupported project record');
  return workspace;
 }
 function durableRecord(workspace,id){
  if(typeof id!=='string'||!uuid.test(id))throw fail('DESKTOP_ACTIVITY_ID','Invalid durable job identity');
  const record=readDesktopJson(path.join(workspace,'04_Notes/jobs',id,'record.json'),workspace);
  if(record.kind!=='retoolkit-job'||record.schemaVersion!==1||record.jobId!==id||record.workspace!==workspace||!states.has(record.state)||typeof record.operation!=='string'||!/^[a-z][a-z0-9_.-]{0,100}$/.test(record.operation)||!date(record.createdAt)||record.state==='succeeded'&&!record.resultReference)throw fail('DESKTOP_ACTIVITY_RECORD','Invalid job record binding');
  return record;
 }
 function summary(record,name,source,id){
  const ownerPid=pid(record.pid??record.ownerPid),ownerAlive=probe(ownerPid),savedState=states.has(record.state)?record.state:'unknown';
  // A saved live state cannot attest that an absent owner is still executing.
  const state=['running','queued'].includes(savedState)&&(ownerPid?ownerAlive!==true:savedState==='running'||now()-(Date.parse(record.createdAt)||0)>30000)?'unknown':savedState;
  const wakeRunning=state==='running'&&ownerAlive===true;
  const notificationQueued=state==='succeeded'&&['queued','notification_queued'].includes(record.wakeProgress?.state);
  return {key:`${source}:${id}`,id,...(source==='durable'?{jobId:id}:{}),source,name,operation:text(record.operation,128)??'unknown',payload:{name},state,savedState,
   createdAt:date(record.createdAt)??date(record.startedAt),updatedAt:date(record.updatedAt)??date(record.startedAt),startedAt:date(record.startedAt),completedAt:date(record.completedAt),ownerPid,ownerAlive,
   ...(text(record.stage,128)?{stage:text(record.stage,128)}:{}),...(Number.isSafeInteger(record.exitCode)?{exitCode:record.exitCode}:{}),
   ...(record.error?{error:{code:text(record.error.code,128),message:text(record.error.message,1024)}}:{}),
   ...(record.operationId&&uuid.test(record.operationId)?{operationId:record.operationId}:{}),
   ...(record.preparationProgress?{preparationProgress:{runId:uuid.test(record.preparationProgress.runId??'')?record.preparationProgress.runId:null,stage:text(record.preparationProgress.stage,80),state:text(record.preparationProgress.state,32),updatedAt:date(record.preparationProgress.updatedAt)}}:{}),
   ...(validationProgressPreview(record.validationProgress)?{validationProgress:validationProgressPreview(record.validationProgress)}:{}),
   ...(record.wakeProgress?{wakeProgress:{jobId:uuid.test(record.wakeProgress.jobId??'')?record.wakeProgress.jobId:null,threadId:text(record.wakeProgress.threadId,80),state:wakeRunning||notificationQueued?text(record.wakeProgress.state,64):'unknown',transportReady:wakeRunning&&record.wakeProgress.transportReady===true,resumed:false,updatedAt:date(record.wakeProgress.updatedAt)}}:{}),
   ...(record.log?{log:{path:text(record.log.path,512),tail:text(record.log.tail,4096),updatedAt:date(record.log.updatedAt),quiet:record.log.quiet===true}}:{})};
 }
 function ghidraObservation(name){
  const observed=ghidra(name);
  if(!observed||typeof observed!=='object'||observed.then)throw fail('DESKTOP_ACTIVITY_GHIDRA','Ghidra observer did not return a synchronous observation');
  return observed;
 }
 async function inspect(name){
  const workspace=selected(name),warnings=[],jobs=[],sessions=[];
  const warn=(code,message)=>{if(!warnings.some(w=>w.code===code))warnings.push({code,message});};
  let lock={state:'unknown',workspaceBusy:null,ownerPid:null,ownerAlive:null,engines:[]};
  try{
   const file=assertAssetPath(path.join(workspace,'.retk-lock'),workspace);let busy=false;
   try{const stat=fs.lstatSync(file);if(!stat.isDirectory())throw Error('Unsupported lock');busy=true;}catch(error){if(error.code!=='ENOENT')throw error;}
   lock={...lock,state:busy?'busy':'available',workspaceBusy:busy};
  }catch{warn('activity_lock_unavailable','Workspace ownership could not be inspected. Lock availability is unverified.');}
  try{
   const records=desktopEntries(path.join(workspace,'04_Notes/jobs'),workspace,128);
   if(records.truncated)warn('activity_jobs_truncated','Only the first 128 job directory entries were inspected. Older or additional jobs may be absent.');
   for(const entry of records.items){
    if(!uuid.test(entry.name))continue;
    try{if(!entry.isDirectory()||entry.isSymbolicLink())throw Error('Unsupported job directory');jobs.push(summary(durableRecord(workspace,entry.name),name,'durable',entry.name));}
    catch{warn('activity_record_unavailable','One or more saved job records are invalid, linked, oversized or belong to another project. They were not shown.');}
   }
   jobs.sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0));
   if(jobs.length>30){jobs.length=30;warn('activity_jobs_truncated','At most 30 durable jobs are displayed from a bounded scan; additional records are omitted.');}
  }catch{warn('activity_jobs_unavailable','Durable job history could not be inspected. No visible rows does not prove no activity.');}
  try{
   const observed=ghidraObservation(name);
   if(observed.state==='unavailable')warn('activity_ghidra_unavailable','Ghidra observations are unavailable. Engine activity may be incomplete.');
   if(observed.jobsTruncated||observed.tasksTruncated)warn('activity_ghidra_truncated','Ghidra observations were bounded; additional observations may be absent.');
   if(observed.lock&&lock.state!=='unknown')lock={...lock,ownerPid:pid(observed.lock.ownerPid),ownerAlive:typeof observed.lock.ownerAlive==='boolean'?observed.lock.ownerAlive:null,ambiguous:observed.lock.ambiguous===true,truncated:observed.lock.truncated===true,engines:Array.isArray(observed.lock.engines)?observed.lock.engines.slice(0,32).map(e=>({pid:pid(e.pid),alive:typeof e.alive==='boolean'?e.alive:null,phase:e.phase==='running'?'running':'unknown'})):[]};
   const ids=new Set(jobs.map(job=>job.id)),seen=new Set();
   for(const task of (Array.isArray(observed.tasks)?observed.tasks:[]).slice(0,8)){
    if(typeof task.id!=='string'||!/^[a-zA-Z0-9_.-]{1,80}$/.test(task.id)||seen.has(task.id))continue;
    seen.add(task.id);if(task.source==='mcp'&&ids.has(task.id))continue;
    jobs.push({...summary(task,name,'ghidra',task.id),observationSource:task.source==='mcp'?'mcp':'workspace'});
   }
  }catch{warn('activity_ghidra_unavailable','Ghidra observations could not be inspected. Engine activity may be incomplete.');}
  try{
   const records=desktopEntries(path.join(workspace,'04_Notes/agent-sessions'),workspace,64);
   if(records.truncated)warn('activity_sessions_truncated','Only the first 64 session directory entries were inspected; additional sessions may be absent.');
   for(const entry of records.items){
    if(!uuid.test(entry.name))continue;
    try{
     if(!entry.isDirectory()||entry.isSymbolicLink())throw Error('Unsupported session directory');
     const directory=path.join(workspace,'04_Notes/agent-sessions',entry.name);
     const optional=leaf=>{try{return readDesktopJson(path.join(directory,leaf),workspace,leaf==='launch.json'?128*1024:65536);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
     const launch=optional('launch-status.json'),terminal=optional('terminal-status.json'),manifest=optional('launch.json');
     if(!launch&&!terminal){warn('activity_session_unavailable','Some sessions have no usable saved status. Their launch and process state are unverified.');continue;}
     const launchState=['terminal-opened','failed'].includes(launch?.state)?launch.state:'unknown',terminalState=['running','exited','failed'].includes(terminal?.state)?terminal.state:null;
     const ownerPid=pid(terminal?.pid),ownerAlive=probe(ownerPid),state=terminalState==='running'?(ownerAlive===true?'running':'unknown'):terminalState??(launchState==='failed'?'failed':launchState);
     sessions.push({key:`session:${entry.name}`,id:entry.name,name,harness:['codex','claude','gemini','opencode'].includes(manifest?.harness)?manifest.harness:'unknown',state,launchState,terminalState,ownerPid,ownerAlive,createdAt:date(launch?.createdAt),updatedAt:date(terminal?.at)??date(launch?.createdAt),mcpState:'unverified',resumed:false,...(Number.isSafeInteger(terminal?.exitCode)?{exitCode:terminal.exitCode}:{}),...(typeof terminal?.message==='string'||typeof launch?.message==='string'?{error:{code:'AGENT_LAUNCH_OBSERVATION',message:text(terminal?.message??launch?.message,1024)}}:{})});
    }catch{warn('activity_session_unavailable','Some Agent session records are invalid, linked or oversized. Launch and process state are unverified.');}
   }
   sessions.sort((a,b)=>(Date.parse(b.updatedAt)||0)-(Date.parse(a.updatedAt)||0));
   if(sessions.length>20){sessions.length=20;warn('activity_sessions_truncated','At most 20 Agent sessions are displayed from a bounded scan; additional sessions are omitted.');}
  }catch{warn('activity_sessions_unavailable','Agent session history could not be inspected. MCP connection and continuation remain unverified.');}
  return {name,observedAt:new Date(now()).toISOString(),jobs,sessions,warnings,lock};
 }
 async function detail(name,request){
  const workspace=selected(name);
  if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(key=>!['source','id'].includes(key)))throw fail('DESKTOP_ACTIVITY_REQUEST','Invalid activity detail request');
  const {source,id}=request;
  if(source==='durable'){
   const saved=durableRecord(workspace,id);
   const job=summary(saved,name,source,id);
   let result,resultReference;
   if(['succeeded','failed','unknown'].includes(saved.state)&&saved.resultReference){
    const reference=saved.resultReference;
    if(reference.path!==`04_Notes/jobs/${id}/result.json`||!Number.isSafeInteger(reference.bytes)||reference.bytes<0||reference.bytes>128*1024**2||typeof reference.sha256!=='string'||!/^[a-f0-9]{64}$/.test(reference.sha256))throw fail('DESKTOP_ACTIVITY_ARTIFACT','Invalid result artifact reference');
    const inline=reference.bytes<=256*1024,artifact=readDesktopArtifact(path.join(workspace,reference.path),workspace,inline?256*1024:128*1024**2,{content:inline});
    if(artifact.stat.size!==reference.bytes)throw fail('DESKTOP_ACTIVITY_ARTIFACT','Result artifact changed size');
    resultReference={path:reference.path,bytes:reference.bytes,sha256:reference.sha256};
    if(inline){if(createHash('sha256').update(artifact.bytes).digest('hex')!==reference.sha256)throw fail('DESKTOP_ACTIVITY_ARTIFACT','Result artifact hash changed');result=boundedValue(JSON.parse(artifact.bytes));}
    else result={truncated:true,notice:'Result exceeds the desktop preview. Full content and hash were not read; inspect the exact saved job receipt with a bounded CLI query.'};
   }
   const diagnostics=Array.isArray(saved.diagnosticTail)?saved.diagnosticTail.slice(-16).map(item=>({timestamp:date(item.timestamp),stage:text(item.stage,80),message:text(item.message,256)})):[];
   return {...job,...(result!==undefined?{result}:{}),...(resultReference?{resultReference}:{}),diagnostics,progress:text(saved.stage,128)};
  }
  if(source==='ghidra'&&typeof id==='string'&&/^[a-zA-Z0-9_.-]{1,80}$/.test(id)){
   const observed=ghidraObservation(name),task=observed.tasks?.find(task=>task.id===id);
   if(!task)throw fail('DESKTOP_ACTIVITY_MISSING','The exact Ghidra observation is no longer available');
   const job={...summary(task,name,source,id),observationSource:task.source==='mcp'?'mcp':'workspace'};
   return {...job,result:{kind:'retoolkit-ghidra-observation',...job},diagnostics:text(task.log?.tail,4096),progress:text(task.stage,128)};
  }
  throw fail('DESKTOP_ACTIVITY_ID','Unsupported activity source or identity');
 }
 return {inspect,detail};
}
