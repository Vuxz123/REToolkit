import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {withToolchainWrite,assertToolchainIdle} from '../toolchain/lease.js';
import {mkdirSafe,durableWrite,cachedArchive,privateArchive,extractChecked,matches} from '../toolchain/archive-io.js';
import {TARGETS,MAX_METADATA_BYTES,JOURNAL_RESERVE_BYTES,encodeToolchainMetadata,assertNoLinks,statOrNull,within,toolchainError} from '../toolchain/manifest.js';
import {validatePythonLock,pythonLockFingerprint,validatePythonReceipt,ACTIVE_PATH,GENERATIONS_PATH,PYTHON_LIMITATIONS} from './manifest.js';
import {snapshotPythonGeneration,verifyPythonGeneration,verifyPythonRuntime} from './verify.js';
import {executePython as defaultExecutePython,runPythonBuild} from './runner.js';
import {validateWindowsWheel,allowWindowsHook,validateWindowsHook} from './windows-site.js';

const fail=(code,message,cause)=>{throw toolchainError(code,message,cause);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function pointerBytes(file){await assertNoLinks(file);const stat=await statOrNull(file);if(!stat)return null;if(!stat.isFile()||stat.size>1024**2)fail('PYTHON_ACTIVE_INVALID','Existing active pointer is not bounded regular metadata.');const bytes=await fs.readFile(file);if(bytes.length>1024**2)fail('PYTHON_ACTIVE_INVALID','Existing active pointer exceeds its byte budget.');return bytes;}
const sameBytes=(a,b)=>a===null?b===null:b!==null&&a.equals(b);
async function assertFinishedTransactions(root){
 for(const relative of ['.cache/toolchain/transactions','.cache/python-runtime/transactions']){
  const folder=path.join(root,relative);await assertNoLinks(folder);if(!await statOrNull(folder))continue;
  for(const name of await fs.readdir(folder)){
   const file=path.join(folder,name,'journal.json');await assertNoLinks(file);
   try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.size>MAX_METADATA_BYTES)throw Error();const bytes=await fs.readFile(file);if(bytes.length>MAX_METADATA_BYTES)throw Error();const journal=JSON.parse(bytes);if(!['committed','rolled-back'].includes(journal.state))throw Error();}
   catch(error){if(error.code==='TOOLCHAIN_PATH_UNSAFE')throw error;fail('TOOLCHAIN_RECOVERY_REQUIRED','An unfinished or unverifiable installation journal requires inspection.');}
  }
 }
}
function wheelEntry(wheel,{path:relative,directory,size}){
 if(directory)return;
 if(/(?:^|\/)(?:[^/]*\.pth|sitecustomize\.py|usercustomize\.py)$/i.test(relative)&&!allowWindowsHook(wheel,relative,size))fail('PYTHON_WHEEL_INVALID','Wheel contains a forbidden Python startup hook.');
 if(/(?:^|\/)[^/]+\.dist-info\//i.test(relative)&&size>1024**2)fail('PYTHON_WHEEL_INVALID','Wheel metadata exceeds 1 MiB.');
}
async function pythonLayout(folder){
 try{await assertNoLinks(folder);const stat=await fs.lstat(folder);if(!stat.isDirectory())throw Error();const exe=await fs.lstat(path.join(folder,'python.exe'));if(!exe.isFile()||!exe.size)throw Error();
  const walk=async dir=>{for(const item of await fs.readdir(dir,{withFileTypes:true})){if(item.name.toLowerCase()==='pyvenv.cfg')throw Error();if(item.isDirectory())await walk(path.join(dir,item.name));}};await walk(folder);
 }catch(error){fail('PYTHON_LAYOUT_INVALID','Python archive requires a nonempty python.exe and must not contain pyvenv.cfg.',error);}
}

export async function installPythonRuntime(root,lock,{cache,fetchImpl=fetch,inspectProcesses,onEvent=()=>{},executePython=defaultExecutePython}={}){
 lock=validatePythonLock(lock);for(const wheel of [lock.pip,...lock.wheels])validateWindowsWheel(wheel);root=path.resolve(root);await assertNoLinks(root);cache=path.resolve(cache??path.join(root,'.cache/python-runtime/packages'));
 const forbidden=[...Object.values(TARGETS),'runtime/python','workspaces','.cache/python-runtime/transactions','.cache/toolchain/transactions','.cache/toolchain/writer','.cache/toolchain/readers'];
 if(forbidden.some(relative=>within(path.join(root,relative),cache)))fail('TOOLCHAIN_PATH_UNSAFE','Package cache must be outside managed runtime/engine trees, workspaces and transaction/lease directories.');
 await assertNoLinks(cache);
 return withToolchainWrite(root,async()=>{
  await assertFinishedTransactions(root);
  const active=path.join(root,ACTIVE_PATH),previous=await pointerBytes(active);
  if(previous){const report=await verifyPythonRuntime(root);if(!report.ok)fail('PYTHON_ACTIVE_INVALID','Current managed runtime must be verified before replacing its pointer.');}
  const runId=randomUUID(),txRelative=`.cache/python-runtime/transactions/${runId}`,tx=path.join(root,txRelative),generation=path.join(root,GENERATIONS_PATH,runId);
  await mkdirSafe(tx);await mkdirSafe(generation);
  const journal={kind:'retoolkit-python-journal',schemaVersion:1,runId,generation:runId,state:'staging',createdAt:new Date().toISOString(),lockFingerprint:pythonLockFingerprint(lock),previousPointer:previous?`${txRelative}/previous-active.json`:null};
  const journalFile=path.join(tx,'journal.json'),persist=()=>durableWrite(journalFile,encodeToolchainMetadata(journal,{reserveBytes:['staging','building','activating'].includes(journal.state)?JOURNAL_RESERVE_BYTES:0}));
  const event=phase=>onEvent({phase,runId,journal:structuredClone(journal)});
  const sources=[];let published=null;
  const recheckSources=async()=>{for(const item of sources)if(!await matches(item.file,item.source))fail('TOOLCHAIN_INTEGRITY','Transaction source bytes changed before activation.');};
  const unchangedPointer=async()=>{if(!sameBytes(await pointerBytes(active),previous))fail('PYTHON_INTEGRITY','Active pointer changed during installation.');};
  try{
   if(previous)await durableWrite(path.join(tx,'previous-active.json'),previous);await persist();await event('journal');
   const budget={entries:0,total:0};
   const capture=async(source,destination)=>{const cached=await cachedArchive(source,cache,fetchImpl);await event('before-source-copy');const file=await privateArchive(cached,destination,source);sources.push({file,source});return file;};
   const archive=await capture(lock.python.source,path.join(tx,'sources/python.zip'));await event('before-extract');
   const unpacked=path.join(tx,'unpacked/python');await extractChecked(archive,unpacked,{budget});
   const pythonStage=path.join(unpacked,...(lock.python.archiveRoot?lock.python.archiveRoot.split('/'):[]));await pythonLayout(pythonStage);
   // Move only unexecuted archive bytes. From this point the interpreter and all
   // installed package paths have their final immutable generation identity.
   const pythonFolder=path.join(generation,'python');await assertNoLinks(pythonFolder);await fs.rename(pythonStage,pythonFolder);await mkdirSafe(path.join(generation,'site'));
   const wheelhouse=path.join(tx,'wheelhouse');await mkdirSafe(wheelhouse);
   for(const wheel of [lock.pip,...lock.wheels]){
    const file=await capture(wheel.source,path.join(wheelhouse,wheel.filename)),unpackedWheel=path.join(tx,'wheel-preflight',wheel.name);await event('before-wheel-preflight');
    await extractChecked(file,unpackedWheel,{budget,validateEntry:entry=>wheelEntry(wheel,entry)});
    if(wheel.name==='pywin32'){
     const hookFile=path.join(unpackedWheel,'pywin32.pth'),stat=await statOrNull(hookFile);
     if(!stat?.isFile()||!allowWindowsHook(wheel,'pywin32.pth',stat.size))fail('PYTHON_WHEEL_INVALID','Reviewed pywin32 startup layout is missing.');
     validateWindowsHook(wheel,'pywin32.pth',await fs.readFile(hookFile));
    }
   }
   await event('staged');await recheckSources();
   const requirements=path.join(tx,'requirements.txt');await durableWrite(requirements,Buffer.from(lock.wheels.map(wheel=>`${wheel.name}==${wheel.version} --hash=sha256:${wheel.source.sha256}`).join('\n')+'\n'));
   const pythonBefore=await snapshotPythonGeneration(generation);
   await assertToolchainIdle(root,{inspectProcesses});journal.state='building';await persist();await event('before-build');await recheckSources();
   if(JSON.stringify(await snapshotPythonGeneration(generation))!==JSON.stringify(pythonBefore))fail('PYTHON_INTEGRITY','Python generation changed before executing locked code.');
   await assertToolchainIdle(root,{inspectProcesses});
   const probe=await runPythonBuild({python:path.join(pythonFolder,'python.exe'),site:path.join(generation,'site'),pipWheel:{path:path.join(wheelhouse,lock.pip.filename),name:'pip',version:lock.pip.version},wheelhouse,requirements,expectedPython:lock.python.version,wheels:lock.wheels,transactionDir:tx},{executePython});
   await event('built');
   const files=await snapshotPythonGeneration(generation);
   const pythonFiles=inventory=>inventory.filter(file=>file.path.startsWith('python/'));
   if(JSON.stringify(pythonFiles(files))!==JSON.stringify(pythonFiles(pythonBefore)))fail('PYTHON_INTEGRITY','Locked Python files changed during the package build.');
   const receipt=validatePythonReceipt({kind:'retoolkit-python-receipt',schemaVersion:1,platform:lock.platform,generation:runId,createdAt:new Date().toISOString(),lockFingerprint:pythonLockFingerprint(lock),python:lock.python,pip:lock.pip,wheels:lock.wheels,probe,files,limitations:[...PYTHON_LIMITATIONS]});
   const receiptBytes=Buffer.from(encodeToolchainMetadata(receipt)),receiptFile=path.join(generation,'receipt.json');
   await event('before-receipt');await recheckSources();
   if(JSON.stringify(await snapshotPythonGeneration(generation))!==JSON.stringify(files))fail('PYTHON_INTEGRITY','Installed generation changed before sealing its receipt.');
   await durableWrite(receiptFile,receiptBytes);
   const pointer=Buffer.from(JSON.stringify({kind:'retoolkit-python-active',schemaVersion:1,generation:runId,receiptSha256:sha(receiptBytes)},null,2)+'\n');
   await assertToolchainIdle(root,{inspectProcesses});await unchangedPointer();journal.state='activating';await persist();await event('before-activate');
   await recheckSources();await unchangedPointer();
   const verified=await verifyPythonGeneration(root,runId);if(!verified.ok)fail('PYTHON_INTEGRITY','Completed generation failed verification before activation.');
   if(!sameBytes(await fs.readFile(receiptFile),receiptBytes))fail('PYTHON_INTEGRITY','Sealed receipt changed before activation.');
   await assertToolchainIdle(root,{inspectProcesses});
   await mkdirSafe(path.dirname(active));await durableWrite(active,pointer);published=pointer;await event('activated');
   if(!sameBytes(await pointerBytes(active),pointer)||(await verifyPythonRuntime(root)).ok!==true)fail('PYTHON_INTEGRITY','Active generation failed verification after activation.');
   journal.state='committed';await persist();await event('committed');return receipt;
  }catch(error){
   if(error.preserveToolchainGate===true){journal.state='recovery-required';journal.failure={code:String(error.code??'PYTHON_EXECUTION_UNCERTAIN').slice(0,128),message:'Python process completion could not be confirmed; inspection required.'};await persist().catch(()=>{});throw error;}
   try{
    journal.state='rolling-back';await persist();await event('before-rollback');
    if(published){if(!sameBytes(await pointerBytes(active),published))throw Error('Active pointer ownership changed.');if(previous)await durableWrite(active,previous);else{await assertNoLinks(active);await fs.unlink(active);}if(!sameBytes(await pointerBytes(active),previous))throw Error('Pointer rollback could not be verified.');}
    if(!sameBytes(await pointerBytes(active),previous))throw Error('Previous pointer identity is uncertain.');
    journal.state='rolled-back';journal.failure={code:String(error.code??'PYTHON_INSTALL_FAILED').slice(0,128),message:'Installation failed; previous pointer retained.'};await persist();
   }catch(rollbackError){journal.state='recovery-required';journal.failure={code:String(error.code??'PYTHON_INSTALL_FAILED').slice(0,128),message:'Pointer rollback is uncertain; journal and generation retained.'};await persist().catch(()=>{});fail('TOOLCHAIN_RECOVERY_REQUIRED','Python pointer rollback is uncertain; retained journal, generation and writer gate require inspection.',rollbackError);}
   if(typeof error.code==='string'&&/^(?:TOOLCHAIN_|PYTHON_)/.test(error.code))throw error;
   fail('PYTHON_INSTALL_FAILED',`Python generation installation failed: ${error.message}`,error);
  }
 },{inspectProcesses});
}
