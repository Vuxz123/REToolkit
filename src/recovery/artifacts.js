import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fingerprint,fileIdentity} from '../state.js';
import {assertAssetPath,assetError} from '../assets/context.js';
import {inventoryUnityProject,verifyGraphFiles} from '../assets/graph.js';
import {createPhaseMetrics} from '../workflow/metrics.js';

export const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export function check(ok,message,code='recovery_invalid'){if(!ok)throw assetError(code,message);}
export function artifactPaths(toolkit,name,artifactId){
 check(uuid(artifactId),'Expected an artifact UUID');const workspace=assertAssetPath(toolkit.workspace(name));
 const base=assertAssetPath(path.join(workspace,'04_Notes/recovery/artifacts',artifactId),workspace);
 return {workspace,base,manifest:path.join(base,'artifact.json'),state:path.join(base,'asset-state.json')};
}
export function readJson(file,max=128*1024**2){
 assertAssetPath(file);const stat=fs.lstatSync(file);check(stat.isFile()&&stat.size<=max,'Invalid or oversized recovery artifact');
 const bytes=fs.readFileSync(file);check(bytes.length<=max,'Recovery artifact exceeds byte limit');
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
export function writeJson(file,value,{exclusive=false}={}){
 assertAssetPath(file);const bytes=JSON.stringify(value)+'\n';check(Buffer.byteLength(bytes)<=128*1024**2,'Recovery artifact exceeds byte limit');
 fs.mkdirSync(path.dirname(file),{recursive:true});assertAssetPath(file);const temp=file+'.tmp-'+randomUUID();
 try{fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});if(exclusive)fs.linkSync(temp,file);else fs.renameSync(temp,file);}finally{fs.rmSync(temp,{force:true});}
}
export const seal=value=>({...value,payloadSha256:fingerprint(value)});
export function unseal(value){const {payloadSha256,...payload}=value??{};check(payloadSha256===fingerprint(payload),'Recovery artifact hash changed','recovery_receipt_invalid');return payload;}
export function loadArtifact(paths,artifactId){
 const value=unseal(readJson(paths.manifest,8*1024**2));
 check(value.kind==='retoolkit-recovery-artifact'&&value.schemaVersion===1&&value.artifactId===artifactId&&uuid(value.revision)&&Array.isArray(value.history)&&value.history.length<=10000,'Invalid recovery manifest');return value;
}
export function generationPaths(paths,revision){check(uuid(revision),'Invalid artifact revision');const directory=assertAssetPath(path.join(paths.base,'generations',revision),paths.base);return {directory,project:path.join(directory,'project'),receipt:path.join(directory,'revision.json')};}
export function loadGeneration(paths,manifest){
 const p=generationPaths(paths,manifest.revision),value=unseal(readJson(p.receipt));
 check(value.kind==='retoolkit-recovery-revision'&&value.revision===manifest.revision&&value.artifactId===manifest.artifactId&&fingerprint(value.files)===value.inventorySha256,'Invalid generation receipt');return {...p,receipt:value};
}
export async function snapshotProject(paths,artifactId,revision,source,files,{parent=null,operation='create',onProgress=()=>{},metrics=createPhaseMetrics()}={}){
 const p=generationPaths(paths,revision);assertAssetPath(source,paths.workspace);await metrics.measure('snapshot.verify',()=>verifyGraphFiles(source,{files}));
 fs.mkdirSync(p.directory,{recursive:true});fs.mkdirSync(p.project);const claims=new Set();
 let completedFiles=0,lastProgress=0;for(const entry of files){
  check(typeof entry.path==='string'&&/^(Assets|Packages|ProjectSettings)\//.test(entry.path)&&!/[\\:\x00-\x1f]/.test(entry.path)&&entry.path.split('/').every(v=>v&&v!=='.'&&v!=='..'),'Unsafe artifact inventory path');
  const key=entry.path.toLowerCase();check(!claims.has(key),'Ambiguous case-colliding artifact paths');claims.add(key);
  const from=assertAssetPath(path.join(source,...entry.path.split('/')),source),to=assertAssetPath(path.join(p.project,...entry.path.split('/')),p.project);
  fs.mkdirSync(path.dirname(to),{recursive:true});metrics.measureSync('snapshot.copy',()=>{fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);
  const actual=fileIdentity(to);check(actual.size===entry.size&&actual.sha256===entry.sha256,'Source changed while copying artifact','stale_graph');});metrics.count('snapshot.copy',entry.size,1);
  completedFiles++;if(Date.now()-lastProgress>=1000||completedFiles===files.length){lastProgress=Date.now();onProgress({phase:'snapshot.copying',artifactId,revision,completedFiles,totalFiles:files.length});}
 }
 // Empty required roots do not appear in a file inventory.
 for(const root of ['Assets','ProjectSettings'])fs.mkdirSync(path.join(p.project,root),{recursive:true});
 await metrics.measure('snapshot.verify',()=>verifyGraphFiles(source,{files}));await metrics.measure('snapshot.verify',()=>verifyGraphFiles(p.project,{files}));
 const receipt={kind:'retoolkit-recovery-revision',schemaVersion:1,artifactId,revision,parent,operation,createdAt:new Date().toISOString(),inventorySha256:fingerprint(files),files};
 writeJson(p.receipt,seal(receipt),{exclusive:true});return {...p,receipt};
}
export async function closeGeneration(paths,artifactId,revision,project,{parent,operation}){
 const p=generationPaths(paths,revision),{files}=await inventoryUnityProject(project);
 check(path.resolve(project)===path.resolve(p.project),'Noncanonical artifact project');
 const receipt={kind:'retoolkit-recovery-revision',schemaVersion:1,artifactId,revision,parent,operation,createdAt:new Date().toISOString(),inventorySha256:fingerprint(files),files};
 // A source fork initially has a snapshot receipt. Keep that immutable baseline
 // under before.json before publishing its final inventory.
 if(fs.existsSync(p.receipt))fs.renameSync(p.receipt,path.join(p.directory,'before.json'));
 writeJson(p.receipt,seal(receipt),{exclusive:true});return {...p,receipt};
}
export function page(items,{limit=50,cursor,query=''}={},signature){
 check(Number.isSafeInteger(limit)&&limit>=1&&limit<=100&&typeof query==='string'&&query.length<=512,'Invalid recovery paging');let offset=0;
 if(cursor!==undefined){try{check(typeof cursor==='string'&&cursor.length<=4096,'Invalid cursor');const c=JSON.parse(Buffer.from(cursor,'base64url').toString());check(c.signature===fingerprint({signature,query})&&Number.isSafeInteger(c.offset)&&c.offset>=0,'Stale cursor');offset=c.offset;}catch{throw assetError('recovery_cursor_invalid','Invalid or stale recovery cursor');}}
 const selected=query?items.filter(v=>JSON.stringify(v).toLowerCase().includes(query.toLowerCase())):items;
 const rows=[];let bytes=0;for(const row of selected.slice(offset,offset+limit)){const size=Buffer.byteLength(JSON.stringify(row));check(size<=64*1024,'Recovery row exceeds output budget');if(bytes+size>512*1024)break;rows.push(row);bytes+=size;}
 const next=offset+rows.length;return {items:rows,total:selected.length,nextCursor:next<selected.length?Buffer.from(JSON.stringify({offset:next,signature:fingerprint({signature,query})})).toString('base64url'):null};
}
