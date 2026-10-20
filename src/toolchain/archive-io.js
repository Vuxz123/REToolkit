import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {crc32} from 'node:zlib';
import yauzl from 'yauzl';
import {MAX_PACKAGE_BYTES,createPathAccountant,safeRelative,toolchainError,assertNoLinks,statOrNull,within} from './manifest.js';

const fail=(code,message,cause)=>{throw toolchainError(code,message,cause);};
export async function mkdirSafe(folder){await assertNoLinks(folder);await fs.mkdir(folder,{recursive:true});await assertNoLinks(folder);}
export async function durableWrite(file,bytes){await assertNoLinks(file);const temporary=path.join(path.dirname(file),`.retk-${randomUUID()}.tmp`);const handle=await fs.open(temporary,'wx');try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}await fs.rename(temporary,file);}
export async function hashFile(file){await assertNoLinks(file);const stat=await fs.lstat(file);if(!stat.isFile())fail('TOOLCHAIN_PATH_UNSAFE','Archive cache entry must be a regular file.');const hash=createHash('sha256');const handle=await fs.open(file,'r');try{for await(const chunk of handle.createReadStream({autoClose:false}))hash.update(chunk);}finally{await handle.close();}return {sha256:hash.digest('hex'),size:stat.size};}
export async function matches(file,source){if(!await statOrNull(file))return false;const actual=await hashFile(file);return actual.sha256===source.sha256&&actual.size===source.size;}
async function fetchArchive(source,file,fetchImpl){
 let url=source.url,response;
 try{
  for(let redirects=0;;redirects++){
   response=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(120000)});
   if([301,302,303,307,308].includes(response.status)){
    if(redirects>=5)fail('TOOLCHAIN_DOWNLOAD_FAILED','Too many archive download redirects.');
    const next=new URL(response.headers.get('location'),url);if(next.protocol!=='https:'||next.username||next.password)fail('TOOLCHAIN_DOWNLOAD_FAILED','Unsafe archive download redirect.');
    await response.body?.cancel();url=next.href;continue;
   }
   break;
  }
  if(!response.ok||!response.body)fail('TOOLCHAIN_DOWNLOAD_FAILED',`Archive download failed (HTTP ${response.status}).`);
  let size=0;const hash=createHash('sha256');
  const limit=new Transform({transform(chunk,encoding,callback){size+=chunk.length;if(size>source.size||size>MAX_PACKAGE_BYTES){callback(toolchainError('TOOLCHAIN_INTEGRITY','Downloaded archive exceeds locked size.'));return;}hash.update(chunk);callback(null,chunk);}});
  await pipeline(Readable.fromWeb(response.body),limit,createWriteStream(file,{flags:'wx'}));
  if(size!==source.size||hash.digest('hex')!==source.sha256)fail('TOOLCHAIN_INTEGRITY','Downloaded archive checksum or size does not match lock.');
 }catch(error){if(typeof error.code==='string'&&error.code.startsWith('TOOLCHAIN_'))throw error;fail('TOOLCHAIN_DOWNLOAD_FAILED','Archive download failed.',error);}
}
export async function cachedArchive(source,cache,fetchImpl){
 await mkdirSafe(cache);const file=path.join(cache,`${source.sha256}.zip`);await assertNoLinks(file);
 if(await matches(file,source))return file;
 const temporary=path.join(cache,`.retk-download-${randomUUID()}.tmp`);
 try{await fetchArchive(source,temporary,fetchImpl);await assertNoLinks(file);await fs.rename(temporary,file);return file;}
 finally{await assertNoLinks(temporary);await fs.rm(temporary,{force:true});}
}
export async function privateArchive(cacheFile,destination,source){
 await assertNoLinks(cacheFile);await mkdirSafe(path.dirname(destination));await assertNoLinks(destination);
 const handle=await fs.open(cacheFile,'r');
 try{
  const stat=await handle.stat();
  if(!stat.isFile()||stat.size!==source.size)fail('TOOLCHAIN_INTEGRITY','Cached archive size changed before transaction snapshot.');
  let size=0;const hash=createHash('sha256');
  const verify=new Transform({
   transform(chunk,encoding,callback){size+=chunk.length;if(size>source.size){callback(toolchainError('TOOLCHAIN_INTEGRITY','Cached archive exceeds locked size.'));return;}hash.update(chunk);callback(null,chunk);},
   flush(callback){callback(size===source.size&&hash.digest('hex')===source.sha256?null:toolchainError('TOOLCHAIN_INTEGRITY','Cached archive changed before transaction snapshot.'));}
  });
  // Hash exactly the stream written to a unique transaction-owned file. The
  // shared cache pathname is never opened by ZIP extraction.
  await pipeline(handle.createReadStream({autoClose:false}),verify,createWriteStream(destination,{flags:'wx'}));
 }finally{await handle.close();}
 return destination;
}
function openZip(file){return new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,autoClose:true,validateEntrySizes:true,strictFileNames:true},(e,z)=>e?reject(e):resolve(z)));}
export async function extractChecked(file,destination,{budget={entries:0,total:0},validateEntry}={}){
 await mkdirSafe(destination);let archive;
 try{
  archive=await openZip(file);const identities=new Map();const pathBudget=budget.pathBudget??(budget.pathBudget=createPathAccountant());
  const storeIdentity=(key,node)=>{
   if(!identities.has(key)){
    // Both the Windows identity and original spelling remain in memory. Include
    // node bookkeeping before retaining either full implicit ancestor prefix.
    pathBudget.claim(key,128);pathBudget.claim(node.spelling);
   }
   identities.set(key,node);
  };
  await new Promise((resolve,reject)=>{
   let settled=false;const failZip=error=>{if(settled)return;settled=true;archive.close();reject(error);};
   archive.on('error',failZip);archive.on('end',()=>{settled=true;resolve();});
   archive.on('entry',entry=>{
    (async()=>{
     if(++budget.entries>100000)throw Error('ZIP entry count exceeds 100000.');
     // Explicit ZIP entry names and their per-entry bookkeeping count even when
     // the directory was already represented by an implicit ancestor node.
     pathBudget.claim(entry.fileName,64);
     const type=(entry.externalFileAttributes>>>16)&0o170000;
     if(![0,0o100000,0o040000].includes(type))throw Error('Unsupported ZIP entry type; links are forbidden.');
     const directory=entry.fileName.endsWith('/');const relative=directory?entry.fileName.slice(0,-1):entry.fileName;
     if(!safeRelative(relative)||(type===0o040000&&!directory)||(type===0o100000&&directory))throw Error('Unsafe ZIP path or inconsistent entry type.');
     const parts=relative.split('/');const key=relative.toLowerCase();
     let prefix='';for(let i=0;i<parts.length-1;i++){
      prefix=prefix?`${prefix}/${parts[i]}`:parts[i];const parent=prefix.toLowerCase();const node=identities.get(parent);
      if(node&&(node.type!=='directory'||node.spelling!==prefix))throw Error('ZIP ancestor case or file/directory collision.');
      if(!node)storeIdentity(parent,{type:'directory',spelling:prefix,explicit:false});
     }
     const existing=identities.get(key);
     if(existing&&(!directory||existing.type!=='directory'||existing.spelling!==relative||existing.explicit))throw Error('ZIP duplicate or case-colliding path.');
     storeIdentity(key,{type:directory?'directory':'file',spelling:relative,explicit:true});
     if(!Number.isSafeInteger(entry.uncompressedSize)||entry.uncompressedSize<0||(budget.total+=entry.uncompressedSize)>MAX_PACKAGE_BYTES)throw Error('ZIP declared uncompressed size exceeds limit.');
     if(validateEntry)await validateEntry({path:relative,directory,size:entry.uncompressedSize});
     const target=path.join(destination,...parts);if(!within(destination,target))throw Error('ZIP path escapes stage.');
     if(directory){if(entry.uncompressedSize!==0||entry.crc32!==0)throw Error('ZIP directory has content.');await mkdirSafe(target);return;}
     await mkdirSafe(path.dirname(target));const input=await new Promise((res,rej)=>archive.openReadStream(entry,(e,s)=>e?rej(e):res(s)));
     let size=0,checksum=0;const check=new Transform({transform(chunk,encoding,cb){size+=chunk.length;if(size>entry.uncompressedSize){cb(Error('ZIP actual size exceeds declared size.'));return;}checksum=crc32(chunk,checksum);cb(null,chunk);},flush(cb){cb(size===entry.uncompressedSize&&checksum===entry.crc32?null:Error('ZIP CRC or declared size mismatch.'));}});
     await pipeline(input,check,createWriteStream(target,{flags:'wx'}));
    })().then(()=>{if(!settled)archive.readEntry();},failZip);
   });archive.readEntry();
  });
 }catch(error){archive?.close();fail('TOOLCHAIN_ARCHIVE_INVALID',`Archive validation failed: ${error.message}`,error);}
}
