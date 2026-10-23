import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {assertAssetPath} from '../assets/context.js';
import {desktopOperations} from './operations.js';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const operations=new Set(desktopOperations.map(item=>item.id));
const states=new Set(['queued','running','succeeded','failed','unverified','unknown']);
const maxBytes=1024*1024;

// Guard both the pathname and the opened descriptor; records can be replaced
// atomically by workers, and linked or enlarged replacements must not be read.
export function readDesktopArtifact(file,parent,max=65536,{content=true}={}){
 assertAssetPath(file,parent);const before=fs.lstatSync(file);
 if(!before.isFile()||before.nlink!==1||before.size>max)throw Error('Unsupported or linked desktop record');
 const descriptor=fs.openSync(file,'r');
 try{
  const opened=fs.fstatSync(descriptor);
  assertAssetPath(file,parent);const named=fs.lstatSync(file);
  if(!opened.isFile()||opened.nlink!==1||opened.size>max||named.ino!==opened.ino||named.dev!==opened.dev)throw Error('Desktop record changed or exceeds limit');
  if(!content)return {stat:opened};
  const bytes=Buffer.alloc(opened.size+1);let length=0;
  while(length<bytes.length){const count=fs.readSync(descriptor,bytes,length,bytes.length-length,length);if(!count)break;length+=count;}
  if(length!==opened.size||length>max)throw Error('Desktop record changed while reading');
  const after=fs.fstatSync(descriptor);
  if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||after.nlink!==1)throw Error('Desktop record changed while reading');
  return {bytes:bytes.subarray(0,length),stat:opened};
 }finally{fs.closeSync(descriptor);}
}
export function readDesktopJson(file,parent,max=65536){
 return JSON.parse(readDesktopArtifact(file,parent,max).bytes.toString('utf8').replace(/^\uFEFF/,''));
}

export function desktopEntries(directory,parent,limit){
 assertAssetPath(directory,parent);let handle;
 try{handle=fs.opendirSync(directory);}catch(error){if(error.code==='ENOENT')return {items:[],truncated:false};throw error;}
 try{const items=[];let entry;while(items.length<limit&&(entry=handle.readSync()))items.push(entry);return {items,truncated:!!handle.readSync()};}finally{handle.closeSync();}
}

function validateJob(job){
 if(!job||!uuid.test(job.id??'')||!operations.has(job.operation)||!states.has(job.state)||typeof job.createdAt!=='string'||!Number.isFinite(Date.parse(job.createdAt))||!job.payload||typeof job.payload!=='object'||Array.isArray(job.payload)||Buffer.byteLength(JSON.stringify(job))>16384)throw Error('Invalid desktop history job');
 const name=job.payload.name;
 if(name!==undefined&&(typeof name!=='string'||!/^[A-Za-z0-9_.-]{1,64}$/.test(name)||['.','..'].includes(name)||name.endsWith('.')||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)))throw Error('Invalid desktop history project');
 return {...job,payload:name===undefined?{}:{name}};
}

/** Compact observation journal. It cannot dispatch or recover a worker. */
export function createDesktopHistory(root,{enabled=true}={}){
 root=path.resolve(root);const file=path.join(root,'.cache/desktop-jobs/history.json');
 let state=enabled?'missing':'disabled',writable=enabled,retained=0;
 const warnings=[];
 const warn=(code,message)=>{if(!warnings.some(item=>item.code===code))warnings.push({code,message});};
 function load(){
  if(!enabled)return [];
  try{
   const record=readDesktopJson(file,root,maxBytes);
   if(record.kind!=='retoolkit-desktop-history'||record.schemaVersion!==1||!Array.isArray(record.jobs)||record.jobs.length>30)throw Error('Invalid desktop history');
   const ids=new Set(),jobs=record.jobs.map(raw=>{const job=validateJob(raw);if(ids.has(job.id))throw Error('Duplicate desktop history identity');ids.add(job.id);
    if(['queued','running'].includes(job.state)){job.savedState=job.state;job.state='unknown';job.error={code:'DESKTOP_INTERRUPTED',message:'Desktop restarted without observing command completion. Inspect durable records and receipts before another attempt.'};delete job.progress;}
    return job;
   });
   state='available';retained=jobs.length;return jobs;
  }catch(error){
   if(error.code==='ENOENT'){state='missing';warn('desktop_history_missing','Earlier desktop command history is unavailable; absence of saved rows does not prove no activity.');}
   else{state='unavailable';writable=false;warn('desktop_history_unavailable','Saved desktop history is corrupt, linked or outside its bounds. It was not loaded or replaced. Inspect durable jobs and receipts.');}
   return [];
  }
 }
 function save(jobs){
  if(!writable)return;
  let temporary;
  try{
   const rows=jobs.slice(-30).map(validateJob).map(job=>({...job,payload:job.payload.name===undefined?{}:{name:job.payload.name}}));
   const serialized=JSON.stringify({kind:'retoolkit-desktop-history',schemaVersion:1,updatedAt:new Date().toISOString(),jobs:rows});
   if(Buffer.byteLength(serialized)>maxBytes)throw Error('Desktop history exceeds limit');
   assertAssetPath(file,root);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});assertAssetPath(file,root);
   try{const current=fs.lstatSync(file);if(!current.isFile()||current.nlink!==1||current.size>maxBytes)throw Error('Unsupported history destination');}catch(error){if(error.code!=='ENOENT')throw error;}
   temporary=assertAssetPath(path.join(path.dirname(file),`history-${randomUUID()}.tmp`),root);
   fs.writeFileSync(temporary,serialized,{flag:'wx',mode:0o600});assertAssetPath(file,root);fs.renameSync(temporary,file);temporary=undefined;state='available';retained=rows.length;
  }catch{state='unavailable';writable=false;warn('desktop_history_write_failed','Desktop history could not be saved. In-memory rows may be lost on restart; inspect durable jobs and receipts.');}
  finally{if(temporary)try{fs.unlinkSync(temporary);}catch{}}
 }
 return {load,save,status:()=>({state,retained,limit:30,warnings:structuredClone(warnings)})};
}
