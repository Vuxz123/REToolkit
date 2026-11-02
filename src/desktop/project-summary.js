import fs from 'node:fs';
import path from 'node:path';
import {assertAssetPath} from '../assets/context.js';

// Inventory-heavy records are parsed once per file revision. Only this small,
// immutable projection is retained; never cache or send output inventories.
export const desktopProjectByteLimit=128*1024**2;
const cache=new Map(),keys=['extract','scan','dump','import','analyze','symbols','notes','assetripper'];
const signature=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join('|');
const text=(v,n)=>typeof v==='string'?v.slice(0,n):undefined;
function supported(stat){
 if(!stat.isFile()||stat.nlink!==1n||stat.size>BigInt(desktopProjectByteLimit))throw Error('Unsupported project record: expected a regular, unlinked JSON file at most 128 MiB');
}
export function readDesktopProjectSummary(workspace){
 const file=assertAssetPath(path.join(workspace,'project.re.json'),workspace);
 const stat=fs.lstatSync(file,{bigint:true});supported(stat);const revision=signature(stat);
 if(cache.get(file)?.revision===revision)return cache.get(file).summary;
 cache.delete(file);let fd;
 try{
  fd=fs.openSync(file,'r');const opened=fs.fstatSync(fd,{bigint:true});supported(opened);
  if(signature(opened)!==revision)throw Error('Project changed while opening; refresh to retry');
  const bytes=Buffer.alloc(Number(opened.size)+1);let length=0;
  while(length<bytes.length){const read=fs.readSync(fd,bytes,length,bytes.length-length,null);if(!read)break;length+=read;}
  assertAssetPath(file,workspace);
  if(length!==Number(opened.size)||signature(fs.fstatSync(fd,{bigint:true}))!==revision||signature(fs.lstatSync(file,{bigint:true}))!==revision)throw Error('Project changed while reading; refresh to retry');
  const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,length)).replace(/^\uFEFF/,''));
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid project JSON object');
  const steps={};
  for(const key of keys){const step=raw.steps?.[key];if(step&&typeof step==='object'&&!Array.isArray(step))steps[key]=Object.freeze({state:text(step.state,32),runId:text(step.runId,64),owner:Object.freeze({pid:Number.isSafeInteger(step.owner?.pid)&&step.owner.pid>0?step.owner.pid:null}),startedAt:text(step.startedAt,64),completedAt:text(step.completedAt,64)});}
  const summary=Object.freeze({platform:text(raw.platform,64),reconstructedSourceDir:typeof raw.reconstructedSourceDir==='string'&&raw.reconstructedSourceDir.length<=4096?raw.reconstructedSourceDir:undefined,steps:Object.freeze(steps)});
  if(cache.size>=16)cache.delete(cache.keys().next().value);
  cache.set(file,{revision,summary});return summary;
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}
