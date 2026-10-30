import fs from 'node:fs';
import {measurePhase} from '../workflow/metrics.js';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileIdentity,fingerprint,ownsWorkspaceLock} from '../state.js';
import {assertAssetPath,assetPaths,assetError,selectedAssetBinding} from '../assets/context.js';
import {verifyGraphFiles} from '../assets/graph.js';
import {managedLibraries} from '../libraries/managed.js';
import {validateUnityObservation,validateUnityRequest} from './report.js';
import {sourceExcludesComponentInheritance} from '../assets/csharp.js';
import {stageResidentProject,runResidentEditor} from './resident.js';
import {verifyResidentExecution,validationExecutionComplete} from './execution.js';
import {classifyMetaFreeSources} from './source-identities.js';

const MiB=1024**2,versionPattern=/^\d{4}\.\d+\.\d+[abfp]\d+$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function check(ok,message,code='unity_validation_invalid'){if(!ok)throw assetError(code,message);}
function json(file,value){assertAssetPath(file);const bytes=JSON.stringify(value,null,2)+'\n';check(Buffer.byteLength(bytes)<=32*MiB,'Validation artifact exceeds 32 MiB');fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});}
function readArtifact(file,limit=16*MiB){assertAssetPath(file);const stat=fs.lstatSync(file);check(stat.isFile()&&stat.size<=limit,'Invalid validation artifact size');const bytes=fs.readFileSync(file);check(bytes.length<=limit,'Validation artifact changed size');return {value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),sha256:sha(bytes)};}
function readJson(file,limit){return readArtifact(file,limit).value;}
export function assertPortablePackages(projectDir,files){
 const managed=managedLibraries(projectDir,files);
 for(const file of files.filter(f=>/^Packages\/(?:manifest|packages-lock)\.json$/i.test(f.path)||/^Packages\/(?:[^/]+\/)+package\.json$/i.test(f.path))){
  const embedded=/^Packages\/([^/]+)\/package\.json$/i.exec(file.path);
  if(embedded)check(managed.has(embedded[1]),'Embedded packages require an exact managed library inventory','unity_package_unsupported');
  const value=readJson(path.join(projectDir,file.path));const dependencies=value.dependencies??{};check(typeof dependencies==='object'&&!Array.isArray(dependencies),'Invalid package manifest');
  for(const [id,spec] of Object.entries(dependencies)){
   if(/^Packages\/packages-lock\.json$/i.test(file.path)&&spec?.source==='embedded'){
    const pkg=managed.get(id);check(pkg&&(spec.version===pkg.version||spec.version===`file:${id}`),'Embedded package lock differs from managed inventory','unity_package_unsupported');
    for(const dependency of Object.values(spec.dependencies??{}))check(typeof dependency==='string'&&/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(dependency),'Embedded package has unsupported dependency','unity_package_unsupported');continue;
   }
   const dependency=typeof spec==='string'?spec:spec?.version;
   check(typeof dependency==='string'&&/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(dependency),'Local, Git and unresolved package dependencies require a portable staging project','unity_package_unsupported');
   if(typeof spec==='object')check(['registry','builtin'].includes(spec.source),'External package source is unsupported','unity_package_unsupported');
   if(typeof spec==='object')for(const dependency of Object.values(spec.dependencies??{}))check(typeof dependency==='string'&&/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(dependency),'Package lock has unsupported nested dependency','unity_package_unsupported');
  }
 }
}

