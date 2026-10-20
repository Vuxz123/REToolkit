import fs from 'node:fs/promises';
import path from 'node:path';
import {TARGETS,RECEIPT_PATH,LIMITATIONS,MAX_METADATA_BYTES,exactKeys,safeRelative,validateToolchainLock,assertNoLinks,statOrNull,snapshotTree} from './manifest.js';

function validateReceipt(value){
 if(!exactKeys(value,['kind','schemaVersion','runId','createdAt','platform','lockFingerprint','packages','limitations'])||value.kind!=='retoolkit-toolchain-receipt'||value.schemaVersion!==1||value.platform!=='win32-x64'||typeof value.runId!=='string'||!/^[a-f0-9-]{36}$/.test(value.runId)||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||typeof value.lockFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(value.lockFingerprint)||!Array.isArray(value.packages)||!value.packages.length||value.packages.length>4||!Array.isArray(value.limitations)||!value.limitations.every(s=>typeof s==='string'))throw Error('Invalid receipt header.');
 const ids=new Set();
 for(const item of value.packages){
  if(!exactKeys(item,['id','version','source','target','files','templates'])||!Object.hasOwn(TARGETS,item.id)||ids.has(item.id)||item.target!==TARGETS[item.id]||!Array.isArray(item.files)||item.files.length<1||item.files.length>100002||!Array.isArray(item.templates))throw Error('Invalid receipt package.');
  ids.add(item.id);validateToolchainLock({kind:'retoolkit-toolchain-lock',schemaVersion:1,platform:'win32-x64',packages:[{id:item.id,version:item.version,source:item.source,archiveRoot:''}]});
  const names=new Set();const files=new Map();
  for(const file of item.files){if(!exactKeys(file,['path','size','sha256'])||!safeRelative(file.path)||names.has(file.path.toLowerCase())||!Number.isSafeInteger(file.size)||file.size<0||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid receipt inventory.');names.add(file.path.toLowerCase());files.set(file.path,file);}
  const expected=item.id==='dumper'?['ghidra.py','ghidra_with_struct.py']:[];if(item.templates.length!==expected.length)throw Error('Invalid template receipt.');
  const seen=new Set();for(const template of item.templates){if(!exactKeys(template,['path','sha256'])||!expected.includes(template.path)||seen.has(template.path)||files.get(template.path)?.sha256!==template.sha256)throw Error('Invalid template inventory.');seen.add(template.path);}
 }
 return value;
}
/** Verify the local receipt and exact file inventories without creating locks or
 * modifying receipts, caches, engine directories or project state. */
export async function verifyToolchain(root){
 const result={ok:false,state:'unknown',packages:[],errors:[],limitations:[...LIMITATIONS]};root=path.resolve(root);let receipt;
 try{
  const file=path.join(root,RECEIPT_PATH);await assertNoLinks(file);const stat=await statOrNull(file);
  if(!stat){result.errors.push({code:'TOOLCHAIN_RECEIPT_MISSING',message:'No committed toolchain receipt; installation is unknown.'});return result;}
  if(!stat.isFile()||stat.size>MAX_METADATA_BYTES)throw Error('Receipt must be a bounded regular file.');
  receipt=validateReceipt(JSON.parse(await fs.readFile(file,'utf8')));
 }catch(error){result.state='invalid';result.errors.push({code:'TOOLCHAIN_RECEIPT_INVALID',message:`Cannot verify toolchain receipt: ${error.message}`});return result;}
 result.limitations=[...new Set([...LIMITATIONS,...receipt.limitations])];
 for(const item of receipt.packages){
  const report={id:item.id,version:item.version,target:item.target,state:'matching',matching:[],missing:[],tampered:[],extra:[]};result.packages.push(report);
  try{
   const folder=path.join(root,item.target);await assertNoLinks(folder);const stat=await statOrNull(folder);
   const actual=stat?await snapshotTree(folder):[];const current=new Map(actual.map(file=>[file.path,file]));const expected=new Set(item.files.map(file=>file.path));
   for(const file of item.files){const found=current.get(file.path);if(!found)report.missing.push(file.path);else if(found.size!==file.size||found.sha256!==file.sha256)report.tampered.push(file.path);else report.matching.push(file.path);}
   report.extra=actual.filter(file=>!expected.has(file.path)).map(file=>file.path);
   if(report.missing.length||report.tampered.length||report.extra.length){report.state='changed';result.errors.push({code:'TOOLCHAIN_FILES_CHANGED',id:item.id,message:`Installed ${item.id} file inventory differs from its receipt.`});}
  }catch(error){report.state='invalid';result.errors.push({code:'TOOLCHAIN_PATH_UNSAFE',id:item.id,message:`Cannot safely inspect ${item.id}: ${error.message}`});}
 }
 result.ok=result.errors.length===0;result.state=result.ok?'verified':'changed';return result;
}
