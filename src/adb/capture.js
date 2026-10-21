import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import yazl from 'yazl';
import {fileIdentity} from '../state.js';
import {walk} from '../inputs.js';
import {rejectOutputLinks,publishJson} from '../artifacts.js';
import {validatePackageName,validateSerial} from './client.js';

const MAX_FILES=1024,MAX_FILE_BYTES=8*1024**3,MAX_TOTAL_BYTES=32*1024**3;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
function remoteEntry(remote,kind,packageName){
 if(typeof remote!=='string'||remote.length>2048||!/^\/(?:[A-Za-z0-9_~+.=@-]+\/)*[A-Za-z0-9_~+.=@-]+$/.test(remote)||remote.split('/').some(part=>part==='.'||part==='..'))fail('ADB_PATH_INVALID','Unsafe remote capture path');
 const base=path.posix.basename(remote);
 if(!/^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/.test(base)||/[. ]$/.test(base)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(base)||!base.toLowerCase().endsWith(kind==='apk'?'.apk':'.obb'))fail('ADB_PATH_INVALID','Unsafe capture filename');
 if(kind==='obb'&&path.posix.dirname(remote)!==`/sdcard/Android/obb/${packageName}`)fail('ADB_PATH_INVALID','Invalid OBB package directory');
 return kind==='apk'?base:`Android/obb/${packageName}/${base}`;
}
function inventoryPaths(apks,obbs,packageName){
 if(!Array.isArray(apks)||!apks.length||!Array.isArray(obbs)||apks.length+obbs.length>MAX_FILES)fail('ADB_METADATA_INVALID','Empty or excessive APK/OBB metadata');
 const entries=[...apks.map(remote=>({remote,entry:remoteEntry(remote,'apk',packageName)})),...obbs.map(remote=>({remote,entry:remoteEntry(remote,'obb',packageName)}))];
 const names=new Set();
 for(const item of entries){const key=item.entry.toLowerCase();if(names.has(key))fail('ADB_PATH_COLLISION','Duplicate or colliding capture filename');names.add(key);}
 return entries;
}
function verifyPayload(payload,files){
 rejectOutputLinks(payload);const found=walk(payload),expected=new Set(files.map(item=>path.join(payload,...item.entry.split('/')).toLowerCase()));
 if(found.length!==expected.size||found.some(file=>!expected.has(file.toLowerCase())))fail('ADB_CAPTURE_INVALID','Unexpected or missing capture files');
 for(const item of files){const file=path.join(payload,...item.entry.split('/'));rejectOutputLinks(file);const identity=fileIdentity(file);if(identity.sha256!==item.sha256||identity.size!==item.size)fail('ADB_CAPTURE_CHANGED','Captured file changed during archive creation');}
}
async function archivePayload(payload,files,manifest,output){
 const zip=new yazl.ZipFile();zip.on('error',error=>zip.outputStream.destroy(error));
 const completion=pipeline(zip.outputStream,fs.createWriteStream(output,{flags:'wx'}));completion.catch(()=>{});
 try{
  for(const item of files){rejectOutputLinks(path.join(payload,...item.entry.split('/')));zip.addFile(path.join(payload,...item.entry.split('/')),item.entry,{compress:false});}
  zip.addBuffer(Buffer.from(JSON.stringify(manifest,null,2)+'\n'),'retk-capture.json');zip.end();await completion;
 }catch(error){zip.outputStream.destroy(error);await completion.catch(()=>{});throw error;}
}
/** Caller holds the workspace lease until every ADB child has closed. */
export async function captureBundle({workspace,packageName,serial,client,skipLaunch=false,confirm}){
 validatePackageName(packageName);validateSerial(serial);
 if(typeof skipLaunch!=='boolean'||!skipLaunch&&typeof confirm!=='function')fail('ADB_INTERACTIVE_REQUIRED','Interactive launch requires a confirmation callback; use --skip-launch for unattended capture');
 workspace=path.resolve(workspace);rejectOutputLinks(workspace);rejectOutputLinks(path.join(workspace,'00_OriginalBuild'));
 if(!fs.statSync(workspace).isDirectory())fail('ADB_PATH_INVALID','Capture workspace must be a directory');
 const runId=randomUUID(),staging=path.join(workspace,`.adb-capture-${runId}`),payload=path.join(staging,'payload');
 fs.mkdirSync(staging,{mode:0o700});fs.mkdirSync(payload);
 try{
  let apks=await client.packagePaths(serial,packageName);
  if(!skipLaunch){await client.launch(serial,packageName);await confirm();apks=await client.packagePaths(serial,packageName);}
  const obbs=await client.obbPaths(serial,packageName),files=inventoryPaths(apks,obbs,packageName);let total=0;
  for(const item of files){
   const target=path.join(payload,...item.entry.split('/'));rejectOutputLinks(target);fs.mkdirSync(path.dirname(target),{recursive:true});
   const size=await client.size(serial,item.remote);
   if(!Number.isSafeInteger(size)||size<1||size>MAX_FILE_BYTES||(total+=size)>MAX_TOTAL_BYTES)fail('ADB_CAPTURE_INVALID','Remote file size exceeds capture bounds or is empty');
   await client.pull(serial,item.remote,target);rejectOutputLinks(target);
   const stat=fs.lstatSync(target);if(!stat.isFile()||stat.size!==size)fail('ADB_CAPTURE_INVALID','ADB pull produced a missing, partial or invalid file size');
   if(await client.size(serial,item.remote)!==size)fail('ADB_CAPTURE_CHANGED','Remote file size changed while pulling; retry after downloads finish');
   Object.assign(item,fileIdentity(target));delete item.path;
  }
  verifyPayload(payload,files);
  const capturedAt=new Date().toISOString();
  const evidence={kind:'retoolkit-adb-capture',schemaVersion:1,runId,packageName,serial,capturedAt,files,
   limitations:['Local SHA256 and remote size observations do not establish an atomic device snapshot or binary/metadata compatibility.']};
  const temporary=path.join(staging,'bundle.xapk');await archivePayload(payload,files,evidence,temporary);verifyPayload(payload,files);
  const archive=fileIdentity(temporary),directory=path.join(workspace,'00_OriginalBuild');rejectOutputLinks(directory);fs.mkdirSync(directory,{recursive:true});rejectOutputLinks(directory);
  const bundle=path.join(directory,`${packageName}-${runId}.xapk`),manifest=path.join(staging,'capture.json');
  publishJson(manifest,{...evidence,bundle,archive:{sha256:archive.sha256,size:archive.size}});
  rejectOutputLinks(bundle);fs.linkSync(temporary,bundle);fs.unlinkSync(temporary);
  // Only this successful, fully observed invocation removes its verified payload.
  // Failed calls keep staging; parent death cannot reach this cleanup.
  verifyPayload(payload,files);fs.rmSync(payload,{recursive:true});
  return {state:'captured',runId,packageName,serial,bundle,manifest,staging,files,archive:{sha256:archive.sha256,size:archive.size},limitations:evidence.limitations};
 }catch(error){error.message+=`\nADB capture staging retained: ${staging}`;error.staging=staging;throw error;}
}
