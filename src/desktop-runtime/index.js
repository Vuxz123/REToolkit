import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {exactKeys,safeRelative,MAX_PACKAGE_BYTES,MAX_METADATA_BYTES,assertNoLinks,within} from '../toolchain/manifest.js';
import {withToolchainWrite,assertToolchainIdle} from '../toolchain/lease.js';
import {mkdirSafe,durableWrite,cachedArchive,privateArchive,extractChecked,matches} from '../toolchain/archive-io.js';
import {validatePythonLock,pythonLockFingerprint,validGeneration} from '../python-runtime/manifest.js';
import {installPythonRuntime} from '../python-runtime/installer.js';
import {inspectManagedPython,verifyPythonRuntime,snapshotPythonGeneration} from '../python-runtime/verify.js';
import {executePython,pythonInstallEnvironment} from '../python-runtime/runner.js';
import {WINDOWS_SITE_SCRIPT} from '../python-runtime/windows-site.js';

const BASE='runtime/desktop',ACTIVE=BASE+'/active.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const same=(a,b)=>a===null?b===null:b!==null&&a.equals(b);
const LIMITATIONS=Object.freeze(['GUI activation, Program identity and analysis remain unverified.','Installation executes exactly locked Python and pip; artifact hashes do not sandbox publisher code.','The .NET runtime is toolkit-local; previous generations and transaction journals are retained.']);
function rejectOutputLinks(file){let current=path.resolve(file);for(;;){try{if(fs.lstatSync(current).isSymbolicLink())throw Error('Desktop profile contains a link or junction.');}catch(error){if(error.code!=='ENOENT')throw error;}const parent=path.dirname(current);if(parent===current)return;current=parent;}}