function editorVersion(file){
 if(process.platform!=='win32')return null;
 const shell=path.join(process.env.SystemRoot??'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 const result=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; [Console]::Write((Get-Item -LiteralPath $env:RETK_UNITY_EDITOR_FILE).VersionInfo.ProductVersion)"],{env:{...process.env,RETK_UNITY_EDITOR_FILE:file},encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:65536});
 if(result.status!==0||result.error)return null;
 return result.stdout.trim().split('_')[0];
}
export function resolveUnityEditor(version,project={},options={}){
 check(typeof version==='string'&&versionPattern.test(version),'Invalid Unity project version');
 const installRoot=options.installRoot??path.join(process.env.ProgramFiles??'C:/Program Files','Unity/Hub/Editor');
 const candidate=project.unityEditorPath??path.join(installRoot,version,'Editor/Unity.exe');
 assertAssetPath(candidate);
 if(!fs.existsSync(candidate))return null;
 check(fs.lstatSync(candidate).isFile()&&path.basename(candidate).toLowerCase()==='unity.exe','Configured Unity Editor must be a regular Unity.exe');
 // Folder labels alone cannot attest an Editor build. Verify the binary's
 // embedded product version before launch and Application.unityVersion after.
 check((options.getEditorVersion??editorVersion)(candidate)===version,'Editor executable version differs from the exported project','unity_editor_mismatch');
 return path.resolve(candidate);
}

export async function stageUnityProject({projectDir,graph,runDir,templateRoot,runId=randomUUID(),assetIds,dataCapture=false}){
 assertAssetPath(projectDir);assertAssetPath(runDir);await verifyGraphFiles(projectDir,graph);
 check(typeof graph.unityVersion==='string'&&versionPattern.test(graph.unityVersion),'ProjectVersion.txt has no supported exact Unity version');
 check(!graph.files.some(f=>/^Assets\/REToolkitValidation(?:\/|\.|$)/i.test(f.path)),'Reserved validation helper directory already exists','unity_helper_collision');
 assertPortablePackages(projectDir,graph.files);check(!fs.existsSync(runDir),'Validation run must use a fresh directory');
 fs.mkdirSync(runDir,{recursive:true});const staged=assertAssetPath(path.join(runDir,'project'),runDir);fs.mkdirSync(staged);
 for(const file of graph.files){
  const source=assertAssetPath(path.join(projectDir,file.path),projectDir),target=assertAssetPath(path.join(staged,file.path),staged);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
  const actual=fileIdentity(target);check(actual.sha256===file.sha256&&actual.size===file.size,'Source changed during Unity staging','stale_graph');
 }
 const helper=assertAssetPath(path.join(templateRoot,'Unity/REToolkitValidation.cs')),helperBytes=fs.readFileSync(helper);
 const helperDir=path.join(staged,'Assets/REToolkitValidation/Editor');fs.mkdirSync(helperDir,{recursive:true});
 fs.writeFileSync(path.join(helperDir,'REToolkitValidation.cs'),helperBytes,{flag:'wx'});
 json(path.join(helperDir,'REToolkit.Validation.Editor.asmdef'),{name:'REToolkit.Validation.Editor',includePlatforms:['Editor'],autoReferenced:false});
 const request={kind:'retoolkit-unity-validation-request',schemaVersion:1,runId,graphRevision:graph.revision,binding:graph.binding,unityVersion:graph.unityVersion,scanPolicy:'reference-scan-v2',...(dataCapture?{dataCapture:true}:{}),
  scripts:graph.assets.filter(a=>/\.cs$/i.test(a.path)).map(a=>({assetId:a.id,path:a.path})),
  assets:serializedAssets(graph).filter(a=>assetIds===undefined||assetIds.includes(a.assetId))};
 check(request.scripts.length<=10000&&request.assets.length<=10000,'Editor validation request exceeds 10000 scripts/assets');
 if(dataCapture)check(assetIds?.length&&assetIds.length<=64&&request.assets.length===assetIds.length&&request.assets.every(a=>a.kind==='asset'&&/^asset:[a-f0-9]{32}$/i.test(a.assetId)),'Data capture requires exact stable .asset scope');
 const requestFile=path.join(runDir,'request.json'),reportFile=path.join(runDir,'observation.json');json(requestFile,request);
 await verifyGraphFiles(projectDir,graph);
 return {projectDir:staged,request,requestFile,reportFile,requestSha256:fileIdentity(requestFile).sha256,helperSha256:sha(helperBytes)};
}

function compilerDiagnostics(logTail,exitCode){
 return String(logTail??'').split(/\r?\n/).filter(line=>/error CS\d+|Scripts have compiler errors|Aborting batchmode|Fatal error/i.test(line)||exitCode!==0&&/licen[sc].*(?:fail|error|not found|invalid)/i.test(line)).slice(-100).map(message=>({severity:'error',message:/licen[sc]/i.test(message)?'Unity licensing reported a failure; inspect the local Editor output.':message.slice(0,8192),path:''}));
}
function summary(receipt,storedReceipt){const {diagnostics=[],...rest}=receipt;return {...rest,diagnostics:diagnostics.slice(0,20),diagnosticCount:diagnostics.length,storedReceipt};}
const sourceSnapshot=graph=>({kind:graph.kind,revision:graph.revision,coverage:graph.coverage});
const operationPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const serializedAssets=graph=>graph.assets.filter(a=>/\.(?:unity|prefab|asset)$/i.test(a.path)).map(a=>({assetId:a.id,path:a.path,kind:/\.unity$/i.test(a.path)?'scene':/\.prefab$/i.test(a.path)?'prefab':'asset'}));
function validationScope(graph,assetIds){
 if(assetIds===undefined)return {kind:'project',assetIds:serializedAssets(graph).map(a=>a.assetId).sort()};
 check(Array.isArray(assetIds)&&assetIds.length>=1&&assetIds.length<=1000&&new Set(assetIds).size===assetIds.length,'Expected 1..1000 unique exact scene/prefab/.asset asset IDs');
 const all=new Set(serializedAssets(graph).map(a=>a.assetId));
 check(assetIds.every(id=>typeof id==='string'&&id.length<=2048&&all.has(id)),'Unknown validation scene/prefab/.asset asset ID');
 return {kind:'assets',assetIds:[...assetIds].sort()};
}
function boundRequest(graph,operationId,assetIds){return {kind:'retoolkit-unity-validation-request',schemaVersion:1,runId:operationId,graphRevision:graph.revision,binding:graph.binding,unityVersion:graph.unityVersion,scanPolicy:'reference-scan-v2',scripts:graph.assets.filter(a=>/\.cs$/i.test(a.path)).map(a=>({assetId:a.id,path:a.path})),assets:serializedAssets(graph).filter(a=>assetIds.includes(a.assetId))};}
function completeRows(observation){
 if(observation?.traversal?.policy!=='reference-scan-v2')return [];
 const errors=observation.diagnostics.filter(d=>d.severity==='error');
 return observation.assets.filter(a=>a.traversal.complete&&!errors.some(d=>d.path===''||d.path===a.path));
}
function same(left,right){return fingerprint(left)===fingerprint(right);}
function readArtifacts({paths,operationId,graph}){
 check(typeof operationId==='string'&&operationPattern.test(operationId),'Invalid validation operation UUID');
 const directory=assertAssetPath(path.join(paths.base,'unity-validation',operationId),paths.workspace),receipt=readJson(path.join(directory,'receipt.json'));
 const {receiptSha256,...payload}=receipt;
 check(receipt.kind==='retoolkit-unity-validation'&&receipt.schemaVersion===1&&receipt.operationId===operationId&&receiptSha256===fingerprint(payload),'Invalid validation receipt');
 check(receipt.graphRevision===graph.revision&&same(receipt.binding,graph.binding),'Validation receipt belongs to an old source snapshot','stale_graph');
 let request=null,observation=null,checkpoint=null;
 if(receipt.requestSha256){const artifact=readArtifact(path.join(directory,'request.json'));check(artifact.sha256===receipt.requestSha256,'Validation request bytes changed');request=artifact.value;validateUnityRequest(request);check(request.runId===operationId&&request.graphRevision===graph.revision&&same(request.binding,graph.binding),'Validation request binding changed');}
 // Historical project-wide requests may predate .asset selectors while sharing
 // the same file-inventory revision. They cannot certify the expanded scope.
 const recordedScope=receipt.scope??(request?{kind:'project',assetIds:request.assets.map(a=>a.assetId).sort()}:null);
 if(recordedScope){
  check(['project','assets'].includes(recordedScope.kind),'Invalid recorded validation scope');
  const currentScope=validationScope(graph,recordedScope.kind==='project'?undefined:recordedScope.assetIds);
  check(same(currentScope,recordedScope),'Validation asset scope changed; start a fresh validation with the saved policy. Historical receipts were retained.','unity_validation_scope_changed');
 }
 if(receipt.observationSha256){const artifact=readArtifact(path.join(directory,'observation.json'));check(request&&artifact.sha256===receipt.observationSha256,'Validation observation bytes changed');observation=validateUnityObservation(artifact.value,request);}
 if(receipt.checkpointSha256){
  const artifact=readArtifact(path.join(directory,'checkpoint.json'));check(request&&artifact.sha256===receipt.checkpointSha256,'Validation checkpoint bytes changed');checkpoint=artifact.value;
  const keys=['kind','schemaVersion','operationId','graphRevision','binding','unityVersion','editor','helperSha256','scope','requestSha256','observationSha256','assets'];
  check(Object.keys(checkpoint).length===keys.length&&Object.keys(checkpoint).every(k=>keys.includes(k))&&checkpoint.kind==='retoolkit-unity-validation-checkpoint'&&checkpoint.schemaVersion===1&&checkpoint.operationId===operationId&&checkpoint.graphRevision===graph.revision&&same(checkpoint.binding,graph.binding)&&checkpoint.unityVersion===graph.unityVersion&&same(checkpoint.editor,receipt.editor)&&checkpoint.helperSha256===receipt.helperSha256&&same(checkpoint.scope,receipt.scope)&&checkpoint.requestSha256===receipt.requestSha256&&checkpoint.observationSha256===receipt.observationSha256,'Invalid validation checkpoint binding');
  const scope=validationScope(graph,receipt.scope?.kind==='project'?undefined:receipt.scope?.assetIds);check(same(scope,receipt.scope),'Invalid validation checkpoint scope');
  const full=boundRequest(graph,operationId,scope.assetIds);
  if(request.dataCapture)full.dataCapture=true;
  validateUnityObservation({kind:'retoolkit-unity-observation',schemaVersion:1,runId:operationId,graphRevision:graph.revision,unityVersion:graph.unityVersion,complete:false,compilation:{state:'succeeded'},traversal:{policy:'reference-scan-v2'},scripts:[],assets:checkpoint.assets,diagnostics:[]},full);
  check(checkpoint.assets.every(a=>a.traversal.complete),'Checkpoint contains incomplete assets');
  const observed=new Map((observation?.assets??[]).map(a=>[a.assetId,a]));
  for(const row of checkpoint.assets)if(observed.has(row.assetId))check(same(row,observed.get(row.assetId)),'Checkpoint differs from current observation');
 }
 verifyResidentExecution(directory,receipt);
 return {directory,receipt,payload,request,observation,checkpoint};
}
async function scriptBindingsMatch(graph,projectDir,scripts,editorPath){
 const assets=graph.assets.filter(a=>/\.cs$/i.test(a.path)),byId=new Map(assets.map(a=>[a.id,a])),types=new Map(),shortNames=new Map(),required=new Set(),children=new Map(),queue=[];
 for(const asset of assets)for(const type of asset.script?.types??[]){types.set(type.fullName,type);const matches=shortNames.get(type.name)??[];matches.push(type);shortNames.set(type.name,matches);}
 for(const type of types.values())for(const base of type.baseTypes??[]){
  if(/(?:^|\.)(?:MonoBehaviour|ScriptableObject)$/.test(base)){if(!required.has(type)){required.add(type);queue.push(type);}continue;}
  for(const parent of types.has(base)?[types.get(base)]:shortNames.get(base)??[]){const list=children.get(parent)??[];list.push(type);children.set(parent,list);}
 }
 for(let i=0;i<queue.length;i++)for(const child of children.get(queue[i])??[])if(!required.has(child)){required.add(child);queue.push(child);}
 if(scripts.length!==assets.length)return {matches:false};
 const targets=scripts.filter(row=>{const asset=byId.get(row.assetId);return asset&&!asset.guid&&row.assembly===asset.script?.assembly&&(row.classification==='compiled-source'&&!row.resolved&&row.fullName===null||row.classification==='non-attachable'&&row.resolved);}).map(row=>byId.get(row.assetId));
 const sourceClasses=await classifyMetaFreeSources({assets,targets,files:graph.files,projectDir,editorPath,observations:scripts});
 const matches=scripts.every(row=>{
  const asset=byId.get(row.assetId),declared=asset?.script?.types??[];
  if(!asset||row.assembly!==asset.script?.assembly)return false;
  if(!asset.guid)return sourceClasses.verified.has(asset.id);
  if(row.guid?.toLowerCase()!==asset.guid.toLowerCase())return false;
  if(!row.classification)return row.resolved&&declared.length===1&&row.fullName===declared[0].fullName;
  if(row.classification==='unresolved')return false;
  const expected=declared.filter(type=>required.has(type));
  if(row.classification==='attachable')return row.resolved&&declared.some(type=>type.fullName===row.fullName)&&expected.every(type=>type.fullName===row.fullName);
  // Reflection proves abstract/generic/non-Unity classes non-attachable while
  // retaining any source declaration identity that is available.
  if(row.classification==='non-attachable')return row.resolved&&(declared.length===0||declared.some(type=>type.fullName===row.fullName))&&expected.every(type=>type.fullName===row.fullName);
  if(expected.length)return false;
  // Inclusion in a compiler assembly alone cannot prove a missing component
  // harmless. Unsupported lexical forms remain unknown; reflected identity is
  // required for class inheritance and declarations split across files.
  const source=fs.readFileSync(assertAssetPath(path.join(projectDir,asset.path),projectDir),'utf8');
  if(!sourceExcludesComponentInheritance(source))return false;
  return row.classification==='compiled-source'&&!row.resolved;
 });
 return {matches,reason:sourceClasses.reason};
}
export async function validateUnityProject({toolkit,name,projectDir,graph,timeoutSeconds=600,resumeOperationId,assetIds,dataCapture=false,mode='clean'},dependencies={}){
 check(['clean','resident'].includes(mode),'Unknown Unity validation mode');
 const paths=assetPaths(toolkit,name);check(ownsWorkspaceLock(paths.workspace),'Unity validation requires the workspace lease','asset_lease_required');
 check(Number.isSafeInteger(timeoutSeconds)&&timeoutSeconds>=1&&timeoutSeconds<=3600,'Validation timeout must be 1..3600 seconds');
 const selected=selectedAssetBinding(toolkit,name);check(fingerprint(graph.binding)===fingerprint(selected.binding),'Validation source build changed','stale_graph');
 await verifyGraphFiles(projectDir,graph);
 const parent=resumeOperationId===undefined?null:readArtifacts({paths,operationId:resumeOperationId,graph});
 check(typeof dataCapture==='boolean'&&!(dataCapture&&resumeOperationId)&&!parent?.request?.dataCapture,'Data capture requires a fresh validation operation; capture checkpoints are not resumable','unity_data_capture_invalid');
 const scope=validationScope(graph,assetIds===undefined&&parent?.receipt.scope?.kind==='assets'?parent.receipt.scope.assetIds:assetIds);
 const operationId=randomUUID(),base=assertAssetPath(path.join(paths.base,'unity-validation'),paths.workspace);fs.mkdirSync(base,{recursive:true});
 const runDir=assertAssetPath(path.join(base,operationId),paths.workspace),editor=dependencies.editor??resolveUnityEditor(graph.unityVersion,selected.project);
 if(!editor){check(resumeOperationId===undefined,'Resume requires the original exact Editor executable','unity_resume_mismatch');fs.mkdirSync(runDir);const blocked={kind:'retoolkit-unity-validation',schemaVersion:1,operationId,state:'blocked',code:'unity_editor_missing',unityVersion:graph.unityVersion,graphRevision:graph.revision,binding:graph.binding,sourceSnapshot:sourceSnapshot(graph),compilation:{state:'unverified'},compileReady:false,bindingsVerified:false,scopeBindingsVerified:false,scope,behavior:'unverified'};json(path.join(runDir,'receipt.json'),{...blocked,receiptSha256:fingerprint(blocked)});return summary(blocked,path.relative(paths.workspace,path.join(runDir,'receipt.json')).split(path.sep).join('/'));}
 assertAssetPath(editor);const editorIdentity=fileIdentity(editor);
 const helperFile=assertAssetPath(path.join(toolkit.root,'templates/Unity/REToolkitValidation.cs')),helperSha256=fileIdentity(helperFile).sha256;
 let reused=[];
 if(resumeOperationId!==undefined){
  const parentScope=parent.receipt.scope??validationScope(graph);
  check(parent.request&&validationExecutionComplete(parent.receipt)&&same(parent.receipt.editor,editorIdentity)&&parent.receipt.helperSha256===helperSha256&&same(parentScope,scope),'Resume Editor, helper or exact asset scope changed','unity_resume_mismatch');
  check(parent.request.unityVersion===graph.unityVersion,'Resume Unity version changed','unity_resume_mismatch');
  // Self-contained sealed rows make parent reads constant-depth, regardless of
  // how many earlier resumptions produced this parent.
  reused=parent.checkpoint?.assets??completeRows(parent.observation);
 }
 const pendingIds=scope.assetIds.filter(id=>!reused.some(a=>a.assetId===id));
 const request=boundRequest(graph,operationId,pendingIds);if(dataCapture)request.dataCapture=true;
 if(mode==='resident'){assertPortablePackages(projectDir,graph.files);validateUnityRequest(request);}
 const staged=await measurePhase('unity.stage',()=>mode==='resident'?stageResidentProject({toolkit,name,projectDir,graph,runDir,request,editor,timeoutSeconds},dependencies.resident):stageUnityProject({projectDir,graph,runDir,templateRoot:path.join(toolkit.root,'templates'),runId:operationId,assetIds:pendingIds,dataCapture}));
 check(staged.helperSha256===helperSha256,'Validation helper changed during staging','unity_resume_mismatch');
 const {runUnityEditor}=await import('./runner.js');const run=dependencies.runEditor??runUnityEditor;
 const emitProgress=observed=>{
  if(typeof toolkit.onValidationProgress!=='function')return;
  const completedAssets=reused.length+(observed?.complete&&!observed.traversal?observed.assets.length:completeRows(observed).length),current=observed?.assets.at(-1);
  try{toolkit.onValidationProgress({operationId,requestedAssets:scope.assetIds.length,completedAssets,pendingAssets:scope.assetIds.length-completedAssets,...(current?{currentAsset:current.path}:{})});}catch{/* Telemetry cannot release ownership or interrupt validation. */}
 };
 emitProgress(null);
 const progressTimer=typeof toolkit.onValidationProgress==='function'?setInterval(()=>{try{emitProgress(validateUnityObservation(readJson(staged.progressReportFile??staged.reportFile),staged.request));}catch{/* Atomic checkpoint may not exist yet. */}},2000):null;
 progressTimer?.unref();let processResult;
 try{processResult=await measurePhase('unity.execute',()=>mode==='resident'?runResidentEditor({toolkit,name,staged,editor,timeoutSeconds},dependencies.resident):run({editor,projectDir:staged.projectDir,requestFile:staged.requestFile,reportFile:staged.reportFile,lockDirectory:path.join(paths.workspace,'.retk-lock'),toolkitRoot:toolkit.root,timeoutSeconds}));}finally{if(progressTimer)clearInterval(progressTimer);}
 if(mode==='resident'?processResult.completed!==true:processResult.closed!==true)throw Object.assign(assetError('unity_recovery_required','Unity child close is not confirmed'),{preserveToolchainGate:true});
 check(fingerprint(selectedAssetBinding(toolkit,name).binding)===fingerprint(selected.binding),'Source build changed during Unity validation','stale_graph');await verifyGraphFiles(projectDir,graph);
 check(fileIdentity(editor).sha256===editorIdentity.sha256,'Editor executable changed during validation','unity_editor_mismatch');
 check(fileIdentity(staged.requestFile).sha256===staged.requestSha256,'Validation request bytes changed during Editor work');
 let observation=null,diagnostics=compilerDiagnostics(processResult.logTail,processResult.exitCode),reportError=null,observationSha256=null;
 try{const artifact=readArtifact(staged.reportFile);observation=validateUnityObservation(artifact.value,staged.request);observationSha256=artifact.sha256;}catch(error){reportError=error.code??'unity_report_missing';}
 emitProgress(observation);
 const processSucceeded=processResult.exitCode===0&&!processResult.timedOut;
 const observationCompilerError=observation?.diagnostics.some(d=>d.severity==='error'&&/error CS\d+|Scripts have compiler errors/i.test(d.message));
 const loggedCompilerError=diagnostics.some(d=>/error CS\d+|Scripts have compiler errors/i.test(d.message));
 const compilation={state:loggedCompilerError||observationCompilerError||observation?.compilation.state==='failed'?'failed':processSucceeded&&!diagnostics.length&&observation?.compilation.state==='succeeded'?'succeeded':'unverified'};
 const compileReady=compilation.state==='succeeded';
 const completed=[...reused,...completeRows(observation)],completedIds=new Set(completed.map(a=>a.assetId));
 // Legacy final reports may prove full coverage; partial legacy rows cannot
 // establish completion, even when their missing-reference counters are zero.
 if(observation?.complete&&!observation.traversal)for(const row of observation.assets)completedIds.add(row.assetId);
 const merged=[...reused,...observation?.assets??[]],pendingAssets=scope.assetIds.length-completedIds.size;
 const coverageComplete=pendingAssets===0&&observation?.scripts.length===staged.request.scripts.length;
 const sourceClassification=observation?await scriptBindingsMatch(graph,projectDir,observation.scripts,editor):null,typesMatch=sourceClassification?.matches;
 await verifyGraphFiles(projectDir,graph);
 check(fileIdentity(editor).sha256===editorIdentity.sha256,'Editor executable changed during source classification','unity_editor_mismatch');
 const scopeBindingsVerified=Boolean(compileReady&&coverageComplete&&typesMatch&&!observation.diagnostics.some(d=>d.severity==='error')&&merged.every(asset=>asset.loaded&&asset.missingScripts===0&&asset.missingReferences===0));
 const bindingsVerified=scope.kind==='project'&&scopeBindingsVerified;
 diagnostics=[...diagnostics,...observation?.diagnostics??parent?.receipt.diagnostics??[]].slice(0,1000);
 if(observation&&!typesMatch&&diagnostics.length<1000)diagnostics.push({severity:'warning',message:`Required source class identity or compiler-backed script classification remains unverified; inspect script observations.${sourceClassification?.reason?' '+sourceClassification.reason.slice(0,512):''}`,path:''});
 const requestSha256=staged.requestSha256;
 const checkpoint={kind:'retoolkit-unity-validation-checkpoint',schemaVersion:1,operationId,graphRevision:graph.revision,binding:graph.binding,unityVersion:graph.unityVersion,editor:editorIdentity,helperSha256:staged.helperSha256,scope,requestSha256,observationSha256,assets:completed};
 check(Buffer.byteLength(JSON.stringify(checkpoint,null,2)+'\n')<=16*MiB,'Validation checkpoint exceeds 16 MiB');
 json(path.join(runDir,'checkpoint.json'),checkpoint);
 const receipt={kind:'retoolkit-unity-validation',schemaVersion:1,operationId,state:compilation.state==='failed'?'validation_failed':coverageComplete&&compileReady?'validated':'partial',graphRevision:graph.revision,binding:graph.binding,unityVersion:graph.unityVersion,sourceSnapshot:sourceSnapshot(graph),
  compilation,compileReady,bindingsVerified,scopeBindingsVerified,scope,behavior:'unverified',editor:{...editorIdentity},helperSha256:staged.helperSha256,observationSha256,checkpointSha256:fileIdentity(path.join(runDir,'checkpoint.json')).sha256,
  requestSha256,...(processResult.execution?{execution:processResult.execution,resident:processResult.resident}:{}),process:{exitCode:processResult.exitCode,timedOut:processResult.timedOut,closed:processResult.closed===true},reportError,diagnostics,counts:{scripts:staged.request.scripts.length,assets:staged.request.assets.length},coverage:{state:coverageComplete?'observed':'partial',source:'staging-editor',requestedAssets:scope.assetIds.length,completedAssets:completedIds.size,pendingAssets,reusedAssets:reused.length},nextAction:compilation.state==='failed'?'fix-compilation':pendingAssets?'resume':scopeBindingsVerified?'none':'inspect-bindings',...(pendingAssets&&compilation.state!=='failed'?{resume:{operationId,pendingAssets}}:{}),...(resumeOperationId?{resumedFrom:resumeOperationId}:{})};
 json(path.join(runDir,'receipt.json'),{...receipt,receiptSha256:fingerprint(receipt)});
 fs.writeFileSync(path.join(runDir,'editor-output.txt'),String(processResult.logTail??'').slice(-4*MiB),{flag:'wx',mode:0o600});
 return summary(receipt,path.relative(paths.workspace,path.join(runDir,'receipt.json')).split(path.sep).join('/'));
}

export async function readUnityValidation({toolkit,name,projectDir,graph,operationId,section='summary',limit=100,cursor}){
 check(['summary','scripts','assets','diagnostics'].includes(section)&&Number.isSafeInteger(limit)&&limit>=1&&limit<=1000,'Invalid validation report query');
 const paths=assetPaths(toolkit,name),{directory,receipt,payload,observation,checkpoint}=readArtifacts({paths,operationId,graph});await verifyGraphFiles(projectDir,graph);
 const storedReceipt=path.relative(paths.workspace,path.join(directory,'receipt.json')).split(path.sep).join('/');
 if(section==='summary')return summary(payload,storedReceipt);
 let rows=section==='diagnostics'?(receipt.diagnostics??[]):(observation?.[section]??[]);
 if(section==='assets'&&checkpoint){const merged=new Map(checkpoint.assets.map(row=>[row.assetId,row]));for(const row of rows)merged.set(row.assetId,row);rows=[...merged.values()].sort((a,b)=>a.path.localeCompare(b.path));}
 let offset=0;
 const binding=fingerprint({operationId,section,revision:graph.revision});
 if(cursor!==undefined){try{const decoded=JSON.parse(Buffer.from(cursor,'base64url').toString());check(decoded.binding===binding&&Number.isSafeInteger(decoded.offset)&&decoded.offset>=0,'Invalid validation cursor');offset=decoded.offset;}catch{throw assetError('unity_validation_invalid','Invalid validation cursor');}}
 const items=[];let bytes=0;
 for(const row of rows.slice(offset,offset+limit)){
  const size=Buffer.byteLength(JSON.stringify(JSON.stringify(row)));
  if(items.length&&bytes+size>MiB)break;
  check(size<=MiB,'One validation report row exceeds the output limit');items.push(row);bytes+=size;
 }
 const next=offset+items.length;
 return {operationId,revision:graph.revision,section,coverage:receipt.coverage??{state:'partial',source:'staging-editor'},...(receipt.sourceSnapshot?{sourceSnapshot:receipt.sourceSnapshot}:{}),items,nextCursor:next<rows.length?Buffer.from(JSON.stringify({binding,offset:next})).toString('base64url'):null};
}
