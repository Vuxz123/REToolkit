import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const MAX_PACKAGE_BYTES = 8 * 1024 ** 3;
export const MAX_METADATA_BYTES = 128 * 1024 ** 2;
export const JOURNAL_RESERVE_BYTES = 64 * 1024;
export const TARGETS = Object.freeze({jdk:'runtime/java/jdk-21',ghidra:'tools/ghidra',dumper:'tools/Il2CppDumper',assetripper:'tools/AssetRipper'});
export const RECEIPT_PATH = '.cache/toolchain/receipt.json';
export const LIMITATIONS = Object.freeze([
  'Archive bytes, layout and installed file inventory verified; downloaded code was not executed. Engine acceptance remains unqualified.',
  'Python, MCP wheel/virtualenv, global .NET and user Ghidra extensions are outside this locked archive installation.',
  'A recorded-download hash records bytes and does not authenticate the publisher.',
  'Only packages listed in this receipt are managed by this installation.',
  'Il2CppDumper config is normalized to RequireAnyKey=false and GenerateScript=true; AssetRipper.GUI.Free.exe is copied to AssetRipper.exe when needed. These derived files are included in the installed hash inventory.'
]);
export function toolchainError(code,message,cause) { return Object.assign(new Error(message,cause?{cause}:undefined),{code}); }
export function encodeToolchainMetadata(value,{maxBytes=MAX_METADATA_BYTES,reserveBytes=0}={}) {
  let text;
  try{text=JSON.stringify(value,null,2)+'\n';}catch(error){throw toolchainError('TOOLCHAIN_METADATA_LIMIT','Toolchain metadata cannot be encoded within its byte budget.',error);}
  if(Buffer.byteLength(text)+reserveBytes>maxBytes)throw toolchainError('TOOLCHAIN_METADATA_LIMIT','Toolchain metadata exceeds its byte budget.');
  return text;
}
export function createPathAccountant(maxBytes=MAX_METADATA_BYTES) {
  let bytes=0;
  return {
    get bytes(){return bytes;},
    claim(value,overheadBytes=0){
      const next=bytes+Buffer.byteLength(value,'utf8')+overheadBytes;
      if(next>maxBytes)throw toolchainError('TOOLCHAIN_METADATA_LIMIT','Archive path metadata exceeds its byte budget.');
      bytes=next;return bytes;
    }
  };
}
const invalid = message => {throw toolchainError('TOOLCHAIN_LOCK_INVALID',message);};
export function exactKeys(value,keys) { return value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===keys.length && keys.every(k=>Object.hasOwn(value,k)); }
export function safeRelative(value,{empty=false}={}) {
  if(typeof value!=='string'||(!value&&!empty)||value.length>32768||value.includes('\\'))return false;
  if(!value)return true;
  const parts=value.split('/');
  return parts.length<=64&&parts.every(part=>part&&part!=='.'&&part!=='..'&&!/[<>:"|?*\x00-\x1f\x7f]/.test(part)&&!/[. ]$/.test(part)&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
export function validateToolchainLock(value) {
  if(!exactKeys(value,['kind','schemaVersion','platform','packages'])||value.kind!=='retoolkit-toolchain-lock'||value.schemaVersion!==1||value.platform!=='win32-x64') invalid('Invalid toolchain lock header or unknown fields.');
  if(!Array.isArray(value.packages)||value.packages.length<1||value.packages.length>4)invalid('Lock must contain one to four unique supported packages.');
  const seen=new Set();
  for(const item of value.packages){
    if(!exactKeys(item,['id','version','source','archiveRoot'])||!Object.hasOwn(TARGETS,item.id)||seen.has(item.id))invalid('Invalid, duplicate or unsupported locked package.');
    seen.add(item.id);
    if(typeof item.version!=='string'||item.version.length>128||!/^v?\d+(?:[.\-_+][0-9A-Za-z]+)*$/.test(item.version)||/(?:^|[.\-_+])(?:latest|x|current)(?:$|[.\-_+])/i.test(item.version))invalid(`Package ${item.id} requires an exact version.`);
    if(!safeRelative(item.archiveRoot,{empty:true}))invalid(`Unsafe archiveRoot for ${item.id}.`);
    const source=item.source;
    if(!exactKeys(source,['url','sha256','size','verification'])||!['publisher-checksum','recorded-download'].includes(source.verification)||typeof source.sha256!=='string'||!/^[0-9a-f]{64}$/.test(source.sha256)||!Number.isSafeInteger(source.size)||source.size<1||source.size>MAX_PACKAGE_BYTES)invalid(`Invalid source checksum, size or verification for ${item.id}.`);
    let url,decoded;
    try{url=new URL(source.url);decoded=decodeURIComponent(url.pathname);}catch{invalid(`Invalid source URL for ${item.id}.`);}
    if(typeof source.url!=='string'||source.url.length>8192||url.protocol!=='https:'||!url.hostname||url.username||url.password||url.search||url.hash||/[?#\x00-\x20\\]/.test(source.url)||/(?:^|\/)(?:latest|current|main|master|HEAD)(?:\/|$)/i.test(decoded)||/\/refs\/heads\//i.test(decoded)||!decoded.toLowerCase().endsWith('.zip')) invalid(`Source URL for ${item.id} must name an immutable HTTPS ZIP asset without credentials, query or fragment.`);
  }
  let copy;
  try{const text=JSON.stringify(value);if(Buffer.byteLength(text)>1024**2)invalid('Toolchain lock exceeds 1 MiB.');copy=JSON.parse(text);}catch(error){if(error.code==='TOOLCHAIN_LOCK_INVALID')throw error;invalid('Toolchain lock must be serializable JSON.');}
  return copy;
}
export async function readToolchainLock(file) {
  try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024**2)invalid('Toolchain lock must be a regular file of at most 1 MiB.');const bytes=await fs.readFile(file);if(bytes.length>1024**2)invalid('Toolchain lock exceeds 1 MiB.');return validateToolchainLock(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));}
  catch(error){if(error.code==='TOOLCHAIN_LOCK_INVALID')throw error;throw toolchainError('TOOLCHAIN_LOCK_INVALID',`Cannot read toolchain lock: ${error.message}`,error);}
}
export function lockFingerprint(lock) { const valid=validateToolchainLock(lock); const canonical={kind:valid.kind,schemaVersion:valid.schemaVersion,platform:valid.platform,packages:valid.packages.map(p=>({id:p.id,version:p.version,source:{url:p.source.url,sha256:p.source.sha256,size:p.source.size,verification:p.source.verification},archiveRoot:p.archiveRoot}))}; return createHash('sha256').update(JSON.stringify(canonical)).digest('hex'); }
export function planToolchain(root,lock) { const valid=validateToolchainLock(lock);return {kind:'retoolkit-toolchain-plan',schemaVersion:1,platform:valid.platform,lockFingerprint:lockFingerprint(valid),packages:valid.packages.map(p=>({...p,target:TARGETS[p.id]})),limitations:[...LIMITATIONS]}; }

// Inspect every existing ancestor before creating or opening a toolkit/cache path.
// lstat detects Windows junctions as links. Never resolve a link and use its target.
export async function assertNoLinks(file) {
  const absolute=path.resolve(file);const parsed=path.parse(absolute);let cursor=parsed.root;
  for(const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,component);
    try{const stat=await fs.lstat(cursor);if(stat.isSymbolicLink())throw toolchainError('TOOLCHAIN_PATH_UNSAFE',`Refusing symbolic link or junction: ${cursor}`);}
    catch(error){if(error.code==='ENOENT')return;throw error;}
  }
}
export async function statOrNull(file) { try{return await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;} }
export function within(root,file) { const relative=path.relative(path.resolve(root).toLowerCase(),path.resolve(file).toLowerCase());return relative===''||(!relative.startsWith(`..${path.sep}`)&&relative!=='..'&&!path.isAbsolute(relative)); }
export async function snapshotTree(root,{maxMetadataBytes=MAX_METADATA_BYTES}={}) {
  await assertNoLinks(root);const files=[];const identities=new Set();let metadataBytes=2;
  async function walk(relative){for(const name of (await fs.readdir(path.join(root,relative))).sort()){
    const rel=relative?`${relative}/${name}`:name;if(!safeRelative(rel))throw toolchainError('TOOLCHAIN_PATH_UNSAFE',`Unsafe installed path: ${rel}`);const key=rel.toLowerCase();if(identities.has(key))throw toolchainError('TOOLCHAIN_PATH_UNSAFE',`Case collision in installed tree: ${rel}`);
    // Bound path identity storage too, including empty directories. Check before
    // retaining strings or hashing files, rather than only after JSON encoding.
    metadataBytes+=Buffer.byteLength(rel)*2+128;
    if(metadataBytes>maxMetadataBytes)throw toolchainError('TOOLCHAIN_METADATA_LIMIT','Installed tree inventory exceeds its metadata budget.');
    identities.add(key);
    const absolute=path.join(root,...rel.split('/'));const stat=await fs.lstat(absolute);if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory()))throw toolchainError('TOOLCHAIN_PATH_UNSAFE',`Unsupported installed file type: ${rel}`);
    if(stat.isDirectory())await walk(rel);else{const hash=createHash('sha256');const handle=await fs.open(absolute,'r');try{for await(const bytes of handle.createReadStream({autoClose:false}))hash.update(bytes);}finally{await handle.close();}files.push({path:rel,size:stat.size,sha256:hash.digest('hex')});}
  }}
  await walk('');return files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
