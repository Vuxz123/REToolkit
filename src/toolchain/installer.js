import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSafe,durableWrite,hashFile,matches,cachedArchive,privateArchive,extractChecked} from './archive-io.js';
import {withToolchainWrite,assertToolchainIdle} from './lease.js';
import {validateToolchainLock,planToolchain,TARGETS,RECEIPT_PATH,LIMITATIONS,MAX_METADATA_BYTES,JOURNAL_RESERVE_BYTES,encodeToolchainMetadata,toolchainError,assertNoLinks,statOrNull,snapshotTree,within} from './manifest.js';

const fail=(code,message,cause)=>{throw toolchainError(code,message,cause);};
async function readSmall(file){const stat=await fs.lstat(file);if(!stat.isFile()||stat.size<1||stat.size>1024**2)throw Error('Missing or oversized version metadata.');return fs.readFile(file,'utf8');}
async function validateLayout(item,stage){
 try{
  const nonempty=async relative=>{const stat=await fs.lstat(path.join(stage,...relative.split('/')));if(!stat.isFile()||stat.size<1)throw Error(`Required nonempty file missing: ${relative}`);};
  let version;
  if(item.id==='jdk'){
   await nonempty('bin/java.exe');const text=await readSmall(path.join(stage,'release'));version=/^JAVA_VERSION="([^"]+)"\s*$/m.exec(text)?.[1];
   if(!version||!/^21(?:\.|$)/.test(version)||version!==item.version.replace(/^v/,''))throw Error('JDK release JAVA_VERSION must match locked JDK 21 version.');
  }else if(item.id==='ghidra'){
   await nonempty('ghidraRun.bat');await nonempty('support/analyzeHeadless.bat');const text=await readSmall(path.join(stage,'Ghidra/application.properties'));version=/^application\.version\s*=\s*(\S+)\s*$/m.exec(text)?.[1];if(version!==item.version.replace(/^v/,''))throw Error('Ghidra application.version does not match lock.');
  }else if(item.id==='dumper'){await nonempty('Il2CppDumper.exe');await nonempty('config.json');}
  else{const a=await statOrNull(path.join(stage,'AssetRipper.exe'));const b=await statOrNull(path.join(stage,'AssetRipper.GUI.Free.exe'));if(!a&&!b)throw Error('Required AssetRipper executable missing.');await nonempty(a?'AssetRipper.exe':'AssetRipper.GUI.Free.exe');}
  return version??null;
 }catch(error){fail('TOOLCHAIN_LAYOUT_INVALID',`Invalid ${item.id} layout: ${error.message}`,error);}
}
async function applyTemplates(stage){
 const templates=[];for(const name of ['ghidra.py','ghidra_with_struct.py']){const source=fileURLToPath(new URL(`../../templates/Il2CppDumper/${name}`,import.meta.url));await assertNoLinks(source);const bytes=await fs.readFile(source);if(bytes.length===0)fail('TOOLCHAIN_LAYOUT_INVALID','Repository dumper template is empty.');const target=path.join(stage,name);await assertNoLinks(target);const existing=await statOrNull(target);if(existing&&!existing.isFile())fail('TOOLCHAIN_LAYOUT_INVALID','Dumper template path is not a regular file.');await durableWrite(target,bytes);templates.push({path:name,sha256:createHash('sha256').update(bytes).digest('hex')});}return templates;
}
async function applyCompatibility(item,stage){
 const patches=[];
 if(item.id==='dumper'){
  const file=path.join(stage,'config.json');const stat=await fs.lstat(file);
  if(!stat.isFile()||stat.size<1||stat.size>1024**2)fail('TOOLCHAIN_LAYOUT_INVALID','Il2CppDumper config must be a regular JSON file of at most 1 MiB.');
  const before=await fs.readFile(file);let value;
  try{value=JSON.parse(before.toString('utf8').replace(/^\uFEFF/,''));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();}
  catch(error){fail('TOOLCHAIN_LAYOUT_INVALID','Il2CppDumper config must contain a JSON object.',error);}
  const bytes=Buffer.from(JSON.stringify({...value,RequireAnyKey:false,GenerateScript:true},null,2)+'\n');await durableWrite(file,bytes);
  patches.push({path:'config.json',operation:'normalize-dumper-config',beforeSha256:createHash('sha256').update(before).digest('hex'),sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 if(item.id==='assetripper'&&!await statOrNull(path.join(stage,'AssetRipper.exe'))){
  const source=path.join(stage,'AssetRipper.GUI.Free.exe');const target=path.join(stage,'AssetRipper.exe');await assertNoLinks(source);await assertNoLinks(target);await fs.copyFile(source,target,fs.constants.COPYFILE_EXCL);const identity=await hashFile(target);patches.push({path:'AssetRipper.exe',operation:'alias-assetripper-executable',source:'AssetRipper.GUI.Free.exe',sha256:identity.sha256});
 }
 if(item.id==='assetripper'){
  const file=path.join(stage,'.retk-version');await assertNoLinks(file);const previous=await statOrNull(file);
  if(previous&&(!previous.isFile()||previous.size>1024))fail('TOOLCHAIN_LAYOUT_INVALID','AssetRipper version marker is invalid');
  const before=previous?await hashFile(file):null,bytes=Buffer.from(item.version.replace(/^v/,'')+'\n');await durableWrite(file,bytes);
  patches.push({path:'.retk-version',operation:'record-declared-assetripper-version',beforeSha256:before?.sha256??null,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 return patches;
}
async function assertNoUnfinished(root){
 const folder=path.join(root,'.cache/toolchain/transactions');await assertNoLinks(folder);if(!await statOrNull(folder))return;
 for(const name of await fs.readdir(folder)){const tx=path.join(folder,name);await assertNoLinks(tx);const journalFile=path.join(tx,'journal.json');try{await assertNoLinks(journalFile);const stat=await fs.lstat(journalFile);if(!stat.isFile()||stat.size>MAX_METADATA_BYTES)throw Error();const journal=JSON.parse(await fs.readFile(journalFile,'utf8'));if(!['committed','rolled-back'].includes(journal.state))throw Error();}catch(error){if(error.code==='TOOLCHAIN_PATH_UNSAFE')throw error;fail('TOOLCHAIN_RECOVERY_REQUIRED','An unfinished or unverifiable toolchain journal requires inspection.');}}
}
async function existingFacts(item,target,previousReceipt){const stat=await statOrNull(target);if(!stat)return {exists:false};if(!stat.isDirectory())fail('TOOLCHAIN_PATH_UNSAFE',`Existing tool target is not a directory: ${TARGETS[item.id]}`);const previous=previousReceipt?.packages?.find(p=>p.id===item.id&&p.target===TARGETS[item.id]);return {exists:true,version:previous?.version??null,source:previous?.source??null,files:await snapshotTree(target)};}

export async function installToolchain(root,lock,{cache,fetchImpl=fetch,inspectProcesses,onEvent=()=>{},downloadPolicy={},onProgress}={}){
 const plan=planToolchain(root,validateToolchainLock(lock));root=path.resolve(root);await assertNoLinks(root);
 cache=path.resolve(cache??path.join(root,'.cache/toolchain/packages'));
 const forbidden=[...Object.values(TARGETS),'workspaces','.cache/toolchain/transactions','.cache/toolchain/writer','.cache/toolchain/readers'];
 if(forbidden.some(relative=>within(path.join(root,relative),cache)))fail('TOOLCHAIN_PATH_UNSAFE','Package cache must be outside managed engine trees, workspaces and transaction/lease directories.');
 return withToolchainWrite(root,async()=>{
  await assertNoUnfinished(root);const runId=randomUUID();const txRelative=`.cache/toolchain/transactions/${runId}`;const tx=path.join(root,txRelative);await mkdirSafe(tx);
  const receiptFile=path.join(root,RECEIPT_PATH);await assertNoLinks(receiptFile);const receiptStat=await statOrNull(receiptFile);if(receiptStat&&!receiptStat.isFile())fail('TOOLCHAIN_PATH_UNSAFE','Existing receipt is not a regular file.');if(receiptStat?.size>MAX_METADATA_BYTES)fail('TOOLCHAIN_METADATA_LIMIT','Existing receipt exceeds its byte budget.');const previousBytes=receiptStat?await fs.readFile(receiptFile):null;let previousReceipt;try{previousReceipt=previousBytes?JSON.parse(previousBytes):null;}catch{previousReceipt=null;}
  const journal={kind:'retoolkit-toolchain-journal',schemaVersion:1,runId,state:'staging',createdAt:new Date().toISOString(),lockFingerprint:plan.lockFingerprint,previousReceipt:previousBytes?`${txRelative}/previous-receipt.json`:null,packages:[]};
  const journalFile=path.join(tx,'journal.json');
  const persist=()=>durableWrite(journalFile,encodeToolchainMetadata(journal,{reserveBytes:['staging','publishing'].includes(journal.state)?JOURNAL_RESERVE_BYTES:0}));
  const event=async(phase,id)=>onEvent({phase,runId,...(id?{id}:{}),journal:structuredClone(journal)});
  let receiptPublished=false,movesStarted=false;
  try{
   if(previousBytes)await durableWrite(path.join(tx,'previous-receipt.json'),previousBytes);
   for(const item of plan.packages){const target=path.join(root,item.target);await assertNoLinks(target);journal.packages.push({id:item.id,target:item.target,sourceArchive:`${txRelative}/sources/${item.id}.zip`,stage:`${txRelative}/unpacked/${item.id}${item.archiveRoot?'/'+item.archiveRoot:''}`,backup:`${txRelative}/backup/${item.id}`,before:await existingFacts(item,target,previousReceipt),after:{version:item.version,source:item.source},backedUp:false,published:false});}
   await persist();await event('journal');
   const packages=[];
   for(const item of plan.packages){
    const record=journal.packages.find(p=>p.id===item.id);
    const cached=await cachedArchive(item.source,cache,fetchImpl,{...downloadPolicy,onProgress});
    await event('before-source-copy',item.id);
    const archive=await privateArchive(cached,path.join(root,record.sourceArchive),item.source);
    const unpacked=path.join(tx,'unpacked',item.id);await event('before-extract',item.id);await extractChecked(archive,unpacked);
    const stage=path.join(unpacked,...(item.archiveRoot?item.archiveRoot.split('/'):[]));await assertNoLinks(stage);await validateLayout(item,stage);
    const templates=item.id==='dumper'?await applyTemplates(stage):[];const patches=await applyCompatibility(item,stage);const files=await snapshotTree(stage);
    packages.push({id:item.id,version:item.version,source:item.source,target:item.target,files,templates});record.after.files=files;record.after.patches=patches;await persist();await event('staged',item.id);
   }
   const receipt={kind:'retoolkit-toolchain-receipt',schemaVersion:1,runId,createdAt:new Date().toISOString(),platform:plan.platform,lockFingerprint:plan.lockFingerprint,packages,limitations:[...LIMITATIONS]};
   const receiptText=encodeToolchainMetadata(receipt);
   for(const item of journal.packages){if(!await matches(path.join(root,item.sourceArchive),item.after.source))fail('TOOLCHAIN_INTEGRITY','Transaction archive changed during extraction.');}
   await assertToolchainIdle(root,{inspectProcesses});journal.state='publishing';await persist();
   for(const item of journal.packages){const target=path.join(root,item.target);const stage=path.join(root,item.stage);const backup=path.join(root,item.backup);await assertNoLinks(target);await assertNoLinks(stage);
    if(item.before.exists){await event('before-backup',item.id);await mkdirSafe(path.dirname(backup));movesStarted=true;await fs.rename(target,backup);item.backedUp=true;await persist();await event('backed-up',item.id);}
    await event('before-publish',item.id);await mkdirSafe(path.dirname(target));movesStarted=true;await fs.rename(stage,target);item.published=true;await persist();await event('published',item.id);
   }
   // Re-read actual installed files after publication, rather than assuming that
   // the staged inventory survived rename and observer callbacks unchanged.
   await event('before-receipt');
   for(const item of packages){const actual=await snapshotTree(path.join(root,item.target));if(JSON.stringify(actual)!==JSON.stringify(item.files))fail('TOOLCHAIN_INTEGRITY','Installed tree changed during publication.');}
   await durableWrite(receiptFile,receiptText);receiptPublished=true;journal.state='committed';await persist();await event('committed');return receipt;
  }catch(error){
   try{
    // Before any rename, oversize inventories can be discarded safely. Keep a
    // compact failure journal rather than stranding a gate for a known no-op.
    if(!movesStarted){for(const item of journal.packages){delete item.before?.files;delete item.after?.files;}}
    journal.state='rolling-back';await persist();await event('before-rollback');
    for(const item of [...journal.packages].reverse()){
     const target=path.join(root,item.target),backup=path.join(root,item.backup);await assertNoLinks(target);await assertNoLinks(backup);
     if(item.published){const failed=path.join(tx,'failed',item.id);await mkdirSafe(path.dirname(failed));await fs.rename(target,failed);item.published=false;await persist();}
     if(item.backedUp){if(await statOrNull(target))throw Error('Rollback target is occupied.');await fs.rename(backup,target);item.backedUp=false;await persist();}
    }
    if(receiptPublished){if(previousBytes)await durableWrite(receiptFile,previousBytes);else{await assertNoLinks(receiptFile);await fs.unlink(receiptFile);}}
    journal.state='rolled-back';journal.failure={code:String(error.code??'TOOLCHAIN_INSTALL_FAILED').slice(0,128),message:String(error.message).slice(0,4096)};await persist();
   }catch(rollbackError){journal.state='recovery-required';journal.failure={code:String(error.code??'TOOLCHAIN_INSTALL_FAILED').slice(0,128),message:String(error.message).slice(0,4096)};journal.rollbackFailure=String(rollbackError.message).slice(0,4096);await persist().catch(()=>{});fail('TOOLCHAIN_RECOVERY_REQUIRED','Toolchain rollback is uncertain; retained journal, backup and writer gate require inspection.',rollbackError);}
   if(typeof error.code==='string'&&error.code.startsWith('TOOLCHAIN_'))throw error;fail('TOOLCHAIN_INSTALL_FAILED',`Toolchain installation failed: ${error.message}`,error);
  }
 },{inspectProcesses});
}
