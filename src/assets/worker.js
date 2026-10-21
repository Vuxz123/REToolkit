// Detached owner. The recovery marker is created before spawn and is removed
// only after the ChildProcess close event. Owner PID death never reclaims it.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {AsyncResource} from 'node:async_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {createToolkit} from '../toolkit.js';
import {acquireToolchainRead} from '../toolchain/lease.js';
import {withWorkspaceLock,fingerprint,outputManifest,setStep} from '../state.js';
import {assertAssetPath,safeAssetExportPath} from './context.js';
import {BridgeError,createFrameDecoder,validateRequest,sourcePath,REQUEST_LIMIT,RESPONSE_LIMIT} from './protocol.js';
import {atomicJson,readJson,runtimePaths,releaseGate,verifyBinding} from './runtime.js';

const config=readJson(process.argv[2]),toolkit=createToolkit(config.root,{log:()=>{}}),paths=runtimePaths(toolkit,config.name,config.runId);
let record=readJson(paths.current),engine,engineClosed=false,engineStarted=false,engineError,enginePort,closing=false,server,stop=false,uncertain=false,queue=Promise.resolve(),busy=0,logBytes=0,runOwned,loadCompleted=false;
const sockets=new Set(),jobs=[];
const errorValue=error=>({code:error.code??'asset_error',message:String(error.message??'Asset operation failed').split(config.inputPath).join('[selected source]').slice(0,1024)});
const update=change=>{if(readJson(paths.current).runId!==config.runId)throw new BridgeError('session_conflict','Asset descriptor ownership changed');record={...record,...change};atomicJson(paths.current,record);};
const status=()=>({runId:config.runId,state:record.phase,engineVersion:'1.3.14',engineClosed,loadCompleted,binding:config.binding,engineIdentity:fingerprint(config.engineIdentity),settingsFingerprint:fingerprint(config.settings),capabilities:record.capabilities??[],jobs:jobs.map(j=>({...j}))});
const cancelled=()=>stop||fs.existsSync(paths.cancel);
const enqueue=action=>{
 if(busy>=16)throw new BridgeError('queue_limit','Asset operation queue is full');busy++;
 const next=queue.then(()=>{if(cancelled()||uncertain||closing)throw new BridgeError('session_stopping','Asset session stopped before the queued operation began');return runOwned(action);});queue=next.catch(()=>{}).finally(()=>{busy--;});return next;
};
function job(kind,action) {
 const item={id:randomUUID(),kind,state:'queued',createdAt:new Date().toISOString()};jobs.push(item);if(jobs.length>100)jobs.shift();
 enqueue(async()=>{
  item.state='running';item.startedAt=new Date().toISOString();
  try{await verifyBinding(config,toolkit);item.result=await action();await verifyBinding(config,toolkit);item.state='succeeded';if(kind==='load')loadCompleted=true;}
  catch(error){item.error=errorValue(error);item.state=error.code==='engine_timeout'?'uncertain':'failed';if(error.code==='engine_timeout')stop=true;}
  finally{item.completedAt=new Date().toISOString();}
 }).catch(error=>{item.state='failed';item.error=errorValue(error);});return {job:{...item}};
}
async function http(route,{form,limit=RESPONSE_LIMIT,timeoutMs=config.jobTimeoutMs,redirect=false}={}) {
 if(!enginePort||engineClosed)throw new BridgeError('engine_closed','Owned AssetRipper is not running');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  const response=await fetch(`http://127.0.0.1:${enginePort}${route}`,{method:form?'POST':'GET',redirect:'manual',signal:controller.signal,headers:form?{'Content-Type':'application/x-www-form-urlencoded'}:{},body:form?new URLSearchParams(form):undefined});
  if(response.status>=300&&response.status<400){
   const location=response.headers.get('location');await response.body?.cancel();
   if(!redirect||response.status!==302||!location||new URL(location,`http://127.0.0.1:${enginePort}`).href!==`http://127.0.0.1:${enginePort}/`)throw new BridgeError('engine_redirect','AssetRipper returned an unexpected redirect');
   return {data:Buffer.alloc(0),contentType:''};
  }
  if(!response.ok){await response.body?.cancel();throw new BridgeError('engine_http',`AssetRipper HTTP ${response.status}`);}
  const length=Number(response.headers.get('content-length'));if(length>limit){await response.body?.cancel();throw new BridgeError('response_limit','AssetRipper response exceeds the limit');}
  const chunks=[];let count=0;for await(const chunk of response.body){count+=chunk.length;if(count>limit){controller.abort();throw new BridgeError('response_limit','AssetRipper response exceeds the limit');}chunks.push(chunk);}
  return {data:Buffer.concat(chunks),contentType:response.headers.get('content-type')??''};
 }catch(error){if(controller.signal.aborted&&error.code!=='response_limit')throw new BridgeError('engine_timeout','Engine deadline exceeded; result is uncertain until owned child closes');throw error;}
 finally{clearTimeout(timer);}
}
async function capabilities() {
 const {data}=await http('/openapi.json',{timeoutMs:5000});let doc;try{doc=JSON.parse(data);}catch{throw new BridgeError('capability_mismatch','AssetRipper OpenAPI is invalid');}
 const needed=[['/LoadFolder','post'],['/Export/UnityProject','post'],['/Assets/Json','get'],['/Assets/Yaml','get'],['/Assets/Text','get'],['/Assets/Binary','get']];
 if(!/^3\./.test(doc.openapi??'')||needed.some(([route,method])=>!doc.paths?.[route]?.[method]))throw new BridgeError('capability_mismatch','AssetRipper does not advertise the pinned 1.3.14 operations');
 return Object.entries(doc.paths).filter(([route,value])=>/^\/Assets\//.test(route)&&value.get).map(([route])=>route).concat(['/LoadFolder','/Export/UnityProject']);
}
async function exportProject() {
 if(!loadCompleted)throw new BridgeError('engine_not_loaded','The selected source load has not completed successfully');
 const selected=await verifyBinding(config,toolkit),project=selected.project,id=randomUUID();
 const destination=safeAssetExportPath(config.workspace,project.assetReconstruction?.exportRoot??project.reconstructedSourceDir,config.inputPath);
 const projectFile=assertAssetPath(path.join(config.workspace,'project.re.json'),config.workspace),originalProject=fs.readFileSync(projectFile);
 const base=assertAssetPath(path.join(config.workspace,'04_Notes/assets'),config.workspace);fs.mkdirSync(base,{recursive:true});
 const stage=assertAssetPath(path.join(base,'export-stages',id),config.workspace);fs.mkdirSync(stage,{recursive:true});if(fs.readdirSync(stage).length)throw new BridgeError('export_stage','Export stage must be empty');
 const journal=path.join(base,`export-${id}.json`);
 const backupPath=assertAssetPath(path.join(config.workspace,'backups',`assets-${id}`),config.workspace);
 const receipt={kind:'retoolkit-asset-export',schemaVersion:1,runId:config.runId,binding:config.binding,stage,destination,backupPath:null,phase:'exporting'};atomicJson(journal,receipt);
 await http('/Export/UnityProject',{form:{Path:stage},redirect:true});
 await verifyBinding(config,toolkit);
 const {locateUnityProject}=await import('./graph.js');const unityRoot=await locateUnityProject(stage);
 if(!fs.existsSync(path.join(unityRoot,'ProjectSettings/ProjectVersion.txt')))throw new BridgeError('export_invalid','Export is missing ProjectVersion.txt');
 const relativeRoot=path.relative(stage,unityRoot);receipt.phase='validated';atomicJson(journal,receipt);
 let moved=false,published=false;
 try{
  safeAssetExportPath(config.workspace,destination,config.inputPath);assertAssetPath(stage,config.workspace);assertAssetPath(backupPath,config.workspace);fs.mkdirSync(path.dirname(backupPath),{recursive:true});
  receipt.phase='publishing';atomicJson(journal,receipt);
  if(fs.existsSync(destination)){fs.renameSync(destination,backupPath);moved=true;receipt.backupPath=backupPath;receipt.phase='backed_up';atomicJson(journal,receipt);}
  fs.mkdirSync(path.dirname(destination),{recursive:true});fs.renameSync(stage,destination);published=true;
  project.reconstructedSourceDir=path.join(destination,relativeRoot);
  setStep(project,'assetripper','succeeded',fingerprint({binding:config.binding,engine:config.engineIdentity,settings:config.settings}),outputManifest([destination]));
  project.steps.assetripper.coverage='export_ready';project.assetReconstruction={state:'export_ready',exportRoot:destination,runId:config.runId,binding:config.binding,compileReady:false,bindingsVerified:false,behavior:'unverified'};
  await toolkit.save(config.name,project);if(config.exportFault==='after-state-save')throw new BridgeError('fixture_publication_failure','Fixture publication failure after state save');receipt.phase='published';receipt.projectDir=project.reconstructedSourceDir;atomicJson(journal,receipt);
  return {state:'export_ready',projectDir:project.reconstructedSourceDir,backupPath:receipt.backupPath,binding:config.binding,compileReady:false,bindingsVerified:false,behavior:'unverified'};
 }catch(error){
  try{
   if(published){const failed=destination+'.failed-'+id;fs.renameSync(destination,failed);receipt.failedPath=failed;}if(moved)fs.renameSync(backupPath,destination);
   const current=fs.readFileSync(assertAssetPath(projectFile,config.workspace));
   if(!current.equals(originalProject)){
    if(fingerprint(JSON.parse(current))!==fingerprint(project))throw new BridgeError('asset_recovery_required','Project state changed outside this export transaction');
    const rollback=projectFile+'.rollback-'+id;fs.writeFileSync(rollback,originalProject,{flag:'wx',mode:0o600});fs.renameSync(rollback,projectFile);
   }
   receipt.phase='rolled_back';atomicJson(journal,receipt);
  }
  catch{receipt.phase='recovery_required';atomicJson(journal,receipt);uncertain=true;stop=true;throw new BridgeError('asset_recovery_required','Export publication rollback is uncertain; ownership retained');}throw error;
 }
}
async function dispatch(method,params) {
 if(method==='session.status')return status();
 if(method==='session.stop'){stop=true;return {state:'stopping',runId:config.runId};}
 if(cancelled()||record.phase!=='ready')throw new BridgeError('session_stopping','Asset session is stopping');
 if(method==='assets.export'){if(Object.keys(params).length)throw new BridgeError('invalid_argument','Export accepts no destination parameters');return job('export',exportProject);}
 if(method==='assets.raw'){
  const selector=sourcePath(params);if(!record.capabilities.includes(selector.route))throw new BridgeError('capability_missing','Raw asset format is not advertised by this engine');
  return enqueue(async()=>{if(!loadCompleted)throw new BridgeError('engine_not_loaded','The selected source load has not completed successfully');await verifyBinding(config,toolkit);const response=await http(selector.route+'?Path='+encodeURIComponent(selector.path),{limit:selector.binary?1024*1024:1500000});await verifyBinding(config,toolkit);return {format:params.format,pathID:params.pathID,contentType:response.contentType,encoding:selector.binary?'base64':'utf8',data:response.data.toString(selector.binary?'base64':'utf8')};});
 }
 if(method==='operation')return enqueue(async()=>{
  if(Object.hasOwn(params,'requestId')){
   if(Object.keys(params).length!==1||typeof params.requestId!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(params.requestId))throw new BridgeError('invalid_argument','Invalid operation envelope identity');
   const file=assertAssetPath(path.join(paths.run,'operations',params.requestId+'.json')),stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>32*1024*1024)throw new BridgeError('request_limit','Invalid operation envelope or payload exceeds 32 MiB');
   const bytes=fs.readFileSync(file);if(bytes.length>32*1024*1024)throw new BridgeError('request_limit','Operation envelope exceeds 32 MiB');params=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));fs.unlinkSync(file);
  }
  if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(k=>!['method','params'].includes(k)))throw new BridgeError('invalid_argument','Unknown typed operation parameter');
  try{
   await verifyBinding(config,toolkit);if(config.operationFault){await delay(100);throw new BridgeError(config.operationFault,'Fixture reconstruction recovery uncertainty');}const {handleOwnedAssetOperation}=await import('./service.js');const result=await handleOwnedAssetOperation(toolkit,config.name,params.method,params.params??{});await verifyBinding(config,toolkit);return result;
  }catch(error){if(['reconstruction_recovery_required','asset_recovery_required'].includes(error.code)){uncertain=true;stop=true;update({phase:'cleanup-pending',error:errorValue(error)});}throw error;}
 });
 throw new BridgeError('invalid_request','Unsupported asset operation');
}
function serve() {
 server=net.createServer(socket=>{
  if(sockets.size>=32){socket.destroy();return;}sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));socket.setTimeout(300000,()=>socket.destroy());let pending=0;
  const decode=createFrameDecoder(request=>{
   if(++pending>4){socket.destroy();return;}
   const respond=(ok,value)=>{pending--;if(socket.destroyed)return;let response={version:1,runId:config.runId,id:request.id,ok,...(ok?{result:value}:{error:errorValue(value)})};let frame=JSON.stringify(response)+'\n';if(Buffer.byteLength(frame)-1>RESPONSE_LIMIT){response={version:1,runId:config.runId,id:request.id,ok:false,error:{code:'response_limit',message:'Asset bridge response exceeds 2 MiB'}};frame=JSON.stringify(response)+'\n';}socket.end(frame);};
   try{validateRequest(request,config);Promise.resolve(dispatch(request.method,request.params)).then(result=>respond(true,result),error=>respond(false,error));}catch(error){respond(false,error);}
  },REQUEST_LIMIT);
  socket.on('data',data=>{try{decode(data);}catch{socket.destroy();}});
 });
 return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{atomicJson(paths.endpoint,{version:1,runId:config.runId,host:'127.0.0.1',port:server.address().port});resolve();});});
}
function observeOutput(chunk) {
 const text=chunk.toString('utf8');if(logBytes<4*1024*1024){const remaining=4*1024*1024-logBytes;fs.appendFileSync(paths.log,chunk.subarray(0,remaining));logBytes+=Math.min(chunk.length,remaining);}
 output=(output+text).slice(-8192);const matches=[...output.matchAll(/Now listening on:\s*http:\/\/127\.0\.0\.1:(\d+)/g)];
 if(matches.length){const port=Number(matches.at(-1)[1]);if(enginePort&&enginePort!==port){stop=true;engineError=new BridgeError('endpoint_mismatch','Engine advertised conflicting endpoints');}else enginePort=port;}
}
let output='';let lease,marker;
process.on('SIGTERM',()=>{stop=true;});process.on('SIGINT',()=>{stop=true;});
try{
 update({ownerPid:process.pid});lease=acquireToolchainRead(config.root);
 await withWorkspaceLock(config.workspace,async()=>{
  runOwned=AsyncResource.bind(action=>action());
  marker=path.join(config.workspace,'.retk-lock',`assets-engine-${config.runId}.json`);
  await verifyBinding(config,toolkit);if(cancelled())return;
  atomicJson(marker,{runId:config.runId,ownerPid:process.pid,phase:'launching',engineIdentity:fingerprint(config.engineIdentity)});
  const runEnvironment=path.join(paths.run,'environment');for(const name of ['appdata','local','temp'])fs.mkdirSync(path.join(runEnvironment,name),{recursive:true});
  engine=spawn(config.engine.file,config.engine.args,{cwd:config.engine.cwd,env:{...process.env,...config.engine.env,APPDATA:path.join(runEnvironment,'appdata'),LOCALAPPDATA:path.join(runEnvironment,'local'),TEMP:path.join(runEnvironment,'temp'),TMP:path.join(runEnvironment,'temp')},windowsHide:true,stdio:['ignore','pipe','pipe']});engineStarted=true;
  engine.stdout.on('data',observeOutput);engine.stderr.on('data',observeOutput);
  engine.once('error',error=>{engineError=new BridgeError('engine_start_failed','Owned AssetRipper could not start');});engine.once('close',(code,signal)=>{engineClosed=true;if(!closing)engineError??=new BridgeError('engine_exited',`Owned AssetRipper closed unexpectedly (${code??signal})`);});
  const deadline=Date.now()+config.startupMs;
  try{
   while(!enginePort&&!engineClosed&&!cancelled()&&Date.now()<deadline)await delay(25);
   if(engineClosed)throw engineError;if(cancelled())return;if(!enginePort)throw new BridgeError('startup_timeout','Engine did not advertise a loopback endpoint');
   const available=await capabilities();await serve();update({phase:'ready',engineVersion:'1.3.14',capabilities:available});
   if(!config.skipLoad)job('load',async()=>{await http('/LoadFolder',{form:{Path:config.inputPath},redirect:true});return {state:'load_completed',verification:'command_completed_only'};});
   while(!cancelled()&&!engineClosed)await delay(40);
   if(engineClosed&&!cancelled())throw engineError;
  }finally{
   closing=true;if(!engineClosed){update({phase:'stopping'});engine.kill();const end=Date.now()+10000;while(!engineClosed&&Date.now()<end)await delay(25);}
   if(!engineClosed){uncertain=true;update({phase:'cleanup-pending',error:{code:'cleanup_pending',message:'Owned child close is unconfirmed; ownership retained'}});}
   // Wait for in-flight HTTP/queue rejection before writing the terminal state.
   if(engineClosed){await queue;if(!uncertain)fs.rmSync(marker,{force:true});else update({phase:'cleanup-pending',engineClosed:true,error:record.error??{code:'asset_recovery_required',message:'Transaction recovery is uncertain; ownership retained'}});}
  }
 });
 if(!uncertain){update({phase:'stopped',completedAt:new Date().toISOString()});}
}catch(error){
 if(!engineStarted||engineClosed){update({phase:uncertain?'cleanup-pending':'failed',error:errorValue(error),completedAt:new Date().toISOString()});if(marker&&!uncertain)fs.rmSync(marker,{force:true});}
 else{uncertain=true;update({phase:'cleanup-pending',error:errorValue(error)});}
}finally{
 if(!uncertain&&(!engineStarted||engineClosed)){lease?.release();releaseGate(paths,config.gateToken);fs.rmSync(paths.endpoint,{force:true});}
 for(const socket of sockets)socket.destroy();server?.close();
}
