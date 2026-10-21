// The detached owner survives the CLI and never infers child exit from a PID.
// Its workspace engine marker and toolchain reader are released only on close.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileIdentity,fingerprint,withWorkspaceLock} from '../state.js';
import {createToolkit} from '../toolkit.js';
import {rejectOutputLinks} from '../artifacts.js';
import {acquireToolchainRead} from '../toolchain/lease.js';
import {atomicJson} from '../ghidra/runtime.js';
import {inspectDesktopRuntime,verifyDesktopRuntime} from '../desktop-runtime/index.js';
import {snapshotPythonGeneration} from '../python-runtime/verify.js';
import {desktopLaunchPaths,verifyDesktopLaunchBinding} from './index.js';

const configFile=process.argv[2];rejectOutputLinks(configFile);const configBytes=fs.readFileSync(configFile);if(configBytes.length>1024**2)throw Error('Desktop config exceeds limit.');const config=JSON.parse(configBytes),paths=desktopLaunchPaths(config.root,config.runId);
if(path.resolve(configFile)!==paths.config||path.resolve(config.run)!==paths.run)throw Error('Desktop worker config identity is invalid.');
const toolkit=createToolkit(config.root,{log:()=>{}}),expectedWorkspace=config.name?toolkit.workspace(config.name):path.join(toolkit.root,'.cache/desktop-launch/global');if(path.resolve(config.workspace)!==expectedWorkspace)throw Error('Desktop worker workspace is invalid.');
let record={kind:'retoolkit-desktop-launch',schemaVersion:1,runId:config.runId,mode:config.mode,name:config.name??null,state:'starting',launchObserved:false,childCloseObserved:false,startedAt:new Date().toISOString(),analysis:'unverified',mcp:'unverified',logPath:paths.log},lease,engineStarted=false,engineClosed=false,marker;
const update=change=>{record={...record,...change};rejectOutputLinks(paths.receipt);atomicJson(paths.receipt,record);};
const notify=error=>{if(process.connected)process.send({type:'retk-desktop-observed',runId:config.runId,...(error?{error}:{})},()=>{});};
const publicError=error=>({code:typeof error.code==='string'?error.code:'DESKTOP_LAUNCH_FAILED',message:String(error.message??'Desktop process failed').slice(0,2048)});
// A signal cannot safely kill a command wrapper and establish JVM shutdown.
// Leave the owned GUI running and continue draining it until actual close.
process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});process.on('disconnect',()=>{});
try{
 lease=acquireToolchainRead(config.root);
 await withWorkspaceLock(config.workspace,async()=>{
  verifyDesktopLaunchBinding(toolkit,config.spec.binding);for(const identity of config.spec.identities){rejectOutputLinks(identity.file);const current=fileIdentity(identity.file);if(current.sha256!==identity.sha256||current.size!==identity.size)throw Error('Desktop runtime input changed before launch.');}
  const profile=inspectDesktopRuntime(config.root);if(config.spec.profile){const report=await verifyDesktopRuntime(config.root);if(!report.ok||profile.generation!==config.spec.profile.generation||profile.receiptSha256!==config.spec.profile.receiptSha256)throw Error('Desktop runtime profile changed before launch.');}else if(profile.state!=='absent')throw Error('Desktop runtime selection changed before launch.');
  if(config.spec.privateExtension&&fingerprint(await snapshotPythonGeneration(config.spec.privateExtension.folder))!==config.spec.privateExtension.fingerprint)throw Error('Private Ghidra extension changed before launch.');
  marker=path.join(config.workspace,'.retk-lock','desktop-engine-'+config.runId+'.json');
  try{
   atomicJson(marker,{runId:config.runId,ownerPid:process.pid,state:'launching'});update({ownerPid:process.pid});
   await new Promise((resolve,reject)=>{
   let engine;try{engine=spawn(config.spec.file,config.spec.args,{cwd:config.spec.cwd,env:config.spec.env,shell:false,windowsHide:!config.spec.console,stdio:['ignore','pipe','pipe']});engineStarted=true;}catch(error){reject(error);return;}
   let problem,logBytes=0;const log=chunk=>{try{if(logBytes<4*1024**2){const value=chunk.subarray(0,4*1024**2-logBytes);rejectOutputLinks(paths.log);fs.appendFileSync(paths.log,value);logBytes+=value.length;}}catch(error){problem??=error;}};engine.stdout.on('data',log);engine.stderr.on('data',log);
   engine.once('spawn',()=>{update({state:'launched',launchObserved:true,enginePid:engine.pid});notify();});engine.once('error',error=>{problem??=error;});
   engine.once('close',(code,signal)=>{engineClosed=true;update({state:problem||code!==0?'failed':'closed',childCloseObserved:true,exitCode:code,signal,completedAt:new Date().toISOString(),...(problem?{error:publicError(problem)}:code!==0?{error:{code:'DESKTOP_CHILD_FAILED',message:'Owned desktop process closed with '+(signal??code)+'.'}}:{})});if(problem)reject(problem);else resolve();});
   });
  }finally{
   // Remove our closed/never-started marker before withWorkspaceLock checks
   // whether it can remove its owner file. Unobserved close retains ownership.
   if(!engineStarted||engineClosed){rejectOutputLinks(marker);try{fs.unlinkSync(marker);}catch(error){if(error.code!=='ENOENT')throw error;}marker=null;}
  }
 });
}catch(error){
 const value=publicError(error);if(!engineStarted||engineClosed){if(marker){rejectOutputLinks(marker);fs.unlinkSync(marker);marker=null;}update({state:'failed',error:value,completedAt:new Date().toISOString()});}
 else update({state:'cleanup-pending',error:value});notify(value);
}finally{
 if(!engineStarted||engineClosed)lease?.release();
 if(process.connected)process.disconnect();
}
