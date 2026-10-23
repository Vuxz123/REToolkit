import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {crc32} from 'node:zlib';
import yauzl from 'yauzl';
import {assertAssetPath,assetError} from '../assets/context.js';
import {fileIdentity,withWorkspaceLock} from '../state.js';
import {safeRelative} from '../toolchain/manifest.js';
import {acquireToolchainRead} from '../toolchain/lease.js';
import {assertNoSession,atomicJson} from '../ghidra/runtime.js';
import {createAdbClient,resolveAdbPath,validatePackageName,validateSerial} from './client.js';

const GiB=1024**3;
/** Bound the caller's wait, never infer child termination from a deadline.
 * runProcess supervision retains owned engine/toolchain leases until real close. */
export function boundedAdbRun(run,{metadataMs=30000,pullMs=600000}={}){
 check(typeof run==='function'&&[metadataMs,pullMs].every(value=>Number.isSafeInteger(value)&&value>0),'Invalid ADB deadline policy');
 return async(file,args,options)=>{
  const budget=args.includes('pull')?pullMs:metadataMs;let timer;
  const pending=Promise.resolve().then(()=>run(file,args,options));
  try{return await Promise.race([pending,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(assetError('cleanup_pending','ADB deadline elapsed; owned process cleanup remains unverified. Inspect leases before retrying.')),budget);})]);}
  finally{clearTimeout(timer);}
 };
}
const check=(ok,message,code='android_preparation_invalid')=>{if(!ok)throw assetError(code,message);};
const dataCoverage=()=>({coverage:'unverified',reason:'Only installed and downloaded device content can be observed; undeclared or not-yet-downloaded PAD/CDN content remains unverified.'});
const certs=value=>JSON.stringify([...(value?.signing?.certificateSha256??[])].sort());
function matchingBase(local,installed){
 return local.packageName===installed.packageName&&local.versionCode===installed.versionCode&&local.baseSha256===installed.baseSha256&&local.signing?.state==='verified'&&installed.signing?.state==='verified'&&local.signing.certificateSha256?.length>0&&certs(local)===certs(installed);
}
function unchangedPaths(a,b){return JSON.stringify([...a].sort())===JSON.stringify([...b].sort());}

/** Retain only APK entries from an outer archive. Do not expand APK resources,
 * OBBs or app data merely to inspect manifests. All names/types remain checked. */
export async function collectArchiveApks(input,directory){
 input=assertAssetPath(path.resolve(input));const original=fileIdentity(input);
 if(path.extname(input).toLowerCase()==='.apk')return {apks:[input],obbEntries:[],archive:original};
 check(/\.(?:xapk|apks|zip)$/i.test(input),'Input does not contain inspectable APKs','android_archive_unverified');
 directory=assertAssetPath(path.resolve(directory));fs.mkdirSync(directory,{recursive:true});
 const zip=await new Promise((resolve,reject)=>yauzl.open(input,{lazyEntries:true,autoClose:true,strictFileNames:true,validateEntrySizes:true},(error,value)=>error?reject(error):resolve(value)));
 const apks=[],obbEntries=[],seen=new Set();let entries=0,bytes=0;
 await new Promise((resolve,reject)=>{
  let settled=false;const fail=error=>{if(settled)return;settled=true;zip.close();reject(error);};
  zip.on('error',fail);zip.on('end',()=>{settled=true;resolve();});
  zip.on('entry',entry=>{(async()=>{
   const folder=entry.fileName.endsWith('/'),name=folder?entry.fileName.slice(0,-1):entry.fileName,type=(entry.externalFileAttributes>>>16)&0o170000;
   check(++entries<=100000&&safeRelative(name)&&[0,0o100000,0o040000].includes(type)&&!(entry.generalPurposeBitFlag&1),'Unsafe or excessive APK archive entry');
   check(!seen.has(name.toLowerCase()),'Duplicate APK archive path');seen.add(name.toLowerCase());
   if(folder){check(entry.uncompressedSize===0,'Archive directory contains data');return;}
   if(/\.obb$/i.test(name))obbEntries.push(name);
   if(!/\.apk$/i.test(name))return;
   check(apks.length<256&&entry.uncompressedSize>0&&entry.uncompressedSize<=8*GiB&&(bytes+=entry.uncompressedSize)<=32*GiB,'APK archive exceeds inspection budget');
   const target=assertAssetPath(path.join(directory,`apk-${apks.length}.apk`),directory),stream=await new Promise((res,rej)=>zip.openReadStream(entry,(error,value)=>error?rej(error):res(value)));
   let count=0,sum=0;const verify=new Transform({transform(chunk,encoding,done){count+=chunk.length;if(count>entry.uncompressedSize){done(Error('APK entry grew while reading'));return;}sum=crc32(chunk,sum);done(null,chunk);},flush(done){done(count===entry.uncompressedSize&&sum===entry.crc32?null:Error('APK entry CRC/size mismatch'));}});
   await pipeline(stream,verify,createWriteStream(target,{flags:'wx'}));apks.push(target);
  })().then(()=>{if(!settled)zip.readEntry();},fail);});zip.readEntry();
 });
 check(fileIdentity(input).sha256===original.sha256,'Original archive changed while inspecting');
 check(apks.length>0,'Archive has no APK entries','android_archive_unverified');return {apks,obbEntries,archive:original};
}

