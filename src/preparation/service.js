import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {fileIdentity,fingerprint,outputManifest,validManifest,reusable} from '../state.js';
import {stepFingerprint} from '../inputs.js';
import {assertAssetPath,assetPaths,selectedAssetBinding} from '../assets/context.js';
import {inspectAssetReadiness} from '../assets/readiness.js';
import {readSession as readGhidraSession,atomicJson,readJson} from '../ghidra/runtime.js';
import {readSession as readAssetSession} from '../assets/runtime.js';

const ownerToken=`${process.pid}:${performance.timeOrigin}`;
const stageIds=['prerequisites','android','inputs','dump','import','analyze','symbols','assets','index','scripts','validation'];
const stageDependencies={dump:['inputs'],import:['dump'],analyze:['import'],symbols:['dump','analyze'],assets:['inputs'],index:['assets'],scripts:['index'],validation:['index']};
const uncertainCodes=new Set(['cleanup_pending','cleanup-pending','needs_recovery','asset_recovery_required','reconstruction_recovery_required','request_timeout','startup_timeout','PREPARATION_ENGINE_UNCERTAIN','PREPARATION_INPUT_CHANGED']);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const fail=(code,message,action)=>Object.assign(new Error(message),{code,action});
const now=()=>new Date().toISOString();
const bounded=value=>typeof value==='string'?value.slice(0,2048):'';
const errorView=error=>({code:bounded(error?.code)||'PREPARATION_STAGE_FAILED',message:bounded(error?.message)||'Preparation stage failed',...(error?.action?{action:bounded(error.action)}:{})});
const terminal=record=>!record||['stopped','failed'].includes(record.phase);
function alive(owner) {
 if(!Number.isSafeInteger(owner?.pid)||owner.pid<1)return false;
 if(owner.pid===process.pid)return owner.token===ownerToken;
 try{process.kill(owner.pid,0);return true;}catch(error){return error.code!=='ESRCH';}
}
function locations(toolkit,name,runId) {
 const workspace=assertAssetPath(toolkit.workspace(name));
 const base=assertAssetPath(path.join(workspace,'04_Notes/preparation'),workspace);
 if(runId!==undefined&&!uuid(runId))throw fail('PREPARATION_RUN_INVALID','Preparation run ID must be a UUID');
 const runDirectory=runId?assertAssetPath(path.join(base,runId),base):null;
 return {workspace,base,gate:assertAssetPath(path.join(base,'.gate'),base),current:path.join(base,'current.json'),runDirectory,reportPath:runDirectory?path.join(runDirectory,'report.json'):null,handoffPath:runDirectory?path.join(runDirectory,'handoff.json'):null};
}
function normalize(params,saved) {
 if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(key=>!['profile','symbols','addressMode','serial','packageName','autoPull','includeData','resumeRunId','baselineValidation'].includes(key)))throw fail('PREPARATION_PARAMS_INVALID','Unknown preparation options');
 const explicit={...params};delete explicit.resumeRunId;
 const options={profile:'reconstruction',symbols:'plan',includeData:true,baselineValidation:false,...saved,...explicit};
 options.autoPull??=Boolean(options.serial&&options.packageName);
 if(!['native','reconstruction'].includes(options.profile)||!['plan','apply','skip'].includes(options.symbols)||options.addressMode!==undefined&&!['rva','va'].includes(options.addressMode)||['includeData','autoPull','baselineValidation'].some(key=>typeof options[key]!=='boolean')||options.serial!==undefined&&(typeof options.serial!=='string'||!options.serial||options.serial.length>256||/[\s\x00-\x1f]/.test(options.serial))||options.packageName!==undefined&&(typeof options.packageName!=='string'||!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(options.packageName)))throw fail('PREPARATION_PARAMS_INVALID','Invalid preparation profile, symbol policy or Android target');
 if(params.resumeRunId!==undefined&&!uuid(params.resumeRunId))throw fail('PREPARATION_RUN_INVALID','Preparation resume ID must be a UUID');
 return options;
}
function compact(value,depth=0) {
 if(depth>4)return undefined;
 if(value===null||typeof value==='boolean'||typeof value==='number')return value;
 if(typeof value==='string')return bounded(value);
 if(Array.isArray(value))return value.slice(0,20).map(item=>compact(item,depth+1));
 if(!value||typeof value!=='object')return undefined;
 const excluded=new Set(['outputs','files','directories','graph','nodes','edges','items','scripts','source','text','data','token','env','inventory','project','sourceManifest']);
 return Object.fromEntries(Object.entries(value).filter(([key])=>!excluded.has(key)).slice(0,32).map(([key,item])=>[key,compact(item,depth+1)]).filter(([,item])=>item!==undefined));
}
function snapshot(toolkit,name) {
 const p=toolkit.read(name),identity=file=>file&&fs.existsSync(file)?fileIdentity(file):null;
 let assets=null;
 if(p.extractedPath&&p.nativeBinary&&p.metadata){try{assets=selectedAssetBinding(toolkit,name).binding.assetsSha256;}catch(error){if(p.identities?.native&&p.identities?.metadata)throw error;}}
 const tools={};
 for(const [key,file]of Object.entries(toolkit.tools??{}))if(typeof file==='string'){
  const observed=fs.existsSync(file)&&fs.statSync(file).isFile()?identity(file):null;tools[key]={path:file,sha256:observed?.sha256??null};
 }
 for(const stage of ['dump','import','analyze','symbols'])if(p.nativeBinary&&p.metadata&&toolkit.tools?.dumper&&toolkit.tools?.ghidra)tools[stage+'Fingerprint']=stepFingerprint(p,stage,toolkit.tools,toolkit.root);
 const settings={inputPolicy:p.inputPolicy??null,extractedPath:p.extractedPath??null,nativeBinary:p.nativeBinary??null,metadata:p.metadata??null,ghidraProjectDir:p.ghidraProjectDir??null,ghidraProjectName:p.ghidraProjectName??name,ghidraProgramName:p.ghidraProgramName??(p.nativeBinary?path.basename(p.nativeBinary):null),reconstructedSourceDir:p.reconstructedSourceDir??null,unityEditorPath:p.unityEditorPath??null};
 const sourceHash=fingerprint({native:identity(p.nativeBinary),metadata:identity(p.metadata),assets});
 return {hash:fingerprint({sourceHash,settings,tools}),sourceHash,toolsHash:fingerprint(tools),settingsHash:fingerprint(settings),settings};
}
function publicReport(record) {
 const result={...record,stages:record.stages.map(({outputs,binding,...stage})=>stage)};
 delete result.owner;delete result.binding;
 return result;
}
function unknown(record,message='Preparation owner exited with an unobserved stage; inspect engine ownership and saved receipts before starting another run') {
 const result={...record,state:'unknown',stages:record.stages.map(s=>s.state==='running'?{...s,state:'unknown',error:{code:'PREPARATION_OWNER_LOST',message}}:s),blockers:[...(record.blockers??[]),{stage:'ownership',code:'PREPARATION_OWNER_LOST',message,action:'Review retained engine leases, job and mutation receipts; never replay an uncertain write.'}]};
 result.readiness=readiness(result);return result;
}

