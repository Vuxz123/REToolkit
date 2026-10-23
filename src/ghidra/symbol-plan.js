import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertAssetPath,assetError} from '../assets/context.js';

export const SYMBOL_PLAN_LIMITS=Object.freeze({maxBytes:512*1024**2,chunkBytes:64*1024});
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&a.nlink===b.nlink;
const changed=()=>assetError('job_plan_changed','Saved symbols plan changed; inspect the exact plan and hash before starting');

// Hash the exact immutable bytes without allocating a plan-sized Buffer or JSON
// tree. Java separately validates its schema, Program/revision and old values.
export async function verifySymbolPlan({workspace,plan,planHash,onProgress}){
 const root=assertAssetPath(path.resolve(workspace)),file=assertAssetPath(path.resolve(root,plan),root),before=await fs.lstat(file);
 if(!before.isFile()||before.nlink!==1||before.size>SYMBOL_PLAN_LIMITS.maxBytes)throw assetError('job_artifact_invalid','Symbol plan must be an unlinked regular file within the 512 MiB plan budget');
 if(typeof planHash!=='string'||! /^[a-f0-9]{64}$/.test(planHash))throw changed();
 const handle=await fs.open(file,'r');let bytes=0;const hash=createHash('sha256');
 try{
  if(!same(before,await handle.stat()))throw changed();
  for await(const chunk of handle.createReadStream({autoClose:false,highWaterMark:SYMBOL_PLAN_LIMITS.chunkBytes})){
   bytes+=chunk.length;if(bytes>before.size||bytes>SYMBOL_PLAN_LIMITS.maxBytes)throw changed();hash.update(chunk);
   if(onProgress)await onProgress({bytes,totalBytes:before.size});
  }
  assertAssetPath(file,root);const after=await handle.stat(),current=await fs.lstat(file),sha256=hash.digest('hex');
  if(bytes!==before.size||current.isSymbolicLink()||!current.isFile()||!same(before,after)||!same(before,current)||sha256!==planHash)throw changed();
  return {path:file,size:bytes,sha256};
 }finally{await handle.close();}
}