function source(value){
 if(!exactKeys(value,['url','sha256','size','verification'])||!digest(value.sha256)||!Number.isSafeInteger(value.size)||value.size<1||value.size>MAX_PACKAGE_BYTES||!['publisher-checksum','recorded-download'].includes(value.verification))fail('DESKTOP_LOCK_INVALID','Invalid desktop lock source.');
 let u,decoded;try{u=new URL(value.url);decoded=decodeURIComponent(u.pathname);}catch{fail('DESKTOP_LOCK_INVALID','Invalid desktop lock URL.');}
 if(typeof value.url!=='string'||value.url.length>8192||u.protocol!=='https:'||!u.hostname||u.username||u.password||u.search||u.hash||/[?#\x00-\x20\\]/.test(value.url)||/(?:^|\/)(latest|current|main|master|HEAD)(?:\/|$)/i.test(decoded)||/\/refs\/heads\//i.test(decoded)||!decoded.endsWith('.zip'))fail('DESKTOP_LOCK_INVALID','Desktop sources require immutable HTTPS ZIP URLs.');
}
export function validateDesktopLock(value){
 if(!exactKeys(value,['kind','schemaVersion','platform','ghidraVersion','pythonLock','extension','dotnet'])||value.kind!=='retoolkit-desktop-lock'||value.schemaVersion!==1||value.platform!=='win32-x64'||value.ghidraVersion!=='12.1.2')fail('DESKTOP_LOCK_INVALID','Invalid desktop lock header or pinned Ghidra version.');
 const python=validatePythonLock(value.pythonLock),expected={'ghidra-mcp-bridge':'6.0.0',pyghidra:'3.1.0',jpype1:'1.5.2',packaging:'25.0'};
 for(const [name,version]of Object.entries(expected))if(python.wheels.find(w=>w.name===name)?.version!==version)fail('DESKTOP_LOCK_INVALID','Desktop lock requires pinned '+name+' '+version+'.');
 if(python.wheels.find(w=>w.name==='jpype1').filename!=='jpype1-1.5.2-cp312-cp312-win_amd64.whl')fail('DESKTOP_LOCK_INVALID','JPype native wheel must match CPython312 Windows x64.');
 if(!exactKeys(value.extension,['version','archiveRoot','source'])||value.extension.version!=='6.0.0'||!safeRelative(value.extension.archiveRoot,{empty:true}))fail('DESKTOP_LOCK_INVALID','Invalid extension version or root in desktop lock.');
 if(!exactKeys(value.dotnet,['version','archiveRoot','source'])||!/^8\.0\.\d+$/.test(value.dotnet.version)||!safeRelative(value.dotnet.archiveRoot,{empty:true}))fail('DESKTOP_LOCK_INVALID','Desktop lock requires a pinned .NET8 runtime ZIP.');
 source(value.extension.source);source(value.dotnet.source);
 if(value.extension.source.size+value.dotnet.source.size+python.python.source.size+python.pip.source.size+python.wheels.reduce((n,w)=>n+w.source.size,0)>MAX_PACKAGE_BYTES||Buffer.byteLength(JSON.stringify(value))>1024**2)fail('DESKTOP_LOCK_INVALID','Desktop lock exceeds byte limits.');
 return structuredClone(value);
}
export function desktopLockFingerprint(lock){const l=validateDesktopLock(lock);return sha(JSON.stringify({kind:l.kind,schemaVersion:l.schemaVersion,platform:l.platform,ghidraVersion:l.ghidraVersion,python:pythonLockFingerprint(l.pythonLock),extension:l.extension,dotnet:l.dotnet}));}
export function planDesktopRuntime(root,lock){const l=validateDesktopLock(lock);return {kind:'retoolkit-desktop-plan',schemaVersion:1,platform:l.platform,lockFingerprint:desktopLockFingerprint(l),root:path.resolve(root),lock:l,generationTarget:BASE+'/generations/<UUID>',activePointer:ACTIVE,executesLockedCode:true,limitations:[...LIMITATIONS]};}

function bounded(file,limit=MAX_METADATA_BYTES){rejectOutputLinks(file);const s=fs.lstatSync(file);if(!s.isFile()||s.size>limit)throw Error('Profile metadata is not a bounded regular file.');const b=fs.readFileSync(file);if(b.length>limit)throw Error('Profile metadata exceeds byte limit.');return b;}
function properties(file){const result={};for(const line of bounded(file,1024**2).toString('utf8').replace(/^\uFEFF/,'').split(/\r?\n/)){const pair=/^([^#!\s=]+)\s*=\s*(.*)$/.exec(line);if(pair){if(Object.hasOwn(result,pair[1]))throw Error('Duplicate property.');result[pair[1]]=pair[2].trim();}}return result;}
function installedGhidra(root){const file=path.join(root,'tools/ghidra/Ghidra/application.properties'),bytes=bounded(file,1024**2),p=properties(file);if(p['application.version']!=='12.1.2'||(p['application.release.name']??'PUBLIC')!=='PUBLIC')fail('DESKTOP_GHIDRA_VERSION','Installed Ghidra12.1.2 PUBLIC is required.');return {sha256:sha(bytes),version:p['application.version'],release:'PUBLIC'};}
function validateReceipt(receipt){
 if(!exactKeys(receipt,['kind','schemaVersion','generation','createdAt','lock','lockFingerprint','pythonReceiptSha256','ghidra','probe','files','guiActivation','limitations'])||receipt.kind!=='retoolkit-desktop-receipt'||receipt.schemaVersion!==1||!validGeneration(receipt.generation)||!Number.isFinite(Date.parse(receipt.createdAt))||!digest(receipt.pythonReceiptSha256)||receipt.lockFingerprint!==desktopLockFingerprint(receipt.lock)||receipt.guiActivation!=='unverified'||!Array.isArray(receipt.files)||!receipt.files.length||receipt.files.length>100000||!Array.isArray(receipt.limitations)||!receipt.limitations.every(v=>typeof v==='string'&&v.length<8192)||!exactKeys(receipt.ghidra,['sha256','version','release'])||!digest(receipt.ghidra.sha256)||receipt.ghidra.version!=='12.1.2'||receipt.ghidra.release!=='PUBLIC')throw Error('Invalid desktop receipt.');
 const seen=new Set();let total=0;for(const f of receipt.files){if(!exactKeys(f,['path','size','sha256'])||!safeRelative(f.path)||seen.has(f.path.toLowerCase())||!Number.isSafeInteger(f.size)||f.size<0||!digest(f.sha256)||! /^(extension|dotnet)\//.test(f.path))throw Error('Invalid desktop inventory.');seen.add(f.path.toLowerCase());total+=f.size;}
 if(total>MAX_PACKAGE_BYTES||!validProbe(receipt.probe))throw Error('Invalid desktop inventory or probe.');return receipt;
}
export function inspectDesktopRuntime(root){
 try{
  const active=path.join(root,ACTIVE);rejectOutputLinks(active);if(!fs.existsSync(active))return {state:'absent'};
  const p=JSON.parse(bounded(active,65536));if(!exactKeys(p,['kind','schemaVersion','generation','receiptSha256'])||p.kind!=='retoolkit-desktop-active'||p.schemaVersion!==1||!validGeneration(p.generation)||!digest(p.receiptSha256))throw Error('Invalid pointer.');
  const folder=path.join(root,BASE,'generations',p.generation),bytes=bounded(path.join(folder,'receipt.json')),receipt=validateReceipt(JSON.parse(bytes));if(receipt.generation!==p.generation||sha(bytes)!==p.receiptSha256)throw Error('Receipt hash differs.');
  const pythonRoot=path.join(root,BASE,'python'),python=inspectManagedPython(pythonRoot);if(python.state!=='selected'||python.receiptSha256!==receipt.pythonReceiptSha256)throw Error('Python selection differs.');
  return {state:'selected',generation:p.generation,folder,receipt,receiptSha256:p.receiptSha256,pythonRoot,python:python.python,site:python.site,dotnet:path.join(folder,'dotnet'),extension:path.join(folder,'extension'),settings:path.join(root,BASE,'settings',p.generation)};
 }catch{return {state:'invalid',error:{code:'DESKTOP_PROFILE_INVALID',message:'Selected desktop runtime is invalid; inspect its active pointer, Python profile and receipt.'}};}
}
export async function verifyDesktopRuntime(root){
 const selected=inspectDesktopRuntime(root);if(selected.state!=='selected')return {ok:false,state:selected.state,errors:[selected.error??{code:'DESKTOP_PROFILE_MISSING',message:'No managed desktop runtime selected.'}],limitations:[...LIMITATIONS]};
 try{
  const actual=await snapshotPythonGeneration(selected.folder),python=await verifyPythonRuntime(selected.pythonRoot),after=inspectDesktopRuntime(root);
  if(!python.ok||JSON.stringify(actual)!==JSON.stringify(selected.receipt.files)||after.state!=='selected'||after.receiptSha256!==selected.receiptSha256||after.generation!==selected.generation||installedGhidra(root).sha256!==selected.receipt.ghidra.sha256)throw Error('Profile files, Ghidra or selection changed.');
  return {ok:true,state:'verified',profile:selected,guiActivation:'unverified',limitations:[...LIMITATIONS]};
 }catch{return {ok:false,state:'changed',errors:[{code:'DESKTOP_FILES_CHANGED',message:'Desktop runtime, private Python or installed Ghidra differs from its receipt.'}],limitations:[...LIMITATIONS]};}
}
export function desktopRuntimeEnvironment(profile,baseEnv={}){if(profile?.state!=='selected')fail('DESKTOP_PROFILE_INVALID','A selected desktop profile is required.');return {...baseEnv,DOTNET_ROOT:profile.dotnet,DOTNET_ROOT_X64:profile.dotnet,DOTNET_MULTILEVEL_LOOKUP:'0',DOTNET_ROLL_FORWARD:'LatestPatch',PYGHIDRA_PYTHON:profile.python,PATH:profile.dotnet+path.delimiter+(baseEnv.PATH??'')};}

export const DESKTOP_PROBE_SCRIPT=`# RETK_DESKTOP_PROBE
${WINDOWS_SITE_SCRIPT}
import json
import pyghidra, jpype, _jpype, packaging
print(json.dumps({'pyghidra': metadata.version('pyghidra'), 'jpype1': metadata.version('jpype1'), 'packaging': metadata.version('packaging'), 'nativeImports': callable(jpype.startJVM)}))
`;
function validProbe(p){return exactKeys(p,['pyghidra','jpype1','packaging','nativeImports'])&&p.pyghidra==='3.1.0'&&p.jpype1==='1.5.2'&&p.packaging==='25.0'&&p.nativeImports===true;}
async function pointer(file){await assertNoLinks(file);try{return bounded(file,65536);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function checkTransactions(root){const base=path.join(root,'.cache/desktop-runtime/transactions');await assertNoLinks(base);if(!fs.existsSync(base))return;for(const name of await fsp.readdir(base)){try{const j=JSON.parse(bounded(path.join(base,name,'journal.json')));if(!['committed','rolled-back'].includes(j.state))throw Error();}catch{fail('TOOLCHAIN_RECOVERY_REQUIRED','Unfinished desktop runtime transaction requires inspection.');}}}
async function checkExtension(folder,lock){
 const files=await snapshotPythonGeneration(folder),metadata=files.filter(f=>f.path==='extension.properties'||f.path.endsWith('/extension.properties'));
 const p=properties(path.join(folder,'extension.properties'));if(metadata.length!==1||p.name!=='GhidraMCP'||p.version!==lock.ghidraVersion||p.description?.match(/(?:^|\s)Plugin version (\d+(?:\.\d+)+)\.?$/)?.[1]!==lock.extension.version||!files.some(f=>f.path==='Module.manifest')||!files.some(f=>f.path.startsWith('lib/')&&f.path.endsWith('.jar')&&f.size>0))fail('DESKTOP_EXTENSION_INVALID','Extension metadata/layout does not match pinned Ghidra and bridge.');
}
async function checkDotnet(folder,version){for(const relative of ['dotnet.exe',`shared/Microsoft.NETCore.App/${version}/System.Private.CoreLib.dll`]){const file=path.join(folder,relative);await assertNoLinks(file);const s=await fsp.lstat(file);if(!s.isFile()||!s.size)fail('DESKTOP_DOTNET_INVALID','Pinned local .NET runtime layout is missing.');}}

export async function installDesktopRuntime(root,lock,{cache,fetchImpl=fetch,inspectProcesses,onEvent=()=>{},executePython:execute=executePython}={}){
 lock=validateDesktopLock(lock);root=path.resolve(root);await assertNoLinks(root);cache=path.resolve(cache??path.join(root,'.cache/desktop-runtime/packages'));await assertNoLinks(cache);
 const prospectiveNative=path.join(root,BASE,'python/runtime/python/generations','0'.repeat(36),'site/pywin32_system32/pywintypes312.dll');if(process.platform==='win32'&&prospectiveNative.length>248)fail('DESKTOP_PATH_TOO_LONG','Desktop Python native libraries require a shorter toolkit root on Windows.');
 if(['runtime','tools','workspaces','.cache/toolchain','.cache/desktop-runtime/transactions'].some(rel=>within(path.join(root,rel),cache)))fail('TOOLCHAIN_PATH_UNSAFE','Desktop cache must be outside managed runtimes, engines, workspaces and transaction gates.');
 return withToolchainWrite(root,async()=>{
  await checkTransactions(root);const old=await pointer(path.join(root,ACTIVE));if(old&&!(await verifyDesktopRuntime(root)).ok)fail('DESKTOP_PROFILE_INVALID','Current desktop profile must be verified before replacement.');
  const ghidra=installedGhidra(root),generation=randomUUID(),folder=path.join(root,BASE,'generations',generation),pythonRoot=path.join(root,BASE,'python'),pythonActive=path.join(pythonRoot,'runtime/python/active.json'),oldPython=await pointer(pythonActive),tx=path.join(root,'.cache/desktop-runtime/transactions',generation),active=path.join(root,ACTIVE);await mkdirSafe(folder);await mkdirSafe(tx);
  const journal={kind:'retoolkit-desktop-journal',schemaVersion:1,generation,state:'staging',lockFingerprint:desktopLockFingerprint(lock),createdAt:new Date().toISOString()},journalFile=path.join(tx,'journal.json'),persist=()=>durableWrite(journalFile,encode(journal));let published=null,publishedPython=null;
  const event=phase=>onEvent({phase,runId:generation,journal:structuredClone(journal)}),sources=[];
  const recheck=async()=>{for(const {file,source}of sources)if(!await matches(file,source))fail('TOOLCHAIN_INTEGRITY','Desktop transaction source changed.');if(installedGhidra(root).sha256!==ghidra.sha256)fail('DESKTOP_GHIDRA_CHANGED','Installed Ghidra changed during desktop installation.');};
  const unchanged=async()=>{if(!same(await pointer(active),old))fail('DESKTOP_POINTER_CHANGED','Desktop active pointer changed during transaction.');};
  try{
   if(old)await durableWrite(path.join(tx,'previous-active.json'),old);if(oldPython)await durableWrite(path.join(tx,'previous-python-active.json'),oldPython);await persist();await event('journal');const budget={entries:0,total:0};
   for(const kind of ['extension','dotnet']){const artifact=lock[kind],cached=await cachedArchive(artifact.source,cache,fetchImpl),file=await privateArchive(cached,path.join(tx,kind+'.zip'),artifact.source);sources.push({file,source:artifact.source});await event('before-'+kind+'-extract');const unpacked=path.join(tx,'unpacked',kind);await extractChecked(file,unpacked,{budget});const sourceFolder=path.join(unpacked,...(artifact.archiveRoot?artifact.archiveRoot.split('/'):[]));await assertNoLinks(sourceFolder);await fsp.rename(sourceFolder,path.join(folder,kind));}
   await checkExtension(path.join(folder,'extension'),lock);await checkDotnet(path.join(folder,'dotnet'),lock.dotnet.version);await recheck();await assertToolchainIdle(root,{inspectProcesses});journal.state='building';await persist();await event('before-python');
   // Separate installation root preserves the CLI MCP active pointer and uses
   // the existing strict Python installer, hash checks and rollback machinery.
   await installPythonRuntime(pythonRoot,lock.pythonLock,{cache,fetchImpl,inspectProcesses,executePython:execute});
   publishedPython=await pointer(pythonActive);
   const python=inspectManagedPython(pythonRoot);if(python.state!=='selected')fail('DESKTOP_PYTHON_INVALID','Private GUI Python was not selected.');
   const pythonBefore=await verifyPythonRuntime(pythonRoot);if(!pythonBefore.ok)fail('DESKTOP_PYTHON_INVALID','Private GUI Python failed verification.');
   const output=await execute(python.python,['-B','-I','-S','-c',DESKTOP_PROBE_SCRIPT,python.site],{cwd:python.folder,env:pythonInstallEnvironment(path.join(tx,'probe')),timeoutMs:120000});let probe;try{probe=JSON.parse(output.stdout);}catch{}if(output.exitCode!==0||!validProbe(probe))fail('DESKTOP_NATIVE_IMPORT_INVALID','Private PyGhidra/JPype native import probe failed.');
   if(!(await verifyPythonRuntime(pythonRoot)).ok)fail('DESKTOP_PYTHON_INVALID','GUI native import probe changed sealed Python files.');
   const files=await snapshotPythonGeneration(folder),receipt={kind:'retoolkit-desktop-receipt',schemaVersion:1,generation,createdAt:new Date().toISOString(),lock,lockFingerprint:desktopLockFingerprint(lock),pythonReceiptSha256:python.receiptSha256,ghidra,probe,files,guiActivation:'unverified',limitations:[...LIMITATIONS]},bytes=encode(validateReceipt(receipt));
   await event('before-receipt');await recheck();if(JSON.stringify(await snapshotPythonGeneration(folder))!==JSON.stringify(files))fail('DESKTOP_FILES_CHANGED','Desktop assets changed before receipt seal.');await durableWrite(path.join(folder,'receipt.json'),bytes);
   journal.state='activating';await persist();await event('before-activate');await recheck();await unchanged();await assertToolchainIdle(root,{inspectProcesses});if(JSON.stringify(await snapshotPythonGeneration(folder))!==JSON.stringify(files)||!(await verifyPythonRuntime(pythonRoot)).ok||!same(await fsp.readFile(path.join(folder,'receipt.json')),bytes))fail('DESKTOP_FILES_CHANGED','Sealed desktop generation changed before selection.');
   published=encode({kind:'retoolkit-desktop-active',schemaVersion:1,generation,receiptSha256:sha(bytes)});await mkdirSafe(path.dirname(active));await durableWrite(active,published);await event('activated');if(!(await verifyDesktopRuntime(root)).ok)fail('DESKTOP_FILES_CHANGED','Selected desktop profile failed verification.');journal.state='committed';await persist();await event('committed');return receipt;
  }catch(error){
   if(error.preserveToolchainGate===true){journal.state='recovery-required';journal.failure=String(error.code??'DESKTOP_EXECUTION_UNCERTAIN');await persist().catch(()=>{});throw error;}
   try{journal.state='rolling-back';await persist();await event('before-rollback');if(published){if(!same(await pointer(active),published))throw Error('Pointer ownership changed.');if(old)await durableWrite(active,old);else await fsp.unlink(active);}if(publishedPython){if(!same(await pointer(pythonActive),publishedPython))throw Error('Private Python pointer ownership changed.');if(oldPython)await durableWrite(pythonActive,oldPython);else await fsp.unlink(pythonActive);}if(!same(await pointer(pythonActive),oldPython))throw Error('Private Python rollback is uncertain.');await unchanged();journal.state='rolled-back';journal.failure=String(error.code??'DESKTOP_INSTALL_FAILED');await persist();}
   catch{journal.state='recovery-required';await persist().catch(()=>{});fail('TOOLCHAIN_RECOVERY_REQUIRED','Desktop pointer rollback is uncertain; retain journal, generations and writer gate for inspection.');}throw error;
  }
 },{inspectProcesses});
}