/** Read-only: does not acquire a workspace or preparation lease, refresh steps or launch engines. */
export async function inspectPreparation(toolkit,name,{runId,verifyFreshness=true}={}) {
 if(typeof verifyFreshness!=='boolean')throw fail('PREPARATION_PARAMS_INVALID','verifyFreshness must be a boolean');
 let paths=locations(toolkit,name,runId);
 if(!runId){if(!fs.existsSync(paths.current))return {kind:'retoolkit-preparation',schemaVersion:1,name,state:'not-started',stages:[],blockers:[],readiness:readiness({stages:[]})};const current=readJson(paths.current);paths=locations(toolkit,name,current.runId);}
 if(!fs.existsSync(paths.reportPath))throw fail('PREPARATION_RUN_MISSING','Preparation run has no saved report');
 const record=readJson(paths.reportPath);
 if(record.kind!=='retoolkit-preparation'||record.schemaVersion!==1||record.name!==name||record.runId!==path.basename(paths.runDirectory)||!Array.isArray(record.stages))throw fail('PREPARATION_REPORT_INVALID','Invalid preparation report identity');
 const observed=record.state==='running'&&!alive(record.owner)?unknown(record):record;
 if(!verifyFreshness||['running','unknown'].includes(observed.state))return uncheckedInspection(observed);
 return freshInspection(toolkit,name,observed);
}
function uncheckedInspection(record) {
 const recordedReadiness=record.readiness??readiness(record);
 const unverified=Object.fromEntries(Object.entries(recordedReadiness).map(([dimension,value])=>[dimension,{...value,...(['ready','planned','partial'].includes(value?.state)?{state:'unverified'}:{})}]));
 return publicReport({...record,freshness:'not-rechecked',recordedReadiness,readiness:unverified});
}
async function freshInspection(toolkit,name,record) {
 const result=structuredClone(record);result.recordedState=record.state;result.recordedReadiness=record.readiness??readiness(record);result.freshness='current';result.freshnessCheckedAt=now();
 const stale=(stage,message)=>{stage.state='stale';stage.error={code:'PREPARATION_EVIDENCE_STALE',message,action:'Inspect current input, engine and output receipts; do not reuse the recorded success as current readiness.'};result.blockers.push({stage:stage.id,...stage.error});result.freshness='stale';};
 let bindingValid=false,bindingError='Preparation has no saved input/configuration binding';
 try{bindingValid=Boolean(record.binding&&snapshot(toolkit,name).hash===record.binding.hash);bindingError='Selected input content, engine files or configuration changed since this preparation run';}catch(error){bindingError=`Input/configuration evidence is unavailable: ${bounded(error.message)}`;}
 result.blockers??=[];
 if(!bindingValid){
  for(const stage of result.stages)if(stage.state==='succeeded'&&stage.id!=='prerequisites'&&stage.id!=='android')stale(stage,bindingError);
 }else{
  let assetObservation;
  const currentAssets=()=>assetObservation??=(inspectAssetReadiness(toolkit,name));
  for(const stage of result.stages){
   if(stage.state!=='succeeded'||!Object.hasOwn(stageDependencies,stage.id))continue;
   if((stageDependencies[stage.id]??[]).some(id=>result.stages.find(s=>s.id===id)?.state!=='succeeded')){stale(stage,'A required preparation stage no longer has current evidence');continue;}
   let valid=false;
   try{
    valid=manifestEvidence(toolkit,name,stage);
    if(valid&&['dump','import','analyze'].includes(stage.id)&&toolkit.tools?.dumper)valid=nativeEvidence(toolkit,name,stage.id);
    if(valid&&stage.id==='symbols'&&record.options.symbols==='apply'&&stage.result?.coverage==='complete'&&toolkit.tools?.dumper)valid=nativeEvidence(toolkit,name,'symbols');
    if(valid&&stage.id==='assets'&&toolkit.tools?.assetripper)valid=exportEvidence(toolkit,name);
    if(stage.id==='index'&&toolkit.tools?.assetripper){const observed=await currentAssets();valid=valid&&observed.state==='indexed'&&(!stage.result?.revision||stage.result.revision===observed.revision);}
    if(stage.id==='validation'&&stage.result?.operationId){const observed=await currentAssets();valid=observed.validationOperation===stage.result.operationId&&!['stale-or-unavailable',undefined].includes(observed.validationState)&&(!stage.result.compileReady||observed.compileReady===true)&&(!stage.result.bindingsVerified||observed.bindingsVerified===true);}
   }catch{valid=false;}
   if(!valid)stale(stage,'Saved outputs or receipts no longer verify against the current workspace');
  }
 }
 result.readiness=readiness(result);
 if(result.freshness==='stale')result.state='stale';
 return publicReport(result);
}
function readiness(record) {
 const stage=id=>record.stages.find(s=>s.id===id),ready=id=>stage(id)?.state==='succeeded';
 const unverified={state:'unverified'};
 const symbols=stage('symbols'),validation=ready('validation')?stage('validation')?.result:null,android=stage('android')?.result;
 const validationUnavailable={state:stage('validation')?.state==='stale'?'stale':'unverified',...(stage('validation')?.result?.coverage?{coverage:stage('validation').result.coverage}:{})};
 return {
  nativeAnalysis:{state:ready('analyze')?'ready':stage('analyze')?.state??'unverified'},
  symbols:{state:ready('symbols')?(record.options?.symbols==='apply'?(symbols.result?.coverage==='complete'?'ready':'partial'):'planned'):symbols?.state??'unverified',coverage:symbols?.result?.coverage??'unverified'},
  assetsIndex:{state:ready('index')?'ready':stage('index')?.state??'unverified',storage:stage('index')?.result?.storage??null,coverage:stage('index')?.result?.coverage??'unverified'},
  downloadedData:compact(android?.downloadedData??android?.readiness?.downloadedData??{state:'unverified',limitations:['Remote/on-demand asset coverage is unverified.']}),
  compilation:validation?{state:validation.compileReady?'ready':validation.compilation?.state??'unverified',coverage:validation.coverage??'unverified'}:validationUnavailable,
  bindings:validation?{state:validation.bindingsVerified?'ready':validation.scopeBindingsVerified?'partial':'unverified',coverage:validation.coverage??'unverified'}:validationUnavailable,
  gameplay:unverified,
 };
}
function ownership(toolkit,name) {
 const workspace=toolkit.workspace(name),lock=path.join(workspace,'.retk-lock');
 if(fs.existsSync(lock))throw fail('PREPARATION_ENGINE_UNCERTAIN','Workspace engine lease is occupied or uncertain','Inspect the owning workspace job/session and close its engine; retain all lock files.');
 for(const [label,record]of [['Ghidra',readGhidraSession(toolkit,name)],['AssetRipper',readAssetSession(toolkit,name)]])if(!terminal(record))throw fail('PREPARATION_ENGINE_UNCERTAIN',`${label} session is ${record.phase}; preparation cannot claim its engine`,'Inspect and stop the existing session through its typed session API.');
 for(const [stage,step]of Object.entries(toolkit.read(name).steps??{}))if(step?.state==='running')throw fail('PREPARATION_ENGINE_UNCERTAIN',`Toolkit ${stage} stage still has an unobserved running owner`,'Inspect stage output, engine leases and receipts; do not replay interrupted work.');
}
function gate(paths,runId) {
 fs.mkdirSync(paths.base,{recursive:true});
 const token=randomUUID(),marker=path.join(paths.gate,'owner.json');
 try{fs.mkdirSync(paths.gate);}catch(error){if(error.code==='EEXIST')throw fail('PREPARATION_BUSY','Another preparation worker or unresolved owner holds the preparation gate','Inspect the current preparation/job and engine receipts; resume only after ownership is resolved.');throw error;}
 try{atomicJson(marker,{pid:process.pid,token:ownerToken,gateToken:token,runId});}catch(error){fs.rmdirSync(paths.gate);throw error;}
 return ()=>{if(fs.existsSync(marker)&&readJson(marker).gateToken===token){fs.unlinkSync(marker);fs.rmdirSync(paths.gate);}};
}
const blocked=(code,message,action)=>({state:'blocked',code,message,action});
function manifestEvidence(toolkit,name,stage) {
 if(!stage||!validManifest(stage.outputs))return false;
 if(stage.evidencePath){assertAssetPath(stage.evidencePath,toolkit.workspace(name));const saved=readJson(stage.evidencePath);if(saved.stage!==stage.id||!validManifest(saved.outputs))return false;}
 return true;
}
async function existingEvidence(toolkit,name,id,previous,dependencies) {
 if(dependencies.inspectStage)return Boolean(await dependencies.inspectStage(id,{toolkit,name,stage:previous}));
 if(manifestEvidence(toolkit,name,previous)){
  if(['dump','import','analyze'].includes(id)&&toolkit.tools?.dumper)return nativeEvidence(toolkit,name,id);
  if(id==='assets'&&!dependencies.invokeStage&&!dependencies.runStage)return exportEvidence(toolkit,name);
  if(id==='index'&&!dependencies.invokeStage&&!dependencies.runStage)return (await (dependencies.inspectAssetReadiness??inspectAssetReadiness)(toolkit,name)).state==='indexed';
  return true;
 }
 return false;
}
function nativeEvidence(toolkit,name,id) {
 try{
  const p=toolkit.read(name),fp=stepFingerprint(p,id,toolkit.tools,toolkit.root);
  if(!reusable(p,id,fp))return false;
  if(id!=='import')return true;
  const receipt=readJson(assertAssetPath(path.join(toolkit.workspace(name),'04_Notes/import-receipt.json'),toolkit.workspace(name)));
  return receipt.fingerprint===fp&&receipt.native?.sha256===fileIdentity(p.nativeBinary).sha256&&receipt.attestation?.sha256===receipt.native.sha256&&receipt.program===p.ghidraProgramName&&receipt.attestation?.program===receipt.program&&receipt.project===p.ghidraProjectName&&['.gpr','.rep'].every(ext=>fs.existsSync(assertAssetPath(path.join(p.ghidraProjectDir,p.ghidraProjectName+ext),toolkit.workspace(name))));
 }catch{return false;}
}
function exportEvidence(toolkit,name) {
 try{
  const p=toolkit.read(name),source=toolkit.tools.assetripper,directory=assertAssetPath(path.dirname(source));
  if(fs.readFileSync(path.join(directory,'.retk-version'),'utf8').trim()!=='1.3.14')return false;
  const engine=fs.readdirSync(directory).filter(n=>n===path.basename(source)||n.toLowerCase().endsWith('.dll')).sort().map(filename=>{const identity=fileIdentity(assertAssetPath(path.join(directory,filename)));return {path:filename,sha256:identity.sha256,size:identity.size};});
  const binding=selectedAssetBinding(toolkit,name).binding,settings={version:'1.3.14',source:'upstream-defaults',defaultFile:'AssetRipper.Settings.json'};
  return reusable(p,'assetripper',fingerprint({binding,engine,settings}))&&fingerprint(p.assetReconstruction?.binding)===fingerprint(binding);
 }catch{return false;}
}
function saveEvidence(paths,stage,outputs) {
 const evidencePath=assertAssetPath(path.join(paths.runDirectory,stage.id+'-evidence.json'),paths.workspace);
 atomicJson(evidencePath,{kind:'retoolkit-preparation-evidence',schemaVersion:1,stage:stage.id,outputs});
 stage.evidencePath=evidencePath;stage.outputs=outputManifest([evidencePath]);
}
async function resourcePolicy(record,dependencies) {
 const MiB=1024**2,observed=await (dependencies.getResources??(()=>({availableBytes:os.freemem(),totalBytes:os.totalmem()})))();
 const {availableBytes,totalBytes}=observed??{};
 if(!Number.isFinite(availableBytes)||availableBytes<0||!Number.isFinite(totalBytes)||totalBytes<=0)return {native:{state:'blocked',code:'PREPARATION_MEMORY_UNKNOWN',message:'Available physical memory could not be measured'},assets:{state:'blocked'}};
 const reserveMiB=Math.ceil(Math.max(2048,Math.min(4096,totalBytes/MiB*.15))),availableMiB=Math.floor(availableBytes/MiB),budgetMiB=availableMiB-reserveMiB;
 const explicit=record.resourceConfiguration.explicitHeap;
 const match=explicit?String(explicit).match(/^(\d+)([MG])$/i):null;
 const heapMiB=explicit?(match?Number(match[1])*(match[2].toUpperCase()==='G'?1024:1):NaN):Math.min(8192,Math.floor(budgetMiB/256)*256);
 const state=Number.isSafeInteger(heapMiB)&&heapMiB>=2048&&heapMiB<=budgetMiB?'ready':'blocked';
 return {availableMiB,totalMiB:Math.floor(totalBytes/MiB),reserveMiB,native:{state,heapMiB:Number.isFinite(heapMiB)?heapMiB:null,source:explicit?'explicit':'adaptive',...(state==='blocked'?{code:'PREPARATION_MEMORY_INSUFFICIENT',message:explicit?'Configured headless heap does not fit available memory with the OS reserve; close memory-heavy apps or change the explicit policy.':'Available memory cannot fit a 2 GiB native heap plus the OS reserve; close memory-heavy apps and resume.'}:{})},assets:{state:budgetMiB>=1024?'ready':'blocked'}};
}
async function applyResources(context) {
 const resources=await resourcePolicy(context.record,context.dependencies);context.record.resources=resources;context.persist();
 if(resources.native.state!=='ready')throw fail(resources.native.code??'PREPARATION_MEMORY_INSUFFICIENT',resources.native.message??'Insufficient memory for headless analysis','Free memory or change the explicit heap policy, then resume; preparation never waits indefinitely for RAM.');
 if(context.toolkit.env)context.toolkit.env.GHIDRA_HEADLESS_MAXMEM=`${resources.native.heapMiB}M`;
}
async function defaults(id,context) {
 const {toolkit,name,options,dependencies,record}=context;
 const p=()=>toolkit.read(name);
 const evidence=stage=>{const project=p();return {outputs:project.steps?.[stage]?.outputs??[]};};
 const assetsApi=dependencies.assetApi??(await import('../assets/api.js')).invokeAssetApi;
 switch(id){
  case 'prerequisites':{
   const diagnose=dependencies.diagnose??(await import('../diagnostics.js')).diagnose;
   const report=await diagnose(toolkit,{name,task:'prepare'});
   const diagnostics=(report.diagnostics??[]).filter(d=>d.status==='blocked').map(item=>compact(item));
   const resources=await resourcePolicy(record,dependencies);record.resources=resources;
   if(resources.native.state==='ready'&&toolkit.env)toolkit.env.GHIDRA_HEADLESS_MAXMEM=`${resources.native.heapMiB}M`;
   if(resources.native.state!=='ready')diagnostics.push(compact(resources.native));
   return {state:'ready',native:report.tasks.prepare.state!=='blocked'&&resources.native.state==='ready',assets:report.tasks.assetripper.state!=='blocked'&&resources.assets.state==='ready',diagnostics,resources};
  }
  case 'android':{
   const preflight=dependencies.androidPreflight??(await import('../adb/preparation.js')).runAndroidPreflight;
   return preflight(toolkit,name,options);
  }
  case 'inputs':{
   const resolved=await toolkit.resolveInputs(name);
   return {state:p().nativeBinary&&p().metadata?'ready':'needs-input',selected:Boolean(p().nativeBinary&&p().metadata),resolution:compact(resolved),message:'Select matching IL2CPP binary and metadata through workspace input selection.'};
  }
  case 'dump':case 'import':case 'analyze':{
   const project=p(),fp=stepFingerprint(project,id,toolkit.tools,toolkit.root);
   if(reusable(project,id,fp)){
    if(!nativeEvidence(toolkit,name,id))return blocked('PREPARATION_IMPORT_UNVERIFIED','Existing import receipt or Ghidra project identity is invalid','Inspect existing Program; explicit reimport with backup is a separate operation.');
    return {state:'ready',reused:true,...evidence(id)};
   }
   if(id!=='dump')await applyResources(context);
   await (id==='import'?toolkit.importProgram(name,{reimport:false}):toolkit[id](name));
   return {state:'ready',...evidence(id)};
  }
  case 'symbols':{
   const provider=dependencies.ghidraProvider??await import('../ghidra/provider.js');
   await applyResources(context);
   let owned,operationError,applying=false;
   try{
    // Never attach to, adopt or stop a session that existed before this stage.
    if(!terminal(readGhidraSession(toolkit,name)))throw fail('PREPARATION_ENGINE_UNCERTAIN','Existing Ghidra session prevents owned symbol preparation');
    owned=await provider.startSession(toolkit,name,{write:options.symbols==='apply',reuse:false,timeoutMs:300000});
    const plan=await provider.querySession(toolkit,name,'symbols.plan',{addressMode:options.addressMode,createFunctions:false,replaceUserNames:false,replaceUserComments:false},{timeoutMs:300000});
    if(options.symbols==='plan')return {state:'ready',...plan,outputs:plan.plan?outputManifest([plan.plan]):[]};
    applying=true;record.stages.find(s=>s.id===id).phase='applying';context.persist();
    const result=await provider.mutateSession(toolkit,name,'symbols.apply',{plan:plan.plan,planHash:plan.planHash},{operationId:record.stages.find(s=>s.id===id).operationId,timeoutMs:300000});
    return {state:'ready',...result,...evidence('symbols')};
   }catch(error){operationError=error;if(applying)throw fail('PREPARATION_ENGINE_UNCERTAIN',`Symbol write result was not observed: ${bounded(error.message)}`,'Inspect the saved operation UUID, Program ledger, backup and mutation receipt before deciding whether to resume.');throw error;}
   finally{if(owned){const current=readGhidraSession(toolkit,name);if(current&&current.runId!==owned.runId)throw fail('PREPARATION_ENGINE_UNCERTAIN','Ghidra session ownership changed before cleanup');try{await provider.stopSession(toolkit,name);}catch(error){throw fail('cleanup_pending',`Owned Ghidra cleanup is unconfirmed: ${bounded(error.message)}${operationError?`; stage: ${bounded(operationError.message)}`:''}`);}}}
  }
  case 'assets':{
   const project=p();
   if(exportEvidence(toolkit,name))return {state:'ready',reused:true,...evidence('assetripper')};
   const destination=project.reconstructedSourceDir??path.join(toolkit.workspace(name),'05_ReconstructedSource');
   if(fs.existsSync(destination)&&fs.readdirSync(destination).length)return blocked('PREPARATION_EXPORT_PROTECTED','An existing export cannot be safely attributed to the current inputs','Inspect export receipt/index or use a new workspace; preparation never overwrites an existing export.');
   let owned;
   try{
    if(!terminal(readAssetSession(toolkit,name)))throw fail('PREPARATION_ENGINE_UNCERTAIN','Existing AssetRipper session prevents owned export');
    owned=await assetsApi(toolkit,name,'assets.session.start',{});
    const result=await assetsApi(toolkit,name,'assets.export',{});
    return {state:'ready',...compact(result),...evidence('assetripper')};
   }finally{if(owned){const current=readAssetSession(toolkit,name);if(current&&current.runId!==owned.runId)throw fail('PREPARATION_ENGINE_UNCERTAIN','AssetRipper session ownership changed before cleanup');try{await assetsApi(toolkit,name,'assets.session.stop',{});}catch(error){throw fail('cleanup_pending',`Owned AssetRipper cleanup is unconfirmed: ${bounded(error.message)}`);}}}
  }
  case 'index':{
   const observed=await (dependencies.inspectAssetReadiness??inspectAssetReadiness)(toolkit,name);
   if(observed.state==='indexed'&&p().assetReconstruction?.graphStorage==='sqlite')return {state:'ready',reused:true,storage:'sqlite',coverage:observed.coverage,outputs:outputManifest([assetPaths(toolkit,name).graphFile])};
   const result=await assetsApi(toolkit,name,'assets.index',{storage:'sqlite'});
   return {state:'ready',...result,outputs:outputManifest([assetPaths(toolkit,name).graphFile])};
  }
  case 'scripts':{
   // SQLite script mapping is intentionally a bounded first page, not a claim of full reconstruction coverage.
   const result=await assetsApi(toolkit,name,'assets.scripts',{limit:100});
   return {state:'ready',coverage:result.coverage,scope:{limit:100,hasMore:Boolean(result.nextCursor)},outputs:outputManifest([assetPaths(toolkit,name).mapFile])};
  }
  case 'validation':return assetsApi(toolkit,name,'reconstruct.validate',{timeoutSeconds:600});
 }
}

