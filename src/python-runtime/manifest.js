import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {exactKeys,safeRelative,MAX_PACKAGE_BYTES,MAX_METADATA_BYTES,createPathAccountant} from '../toolchain/manifest.js';

export const ACTIVE_PATH='runtime/python/active.json';
export const GENERATIONS_PATH='runtime/python/generations';
export const ENTRY_POINT='bridge_mcp_ghidra.cli:main';
export const PYTHON_LIMITATIONS=Object.freeze([
 'Installation executes the explicitly locked Python and pip locally; hashes do not sandbox code.',
 'Only the MCP CLI is managed here; PyGhidra GUI, extensions and global .NET retain their separate installation paths.',
 'A recorded-download hash records bytes and does not authenticate the publisher.',
 'Metadata/import checks do not qualify real Ghidra/plugin compatibility; previous generations are retained.'
]);
export const validGeneration=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const invalid=message=>{throw Object.assign(new Error(message),{code:'PYTHON_LOCK_INVALID'});};
const version=value=>typeof value==='string'&&value.length<=128&&/^\d+(?:\.\d+)*(?:(?:a|b|rc)\d+)?(?:\.post\d+)?(?:\.dev\d+)?(?:\+[a-z0-9]+(?:[.-][a-z0-9]+)*)?$/.test(value);
function source(value,extension){
 if(!exactKeys(value,['url','sha256','size','verification'])||!digest(value.sha256)||!Number.isSafeInteger(value.size)||value.size<1||value.size>MAX_PACKAGE_BYTES||!['publisher-checksum','recorded-download'].includes(value.verification))invalid('Invalid source digest, size or verification.');
 let url,decoded;try{url=new URL(value.url);decoded=decodeURIComponent(url.pathname);}catch{invalid('Invalid source URL.');}
 if(typeof value.url!=='string'||value.url.length>8192||url.protocol!=='https:'||!url.hostname||url.username||url.password||url.search||url.hash||/[?#\x00-\x20\\]/.test(value.url)||/(?:^|\/)(?:latest|current|main|master|HEAD)(?:\/|$)/i.test(decoded)||/\/refs\/heads\//i.test(decoded)||!decoded.toLowerCase().endsWith(`.${extension}`))invalid('Source must be an immutable HTTPS asset without credentials, query or fragment.');
}
export function validatePythonLock(value){
 if(!exactKeys(value,['kind','schemaVersion','platform','python','pip','wheels'])||value.kind!=='retoolkit-python-lock'||value.schemaVersion!==1||value.platform!=='win32-x64')invalid('Invalid Python lock header.');
 if(!exactKeys(value.python,['version','source','archiveRoot'])||!/^3\.12\.\d+$/.test(value.python.version)||!safeRelative(value.python.archiveRoot,{empty:true}))invalid('Python must pin CPython 3.12.patch and a safe archive root.');
 source(value.python.source,'zip');
 if(!Array.isArray(value.wheels)||!value.wheels.length||value.wheels.length>256)invalid('Lock requires one to 256 wheels.');
 const names=new Set(),filenames=new Set();let bytes=value.python.source.size;
 for(const [index,wheel] of [value.pip,...value.wheels].entries()){
  if(!exactKeys(wheel,['name','version','filename','source'])||typeof wheel.name!=='string'||wheel.name.length>128||!/^([a-z0-9]+)(-[a-z0-9]+)*$/.test(wheel.name)||names.has(wheel.name)||!version(wheel.version)||!safeRelative(wheel.filename)||wheel.filename.includes('/')||!wheel.filename.endsWith('.whl')||filenames.has(wheel.filename.toLowerCase())||(index===0?wheel.name!=='pip':wheel.name==='pip'))invalid('Invalid or duplicate pinned wheel.');
  source(wheel.source,'whl');names.add(wheel.name);filenames.add(wheel.filename.toLowerCase());bytes+=wheel.source.size;
 }
 if(!names.has('ghidra-mcp-bridge')||bytes>MAX_PACKAGE_BYTES)invalid('Bridge wheel required; total sources must fit 8 GiB.');
 const copy=JSON.stringify(value);if(Buffer.byteLength(copy)>1024**2)invalid('Python lock exceeds 1 MiB.');return JSON.parse(copy);
}
export async function readPythonLock(file){
 try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024**2)invalid('Lock must be a bounded regular file.');const bytes=await fs.readFile(file);if(bytes.length>1024**2)invalid('Lock exceeds 1 MiB.');return validatePythonLock(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));}
 catch(error){if(error.code==='PYTHON_LOCK_INVALID')throw error;invalid('Cannot read Python lock.');}
}
export function pythonLockFingerprint(lock){
 const l=validatePythonLock(lock),s=x=>({url:x.url,sha256:x.sha256,size:x.size,verification:x.verification}),w=x=>({name:x.name,version:x.version,filename:x.filename,source:s(x.source)});
 return createHash('sha256').update(JSON.stringify({kind:l.kind,schemaVersion:l.schemaVersion,platform:l.platform,python:{version:l.python.version,source:s(l.python.source),archiveRoot:l.python.archiveRoot},pip:w(l.pip),wheels:l.wheels.map(w).sort((a,b)=>a.name.localeCompare(b.name,'en'))})).digest('hex');
}
export function planPythonRuntime(root,lock){const l=validatePythonLock(lock);return {kind:'retoolkit-python-plan',schemaVersion:1,platform:l.platform,lockFingerprint:pythonLockFingerprint(l),...{python:l.python,pip:l.pip,wheels:l.wheels},generationTarget:`${GENERATIONS_PATH}/<UUID>`,activePointer:ACTIVE_PATH,executesLockedCode:true,limitations:[...PYTHON_LIMITATIONS]};}
export function validateActivePointer(value){
 if(!exactKeys(value,['kind','schemaVersion','generation','receiptSha256'])||value.kind!=='retoolkit-python-active'||value.schemaVersion!==1||!validGeneration(value.generation)||!digest(value.receiptSha256))throw Error('Invalid active Python pointer.');return value;
}
export function validatePythonReceipt(value){
 if(!exactKeys(value,['kind','schemaVersion','platform','generation','createdAt','lockFingerprint','python','pip','wheels','probe','files','limitations'])||value.kind!=='retoolkit-python-receipt'||value.schemaVersion!==1||!validGeneration(value.generation)||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||!digest(value.lockFingerprint)||!Array.isArray(value.limitations)||!value.limitations.every(s=>typeof s==='string'&&s.length<=8192))throw Error('Invalid Python receipt header.');
 const lock=validatePythonLock({kind:'retoolkit-python-lock',schemaVersion:1,platform:value.platform,python:value.python,pip:value.pip,wheels:value.wheels});if(pythonLockFingerprint(lock)!==value.lockFingerprint)throw Error('Receipt lock fingerprint differs.');
 const p=value.probe;
 if(!exactKeys(p,['pythonVersion','bits','implementation','distributions','entryPoint'])||p.pythonVersion!==lock.python.version||p.bits!==64||p.implementation!=='cpython'||p.entryPoint!==ENTRY_POINT||!Array.isArray(p.distributions)||p.distributions.length!==lock.wheels.length)throw Error('Invalid Python probe receipt.');
 const expected=new Map(lock.wheels.map(w=>[w.name,w.version])),seen=new Set();
 for(const d of p.distributions){if(!exactKeys(d,['name','version'])||expected.get(d.name)!==d.version||seen.has(d.name))throw Error('Distribution facts differ from lock.');seen.add(d.name);}
 if(!Array.isArray(value.files)||!value.files.length||value.files.length>100000)throw Error('Invalid generation inventory.');
 const paths=new Set(),account=createPathAccountant();let total=0;
 for(const file of value.files){if(!exactKeys(file,['path','size','sha256'])||!safeRelative(file.path)||file.path.toLowerCase()==='receipt.json'||paths.has(file.path.toLowerCase())||!Number.isSafeInteger(file.size)||file.size<0||!digest(file.sha256))throw Error('Invalid generation file.');account.claim(file.path,192);paths.add(file.path.toLowerCase());total+=file.size;}
 if(total>MAX_PACKAGE_BYTES||!value.files.some(f=>f.path==='python/python.exe'&&f.size>0)||Buffer.byteLength(JSON.stringify(value))>MAX_METADATA_BYTES)throw Error('Generation inventory exceeds limits or has no Python.');
 return value;
}
