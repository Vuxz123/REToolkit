import fs from 'node:fs';
import path from 'node:path';
import {assertAssetPath} from '../assets/context.js';
import {buildDesktopCommand} from './operations.js';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const operations=new Set(['workspace.import','workspace.analyze','ghidra.analysis.ensure','ghidra.symbols.plan','ghidra.symbols.apply','ghidra.session.start']);
const states=new Set(['pending','queued','running','succeeded','failed','unknown','awaiting-user','stale']);
const pid=value=>Number.isSafeInteger(value)&&value>0?value:null;
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
function alive(value){if(!pid(value))return null;try{process.kill(value,0);return true;}catch(error){return error.code==='ESRCH'?false:null;}}
function readJson(file,parent,max=65536){
 assertAssetPath(file,parent);const handle=fs.openSync(file,'r');try{
  const stat=fs.fstatSync(handle);if(!stat.isFile()||stat.nlink!==1||stat.size>max)throw Error('Unsupported activity record');
  const bytes=Buffer.alloc(Math.min(stat.size+1,max+1)),length=fs.readSync(handle,bytes,0,bytes.length,0);
  if(length>max)throw Error('Activity record exceeds limit');return JSON.parse(bytes.subarray(0,length).toString('utf8').replace(/^\uFEFF/,''));
 }finally{fs.closeSync(handle);}
}
function entries(directory,parent,max){
 assertAssetPath(directory,parent);let handle;
 try{handle=fs.opendirSync(directory);}catch(error){if(error.code==='ENOENT')return {items:[],truncated:false};throw error;}
 try{const items=[];let entry;while(items.length<max&&(entry=handle.readSync()))items.push(entry);return {items,truncated:Boolean(handle.readSync())};}finally{handle.closeSync();}
}
function logTail(workspace,relative,now){
 if(typeof relative!=='string'||relative.length>4096||!relative.startsWith('04_Notes/')||relative.split(/[\\/]/).some(part=>part==='..')||!relative.endsWith('.log'))return;
 let handle;try{
  const file=assertAssetPath(path.resolve(workspace,relative),workspace);handle=fs.openSync(file,'r');const stat=fs.fstatSync(handle);
  if(!stat.isFile()||stat.nlink!==1)return;
  const length=Math.min(stat.size,12288),buffer=Buffer.alloc(length),count=fs.readSync(handle,buffer,0,length,Math.max(0,stat.size-length));
  const tail=buffer.subarray(0,count).toString('utf8').replace(/^\ufffd+/,'').split(/\r?\n/).slice(-40).join('\n');
  const analyzer=[...tail.matchAll(/\(([A-Za-z0-9_]{1,100}Analyzer)\)/g)].at(-1)?.[1]??null;
  return {path:relative,bytes:stat.size,updatedAt:new Date(stat.mtimeMs).toISOString(),quiet:now-stat.mtimeMs>=300000,tail,lastObservedAnalyzer:analyzer};
 }catch{return;}finally{if(handle!==undefined)fs.closeSync(handle);}
}

