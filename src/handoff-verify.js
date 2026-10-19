import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';

export const MAX_MANIFEST = 32 * 1024 * 1024;
export const MAX_FILES = 100000;
const classifications = new Set(['metadata','pseudocode','references','observations','notes','reconstructed','assets','binary']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const size = value => Number.isSafeInteger(value) && value >= 0;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function requireThat(condition,message) { if(!condition) throw new Error(message); }
function keys(value, allowed) {requireThat(object(value) && Object.keys(value).every(key=>allowed.includes(key)), 'Invalid handoff schema fields');}

export function safePath(value) {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= 32768 && !value.includes('\\'),'Unsafe inventory path');
  const parts=value.split('/');
  requireThat(parts.length<=64,'Inventory path exceeds 64-component nesting limit');
  requireThat(parts.every(part=>part && part!=='.' && part!=='..' && !/[<>:"|?*\x00-\x1f\x7f]/.test(part) && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)),'Unsafe inventory path');
  return value;
}
export async function rejectLinks(file) {
  let current=path.resolve(file);
  for(;;) {
    const stat=await fs.lstat(current);
    requireThat(!stat.isSymbolicLink(),'Symbolic links and junctions are forbidden');
    const parent=path.dirname(current);if(parent===current)break;current=parent;
  }
}
export function validateManifest(manifest) {
  keys(manifest,['kind','schemaVersion','name','runId','createdAt','build','steps','tools','files','artifacts','limitations']);
  requireThat(manifest.kind==='retoolkit-handoff' && manifest.schemaVersion===1,'Unsupported handoff kind/schemaVersion');
  requireThat(typeof manifest.name==='string' && typeof manifest.runId==='string' && typeof manifest.createdAt==='string' && Number.isFinite(Date.parse(manifest.createdAt)),'Invalid handoff identity');
  keys(manifest.build,['native','metadata']);
  for(const type of ['native','metadata']) {
    const identity=manifest.build[type];if(identity===null)continue;
    keys(identity,type==='native'?['size','sha256','abi']:['size','sha256']);
    requireThat(size(identity.size)&&digest(identity.sha256)&&(type!=='native'||typeof identity.abi==='string'),'Invalid build identity');
  }
  requireThat(object(manifest.steps)&&object(manifest.tools)&&Array.isArray(manifest.artifacts)&&Array.isArray(manifest.limitations)&&manifest.limitations.every(x=>typeof x==='string'),'Invalid handoff facts');
  for(const step of Object.values(manifest.steps)) {
    keys(step,['state','fingerprint','runId','completedAt']);
    requireThat(['pending','running','succeeded','failed','awaiting-user','stale','unknown'].includes(step.state)&&(step.fingerprint===null||digest(step.fingerprint))&&(step.runId===null||typeof step.runId==='string')&&(step.completedAt===null||typeof step.completedAt==='string'),'Invalid step facts');
  }
  for(const tool of Object.values(manifest.tools)) {
    keys(tool,['version','sha256']);requireThat(typeof tool.version==='string'&&(tool.sha256===null||digest(tool.sha256)),'Invalid tool facts');
  }
  requireThat(Array.isArray(manifest.files)&&manifest.files.length<=MAX_FILES,'Invalid or excessive file inventory');
  const inventory=new Map();const folded=new Set(['manifest.json']);
  for(const file of manifest.files) {
    keys(file,['path','size','sha256','classification']);safePath(file.path);
    requireThat(size(file.size)&&digest(file.sha256)&&classifications.has(file.classification),'Invalid inventory file schema');
    requireThat(!folded.has(file.path.toLowerCase()),'Duplicate case-folded inventory path');
    folded.add(file.path.toLowerCase());inventory.set(file.path,file);
  }
  for(const file of manifest.files) {
    const parts=file.path.split('/');parts.pop();while(parts.length){requireThat(!folded.has(parts.join('/').toLowerCase()),'Inventory file/directory path conflict');parts.pop();}
  }
  for(const artifact of manifest.artifacts) {
    keys(artifact,['name','state','paths']);requireThat(typeof artifact.name==='string'&&['valid','stale','missing','unknown','excluded'].includes(artifact.state)&&Array.isArray(artifact.paths)&&artifact.paths.every(p=>inventory.has(p)),'Invalid artifact facts');
  }
  return inventory;
}
async function consume(stream, expectedSize, expectedHash, expectedCrc, collect=false) {
  const hash=createHash('sha256');let count=0,crc=0;const chunks=[];
  try {
    for await(const chunk of stream) {
      count+=chunk.length;requireThat(count<=expectedSize,'File size exceeds declared size');hash.update(chunk);
      if(expectedCrc!==undefined)crc=crc32(chunk,crc);
      if(collect)chunks.push(chunk);
    }
  } finally {stream.destroy();}
  requireThat(count===expectedSize,'File size does not match declared size');
  const actual=hash.digest('hex');requireThat(!expectedHash||actual===expectedHash,'File SHA256 hash mismatch');
  requireThat(expectedCrc===undefined||crc===expectedCrc,'ZIP CRC mismatch');
  return collect?Buffer.concat(chunks,count):actual;
}
async function folderFiles(root) {
  const files=new Map(),names=new Set(),directories=new Set();let count=0;
  const walk=async(relative='')=>{
    for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})) {
      const rel=relative?`${relative}/${entry.name}`:entry.name;safePath(rel);
      requireThat(++count<=MAX_FILES*2+1,'Excessive bundle entries');requireThat(!names.has(rel.toLowerCase()),'Duplicate case-folded bundle path');names.add(rel.toLowerCase());
      const item=await fs.lstat(path.join(root,rel));requireThat(!item.isSymbolicLink(),'Symbolic links and junctions are forbidden');
      if(item.isDirectory()){directories.add(rel);await walk(rel);}
      else {requireThat(item.isFile(),'Unsupported bundle file type');files.set(rel,item);requireThat(files.size<=MAX_FILES+1,'Excessive bundle files');}
    }
  };await walk();return {files,directories};
}
function parseManifest(bytes) {requireThat(bytes.length<=MAX_MANIFEST,'Manifest exceeds 32MiB limit');return JSON.parse(bytes.toString('utf8'));}
async function folderBundle(root,selected,expectedManifest) {
  await rejectLinks(root);const {files,directories}=await folderFiles(root);const entry=files.get('manifest.json');requireThat(entry&&entry.size<=MAX_MANIFEST,'Missing or oversized manifest');
  const raw=await consume(createReadStream(path.join(root,'manifest.json')),entry.size,expectedManifest,undefined,true);
  const manifest=parseManifest(raw),inventory=validateManifest(manifest);
  requireThat(files.size===inventory.size+1&&[...files.keys()].every(p=>p==='manifest.json'||inventory.has(p)),'Bundle has extra or missing inventory files');
  const allowedDirs=new Set();for(const relative of inventory.keys()){const parts=relative.split('/');parts.pop();while(parts.length){allowedDirs.add(parts.join('/'));parts.pop();}}
  requireThat([...directories].every(p=>allowedDirs.has(p)),'Bundle has undeclared directories');
  if(selected!==undefined)requireThat(inventory.has(selected),'Requested file is not in verified inventory');
  let result;
  for(const [relative,file] of inventory) {
    requireThat(files.has(relative),'Missing inventory file');
    if(selected!==undefined&&selected!==relative)continue;
    result=await consume(createReadStream(path.join(root,relative)),file.size,file.sha256,undefined,selected!==undefined);
  }
  return {manifest,manifestHash:createHash('sha256').update(raw).digest('hex'),bytes:selected===undefined?undefined:result};
}
function openZip(file) {return new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,autoClose:false,validateEntrySizes:true,strictFileNames:true},(error,zip)=>error?reject(error):resolve(zip)));}
function zipEntries(zip) {
  return new Promise((resolve,reject)=>{
    const entries=new Map(),folded=new Set();
    const fail=error=>{zip.close();reject(error);};zip.on('error',fail);
    zip.on('entry',entry=>{
      try {
        requireThat(entries.size<=MAX_FILES*2,'Excessive ZIP entries');
        const directory=entry.fileName.endsWith('/');safePath(directory?entry.fileName.slice(0,-1):entry.fileName);
        const key=(directory?entry.fileName.slice(0,-1):entry.fileName).toLowerCase();requireThat(!folded.has(key),'Duplicate case-folded ZIP entry');folded.add(key);
        const type=(entry.externalFileAttributes>>>16)&0o170000;
        requireThat(type===0||type===(directory?0o040000:0o100000),'ZIP symbolic link or unsupported entry type');
        requireThat(!(entry.generalPurposeBitFlag&1),'Encrypted ZIP is unsupported');
        requireThat(!directory||entry.uncompressedSize===0,'ZIP directory has content');entries.set(entry.fileName,entry);zip.readEntry();
      } catch(error){fail(error);}
    });zip.on('end',()=>resolve(entries));zip.readEntry();
  });
}
function zipStream(zip,entry) {return new Promise((resolve,reject)=>zip.openReadStream(entry,(error,stream)=>error?reject(error):resolve(stream)));}
async function zipBundle(file,selected,expectedManifest) {
  const zip=await openZip(file);
  try {
    const entries=await zipEntries(zip);const entry=entries.get('manifest.json');requireThat(entry&&entry.uncompressedSize<=MAX_MANIFEST,'Missing or oversized ZIP manifest');
    const raw=await consume(await zipStream(zip,entry),entry.uncompressedSize,expectedManifest,entry.crc32,true);
    const manifest=parseManifest(raw),inventory=validateManifest(manifest);const dirs=new Set();
    for(const relative of inventory.keys()){const parts=relative.split('/');parts.pop();while(parts.length){dirs.add(parts.join('/')+'/');parts.pop();}}
    requireThat([...entries.keys()].every(p=>p==='manifest.json'||inventory.has(p)||dirs.has(p)),'ZIP has extra undeclared entries');
    requireThat([...inventory.keys()].every(p=>entries.has(p)),'ZIP missing inventory file');
    if(selected!==undefined)requireThat(inventory.has(selected),'Requested file is not in verified inventory');
    let result;
    for(const [relative,item] of inventory) {
      const actual=entries.get(relative);requireThat(actual.uncompressedSize===item.size,'ZIP declared size mismatch');
      if(selected!==undefined&&selected!==relative)continue;
      result=await consume(await zipStream(zip,actual),item.size,item.sha256,actual.crc32,selected!==undefined);
    }
    return {manifest,manifestHash:createHash('sha256').update(raw).digest('hex'),bytes:selected===undefined?undefined:result};
  } finally {zip.close();}
}
export async function inspectBundle(file,selected,expectedManifest) {
  const absolute=path.resolve(file);await rejectLinks(absolute);const stat=await fs.lstat(absolute);
  requireThat(stat.isDirectory()||stat.isFile(),'Bundle must be a folder or ZIP');
  return stat.isDirectory()?folderBundle(absolute,selected,expectedManifest):zipBundle(absolute,selected,expectedManifest);
}
export async function verifyHandoff(file) {
  try {const {manifest}=await inspectBundle(file);return {ok:true,manifest,errors:[]};}
  catch(error){return {ok:false,manifest:null,errors:[error.message]};}
}
export async function readHandoff(file) {
  const absolute=path.resolve(file);const {manifest,manifestHash}=await inspectBundle(absolute);
  const inventory=new Set(manifest.files.map(item=>item.path));
  return {manifest:structuredClone(manifest),async readFile(relative){safePath(relative);requireThat(inventory.has(relative),'Requested file is not in verified inventory');return (await inspectBundle(absolute,relative,manifestHash)).bytes;}};
}
