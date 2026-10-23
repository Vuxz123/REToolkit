import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import yazl from 'yazl';
import {assertNoLinks,safeRelative,snapshotTree,within} from '../toolchain/manifest.js';
import {extractChecked,hashFile,mkdirSafe} from '../toolchain/archive-io.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const MAX_BYTES=128*1024**2,MAX_FILES=10000;

// An explicit local selection only: no package discovery, generated metadata,
// vendor code execution, Unity setup or changes to the source project.
export async function snapshotProjectPackage({sourceRoot,paths,archivePath,provenance={},expectedFiles}={}){
 if(typeof sourceRoot!=='string'||!path.isAbsolute(sourceRoot)||typeof archivePath!=='string'||!path.isAbsolute(archivePath)||path.extname(archivePath).toLowerCase()!=='.zip'||!Array.isArray(paths)||!paths.length||paths.length>64||paths.some(p=>!safeRelative(p)))fail('LIBRARY_SNAPSHOT_INVALID','Expected absolute source/output paths and explicit safe relative selections.');
 sourceRoot=path.resolve(sourceRoot);archivePath=path.resolve(archivePath);
 if(within(sourceRoot,archivePath))fail('LIBRARY_SNAPSHOT_INVALID','Package output must be outside the source project.');
 const selections=[...paths].sort();
 for(let i=0;i<selections.length;i++)for(let j=0;j<i;j++){
  const a=selections[i].toLowerCase(),b=selections[j].toLowerCase();
  if(a===b||a.startsWith(b+'/')||b.startsWith(a+'/'))fail('LIBRARY_SNAPSHOT_INVALID','Selections must be unique and must not overlap.');
 }
 if(!provenance||typeof provenance!=='object'||Array.isArray(provenance)||Buffer.byteLength(JSON.stringify(provenance))>1024**2)fail('LIBRARY_SNAPSHOT_INVALID','Expected bounded JSON provenance.');
 provenance=JSON.parse(JSON.stringify(provenance));
 await assertNoLinks(sourceRoot);
 if(!(await fs.lstat(sourceRoot)).isDirectory())fail('LIBRARY_SNAPSHOT_INVALID','Source root must be a directory.');
 const receiptPath=archivePath+'.provenance.json';
 await mkdirSafe(path.dirname(archivePath));
 for(const file of [archivePath,receiptPath]){
  await assertNoLinks(file);
  try{await fs.lstat(file);fail('EEXIST','Snapshot output already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 async function inventory(){
  const files=[];
  for(const relative of selections){
   const absolute=path.join(sourceRoot,...relative.split('/'));await assertNoLinks(absolute);const stat=await fs.lstat(absolute);
   if(stat.isDirectory())files.push(...(await snapshotTree(absolute)).map(file=>({...file,path:relative+'/'+file.path})));
   else if(stat.isFile()){const hash=await hashFile(absolute);files.push({path:relative,size:hash.size,sha256:hash.sha256});}
   else fail('TOOLCHAIN_PATH_UNSAFE','Only regular files and directories can be selected.');
  }
  files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  if(!files.length||files.length>MAX_FILES||files.reduce((n,f)=>n+f.size,0)>MAX_BYTES)fail('LIBRARY_SNAPSHOT_LIMIT','Selected payload exceeds 10000 files or 128 MiB.');
  const seen=new Set();for(const file of files){const key=file.path.toLowerCase();if(seen.has(key))fail('LIBRARY_SNAPSHOT_INVALID','Selected payload has case-colliding paths.');seen.add(key);}
  return files;
 }
 const files=await inventory();
 if(expectedFiles&&!same(files,expectedFiles))fail('LIBRARY_SOURCE_CHANGED','Source payload differs from its pinned inventory.');
 const temporary=await fs.mkdtemp(path.join(path.dirname(archivePath),'.retk-project-package-'));
 let publishedArchive=false,publishedReceipt=false;
 try{
  const zip=new yazl.ZipFile(),chunks=[];
  const done=new Promise((resolve,reject)=>{zip.outputStream.on('data',chunk=>chunks.push(chunk));zip.outputStream.on('end',resolve);zip.outputStream.on('error',reject);});
  for(const file of files){
   const absolute=path.join(sourceRoot,...file.path.split('/'));await assertNoLinks(absolute);
   const handle=await fs.open(absolute,'r');let bytes;
   try{const stat=await handle.stat();if(!stat.isFile()||stat.size!==file.size)fail('LIBRARY_SOURCE_CHANGED','Selected source file changed.');bytes=await handle.readFile();}finally{await handle.close();}
   if(bytes.length!==file.size||digest(bytes)!==file.sha256)fail('LIBRARY_SOURCE_CHANGED','Source bytes changed while packaging.');
   zip.addBuffer(bytes,file.path,{mtime:new Date('1980-01-01T00:00:00.000Z'),mode:0o100644,compress:true,forceDosTimestamp:true});
  }
  zip.end();await done;
  const staged=path.join(temporary,'payload.zip');await fs.writeFile(staged,Buffer.concat(chunks),{flag:'wx'});
  const unpacked=path.join(temporary,'verified');await extractChecked(staged,unpacked);
  if(!same(await snapshotTree(unpacked),files))fail('LIBRARY_SNAPSHOT_INTEGRITY','Extracted archive differs from selected source bytes.');
  if(!same(await inventory(),files))fail('LIBRARY_SOURCE_CHANGED','Source inventory changed during packaging.');
  const archive=await hashFile(staged);
  const receipt={kind:'retoolkit-project-library-snapshot',schemaVersion:1,sourceRoot,selections,provenance,files,archivePath,receiptPath,archive,verification:{archiveRoundTrip:true,sourceRechecked:true,executedSourceCode:false}};
  const stagedReceipt=path.join(temporary,'provenance.json');await fs.writeFile(stagedReceipt,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  await assertNoLinks(archivePath);await assertNoLinks(receiptPath);
  await fs.link(staged,archivePath);publishedArchive=true;
  await fs.link(stagedReceipt,receiptPath);publishedReceipt=true;
  return receipt;
 }catch(error){
  if(publishedArchive&&!publishedReceipt){await assertNoLinks(archivePath);await fs.unlink(archivePath);}
  throw error;
 }finally{
  await assertNoLinks(temporary);
  if(!within(path.dirname(archivePath),temporary))fail('LIBRARY_SNAPSHOT_INVALID','Temporary path escaped output directory.');
  await fs.rm(temporary,{recursive:true,force:true});
 }
}
