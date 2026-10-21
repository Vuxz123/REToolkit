import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {withWorkspaceLock} from '../state.js';
import {acquireToolchainRead} from '../toolchain/lease.js';
import {BridgeError} from './protocol.js';
import {assertAssetPath} from './context.js';
import {sendRequest} from './client.js';
import {atomicJson,secureDirectory,readJson,runtimePaths,readSession,publicSession,releaseGate,bindingFor,copyEngine,verifyBinding} from './runtime.js';
export function hasAssetSession(toolkit,name) {const record=readSession(toolkit,name);return Boolean(record&&!['stopped','failed'].includes(record.phase));}
export async function requestAssetSession(toolkit,name,method,params={},options={}) {
 const record=readSession(toolkit,name);if(!record||!['ready','stopping','cleanup-pending'].includes(record.phase))throw new BridgeError('session_not_running','No owned asset session is ready');
 const paths=runtimePaths(toolkit,name,record.runId),config=readJson(paths.config);
 if(config.runId!==record.runId||config.workspace!==fs.realpathSync(toolkit.workspace(name)))throw new BridgeError('binding_mismatch','Asset descriptor does not bind this workspace');
 if(!['session.status','session.stop'].includes(method))await verifyBinding(config,toolkit);
 const endpoint=readJson(paths.endpoint);if(endpoint.runId!==record.runId)throw new BridgeError('binding_mismatch','Asset endpoint does not bind this run');
 let wireParams=params;
 if(method==='operation'&&Buffer.byteLength(JSON.stringify(params))>60*1024){
  const payload=JSON.stringify(params);if(Buffer.byteLength(payload)>32*1024*1024)throw new BridgeError('request_limit','Operation payload exceeds 32 MiB');
  const directory=assertAssetPath(path.join(paths.run,'operations'));fs.mkdirSync(directory,{mode:0o700,recursive:true});const requestId=randomUUID(),file=assertAssetPath(path.join(directory,requestId+'.json'));
  fs.writeFileSync(file,payload,{flag:'wx',mode:0o600});wireParams={requestId};
 }
 const started=Date.now(),result=await sendRequest({...endpoint,token:config.token},method,wireParams,options);
 if(method!=='assets.export'||options.wait===false)return result;
 const timeoutMs=options.timeoutMs??60000;
 for(;;){
  const status=await requestAssetSession(toolkit,name,'session.status',{}, {timeoutMs:Math.min(5000,timeoutMs)}),job=status.jobs.find(j=>j.id===result.job.id);
  if(job?.state==='succeeded')return {...job.result,jobId:job.id};
  if(job&&['failed','uncertain'].includes(job.state))throw new BridgeError(job.error?.code??'export_failed',job.error?.message??'Export job failed');
  if(Date.now()-started>=timeoutMs)throw new BridgeError('request_timeout','Export deadline exceeded; inspect session job status; owned job is still running');await delay(40);
 }
}
export async function assetSessionStatus(toolkit,name) {
 const record=readSession(toolkit,name),result=publicSession(record);
 if(record&&['ready','stopping','cleanup-pending'].includes(record.phase)){try{result.live=await requestAssetSession(toolkit,name,'session.status',{}, {timeoutMs:5000});}catch(error){result.liveError={code:error.code??'session_error',message:error.message};}}
 return result;
}
export async function startAssetSession(toolkit,name,{timeoutMs=300000,jobTimeoutMs=1800000}={},dependencies={}) {
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000||!Number.isInteger(jobTimeoutMs)||jobTimeoutMs<10||jobTimeoutMs>86400000)throw new BridgeError('invalid_argument','Startup/job timeout is out of range');
 const selected=await bindingFor(toolkit,name),paths=runtimePaths(toolkit,name);secureDirectory(paths.base);
 const token=randomUUID();try{fs.mkdirSync(paths.gate);}catch(error){if(error.code==='EEXIST')throw new BridgeError('session_conflict','Another asset startup or uncertain session owns the startup gate');throw error;}
 fs.writeFileSync(path.join(paths.gate,'owner-'+token),'',{flag:'wx',mode:0o600});let launched=false,runId;
 try{
  const previous=readSession(toolkit,name);if(previous&&!['stopped','failed'].includes(previous.phase))throw new BridgeError('session_conflict','An owned asset session already exists');
  // Read lease covers verification/copy until the detached owner takes its own.
  const lease=acquireToolchainRead(toolkit.root);
  try{
   runId=randomUUID();const runPaths=runtimePaths(toolkit,name,runId);secureDirectory(runPaths.run);
   const config={version:1,root:toolkit.root,name,runId,token:randomBytes(32).toString('hex'),workspace:selected.workspace,inputPath:selected.inputPath,binding:selected.binding,sourceManifest:selected.sourceManifest,gateToken:token,startupMs:timeoutMs,jobTimeoutMs,skipLoad:dependencies.skipLoad===true,exportFault:dependencies.exportFault==='after-state-save'?'after-state-save':null,operationFault:dependencies.operationFault==='reconstruction_recovery_required'?'reconstruction_recovery_required':null};
   if(dependencies.engine){config.engine=dependencies.engine(runPaths.config);config.engineIdentity={kind:'dependency-fixture'};config.settings={source:'fixture'};}
   else{const copied=copyEngine(toolkit,runPaths.run);config.engineIdentity=copied.inventory;config.settings=copied.settings;config.engine={file:copied.file,args:['--headless','--port','0','--log=false']};}
   config.engine.cwd=path.dirname(config.engine.file);atomicJson(runPaths.config,config);atomicJson(paths.current,{runId,phase:'starting',startedAt:new Date().toISOString()});
   const log=fs.openSync(runPaths.log,'a');try{const child=spawn(process.execPath,[fileURLToPath(new URL('./worker.js',import.meta.url)),runPaths.config],{detached:true,windowsHide:true,stdio:['ignore',log,log]});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();launched=true;}finally{fs.closeSync(log);}
  }finally{lease.release();}
  const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){const record=readSession(toolkit,name);if(record?.runId!==runId)throw new BridgeError('session_conflict','Asset startup ownership changed');if(record.phase==='ready')return publicSession(record);if(['failed','stopped','cleanup-pending'].includes(record.phase))throw new BridgeError(record.error?.code??'startup_failed',record.error?.message??'Asset startup failed');await delay(30);}
  atomicJson(runtimePaths(toolkit,name,runId).cancel,{runId,reason:'startup_timeout'});throw new BridgeError('startup_timeout','Asset startup deadline exceeded; cancellation requested; inspect status before retrying');
 }finally{if(!launched)releaseGate(paths,token);}
}
export async function stopAssetSession(toolkit,name,{timeoutMs=30000}={}) {
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw new BridgeError('invalid_argument','Stop timeout must be 1..300000ms');
 let record=readSession(toolkit,name);if(!record)return publicSession(null);const runId=record.runId,paths=runtimePaths(toolkit,name,runId);
 if(!['stopped','failed'].includes(record.phase)){atomicJson(paths.cancel,{runId,reason:'user_stop'});await requestAssetSession(toolkit,name,'session.stop',{}, {timeoutMs:2000}).catch(()=>{});}
 const deadline=Date.now()+timeoutMs;
 while(Date.now()<deadline){record=readSession(toolkit,name);if(record?.runId!==runId)throw new BridgeError('session_conflict','Asset stop ownership changed');if(['stopped','failed'].includes(record.phase)&&!fs.existsSync(paths.gate)){await withWorkspaceLock(toolkit.workspace(name),()=>{}, {timeoutMs:Math.max(0,deadline-Date.now())});return publicSession(record);}await delay(30);}
 throw new BridgeError('cleanup_pending','Asset child close or lease release is not confirmed; ownership markers were retained');
}
