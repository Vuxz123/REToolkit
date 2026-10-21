import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileIdentity,fingerprint,ownsWorkspaceLock} from '../state.js';
import {assertAssetPath,assetPaths,assetError,selectedAssetBinding} from '../assets/context.js';
import {verifyGraphFiles} from '../assets/graph.js';
import {managedLibraries} from '../libraries/managed.js';

const MiB=1024**2,versionPattern=/^\d{4}\.\d+\.\d+[abfp]\d+$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function check(ok,message,code='unity_validation_invalid'){if(!ok)throw assetError(code,message);}
function json(file,value){assertAssetPath(file);const bytes=JSON.stringify(value,null,2)+'\n';check(Buffer.byteLength(bytes)<=32*MiB,'Validation artifact exceeds 32 MiB');fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});}
function readJson(file,limit=16*MiB){assertAssetPath(file);const stat=fs.lstatSync(file);check(stat.isFile()&&stat.size<=limit,'Invalid validation artifact size');const bytes=fs.readFileSync(file);check(bytes.length<=limit,'Validation artifact changed size');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
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

export async function stageUnityProject({projectDir,graph,runDir,templateRoot,runId=randomUUID()}){
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
 const request={kind:'retoolkit-unity-validation-request',schemaVersion:1,runId,graphRevision:graph.revision,binding:graph.binding,unityVersion:graph.unityVersion,
  scripts:graph.assets.filter(a=>/\.cs$/i.test(a.path)).map(a=>({assetId:a.id,path:a.path})),
  assets:graph.assets.filter(a=>/\.(?:unity|prefab)$/i.test(a.path)).map(a=>({assetId:a.id,path:a.path,kind:/\.unity$/i.test(a.path)?'scene':'prefab'}))};
 check(request.scripts.length<=10000&&request.assets.length<=10000,'Editor validation request exceeds 10000 scripts/assets');
 const requestFile=path.join(runDir,'request.json'),reportFile=path.join(runDir,'observation.json');json(requestFile,request);
 await verifyGraphFiles(projectDir,graph);
 return {projectDir:staged,request,requestFile,reportFile,helperSha256:sha(helperBytes)};
}

function compilerDiagnostics(logTail,exitCode){
 return String(logTail??'').split(/\r?\n/).filter(line=>/error CS\d+|Scripts have compiler errors|Aborting batchmode|Fatal error/i.test(line)||exitCode!==0&&/licen[sc].*(?:fail|error|not found|invalid)/i.test(line)).slice(-100).map(message=>({severity:'error',message:/licen[sc]/i.test(message)?'Unity licensing reported a failure; inspect the local Editor output.':message.slice(0,8192),path:''}));
}
function summary(receipt,storedReceipt){const {diagnostics=[],...rest}=receipt;return {...rest,diagnostics:diagnostics.slice(0,20),diagnosticCount:diagnostics.length,storedReceipt};}
export async function validateUnityProject({toolkit,name,projectDir,graph,timeoutSeconds=600},dependencies={}){
 const paths=assetPaths(toolkit,name);check(ownsWorkspaceLock(paths.workspace),'Unity validation requires the workspace lease','asset_lease_required');
 check(Number.isSafeInteger(timeoutSeconds)&&timeoutSeconds>=1&&timeoutSeconds<=3600,'Validation timeout must be 1..3600 seconds');
 const selected=selectedAssetBinding(toolkit,name);check(fingerprint(graph.binding)===fingerprint(selected.binding),'Validation source build changed','stale_graph');
 await verifyGraphFiles(projectDir,graph);
 const operationId=randomUUID(),base=assertAssetPath(path.join(paths.base,'unity-validation'),paths.workspace);fs.mkdirSync(base,{recursive:true});
 const runDir=assertAssetPath(path.join(base,operationId),paths.workspace),editor=dependencies.editor??resolveUnityEditor(graph.unityVersion,selected.project);
 if(!editor){fs.mkdirSync(runDir);const blocked={kind:'retoolkit-unity-validation',schemaVersion:1,operationId,state:'blocked',code:'unity_editor_missing',unityVersion:graph.unityVersion,graphRevision:graph.revision,binding:graph.binding,compileReady:false,bindingsVerified:false,behavior:'unverified'};json(path.join(runDir,'receipt.json'),{...blocked,receiptSha256:fingerprint(blocked)});return summary(blocked,path.relative(paths.workspace,path.join(runDir,'receipt.json')).split(path.sep).join('/'));}
 assertAssetPath(editor);const editorIdentity=fileIdentity(editor);
 const staged=await stageUnityProject({projectDir,graph,runDir,templateRoot:path.join(toolkit.root,'templates'),runId:operationId});
 const {runUnityEditor}=await import('./runner.js');const run=dependencies.runEditor??runUnityEditor;
 const processResult=await run({editor,projectDir:staged.projectDir,requestFile:staged.requestFile,reportFile:staged.reportFile,lockDirectory:path.join(paths.workspace,'.retk-lock'),toolkitRoot:toolkit.root,timeoutSeconds});
 check(processResult.closed===true,'Unity child close is not confirmed','unity_recovery_required');
 check(fingerprint(selectedAssetBinding(toolkit,name).binding)===fingerprint(selected.binding),'Source build changed during Unity validation','stale_graph');await verifyGraphFiles(projectDir,graph);
 check(fileIdentity(editor).sha256===editorIdentity.sha256,'Editor executable changed during validation','unity_editor_mismatch');
 let observation=null,diagnostics=compilerDiagnostics(processResult.logTail,processResult.exitCode),reportError=null;
 try{const {validateUnityObservation}=await import('./report.js');observation=validateUnityObservation(readJson(staged.reportFile),staged.request);}catch(error){reportError=error.code??'unity_report_missing';}
 const compileReady=processResult.exitCode===0&&!processResult.timedOut&&observation?.complete===true&&observation.compilation.state==='succeeded';
 const typesMatch=observation?.scripts.every(script=>{const asset=graph.assets.find(a=>a.id===script.assetId),types=asset?.script?.types??[];return script.resolved&&asset.guid&&script.guid?.toLowerCase()===asset.guid.toLowerCase()&&types.length===1&&script.fullName===types[0].fullName&&script.assembly===asset.script.assembly;});
 const bindingsVerified=Boolean(compileReady&&typesMatch&&observation.assets.every(asset=>asset.loaded&&asset.missingScripts===0&&asset.missingReferences===0));
 diagnostics=[...diagnostics,...observation?.diagnostics??[]].slice(0,1000);
 const receipt={kind:'retoolkit-unity-validation',schemaVersion:1,operationId,state:compileReady?'validated':'validation_failed',graphRevision:graph.revision,binding:graph.binding,unityVersion:graph.unityVersion,
  compileReady:Boolean(compileReady),bindingsVerified,behavior:'unverified',editor:{...editorIdentity},helperSha256:staged.helperSha256,observationSha256:observation?fileIdentity(staged.reportFile).sha256:null,
  requestSha256:fileIdentity(staged.requestFile).sha256,process:{exitCode:processResult.exitCode,timedOut:processResult.timedOut,closed:true},reportError,diagnostics,counts:{scripts:staged.request.scripts.length,assets:staged.request.assets.length},coverage:{state:observation?.complete?'observed':'partial',source:'staging-editor'}};
 json(path.join(runDir,'receipt.json'),{...receipt,receiptSha256:fingerprint(receipt)});
 fs.writeFileSync(path.join(runDir,'editor-output.txt'),String(processResult.logTail??'').slice(-4*MiB),{flag:'wx',mode:0o600});
 return summary(receipt,path.relative(paths.workspace,path.join(runDir,'receipt.json')).split(path.sep).join('/'));
}

export async function readUnityValidation({toolkit,name,projectDir,graph,operationId,section='summary',limit=100,cursor}){
 check(['summary','scripts','assets','diagnostics'].includes(section)&&Number.isSafeInteger(limit)&&limit>=1&&limit<=1000,'Invalid validation report query');
 check(typeof operationId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(operationId),'Invalid validation operation UUID');
 const paths=assetPaths(toolkit,name),directory=assertAssetPath(path.join(paths.base,'unity-validation',operationId),paths.workspace),receipt=readJson(path.join(directory,'receipt.json'));
 const {receiptSha256,...payload}=receipt;check(receipt.kind==='retoolkit-unity-validation'&&receipt.schemaVersion===1&&receipt.operationId===operationId&&receiptSha256===fingerprint(payload),'Invalid validation receipt');
 check(receipt.graphRevision===graph.revision&&fingerprint(receipt.binding)===fingerprint(graph.binding),'Validation receipt belongs to an old source snapshot','stale_graph');await verifyGraphFiles(projectDir,graph);
 let observation=null;
 if(receipt.requestSha256)check(fileIdentity(path.join(directory,'request.json')).sha256===receipt.requestSha256,'Validation request bytes changed');
 if(receipt.observationSha256){check(fileIdentity(path.join(directory,'observation.json')).sha256===receipt.observationSha256,'Validation observation bytes changed');const {validateUnityObservation}=await import('./report.js');const request=readJson(path.join(directory,'request.json'));check(request.runId===operationId&&request.graphRevision===graph.revision&&fingerprint(request.binding)===fingerprint(graph.binding),'Validation request binding changed');observation=validateUnityObservation(readJson(path.join(directory,'observation.json')),request);}
 const storedReceipt=path.relative(paths.workspace,path.join(directory,'receipt.json')).split(path.sep).join('/');
 if(section==='summary')return summary(payload,storedReceipt);
 const rows=section==='diagnostics'?(receipt.diagnostics??[]):(observation?.[section]??[]);let offset=0;
 const binding=fingerprint({operationId,section,revision:graph.revision});
 if(cursor!==undefined){try{const decoded=JSON.parse(Buffer.from(cursor,'base64url').toString());check(decoded.binding===binding&&Number.isSafeInteger(decoded.offset)&&decoded.offset>=0,'Invalid validation cursor');offset=decoded.offset;}catch{throw assetError('unity_validation_invalid','Invalid validation cursor');}}
 const items=[];let bytes=0;
 for(const row of rows.slice(offset,offset+limit)){
  const size=Buffer.byteLength(JSON.stringify(JSON.stringify(row)));
  if(items.length&&bytes+size>MiB)break;
  check(size<=MiB,'One validation report row exceeds the output limit');items.push(row);bytes+=size;
 }
 const next=offset+items.length;
 return {operationId,revision:graph.revision,section,coverage:receipt.coverage??{state:'partial',source:'staging-editor'},items,nextCursor:next<rows.length?Buffer.from(JSON.stringify({binding,offset:next})).toString('base64url'):null};
}