/** Durable deterministic preparation. All engine operations use typed APIs and their existing leases. */
export async function runPreparation(toolkit,name,params={},dependencies={}) {
 const base=locations(toolkit,name);let saved;
 if(params?.resumeRunId){const selected=locations(toolkit,name,params.resumeRunId);if(!fs.existsSync(selected.reportPath))throw fail('PREPARATION_RUN_MISSING','Preparation resume run does not exist');saved=readJson(selected.reportPath);if(saved.name!==name||saved.runId!==params.resumeRunId||saved.kind!=='retoolkit-preparation')throw fail('PREPARATION_REPORT_INVALID','Resume report identity does not match this workspace');}
 const options=normalize(params,saved?.options),runId=saved?.runId??randomUUID(),paths=locations(toolkit,name,runId);
 const explicitHeap=toolkit.env?.GHIDRA_HEADLESS_MAXMEM??process.env.GHIDRA_HEADLESS_MAXMEM??null;
 const refusal=(code,message,state='blocked')=>uncheckedInspection({...saved,kind:'retoolkit-preparation',schemaVersion:1,name,runId,state,options,stages:saved?.stages??[],blockers:[{stage:'preparation',code,message}],readiness:saved?.readiness??readiness({stages:[]}),reportPath:paths.reportPath,handoffPath:paths.handoffPath});
 if(saved&&fingerprint(options)!==fingerprint(saved.options))return refusal('PREPARATION_OPTIONS_CHANGED','Resume options differ from the saved symbol/profile/device policy; start a separate run after review.');
 if(saved?.resourceConfiguration&&saved.resourceConfiguration.explicitHeap!==explicitHeap)return refusal('PREPARATION_OPTIONS_CHANGED','Configured headless heap differs from this run; restore the saved policy or start a separate run.');
 if(saved?.state==='running'&&alive(saved.owner))return refusal('PREPARATION_BUSY','This preparation run still has a live owner; inspect progress rather than starting another worker.');
 if(saved&&(saved.state==='unknown'||saved.stages.some(s=>s.state==='unknown'||s.state==='running')))return uncheckedInspection(unknown(saved));
 if(saved&&saved.binding){let current;try{current=snapshot(toolkit,name);}catch(error){return refusal('PREPARATION_BINDING_CHANGED',`Input/config evidence changed: ${bounded(error.message)}`);}if(current.hash!==saved.binding.hash)return refusal('PREPARATION_BINDING_CHANGED','Selected input content, engine files or saved configuration changed; review and start a new run.');}
 let release;
 try{release=gate(base,runId);}catch(error){return refusal(error.code,error.message);}
 let record=saved?structuredClone(saved):{kind:'retoolkit-preparation',schemaVersion:1,name,runId,options,createdAt:now(),stages:stageIds.map(id=>({id,state:'pending'})),blockers:[]};
 record.resourceConfiguration??={explicitHeap};
 const priorHeap=toolkit.env?.GHIDRA_HEADLESS_MAXMEM,hadHeap=toolkit.env&&Object.hasOwn(toolkit.env,'GHIDRA_HEADLESS_MAXMEM');
 record.state='running';record.owner={pid:process.pid,token:ownerToken};record.blockers=[];record.reportPath=paths.reportPath;record.handoffPath=paths.handoffPath;
 fs.mkdirSync(paths.runDirectory,{recursive:true});
 const persist=()=>{record.updatedAt=now();record.readiness=readiness(record);assertAssetPath(paths.reportPath,paths.workspace);atomicJson(paths.reportPath,record);atomicJson(base.current,{runId});const report=publicReport(record);atomicJson(paths.handoffPath,{...report,instructions:['Preparation is setup evidence only. Preserve independent native, symbol, asset and downloaded-data coverage.','Compilation, bindings and gameplay remain unverified unless explicit fresh receipts establish their individual coverage.']});return report;};
 const emit=async(stage,state)=>{const event={kind:'preparation-progress',runId,stage,state,updatedAt:record.updatedAt,readiness:record.readiness};if(dependencies.onProgress)await dependencies.onProgress(event);};
 const discardResult=stage=>{if(stage.result){stage.previousResult=compact(stage.result);delete stage.result;}};
 const complete=async(stage,state,result,error)=>{if(state!=='succeeded'&&!result)discardResult(stage);Object.assign(stage,{state,completedAt:now(),...(result?{result:compact(result)}:{}),...(error?{error:errorView(error)}:{})});if(error)record.blockers.push({stage:stage.id,...errorView(error)});persist();await emit(stage.id,state);};
 try{
  persist();
  try{ownership(toolkit,name);}catch(error){record.state='unknown';record.blockers.push({stage:'ownership',...errorView(error)});return uncheckedInspection(persist());}
  let abort=false;
  for(const stage of record.stages){
   const id=stage.id;
   const prerequisites=record.stages.find(s=>s.id==='prerequisites').result;
   const prerequisite=dependencies=>dependencies.every(dep=>record.stages.find(s=>s.id===dep)?.state==='succeeded');
   if(abort){if(!['succeeded','skipped'].includes(stage.state))await complete(stage,'blocked',null,fail('PREPARATION_OWNERSHIP_REVIEW','An uncertain engine outcome requires review before further stages'));continue;}
   if(id==='validation'&&(!options.baselineValidation||options.profile==='native')||['assets','index','scripts'].includes(id)&&options.profile==='native'||id==='symbols'&&options.symbols==='skip'){await complete(stage,'skipped');continue;}
   if(stage.reviewRequired){await complete(stage,'blocked',null,fail('PREPARATION_RECEIPT_INVALID','This stage requires explicit receipt recovery; repeated resume never replays an earlier successful write'));continue;}
   const native=['dump','import','analyze','symbols'].includes(id),assets=['assets','index','scripts','validation'].includes(id);
   const required=stageDependencies[id]??[];
   if(native&&prerequisites?.native===false||assets&&prerequisites?.assets===false){await complete(stage,'blocked',null,fail('PREPARATION_PREREQUISITE_MISSING',`${native?'Native':'Asset'} prerequisites are missing`,'Review prerequisite diagnostics and install/configure the exact SDK or engine version.'));continue;}
   if(!prerequisite(required)){await complete(stage,'blocked',null,fail('PREPARATION_DEPENDENCY_BLOCKED',`Required preparation stages are not ready: ${required.join(', ')}`));continue;}
   if(id==='symbols'&&!options.addressMode){await complete(stage,'blocked',null,fail('SYMBOL_ADDRESS_MODE_REQUIRED','Choose an explicit rva or va symbol address mode before creating or applying a plan'));continue;}
   if(saved&&stage.state==='succeeded'&&!['prerequisites','android','inputs'].includes(id)){
    if(await existingEvidence(toolkit,name,id,stage,dependencies)){stage.reused=true;persist();await emit(id,'succeeded');continue;}
    stage.reviewRequired=true;await complete(stage,'blocked',null,fail('PREPARATION_RECEIPT_INVALID','Saved successful stage no longer has current output/receipt evidence; review before any explicit rerun'));continue;
   }
   if(record.binding&&!['prerequisites','android','inputs'].includes(id)){
    let observed;try{observed=snapshot(toolkit,name);}catch(error){throw fail('PREPARATION_INPUT_CHANGED',`Input evidence changed during preparation: ${bounded(error.message)}`);}
    if(observed.hash!==record.binding.hash)throw fail('PREPARATION_INPUT_CHANGED','Inputs or engine configuration changed during preparation; writes were stopped');
   }
   discardResult(stage);Object.assign(stage,{state:'running',startedAt:now(),completedAt:null,operationId:stage.operationId??randomUUID()});delete stage.error;persist();await emit(id,'running');
   const context={toolkit,name,options,params:options,dependencies,record,runId,...paths,persist,runDefault:()=>defaults(id,context)};
   try{
    const result=await (dependencies.invokeStage??dependencies.runStage??((_id,c)=>c.runDefault()))(id,context)??{};
    if(result.outputs)saveEvidence(paths,stage,result.outputs);
    const state=['blocked','needs-input','unknown','failed'].includes(result.state)?result.state:'succeeded';
    if(record.binding&&!['prerequisites','android','inputs'].includes(id)){
     let observed;try{observed=snapshot(toolkit,name);}catch(error){throw fail('PREPARATION_INPUT_CHANGED',`Input evidence changed while ${id} ran: ${bounded(error.message)}`);}
     if(observed.hash!==record.binding.hash){
      const before={...record.binding.settings},after={...observed.settings};delete before.reconstructedSourceDir;delete after.reconstructedSourceDir;
      if(id==='assets'&&state==='succeeded'&&record.binding.sourceHash===observed.sourceHash&&record.binding.toolsHash===observed.toolsHash&&fingerprint(before)===fingerprint(after))record.binding=observed;
      else throw fail('PREPARATION_INPUT_CHANGED',`Input or configuration changed while ${id} ran; later stages were stopped`);
     }
    }
    const stageError=state==='succeeded'?null:fail(result.code??(state==='unknown'?'PREPARATION_ENGINE_UNCERTAIN':'PREPARATION_STAGE_BLOCKED'),result.message??result.reason??result.reasons?.[0]?.message??`${id} requires review`,result.action);
    await complete(stage,state,result,stageError);
    if(id==='inputs'&&state==='succeeded')record.binding=snapshot(toolkit,name);
    if(state==='unknown')abort=true;
   }catch(error){let ownershipError;try{ownership(toolkit,name);}catch(observed){ownershipError=observed;}const uncertain=Boolean(ownershipError)||uncertainCodes.has(error.code)||/unknown|uncertain|not confirmed|still running/i.test(error.message);await complete(stage,uncertain?'unknown':'blocked',null,ownershipError??error);if(uncertain)abort=true;}
  }
  const work=record.stages.filter(s=>!['prerequisites','android','inputs'].includes(s.id)&&s.state!=='skipped');
  record.state=record.stages.some(s=>s.state==='unknown')?'unknown':record.stages.some(s=>['blocked','needs-input','failed'].includes(s.state))?(work.some(s=>s.state==='succeeded')?'partial':'blocked'):'succeeded';record.completedAt=now();return persist();
 }catch(error){record.state=uncertainCodes.has(error.code)?'unknown':'blocked';record.blockers.push({stage:'preparation',...errorView(error)});return persist();}
 finally{if(toolkit.env){if(hadHeap)toolkit.env.GHIDRA_HEADLESS_MAXMEM=priorHeap;else delete toolkit.env.GHIDRA_HEADLESS_MAXMEM;}release();}
}