/** Observes saved state only. Never acquires/reclaims a lease or calls an engine. */
export function createGhidraActivityReader(root,{isAlive=alive,now=Date.now}={}){
 root=path.resolve(root);
 let cachedProject;
 function projectState(workspace){
  const file=assertAssetPath(path.join(workspace,'project.re.json'),workspace),stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.nlink!==1||stat.size>16*1024**2)throw Error('Unsupported project file');
  const signature=[file,stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join('|');
  if(cachedProject?.signature===signature)return cachedProject.project;
  const raw=readJson(file,workspace,16*1024**2),project={steps:{}};
  for(const key of ['import','analyze','symbols']){const step=raw.steps?.[key];if(step)project.steps[key]={state:step.state,runId:step.runId,owner:{pid:step.owner?.pid},startedAt:step.startedAt,completedAt:step.completedAt};}
  cachedProject={signature,project};return project;
 }
 return function inspect(name){
  buildDesktopCommand('workspace.status',{name});
  const workspace=path.join(root,'workspaces',name),time=now(),result={name,state:'observed',observedAt:new Date(time).toISOString(),workspaceBusy:false,lock:{ownerPid:null,ownerAlive:null,engines:[]},tasks:[],jobsTruncated:false};
  const probe=value=>{try{return pid(value)?isAlive(value):null;}catch{return null;}};
  function task(record,{id,operation,source,ownerPid,logReference}){
   const ownerAlive=probe(ownerPid),savedState=states.has(record.state)?record.state:'unknown',startedAt=date(record.startedAt)??date(record.createdAt),completedAt=date(record.completedAt);
   const state=savedState==='running'&&ownerAlive!==true?'unknown':savedState;
   return {id,operation,source,state,savedState,ownerPid:pid(ownerPid),ownerAlive,startedAt,completedAt,
    elapsedSeconds:startedAt?Math.max(0,Math.floor(((completedAt?Date.parse(completedAt):time)-Date.parse(startedAt))/1000)):null,
    ...(typeof record.stage==='string'&&/^[a-z][a-z0-9_.-]{0,79}$/.test(record.stage)?{stage:record.stage}:{}),
    ...(Number.isSafeInteger(record.exitCode)?{exitCode:record.exitCode}:{}),
    ...(typeof record.domainState==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(record.domainState)?{domainState:record.domainState}:{}),
    ...(record.resultReference?.path===`04_Notes/jobs/${id}/result.json`?{resultReference:record.resultReference.path}:{}),
    ...(logReference?{log:logTail(workspace,logReference,time)}:{})};
  }
  try{
   const project=projectState(workspace),lock=path.join(workspace,'.retk-lock');
   assertAssetPath(lock,workspace);result.workspaceBusy=fs.existsSync(lock);
   if(result.workspaceBusy){
    const markers=entries(lock,workspace,32);result.lock.truncated=markers.truncated;
    for(const entry of markers.items)try{
     const match=/^(owner|engine)-(\d+)-[a-f0-9-]+\.json$/.exec(entry.name);if(!match||!entry.isFile())continue;
     const marker=readJson(path.join(lock,entry.name),workspace),markerPid=Number(match[2]);
     if(match[1]==='owner'&&marker.pid===markerPid){if(result.lock.ownerPid){result.lock.ambiguous=true;result.lock.ownerAlive=null;}else{result.lock.ownerPid=pid(markerPid);result.lock.ownerAlive=probe(markerPid);}}
     if(match[1]==='engine'&&marker.owner?.pid===markerPid&&typeof marker.file==='string'&&/(?:analyzeHeadless\.(?:bat|sh)|java(?:\.exe)?)$/i.test(marker.file))result.lock.engines.push({pid:markerPid,alive:probe(markerPid),phase:marker.phase==='running'?'running':'unknown'});
    }catch{result.lock.ambiguous=true;}
   }
   for(const step of ['import','analyze','symbols']){
    const record=project.steps?.[step];if(!record||['pending','stale'].includes(record.state))continue;
    const id=uuid.test(record.runId??'')?record.runId:step;
    result.tasks.push(task(record,{id,operation:'workspace.'+step,source:'workspace',ownerPid:record.owner?.pid,logReference:uuid.test(id)?`04_Notes/${step}-${id}.log`:undefined}));
   }
   const directory=path.join(workspace,'04_Notes/jobs'),records=entries(directory,workspace,128);result.jobsTruncated=records.truncated;
   for(const entry of records.items){if(!entry.isDirectory()||!uuid.test(entry.name))continue;try{
    const record=readJson(path.join(directory,entry.name,'record.json'),workspace);
    if(record.kind!=='retoolkit-job'||record.schemaVersion!==1||record.workspace!==workspace||record.jobId!==entry.name||!operations.has(record.operation))continue;
    const observed=task(record,{id:record.jobId,operation:record.operation,source:'mcp',ownerPid:record.pid,logReference:record.logReference});
    const duplicate=observed.log?.path?result.tasks.findIndex(item=>item.source==='workspace'&&item.operation===observed.operation&&item.log?.path===observed.log.path):-1;
    if(duplicate>=0)result.tasks[duplicate]=observed;else result.tasks.push(observed);
   }catch{result.jobsTruncated=true;}}
   result.tasks.sort((a,b)=>Number(['queued','running','unknown'].includes(b.state))-Number(['queued','running','unknown'].includes(a.state))||(Date.parse(b.startedAt)||0)-(Date.parse(a.startedAt)||0));
   result.tasksTruncated=result.tasks.length>8;result.tasks=result.tasks.slice(0,8);
   return result;
  }catch{return {...result,state:'unavailable',tasks:[],code:'ghidra_activity_unavailable'};}
 };
}
