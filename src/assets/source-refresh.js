import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fingerprint} from '../state.js';
import {assertAssetPath,assetError} from './context.js';
import {readUnitySourceMetadata,describeUnitySourceScript,verifyGraphFiles} from './graph.js';
import {isSqliteGraph,assertGraphManifest,storedDatabasePath} from './graph-storage.js';
import {refreshSqliteGraph} from './sqlite-store.js';
const check=(ok,message)=>{if(!ok)throw assetError('asset_source_refresh_invalid',message);};
const pending=new WeakMap();
const sameIdentity=(a,b)=>b.isFile()&&!b.isSymbolicLink()&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
export function assertSourceRefreshFresh(graph,graphFile){
 const owned=pending.get(graph);if(!owned)return;
 check(path.resolve(graphFile)===owned.graphFile,'Source refresh publication target changed');
 const stat=syncFs.lstatSync(assertAssetPath(owned.file,owned.base));
 check(sameIdentity(owned.identity,stat),'Sealed source refresh database changed before publication');
 for(const suffix of ['-journal','-wal','-shm'])try{syncFs.lstatSync(owned.file+suffix);throw assetError('sqlite_graph_changed','Sealed refresh gained a sidecar');}catch(e){if(e.code!=='ENOENT')throw e;}
}
export async function discardSourceRefresh(graph,graphFile){
 const owned=pending.get(graph);if(!owned)return;
 assertSourceRefreshFresh(graph,graphFile);
 await fs.unlink(assertAssetPath(owned.file,owned.base));pending.delete(graph);
 const directory=await fs.lstat(assertAssetPath(owned.directory,owned.base));
 check(directory.isDirectory()&&!directory.isSymbolicLink()&&directory.dev===owned.directoryIdentity.dev&&directory.ino===owned.directoryIdentity.ino,'Source refresh directory changed');
 await fs.rmdir(owned.directory);
}

/** A complete current graph and a verified source receipt are required.
 * Saved JSON reconstruction graphs omit serialized rows and cannot be used here. */
export async function refreshSourceGraph({projectDir,graph,graphFile,receipt,onProgress=()=>{}}){
 assertGraphManifest(graph);const {receiptSha256,...unsigned}=receipt;
 check(receipt.kind==='retoolkit-reconstruction-receipt'&&receipt.schemaVersion===1&&receiptSha256===fingerprint(unsigned),'Invalid source receipt');
 check(receipt.graphRevision===graph.revision&&fingerprint(receipt.binding)===fingerprint(graph.binding),'Receipt baseline differs from graph');
 check(Array.isArray(receipt.changes)&&receipt.changes.length>0&&receipt.changes.length<=16&&Array.isArray(receipt.files)&&receipt.files.length===graph.files.length,'Invalid source-only inventory delta');
 const changes=new Map();for(const c of receipt.changes){check(typeof c.path==='string'&&c.path.startsWith('Assets/')&&c.path.endsWith('.cs')&&!changes.has(c.path),'Expected unique existing C# changes');changes.set(c.path,c);}
 check(new Set(receipt.files.map(f=>f.path)).size===receipt.files.length,'Duplicate receipt file identity');
 for(let i=0;i<graph.files.length;i++){
  const before=graph.files[i],after=receipt.files[i],change=changes.get(before.path);
  check(before.path===after.path,'Source refresh changed file membership/order');
  if(change)check(after.sha256===change.sha256&&Number.isSafeInteger(after.size)&&after.size>0,'Changed source does not match receipt');
  else check(fingerprint(before)===fingerprint(after),'Source receipt changes a non-source file');
 }
 const assets=structuredClone(graph.assets),metadata=await readUnitySourceMetadata(projectDir,receipt.files),scriptIds=[];
 for(const [filePath,change]of changes){
  const matches=assets.filter(a=>a.id===change.scriptId&&a.path===filePath);check(matches.length===1,'Missing or ambiguous source asset');const asset=matches[0],file=receipt.files.find(f=>f.path===filePath);
  check(file&&asset.kind==='script'&&(metadata.metas.get(filePath)??null)===(asset.guid??null),'Source identity/meta changed');
  const script=await describeUnitySourceScript(projectDir,file,metadata);check(script.assembly===asset.script?.assembly,'Source assembly changed');asset.script=script;scriptIds.push(asset.id);
 }
 const changedPaths=new Set(changes.keys()),limitations=graph.limitations.filter(item=>!Array.from(changedPaths).some(p=>item===`Unsupported script declarations: ${p}`));
 for(const asset of assets)if(changedPaths.has(asset.path)&&!asset.script.supported&&limitations.length<1000)limitations.push(`Unsupported script declarations: ${asset.path}`);
 const files=structuredClone(receipt.files),revision=createHash('sha256').update(JSON.stringify({binding:graph.binding,files})).digest('hex');
 const updated={...graph,files,assets,revision,limitations,coverage:{...graph.coverage,unsupportedScripts:assets.filter(a=>a.script&&!a.script.supported).length}};
 await onProgress({phase:'refresh.verifying',changedScripts:scriptIds.length});await verifyGraphFiles(projectDir,updated);
 let directory,directoryIdentity;
 try{
  if(isSqliteGraph(graph)){
   const base=path.dirname(assertAssetPath(graphFile)),relativePath=`indexes/${randomUUID()}/graph.sqlite`,databaseFile=assertAssetPath(path.join(base,...relativePath.split('/')),base);directory=path.dirname(databaseFile);
   await fs.mkdir(path.join(base,'indexes'),{recursive:true});await fs.mkdir(directory);directoryIdentity=await fs.lstat(assertAssetPath(directory,base));assertAssetPath(databaseFile);
   const sealed=await refreshSqliteGraph({file:storedDatabasePath(graph,graphFile),outputFile:databaseFile,graph,updatedGraph:updated,scriptIds,onProgress:event=>onProgress({...event,changedScripts:scriptIds.length})});
   updated.storage={...sealed.receipt,relativePath};
   pending.set(updated,{file:databaseFile,identity:sealed.identity,base,directory,directoryIdentity,graphFile:path.resolve(graphFile)});
  }
  // Observers run before the last source/DB checks; they cannot change verified
  // bytes in a callback after our final attestation.
  await onProgress({phase:'refresh.sealed',changedScripts:scriptIds.length});
  await verifyGraphFiles(projectDir,updated);assertSourceRefreshFresh(updated,graphFile);
  return updated;
 }catch(error){
  try{
   if(pending.has(updated))await discardSourceRefresh(updated,graphFile);
   else if(directory&&directoryIdentity){const stat=await fs.lstat(assertAssetPath(directory,path.dirname(graphFile)));check(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.dev===directoryIdentity.dev&&stat.ino===directoryIdentity.ino,'Refresh directory changed');await fs.rmdir(directory);}
  }catch{error.refreshCleanupPending=true;}
  throw error;
 }
}