async function ingestCapture(toolkit,name,capture,previous){
 // An existing analyzed database/export needs its own reviewed migration. A
 // verified capture is preserved for that decision without replacing its input.
 if(['dump','import','analyze','symbols','assetripper'].some(step=>previous.steps?.[step]?.state==='succeeded')||previous.assetReconstruction)return {changedInputs:false,state:'needs-input',reason:'Capture is verified; existing downstream outputs require explicit input-change review.'};
 try{await toolkit.add(name,capture.bundle);return {changedInputs:true,state:'partial'};}
 catch(error){
  const view=await toolkit.inspectInputs(name);
  if(view.source?.location!=='staging')throw error;
  // Preserve a previous selection by exact content identity even if a raw APK
  // becomes base/<old path> inside the captured XAPK. Never choose by filename.
  const match=(items,identity)=>identity?.sha256?items.filter(item=>{
   const file=assertAssetPath(path.join(view.source.path,item.path),view.source.path);return fileIdentity(file).sha256===identity.sha256;
  }):[];
  const binaries=match(view.binaries,previous.identities?.native),metadata=match(view.metadata,previous.identities?.metadata);
  if(binaries.length!==1||metadata.length!==1)return {changedInputs:false,state:'needs-input',reason:'Verified capture retained in staging; input identities remain ambiguous.'};
  await toolkit.selectBuildInputs(name,{binary:binaries[0].path,metadata:metadata[0].path,revision:view.revision});
  return {changedInputs:true,state:'partial'};
 }
}

/** Caller selects a device or reuses the workspace's previously selected device.
 * This operation never installs/launches the app or requests root enablement. */
