// Detached session owner. Never release the workspace lease before observing
// launcher close; the existing engine worker protects it if this owner dies.
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createToolkit } from '../toolkit.js';
import { runProcess } from '../process.js';
import { withWorkspaceLock,outputManifest,validManifest,fingerprint,setStep } from '../state.js';
import { within,stepFingerprint } from '../inputs.js';
import { runtimePaths,atomicJson,readJson,releaseStartupGate } from './runtime.js';
import { verifyBinding,projectLocks } from './environment.js';
import { connectClient } from './client.js';
import { BridgeError } from './protocol.js';

const config=readJson(process.argv[2]);
const toolkit=createToolkit(config.root,{log:message=>console.error(message)});
const paths=runtimePaths(toolkit,config.name,config.runId);
let record=readJson(paths.current);let engineStarted=false;let engineClosed=false;let control;
let stopRequested=false;let lastReceipt=null;let symbolsFingerprint;
const update=changes=>{record={...record,...changes};const current=readJson(paths.current);
  if(current.runId!==config.runId)throw new BridgeError('session_conflict','Supervisor lost descriptor ownership');atomicJson(paths.current,record);};
const cancellation=()=>stopRequested||fs.existsSync(paths.cancel);
process.on('SIGINT',()=>{stopRequested=true;});process.on('SIGTERM',()=>{stopRequested=true;});
async function reconcile(receiptPath,{verifiedPrior=false,project:sharedProject,save=true}={}) {
  if(!receiptPath)return;
  const receiptRoot=path.join(config.workspace,'04_Notes/bridge/receipts');
  const actual=fs.realpathSync(receiptPath);
  if(!within(actual,receiptRoot))throw new BridgeError('needs_recovery','Engine receipt is outside the allowed directory');
  const receipt=readJson(actual);
  if((receipt.runId!==config.runId&&!verifiedPrior)||!['saved','noop'].includes(receipt.status)||!Number.isSafeInteger(receipt.revision)||
    !/^[a-f0-9-]{36}$/i.test(receipt.operationId)||!/^[a-f0-9]{64}$/i.test(receipt.payloadHash))throw new BridgeError('needs_recovery','Saved mutation receipt failed validation');
  if(receipt.native?.sha256!==config.native.sha256||receipt.metadata?.sha256!==config.metadata.sha256||
    receipt.program!==config.program||receipt.projectName!==config.projectName||(!verifiedPrior&&receipt.workspace!==config.workspace))
    throw new BridgeError('program_mismatch','Saved receipt does not bind this workspace/program/input pair');
  const project=sharedProject??toolkit.read(config.name);
  project.bridgeHistory??=[];
  if(!project.bridgeHistory.some(item=>item.operationId===receipt.operationId))project.bridgeHistory.push({operationId:receipt.operationId,
    receiptPath:actual,revision:receipt.revision,method:receipt.method,payloadHash:receipt.payloadHash,coverage:receipt.coverage,saveStatus:receipt.status});
  if(receipt.method==='symbols.apply'&&receipt.revision>=(project.steps.symbols.bridgeRevision??-1)) {
    if(config.profile.dumpVerified&&fingerprint(receipt.profile)===fingerprint(config.profile)&&
      (receipt.status==='saved'||receipt.revision===(record.revision??receipt.revision))) {
      symbolsFingerprint??=stepFingerprint(project,'symbols',toolkit.tools,toolkit.root);
      setStep(project,'symbols',receipt.coverage==='complete'?'succeeded':'unknown',symbolsFingerprint,outputManifest([actual]));
      project.steps.symbols.coverage=receipt.coverage;project.steps.symbols.receiptPath=actual;project.steps.symbols.bridgeRevision=receipt.revision;
    }else if(project.steps.symbols.state==='succeeded')setStep(project,'symbols','stale',project.steps.symbols.fingerprint,project.steps.symbols.outputs,'Saved symbols receipt belongs to an earlier dump/profile; create a new plan');
  }
  // Reentrant save is authorized solely inside this supervisor's lease context.
  if(save) {
    await toolkit.save(config.name,project);
    update({revision:Math.max(record.revision??0,receipt.revision),reconciliationPending:false});
  }
}
async function reconcileCurrentReceipts() {
  const directory=path.join(config.workspace,'04_Notes/bridge/receipts');
  if(!fs.existsSync(directory))return;
  const project=toolkit.read(config.name);const seen=new Set((project.bridgeHistory??[]).map(item=>item.operationId));
  const unseen=fs.readdirSync(directory).filter(entry=>/^[a-f0-9-]{36}\.json$/i.test(entry))
    .map(entry=>({receiptPath:path.join(directory,entry),receipt:readJson(path.join(directory,entry))}))
    .filter(item=>item.receipt.runId===config.runId&&['saved','noop'].includes(item.receipt.status)&&!seen.has(item.receipt.operationId))
    .sort((a,b)=>a.receipt.revision-b.receipt.revision);
  for(const item of unseen)await reconcile(item.receiptPath,{project,save:false});
  if(unseen.length){await toolkit.save(config.name,project);update({reconciliationPending:false,
    ...(record.error?.code==='state_reconciliation_pending'?{error:null}:{})});}
}
try {
  await withWorkspaceLock(config.workspace,async()=>{
    verifyBinding(config,toolkit,config.name);
    const locks=projectLocks(config.projectDir);
    if(locks.length)throw new BridgeError('session_conflict','Ghidra project is locked; save and close its owning GUI/headless process');
    if(config.mode==='write') {
      const backupPath=path.join(config.workspace,'backups',`ghidra-session-${config.runId}`);
      const before=outputManifest([config.projectDir]);
      fs.mkdirSync(path.dirname(backupPath),{recursive:true});fs.cpSync(config.projectDir,backupPath,{recursive:true,force:false,errorOnExist:true});
      const backup=outputManifest([backupPath]);
      if(!validManifest(before)||fingerprint(before[0].files)!==fingerprint(backup[0].files)||fingerprint(before[0].directories)!==fingerprint(backup[0].directories))throw new BridgeError('backup_failed','Full project backup did not match source; engine was not launched');
      atomicJson(backupPath+'.manifest.json',{runId:config.runId,source:before,backup});update({backupPath});
    }
    if(cancellation()){update({phase:'stopped',completedAt:new Date().toISOString()});return;}
    let engineResult;
    engineStarted=true;
    const engine=runProcess(config.engine.file,config.engine.args,{cwd:config.root,
      env:{...process.env,...config.engine.env},logFile:paths.log,leaseDirectory:path.join(config.workspace,'.retk-lock')})
      .then(()=>{engineClosed=true;return {};},error=>{engineClosed=true;return {error};});
    const deadline=Date.now()+config.startupMs;
    try {
      while(!engineClosed&&!fs.existsSync(paths.endpoint)) {
        if(Date.now()>deadline)stopRequested=true;
        // Cancellation cannot release the lease until Java starts and drains or
        // launcher actually closes. Never terminate a cmd.exe parent alone.
        await delay(50);
      }
      if(engineClosed){engineResult=await engine;throw engineResult.error??new BridgeError('startup_failed','Headless exited without a ready endpoint');}
      const endpoint=readJson(paths.endpoint);
      if(endpoint.version!==1||endpoint.runId!==config.runId||endpoint.programIdentity?.program!==config.program||endpoint.programIdentity?.sha256!==config.native.sha256)throw new BridgeError('program_mismatch','Headless endpoint identity mismatch');
      control=await connectClient({...endpoint,token:config.token});
      const attached=await control.request('control.attach',{}, {timeoutMs:5000});
      update({revision:attached.revision});
      if(Array.isArray(attached.result?.verifiedReceipts)) {
        try {
          const previous=attached.result.verifiedReceipts.map(receiptPath=>({receiptPath,revision:readJson(receiptPath).revision})).sort((a,b)=>a.revision-b.revision);
          const project=toolkit.read(config.name);let heartbeatAt=Date.now();
          for(const item of previous) {
            if(Date.now()-heartbeatAt>1000){await control.request('control.heartbeat',{}, {timeoutMs:5000});heartbeatAt=Date.now();}
            await reconcile(item.receiptPath,{verifiedPrior:true,project,save:false});
          }
          if(previous.length)await toolkit.save(config.name,project);
        }catch(error){update({reconciliationPending:true,error:{code:'state_reconciliation_pending',message:error.message}});}
      }
      update({phase:'ready',revision:attached.revision});
      releaseStartupGate(paths,config.gateToken);
      let nextHeartbeat=0;
      while(!engineClosed) {
        if(cancellation()) {update({phase:'stopping'});await control.request('session.stop',{}, {timeoutMs:5000}).catch(()=>{});break;}
        if(Date.now()>=nextHeartbeat) {
          const reply=await control.request('control.heartbeat',{}, {timeoutMs:5000});nextHeartbeat=Date.now()+1000;
          if(Number.isSafeInteger(reply.revision)&&reply.revision!==(record.revision??0))update({revision:reply.revision});
          if(reply.result?.latestReceipt) {
            try{if(reply.result.latestReceipt!==lastReceipt){await reconcileCurrentReceipts();lastReceipt=reply.result.latestReceipt;}}
            catch(error){update({reconciliationPending:true,error:{code:'state_reconciliation_pending',message:error.message}});}
          }
        }
        await delay(50);
      }
    }catch(error){
      update({phase:engineClosed?'failed':'cleanup-pending',error:{code:error.code??'session_failed',message:error.message}});
      control?.close(); // Java sees control loss and drains; marker remains until close.
    }finally{
      engineResult??=await engine;
      // A worker killed before engine closure retains an extra marker. Do not
      // label its launcher error as proven cleanup merely because Node closed.
      const markers=fs.readdirSync(path.join(config.workspace,'.retk-lock')).filter(name=>name.startsWith('engine-'));
      if(markers.length) {update({phase:'cleanup-pending',error:{code:'cleanup_pending',message:'Engine ownership is uncertain; lock retained for inspection'}});}
      else {
        try {
          await reconcileCurrentReceipts();
        }catch(error){update({reconciliationPending:true,error:{code:'state_reconciliation_pending',message:error.message}});}
        update({phase:record.phase==='failed'?'failed':'stopped',completedAt:new Date().toISOString()});
        fs.rmSync(paths.endpoint,{force:true});
      }
      control?.close();
    }
  });
}catch(error){
  update({phase:engineStarted&&!engineClosed?'cleanup-pending':'failed',error:{code:error.code??'startup_failed',message:error.message},completedAt:new Date().toISOString()});
}finally{
  try{releaseStartupGate(paths,config.gateToken);}catch(error){console.error('Startup ownership marker retained');}
}
