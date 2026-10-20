import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {safeRelative,MAX_METADATA_BYTES,MAX_PACKAGE_BYTES,assertNoLinks,createPathAccountant} from '../toolchain/manifest.js';
import {ACTIVE_PATH,GENERATIONS_PATH,PYTHON_LIMITATIONS,validGeneration,validatePythonReceipt,validateActivePointer} from './manifest.js';

function noLinks(file){const absolute=path.resolve(file),base=path.parse(absolute).root;let cursor=base;for(const part of absolute.slice(base.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,part);try{if(fs.lstatSync(cursor).isSymbolicLink())throw Error('Python profile contains a link or junction.');}catch(error){if(error.code==='ENOENT')return;throw error;}}}
function readBounded(file,limit){noLinks(file);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>limit)throw Error('Python metadata is not a bounded regular file.');const bytes=fs.readFileSync(file);if(bytes.length>limit)throw Error('Python metadata exceeds limits.');return bytes;}
function generationProfile(root,generation){if(!validGeneration(generation))throw Error('Invalid Python generation.');const folder=path.join(root,GENERATIONS_PATH,generation),bytes=readBounded(path.join(folder,'receipt.json'),MAX_METADATA_BYTES),receipt=validatePythonReceipt(JSON.parse(bytes.toString('utf8')));if(receipt.generation!==generation)throw Error('Receipt belongs to another generation.');return {generation,folder,receipt,python:path.join(folder,'python/python.exe'),site:path.join(folder,'site'),receiptSha256:createHash('sha256').update(bytes).digest('hex')};}
export function inspectManagedPython(root){
 try{const file=path.join(root,ACTIVE_PATH);noLinks(file);try{fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return {state:'absent'};throw error;}
  const pointer=validateActivePointer(JSON.parse(readBounded(file,64*1024).toString('utf8'))),profile=generationProfile(root,pointer.generation);if(pointer.receiptSha256!==profile.receiptSha256)throw Error('Selected receipt hash differs from active pointer.');return {state:'selected',...profile};
 }catch{return {state:'invalid',error:{code:'PYTHON_PROFILE_INVALID',message:'Selected Python runtime metadata is invalid; inspect active.json and its generation receipt.'}};}
}
export async function snapshotPythonGeneration(folder){
 await assertNoLinks(folder);const files=[],seen=new Set(),account=createPathAccountant();let total=0,count=0;
 async function walk(relative){for(const name of (await fsp.readdir(path.join(folder,relative))).sort()){
  const rel=relative?`${relative}/${name}`:name;if(!safeRelative(rel)||seen.has(rel.toLowerCase()))throw Error('Unsafe or colliding Python generation path.');seen.add(rel.toLowerCase());account.claim(rel,192);if(++count>100000)throw Error('Python generation entry limit exceeded.');
  const absolute=path.join(folder,...rel.split('/')),stat=await fsp.lstat(absolute);if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory()))throw Error('Unsupported Python generation file type.');
  if(rel==='receipt.json'){if(!stat.isFile()||stat.size>MAX_METADATA_BYTES)throw Error('Invalid root receipt.');continue;}
  if(stat.isDirectory()){await walk(rel);continue;}total+=stat.size;if(total>MAX_PACKAGE_BYTES)throw Error('Python generation byte limit exceeded.');const hash=createHash('sha256'),handle=await fsp.open(absolute,'r');try{for await(const bytes of handle.createReadStream({autoClose:false}))hash.update(bytes);}finally{await handle.close();}const after=await fsp.lstat(absolute);if(after.isSymbolicLink()||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ino!==stat.ino)throw Error('Python file changed during verification.');files.push({path:rel,size:stat.size,sha256:hash.digest('hex')});
 }}await walk('');return files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export async function verifyPythonGeneration(root,generation){
 try{const profile=generationProfile(root,generation),actual=await snapshotPythonGeneration(profile.folder),expected=new Map(profile.receipt.files.map(f=>[f.path,f])),current=new Map(actual.map(f=>[f.path,f]));const missing=[],tampered=[],extra=[];
  for(const f of expected.values()){const found=current.get(f.path);if(!found)missing.push(f.path);else if(found.size!==f.size||found.sha256!==f.sha256)tampered.push(f.path);}for(const f of actual)if(!expected.has(f.path))extra.push(f.path);
  const ok=!(missing.length||tampered.length||extra.length);return {ok,state:ok?'verified':'changed',profile,missing,tampered,extra,errors:ok?[]:[{code:'PYTHON_FILES_CHANGED',message:'Python generation files differ from receipt.'}],limitations:[...PYTHON_LIMITATIONS]};
 }catch{return {ok:false,state:'invalid',errors:[{code:'PYTHON_PROFILE_INVALID',message:'Cannot safely verify Python generation.'}],limitations:[...PYTHON_LIMITATIONS]};}
}
export async function verifyPythonRuntime(root){const selected=inspectManagedPython(root);if(selected.state==='absent')return {ok:false,state:'absent',errors:[{code:'PYTHON_PROFILE_MISSING',message:'No managed Python runtime selected; legacy MCP remains available.'}],limitations:[...PYTHON_LIMITATIONS]};if(selected.state==='invalid')return {ok:false,state:'invalid',errors:[selected.error],limitations:[...PYTHON_LIMITATIONS]};const report=await verifyPythonGeneration(root,selected.generation),after=inspectManagedPython(root);if(after.state!=='selected'||after.generation!==selected.generation||after.receiptSha256!==selected.receiptSha256||report.profile?.receiptSha256!==selected.receiptSha256)return {ok:false,state:'invalid',errors:[{code:'PYTHON_PROFILE_CHANGED',message:'Python selection changed during verification.'}],limitations:[...PYTHON_LIMITATIONS]};return report;}