export async function runAndroidPreflight(toolkit,name,params={},dependencies={}){
 const workspace=assertAssetPath(toolkit.workspace(name)),lease=acquireToolchainRead(toolkit.root);
 try{return await withWorkspaceLock(workspace,async()=>{
  assertNoSession(toolkit,name);
  const {hasAssetSession}=await import('../assets/session.js');check(!hasAssetSession(toolkit,name),'Stop the owned AssetRipper session before Android preparation','asset_session_active');
  const project=toolkit.read(name),runId=randomUUID(),directory=assertAssetPath(path.join(workspace,'04_Notes/android-delivery',runId),workspace);fs.mkdirSync(directory,{recursive:true});
  const receipt=path.join(directory,'inspection.json'),base={kind:'retoolkit-android-preparation',schemaVersion:1,runId,state:'partial',changedInputs:false,missingSplits:[],missingSplitTypes:[],downloadedData:dataCoverage(),receipt:path.relative(workspace,receipt).split(path.sep).join('/')};
  const finish=result=>{const value={...base,...result};atomicJson(receipt,value);return value;};
  const archive=project.identities?.archive;
  if(!archive?.path||!fs.existsSync(archive.path))return finish({reason:'No retained APK archive is available; extracted inputs and downloaded data remain unverified.'});
  check(fileIdentity(assertAssetPath(archive.path)).sha256===archive.sha256,'Retained input archive changed','android_input_changed');
  const collect=dependencies.collectApks??collectArchiveApks;
  let original;
  try{original=await collect(archive.path,path.join(directory,'original-apks'));}catch(error){if(error.code==='android_archive_unverified')return finish({reason:error.message});throw error;}
  const inspect=dependencies.inspectSet??(await import('./apk-inspection.js')).inspectApkSet;
  const inspectionOptions={toolkitRoot:toolkit.root},local=await inspect(original.apks,inspectionOptions);
  if(local.state==='invalid')return finish({state:'blocked',reason:'Original APK set has conflicting identities or malformed declared split dependencies.'});
  base.missingSplits=local.missingSplits??[];base.missingSplitTypes=local.missingSplitTypes??[];
  const packageName=params.packageName??local.packageName,serial=params.serial??project.ldplayerCapture?.serial;
  if(params.packageName!==undefined&&params.packageName!==local.packageName)return finish({state:'blocked',reason:'Selected package differs from the retained APK manifest.'});
  const missing=base.missingSplits.length>0||base.missingSplitTypes.length>0||local.state==='missing-splits',inputs=await toolkit.inspectInputs(name);
  if(!serial)return finish({state:missing?'needs-input':'partial',packageName,reason:missing?'A declared split is missing; select an LDPlayer device to inspect the matching installed app.':'No device selected; offline APK inspection does not prove downloaded-asset completeness.'});
  validateSerial(serial);validatePackageName(packageName);
  if(local.signing?.state!=='verified')return finish({state:'blocked',packageName,serial,reason:'APK signing identity is unverified; configure a trusted apksigner before automatic device recovery.'});
  let client=dependencies.client,adb;const adbRun=boundedAdbRun(toolkit.run);
  if(!client){adb=resolveAdbPath(undefined,{env:toolkit.env});client=createAdbClient({file:adb,run:adbRun,runOptions:{cwd:toolkit.root,env:toolkit.env,leaseDirectory:path.join(workspace,'.retk-lock'),toolchainRoot:toolkit.root}});}
  await client.selectDevice(serial);
  const paths=await client.packagePaths(serial,packageName),basePaths=paths.length===1?paths:paths.filter(file=>path.posix.basename(file)==='base.apk');
  if(basePaths.length!==1)return finish({state:'blocked',packageName,serial,reason:'Cannot uniquely locate the installed base APK for identity verification.'});
  const remoteBase=basePaths[0],localBase=path.join(directory,'installed-base.apk'),size=await client.size(serial,remoteBase);
  check(Number.isSafeInteger(size)&&size>0&&size<=8*GiB,'Installed base APK exceeds the capture budget');
  await client.pull(serial,remoteBase,localBase);assertAssetPath(localBase,directory);
  check(fileIdentity(localBase).size===size&&await client.size(serial,remoteBase)===size,'Installed base changed while pulling','android_device_changed');
  const installed=await inspect([localBase],inspectionOptions);
  if(!matchingBase(local,installed))return finish({state:'blocked',packageName,serial,reason:'Installed base APK bytes, package, version or verified signer differ from the original input.'});
  const obbs=await client.obbPaths(serial,packageName),needsCapture=missing||inputs.state==='missing-input'&&paths.length>original.apks.length||obbs.length>0&&!original.obbEntries?.length;
  if(!needsCapture)return finish({packageName,serial,reason:'Installed base matches; no missing declared split or additional input requirement was established.'});
  if(params.autoPull===false)return finish({state:'needs-input',packageName,serial,reason:'Matching installed content is available; automatic pull is disabled.'});
  let capture=dependencies.capture;
  if(!capture){const {captureBundle}=await import('./capture.js');capture=captureBundle;}
  const includeData=params.includeData!==false;
  let dataClient;if(includeData&&!dependencies.capture){const {createAdbDataClient}=await import('./data-client.js');dataClient=createAdbDataClient({file:adb,run:adbRun,runOptions:{cwd:toolkit.root,env:toolkit.env,leaseDirectory:path.join(workspace,'.retk-lock'),toolchainRoot:toolkit.root}});}
  const captured=await capture({workspace,packageName,serial,client,skipLaunch:true,includeData,dataClient});
  const collected=await collect(captured.bundle,path.join(directory,'captured-apks')),verified=await inspect(collected.apks,inspectionOptions);
  const currentPaths=await client.packagePaths(serial,packageName);
  if(!unchangedPaths(paths,currentPaths)||!matchingBase(local,verified)||verified.state!=='complete-for-declared-requirements')return finish({state:'blocked',packageName,serial,capture:{bundle:captured.bundle,manifest:captured.manifest},reason:'Captured APK set changed or has unverified/missing split dependencies; original selected inputs were preserved.'});
  check(fileIdentity(archive.path).sha256===archive.sha256,'Original archive changed before input publication','android_input_changed');
  const publication=await ingestCapture(toolkit,name,captured,project);
  return finish({...publication,packageName,serial,capture:{bundle:captured.bundle,manifest:captured.manifest,apks:verified.apks.length},missingSplits:[],missingSplitTypes:[],downloadedData:{...dataCoverage(),...(captured.applicationData?{captured:captured.applicationData}:{}),obbFiles:obbs.length},reason:publication.reason??'Matching installed APK set captured and validated. Unrequested or not-yet-downloaded assets remain unverified.'});
 });}finally{lease.release();}
}
