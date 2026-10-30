import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fingerprint,withWorkspaceLock} from '../state.js';
import {assertAssetPath,selectedAssetBinding,assetProjectPath,createArtifactToolkit} from '../assets/context.js';
import {locateUnityProject,inventoryUnityProject,verifyGraphFiles} from '../assets/graph.js';
import {acquireToolchainRead} from '../toolchain/lease.js';
import {assertNoSession} from '../ghidra/runtime.js';
import {hasAssetSession} from '../assets/session.js';
import {artifactPaths,check,uuid,readJson,writeJson,seal,unseal,loadArtifact,loadGeneration,snapshotProject,closeGeneration,page} from './artifacts.js';
import {diagnoseArtifact} from './diagnosis.js';
import {recoveryOperations} from './definitions.js';
import {recoveryProgressPreview} from './progress.js';
import {createPhaseMetrics,currentPhaseMetrics,withPhaseMetrics} from '../workflow/metrics.js';

const projectMutations=new Set(['reconstruct.apply','reconstruct.validate','libraries.import','libraries.runtime.apply','migration.apply','migration.observe','data.capture','data.verify','components.observe','components.apply']);
const allowed={create:[],status:['artifactId'],history:['artifactId','limit','cursor'],diagnose:['artifactId','limit','cursor','query'],run:['artifactId','revision','operation','params'],abandon:['artifactId','revision','intentId']};
function validate(command,params){
 check(Object.hasOwn(allowed,command)&&params&&typeof params==='object'&&!Array.isArray(params)&&Object.keys(params).every(k=>allowed[command].includes(k)),'Invalid recovery operation parameters');
 if(command!=='create')check(uuid(params.artifactId),'Expected artifactId UUID');
 if(command==='run')check(uuid(params.revision)&&recoveryOperations.has(params.operation)&&params.params&&typeof params.params==='object'&&!Array.isArray(params.params),'Invalid artifact operation');
 if(command==='abandon')check(uuid(params.revision)&&uuid(params.intentId),'Expected the exact current revision and pending intent');
}
function summary(paths,manifest,generation){return {artifactId:manifest.artifactId,revision:manifest.revision,state:manifest.pending?'needs-inspection':'available',project:path.relative(paths.workspace,generation.project).split(path.sep).join('/'),inventorySha256:generation.receipt.inventorySha256,files:generation.receipt.files.length,pending:manifest.pending??null,compileReady:false,bindingsVerified:false,gameplay:'unverified'};}
function scopedToolkit(toolkit,name,paths,projectDir){return createArtifactToolkit(toolkit,name,{base:paths.base,projectDir,readState:()=>fs.existsSync(paths.state)?unseal(readJson(paths.state)).value:undefined,saveState:value=>writeJson(paths.state,seal({value}))});}
async function verifyCurrent(toolkit,name,manifest,generation,metrics=createPhaseMetrics()){
 const selected=selectedAssetBinding(toolkit,name);
 check(fingerprint(selected.binding)===fingerprint(manifest.binding),'Artifact belongs to stale input build','recovery_input_stale');
 await verifyGraphFiles(generation.project,{files:generation.receipt.files});
}
function progress(toolkit,phase,extra={}){const event=recoveryProgressPreview({phase,...extra});if(event){toolkit.onRecoveryProgress?.(event);toolkit.log(JSON.stringify({kind:'recovery-progress',...event}));}}
function validateMigrationScope(paths,operation,params,generation){
 if(operation==='components.observe'&&params.stageOperationId||operation==='components.verify'){
  let id=params.stageOperationId;
  if(operation==='components.verify'){const record=unseal(readJson(path.join(paths.base,'assets/components',params.operationId,'record.json')));check(record.command==='plan'&&record.operationId===params.operationId,'Invalid component plan','recovery_receipt_invalid');if(record.state==='no-change')return;check(uuid(record.migration?.operationId),'Invalid component migration plan','recovery_receipt_invalid');id=record.migration.operationId;}
  check(uuid(id),'Invalid component stage identity','recovery_receipt_invalid');const receipt=readJson(path.join(paths.base,'assets/migration',id,'apply/receipt.json')),{receiptSha256,...payload}=receipt;
  check(receipt.kind==='retoolkit-migration-receipt'&&receipt.operationId===id&&receiptSha256===fingerprint(payload),'Invalid component migration receipt','recovery_receipt_invalid');
  check(fingerprint(receipt.files)===generation.receipt.inventorySha256,'Component migration describes a historical stage; validate the current artifact instead','recovery_receipt_stale');
 }
 const key=operation==='migration.apply'?'plan':['migration.observe','migration.verify'].includes(operation)?'receipt':null;
 if(!key||!params[key])return;
 const file=assertAssetPath(path.resolve(params[key]),paths.base),value=readJson(file);check(uuid(value.operationId),'Missing migration operation UUID');
 const expected=path.join(paths.base,'assets/migration',value.operationId,...(key==='plan'?['plan.json']:['apply/receipt.json']));
 const normalized=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
 check(normalized(file)===normalized(expected),'Migration control file must belong to this artifact','recovery_receipt_invalid');
 if(key==='receipt'){
  const {receiptSha256,...payload}=value;check(value.kind==='retoolkit-migration-receipt'&&receiptSha256===fingerprint(payload),'Invalid migration receipt','recovery_receipt_invalid');
  check(fingerprint(value.files)===generation.receipt.inventorySha256,'Migration receipt describes a historical stage; validate the current artifact instead','recovery_receipt_stale');
 }
}
async function adoptStage(paths,manifest,operation,result,newRevision){
 // Only canonical, domain-owned receipts may supply a new project. Never trust
 // a stage path returned by a client or a result without a verified inventory.
 const id=result.operationId;check(uuid(id),'Missing staged operation identity');
 const library=operation==='libraries.import',runtime=operation==='libraries.runtime.apply',directory=assertAssetPath(path.join(paths.base,'assets',runtime?'runtime-providers':library?'library-imports':'migration',id,...(library||runtime?[]:['apply'])),paths.base);
 const file=path.join(directory,'receipt.json'),receipt=readJson(file),{receiptSha256,...payload}=receipt;
 check(receiptSha256===fingerprint(payload)&&receipt.operationId===id&&fingerprint(receipt.binding)===fingerprint(manifest.binding),'Invalid staged receipt','recovery_receipt_invalid');
 check(receipt.kind===(runtime?'retoolkit-runtime-provider-receipt':library?'retoolkit-library-import':'retoolkit-migration-receipt')&&(!library||receipt.state==='imported')&&(!runtime||receipt.state==='staged'),'Stage did not complete','recovery_receipt_invalid');
 const source=assertAssetPath(path.join(directory,'project'),paths.base),files=library?receipt.stageInventory:receipt.files;
 check(Array.isArray(files),'Missing stage inventory','recovery_receipt_invalid');
 return snapshotProject(paths,manifest.artifactId,newRevision,source,files,{parent:manifest.revision,operation});
}
export async function runRecoveryOperation(toolkit,name,command,params={},dependencies={}){
 const inherited=currentPhaseMetrics(),metrics=inherited??createPhaseMetrics();try{const action=()=>runRecoveryCore(toolkit,name,command,params,{...dependencies,metrics});const result=await withPhaseMetrics(metrics,()=>inherited?action():metrics.measure('total',action));return {...result,phaseMetrics:metrics.snapshot()};}
 catch(error){error.phaseMetrics=metrics.snapshot();throw error;}
}
async function runRecoveryCore(toolkit,name,command,params={},dependencies={}){
 const {metrics}=dependencies;
 validate(command,params);
 if(command==='status'||command==='history'){
  const paths=artifactPaths(toolkit,name,params.artifactId),manifest=loadArtifact(paths,params.artifactId),generation=loadGeneration(paths,manifest);
  if(command==='history')return {...summary(paths,manifest,generation),...page(manifest.history,params,fingerprint(manifest))};
  let freshness='current',diagnostic=null;try{await verifyCurrent(toolkit,name,manifest,generation,metrics);}catch(e){freshness='stale';diagnostic={code:e.code??'recovery_verification_failed',message:e.message.slice(0,1024)};}
  return {...summary(paths,manifest,generation),freshness,diagnostic};
 }
 assertNoSession(toolkit,name);check(!hasAssetSession(toolkit,name),'Stop AssetRipper before artifact operations','asset_session_active');
 const workspace=assertAssetPath(toolkit.workspace(name)),lease=acquireToolchainRead(toolkit.root);let uncertain=false;
 try{return await withWorkspaceLock(workspace,async()=>{
  if(command==='create'){
   const selected=selectedAssetBinding(toolkit,name),original=await locateUnityProject(assetProjectPath(toolkit,name,selected)),artifactId=randomUUID(),revision=randomUUID(),paths=artifactPaths(toolkit,name,artifactId);
   progress(toolkit,'snapshot.start',{artifactId});const {files}=await inventoryUnityProject(original),generation=await snapshotProject(paths,artifactId,revision,original,files,{metrics,onProgress:event=>progress(toolkit,event.phase,event)});
   check(fingerprint(selectedAssetBinding(toolkit,name).binding)===fingerprint(selected.binding),'Inputs changed during snapshot','recovery_input_stale');
   const manifest={kind:'retoolkit-recovery-artifact',schemaVersion:1,artifactId,revision,binding:selected.binding,createdAt:new Date().toISOString(),history:[{operation:'create',revision,parent:null,inventorySha256:generation.receipt.inventorySha256}],pending:null};
   writeJson(paths.manifest,seal(manifest),{exclusive:true});progress(toolkit,'snapshot.complete',{artifactId,revision});return {...summary(paths,manifest,generation),state:'created'};
  }
  const paths=artifactPaths(toolkit,name,params.artifactId),manifest=loadArtifact(paths,params.artifactId),generation=loadGeneration(paths,manifest);
  if(command==='run'&&['reconstruct.resident-status','reconstruct.resident-stop'].includes(params.operation)){
   // Session ownership is independent of a pending or stale source generation.
   // Closing an exact artifact Editor must remain possible during recovery.
   const {validateAssetParams}=await import('../assets/api.js');validateAssetParams(params.operation,params.params);
   const {residentSessionOperation}=await import('../unity/resident.js');
   const result=await residentSessionOperation(scopedToolkit(toolkit,name,paths,generation.project),name,params.operation.endsWith('-stop')?'stop':'status',dependencies.validation?.resident);
   return {...summary(paths,manifest,generation),operation:params.operation,result};
  }
  if(command==='abandon'){
   check(manifest.revision===params.revision&&manifest.pending?.invocationId===params.intentId,'Intent or revision changed; inspect again','recovery_revision_stale');await verifyCurrent(toolkit,name,manifest,generation,metrics);
   const intent=unseal(readJson(path.join(paths.base,'intents',params.intentId+'.json')));check(fingerprint(intent)===fingerprint(manifest.pending),'Pending intent differs','recovery_receipt_invalid');
   // Ownership checks and the real workspace lock above must be clear. Keep all
   // candidate projects, plans and receipts for inspection; never replay writes.
   fs.rmSync(paths.state,{force:true});fs.rmSync(path.join(paths.base,'assets/graph.json'),{force:true});
   manifest.history.push({operation:'abandon',intentId:params.intentId,revision:manifest.revision,parent:manifest.revision,completedAt:new Date().toISOString()});manifest.pending=null;writeJson(paths.manifest,seal(manifest));return summary(paths,manifest,generation);
  }
  check(!manifest.pending,'Inspect the saved intent and receipts before further artifact operations','recovery_inspection_required');await verifyCurrent(toolkit,name,manifest,generation,metrics);
  check(manifest.history.length<10000,'Artifact history limit reached');
  const scoped=scopedToolkit(toolkit,name,paths,generation.project);
  if(command==='diagnose')return {...summary(paths,manifest,generation),...await diagnoseArtifact(scoped,name,params,{artifactId:manifest.artifactId,revision:manifest.revision})};
  check(params.revision===manifest.revision,'Artifact revision changed; inspect current status','recovery_revision_stale');
  const {invokeAssetApi,validateAssetParams}=await import('../assets/api.js');validateAssetParams(params.operation,params.params);
  validateMigrationScope(paths,params.operation,params.params,generation);
  const mutates=projectMutations.has(params.operation)&&!(['reconstruct.validate','data.verify'].includes(params.operation)&&params.params.mode==='resident')&&!(params.operation==='data.verify'&&params.params.reuseVerificationId),revision=mutates?randomUUID():manifest.revision,invocationId=randomUUID();let target=scoped,fork;
  if(mutates){
   manifest.pending={invocationId,operation:params.operation,paramsSha256:fingerprint(params.params),revision,parent:manifest.revision,startedAt:new Date().toISOString()};
   writeJson(path.join(paths.base,'intents',invocationId+'.json'),seal(manifest.pending),{exclusive:true});writeJson(paths.manifest,seal(manifest));
   if(!['libraries.import','libraries.runtime.apply','migration.apply','components.apply'].includes(params.operation)){
    progress(toolkit,'fork.start',{artifactId:manifest.artifactId,revision});fork=await metrics.measure('fork',()=>snapshotProject(paths,manifest.artifactId,revision,generation.project,generation.receipt.files,{metrics,parent:manifest.revision,operation:params.operation,onProgress:event=>progress(toolkit,event.phase,event)}));
    target=scopedToolkit(toolkit,name,paths,fork.project);
   }
  }
  progress(toolkit,'operation.start',{operation:params.operation,artifactId:manifest.artifactId});
  let result;try{result=await metrics.measure('domain.operation',async()=>{
   if(dependencies.components&&params.operation.startsWith('components.')){
    const {runComponentOperation}=await import('../components/service.js');return runComponentOperation(target,name,params.operation.slice(11),params.params,dependencies.components);
   }else if(dependencies.data&&params.operation.startsWith('data.')){
    const {runDataOperation}=await import('../data/service.js');return runDataOperation(target,name,params.operation.slice(5),params.params,dependencies.data);
   }else if(dependencies.library&&params.operation.startsWith('libraries.')){
    const {runLibraryOperation}=await import('../libraries/service.js');return runLibraryOperation(target,name,params.operation,params.params,dependencies.library);
   }else return invokeAssetApi(target,name,params.operation,params.params);
  });
  }catch(error){uncertain=!error.residentSessionProtected&&(error.preserveToolchainGate===true||['unity_recovery_required','library_recovery_required','reconstruction_recovery_required','migration_recovery_required'].includes(error.code));throw error;}
  await verifyCurrent(toolkit,name,manifest,generation,metrics);
  let published=generation;
  if(mutates){
   const staged=['migration.apply','components.apply','libraries.runtime.apply'].includes(params.operation)&&result.state==='staged'||params.operation==='libraries.import'&&result.state==='imported';
   if(staged){
    published=await metrics.measure('stage.adopt',()=>adoptStage(paths,manifest,params.operation,result,revision));fs.rmSync(paths.state,{force:true});
    // The old graph belongs to the parent inventory. Build a current sealed
    // graph before publishing the adopted revision for subsequent operations.
    await metrics.measure('graph.index',()=>invokeAssetApi(scopedToolkit(toolkit,name,paths,published.project),name,'assets.index',{storage:'sqlite'}));
   }
   else if(fork)published=await closeGeneration(paths,manifest.artifactId,revision,fork.project,{parent:manifest.revision,operation:params.operation});
   // A blocked/satisfied import produces no stage and keeps the current revision.
   if(staged||fork)manifest.revision=revision;
   manifest.pending=null;
  }
  manifest.history.push({operation:params.operation,invocationId,revision:manifest.revision,parent:generation.receipt.revision,inventorySha256:published.receipt.inventorySha256,domainOperationId:result.operationId??null,completedAt:new Date().toISOString()});
  writeJson(path.join(paths.base,'results',invocationId+'.json'),seal({operation:params.operation,result}),{exclusive:true});writeJson(paths.manifest,seal(manifest));
  progress(toolkit,'operation.complete',{operation:params.operation,artifactId:manifest.artifactId,revision:manifest.revision});
  return {...summary(paths,manifest,published),operation:params.operation,result};
 });}finally{if(!uncertain)lease.release();}
}
