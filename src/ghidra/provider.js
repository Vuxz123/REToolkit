import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes,randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { runtimePaths,secureDirectory,atomicJson,readJson,readSession,publicSession,releaseStartupGate } from './runtime.js';
import { validateProject,verifyBinding,sessionProfile,engineEnvironment } from './environment.js';
import { connectClient } from './client.js';
import { BridgeError,mutationParams } from './protocol.js';
import { fingerprint,withWorkspaceLock } from '../state.js';

function configFor(toolkit,name,record) {
  const paths=runtimePaths(toolkit,name,record.runId);
  const config=readJson(paths.config);
  if(config.runId!==record.runId||config.workspace!==fs.realpathSync(toolkit.workspace(name)))throw new BridgeError('program_mismatch','Session descriptor belongs to another workspace/run');
  return {paths,config};
}
async function connection(toolkit,name,{allowStale=false}={}) {
  const record=readSession(toolkit,name);
  if(!record||record.phase!=='ready')throw new BridgeError(record?.phase==='cleanup-pending'?'cleanup_pending':'session_not_running',`No ready session. Run: node re.js session start ${name}`,{session:publicSession(record)});
  const {paths,config}=configFor(toolkit,name,record);
  if(!allowStale)verifyBinding(config,toolkit,name);
  const endpoint=readJson(paths.endpoint);
  if(endpoint.runId!==config.runId||endpoint.version!==1||endpoint.programIdentity?.program!==config.program||endpoint.programIdentity?.sha256!==config.native.sha256)throw new BridgeError('program_mismatch','Engine endpoint identity does not match session binding');
  return connectClient({...endpoint,token:config.token});
}
function verifySymbolsProfile(toolkit,name) {
  const record=readSession(toolkit,name);if(!record||record.phase!=='ready')return;
  const {config}=configFor(toolkit,name,record);
  const {project,native,metadata}=verifyBinding(config,toolkit,name);
  const current=sessionProfile(toolkit,project,native,metadata);
  if(!current.profile.dumpVerified||fingerprint(current.profile)!==fingerprint(config.profile))
    throw new BridgeError('input_changed','Dump output or dumper profile changed. Stop the session, prepare a verified dump, then restart');
}
export async function querySession(toolkit,name,method,params={},options={}) {
  if(method.startsWith('symbols.'))verifySymbolsProfile(toolkit,name);
  const client=await connection(toolkit,name,{allowStale:['session.status','session.stop'].includes(method)});
  try{return await client.request(method,params,options);}finally{client.close();}
}
export async function mutateSession(toolkit,name,method,params,{dryRun=false,operationId,...options}={}) {
  if(method.startsWith('symbols.'))verifySymbolsProfile(toolkit,name);
  const client=await connection(toolkit,name);
  const id=operationId??randomUUID();
  try {
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw new BridgeError('invalid_argument','Operation ID must be a canonical UUID');
    const record=readSession(toolkit,name);const paths=runtimePaths(toolkit,name,record.runId);
    const requests=path.join(paths.base,'requests');fs.mkdirSync(requests,{mode:0o700,recursive:true});
    const cachedPath=path.join(requests,id+'.json');
    const intent=fingerprint({method,params});
    const {config}=configFor(toolkit,name,record);
    const binding=fingerprint({workspace:config.workspace,program:config.program,projectName:config.projectName,
      native:config.native.sha256,metadata:config.metadata.sha256,importRunId:toolkit.read(name).steps.import.runId});
    let cached;
    if(!dryRun&&fs.existsSync(cachedPath)) {
      cached=readJson(cachedPath);
      if(cached.intent!==intent||cached.method!==method||cached.binding!==binding)throw new BridgeError('operation_conflict','Operation UUID already binds another intent/program/input pair');
      return await client.request(method,cached.params,options);
    }
    const preview=await client.request(method,{...params,dryRun:true},options);
    if(dryRun)return preview;
    const prepared=mutationParams(method,params,preview,id);
    // Store exact observed revision/old value outside the workspace, in this
    // private workspace runtime. Reopened runs reuse it, never a new preview.
    cached={intent,binding,method,params:prepared};
    try{fs.writeFileSync(cachedPath,JSON.stringify(cached),{flag:'wx',mode:0o600});}
    catch(error){if(error.code!=='EEXIST')throw error;cached=readJson(cachedPath);if(cached.intent!==intent||cached.binding!==binding)throw new BridgeError('operation_conflict','Operation UUID already binds another intent/program/input pair');}
    return await client.request(method,cached.params,options);
  }catch(error){error.operationId=id;error.message+=` (operation ${id}; explicit retry: --operation-id ${id})`;throw error;}
  finally{client.close();}
}
export async function sessionStatus(toolkit,name) {
  const record=readSession(toolkit,name);const result=publicSession(record);
  if(record?.phase==='ready')try{result.live=await querySession(toolkit,name,'session.status',{}, {timeoutMs:5000});}
  catch(error){result.liveError={code:error.code,message:error.message};}
  if(record?.phase==='ready')try{const {config}=configFor(toolkit,name,record);verifyBinding(config,toolkit,name);}
  catch(error){result.bindingError={code:error.code,message:error.message};}
  return result;
}
export async function startSession(toolkit,name,{write=false,timeoutMs=300000,idleMs=900000}={},dependencies={}) {
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>300000)throw new BridgeError('invalid_argument','Startup timeout must be 1..300000ms');
  if(!Number.isFinite(idleMs)||idleMs<1000||idleMs>86400000)throw new BridgeError('invalid_argument','Idle timeout must be 1000..86400000ms');
  const validated=validateProject(toolkit,name);
  const paths=runtimePaths(toolkit,name);secureDirectory(paths.base);
  const gateToken=randomUUID();
  try{fs.mkdirSync(paths.gate);}catch(error){if(error.code==='EEXIST')throw new BridgeError('session_conflict','Another session startup owns this workspace; inspect session status');throw error;}
  fs.writeFileSync(path.join(paths.gate,`owner-${gateToken}`),'',{flag:'wx',mode:0o600});
  let ownsGate=true;let launched=false;let createdRunId;
  try {
    const old=readSession(toolkit,name);
    if(old&&!['stopped','failed'].includes(old.phase)) {
      if(old.phase==='ready'&&old.mode===(write?'write':'read')) {
        const {config}=configFor(toolkit,name,old);verifyBinding(config,toolkit,name);
        const status=await sessionStatus(toolkit,name);if(!status.liveError)return status;
      }
      throw new BridgeError('session_conflict',`Session is ${old.phase}; stop or inspect it before starting another`);
    }
    const runId=randomUUID();const runPaths=runtimePaths(toolkit,name,runId);secureDirectory(runPaths.run);
    createdRunId=runId;
    const config={version:1,root:toolkit.root,name,runId,token:randomBytes(32).toString('hex'),mode:write?'write':'read',
      workspace:validated.workspace,projectDir:validated.projectDir,projectName:validated.project.ghidraProjectName,
      program:validated.project.ghidraProgramName,native:validated.native,metadata:validated.metadata,
      ...sessionProfile(toolkit,validated.project,validated.native,validated.metadata),endpointPath:runPaths.endpoint,
      idleMs,startupMs:timeoutMs,gateToken};
    config.engine=dependencies.engine?dependencies.engine(runPaths.config):{file:toolkit.tools.headless,
      args:[config.projectDir,config.projectName,'-process',config.program,'-noanalysis',...(write?[]:['-readOnly']),
        '-scriptPath',path.join(toolkit.root,'scripts/ghidra'),'-postScript','RetkSessionBridge.java',runPaths.config]};
    config.engine.env=engineEnvironment(toolkit,config.workspace);
    atomicJson(runPaths.config,config);
    atomicJson(paths.current,{runId,phase:'starting',mode:config.mode,startedAt:new Date().toISOString(),logPath:runPaths.log});
    const log=fs.openSync(runPaths.log,'a');let child;
    try {child=spawn(process.execPath,[fileURLToPath(new URL('./supervisor.js',import.meta.url)),runPaths.config],
      {detached:true,windowsHide:true,stdio:['ignore',log,log]});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();launched=true;ownsGate=false;
    }finally{fs.closeSync(log);}
    const deadline=Date.now()+timeoutMs;
    while(Date.now()<deadline) {
      const record=readSession(toolkit,name);
      if(record?.runId!==runId)throw new BridgeError('session_conflict','Startup descriptor ownership changed');
      if(record.phase==='ready')return publicSession(record);
      if(['failed','stopped','cleanup-pending'].includes(record.phase))throw new BridgeError(record.error?.code??'startup_failed',record.error?.message??'Session stopped before becoming ready',{logPath:runPaths.log});
      await delay(50);
    }
    atomicJson(runPaths.cancel,{runId,reason:'startup_timeout'});
    throw new BridgeError('startup_timeout','Startup deadline exceeded; cancellation requested. Inspect session status before retrying',{runId,logPath:runPaths.log});
  }catch(error){if(!launched&&ownsGate){const old=readSession(toolkit,name);if(old?.runId===createdRunId&&old?.phase==='starting')atomicJson(paths.current,{...old,phase:'failed',error:{code:'startup_failed',message:'Supervisor could not start'}});}throw error;}
  finally{if(ownsGate)releaseStartupGate(paths,gateToken);}
}
export async function stopSession(toolkit,name,{timeoutMs=30000}={}) {
  let record=readSession(toolkit,name);
  if(!record||['stopped','failed'].includes(record.phase))return publicSession(record);
  const {paths}=configFor(toolkit,name,record);
  atomicJson(paths.cancel,{runId:record.runId,reason:'user_stop'});
  if(record.phase==='ready')await querySession(toolkit,name,'session.stop',{}, {timeoutMs:5000}).catch(()=>{});
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline) {record=readSession(toolkit,name);if(['stopped','failed'].includes(record.phase))return publicSession(record);await delay(50);}
  throw new BridgeError('cleanup_pending','Engine closure has not been confirmed; workspace lock is retained. Inspect session log',{runId:record.runId,logPath:paths.log});
}
export async function recoverSession(toolkit,name) {
  const previous=readSession(toolkit,name);
  if(!previous||['stopped','failed'].includes(previous.phase))return publicSession(previous);
  // Acquiring the existing lease proves no live owner and no uncertain engine
  // marker remains. PID death alone never authorizes descriptor/lock removal.
  return withWorkspaceLock(toolkit.workspace(name),async()=>{
    const record=readSession(toolkit,name);
    if(record.runId!==previous.runId)throw new BridgeError('session_conflict','Session changed while recovery was requested');
    const {paths,config}=configFor(toolkit,name,record);
    const recovered={...record,phase:'stopped',completedAt:new Date().toISOString(),
      error:{code:'owner_exited',message:'Owner and engine leases closed. Reopen to verify Program ledger before trusting any interrupted write.'}};
    atomicJson(paths.current,recovered);fs.rmSync(paths.endpoint,{force:true});releaseStartupGate(paths,config.gateToken);
    return publicSession(recovered);
  });
}
