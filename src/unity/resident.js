import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {assetPaths,assertAssetPath,assetError} from '../assets/context.js';
import {fileIdentity,fingerprint} from '../state.js';
import {inventoryUnityProject,verifyGraphFiles} from '../assets/graph.js';
import {readJson,writeJson,seal,unseal} from '../recovery/artifacts.js';
import {withoutJevCredentials} from '../jev-environment.js';
import {runUnityCli} from './live-cli.js';
import {acquirePersistentToolchainRead,releasePersistentToolchainRead} from '../toolchain/lease.js';
import {inspectResidentProcess} from './resident-process.js';

const check=(ok,message,code='unity_resident_invalid')=>{if(!ok)throw assetError(code,message);};
const same=(a,b)=>fingerprint(a)===fingerprint(b);
const safe=p=>typeof p==='string'&&/^(Assets|Packages|ProjectSettings)\//.test(p)&&!/[\\:\x00-\x1f]/.test(p)&&p.split('/').every(s=>s&&s!=='.'&&s!=='..');
const inside=(base,p)=>assertAssetPath(path.join(base,p),base);
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function sourceDelta(before,after){
 check([...before,...after].every(f=>safe(f.path)),'Unsafe resident source path');
 check(new Set(after.map(f=>f.path.toLowerCase())).size===after.length,'Duplicate resident source path');
 const old=new Map(before.map(f=>[f.path,f])),next=new Set(after.map(f=>f.path));
 return {copy:after.filter(f=>!same(old.get(f.path)??null,f)),remove:before.filter(f=>!next.has(f.path))};
}
function locations(toolkit,name){const p=assetPaths(toolkit,name),base=inside(p.base,'unity-resident');return {...p,residentBase:base,stateFile:inside(base,'session.json')};}
function load(p){if(!fs.existsSync(p.stateFile))return null;const s=unseal(readJson(p.stateFile));check(s.kind==='retoolkit-unity-resident'&&/^[a-f0-9-]{36}$/.test(s.sessionId)&&s.project===inside(p.residentBase,`${s.sessionId}/project`),'Invalid resident session');return s;}
function save(p,s){writeJson(p.stateFile,seal(s));}
const cliOptions=(s,timeoutSeconds)=>({cwd:s.project,timeoutSeconds});
async function evaluate(s,code,cli,timeoutSeconds=120){
 const response=await cli(['command','eval',code,'--project-path',s.project,'--caller','plugin','--skill','unity-cli','--timeout',String(timeoutSeconds)],cliOptions(s,timeoutSeconds));
 const result=response?.data?.result;
 check(response?.success===true&&result?.success===true&&Object.hasOwn(result,'result'),'Missing or failed resident eval result');return result.result;
}
const inspectCode='return REToolkit.EditorValidation.InspectLive();';
async function inspect(s,cli){const raw=await evaluate(s,inspectCode,cli);const result=typeof raw==='string'?JSON.parse(raw):raw;check(result&&path.resolve(result.projectPath)===s.project&&result.unityVersion===s.unityVersion,'Resident Editor identity differs');return result;}
function idle(observation){check(!observation.isPlaying&&!observation.isCompiling&&!observation.scriptCompilationFailed&&observation.dirtyScenes===0,'Resident Editor must be idle, compiled and have no dirty scenes','unity_resident_busy');}
function versionOnly(file,version){return fs.readFileSync(file,'utf8').trim().split(/\r?\n/).every((line,i)=>i===0?line===`m_EditorVersion: ${version}`:i===1&&line.startsWith(`m_EditorVersionWithRevision: ${version} (`)&&/^m_EditorVersionWithRevision: [0-9.a-z]+ \([a-f0-9]+\)$/.test(line));}
async function verifySource(project,files,version){for(const f of files){if(/^Packages\/(manifest|packages-lock)\.json$/.test(f.path))continue;if(f.path==='ProjectSettings/ProjectVersion.txt'){check(versionOnly(inside(project,f.path),version),'Resident Editor version file changed');continue;}const id=fileIdentity(inside(project,f.path));check(id.size===f.size&&id.sha256===f.sha256,'Resident source changed during Editor execution','unity_resident_stale');}}
async function verifyWorking(s){const {files}=await inventoryUnityProject(s.project);check(same(files,s.workingFiles),'Resident project was modified outside its recorded run','unity_resident_stale');}
function writeIfChanged(file,bytes){if(!fs.existsSync(file)||!fs.readFileSync(file).equals(Buffer.from(bytes)))fs.writeFileSync(file,bytes);}
function writeHelper(project,helperFile){const dir=inside(project,'Assets/REToolkitValidation/Editor');fs.mkdirSync(dir,{recursive:true});writeIfChanged(path.join(dir,'REToolkitValidation.cs'),fs.readFileSync(helperFile));writeIfChanged(path.join(dir,'REToolkit.Validation.Editor.asmdef'),JSON.stringify({name:'REToolkit.Validation.Editor',includePlatforms:['Editor'],autoReferenced:false}));}
async function launchEditor(editor,s,logFile){
 return new Promise((resolve,reject)=>{const child=spawn(editor,['-batchmode','-projectPath',s.project,'-logFile',logFile],{detached:true,windowsHide:true,stdio:'ignore',env:withoutJevCredentials(process.env),shell:false});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve(child.pid);});});
}

export async function stageResidentProject({toolkit,name,projectDir,graph,runDir,request,editor,timeoutSeconds=600},dependencies={}){
 check(!graph.files.some(f=>/^Assets\/REToolkitValidation(?:\/|\.|$)/i.test(f.path)),'Reserved validation helper directory already exists','unity_helper_collision');
 check(/^6000\./.test(graph.unityVersion),'Resident validation currently requires Unity 6');
 const cli=dependencies.cli??runUnityCli,p=locations(toolkit,name),helperFile=inside(toolkit.root,'templates/Unity/REToolkitValidation.cs'),helperSha256=fileIdentity(helperFile).sha256;
 await verifyGraphFiles(projectDir,graph);check(!fs.existsSync(runDir),'Validation run must be fresh');
 fs.mkdirSync(runDir,{recursive:true});writeHelper(path.join(runDir,'project'),helperFile);writeJson(path.join(runDir,'request.json'),request,{exclusive:true});
 let s=load(p),fresh=!s||s.state==='stopped';
 if(fresh){const sessionId=randomUUID();s={kind:'retoolkit-unity-resident',schemaVersion:1,sessionId,project:inside(p.residentBase,`${sessionId}/project`),unityVersion:graph.unityVersion,editor:fileIdentity(editor),binding:graph.binding,state:'preparing',pending:request.runId,sourceFiles:[],workingFiles:[],helperSha256,pid:null};fs.mkdirSync(s.project,{recursive:true});save(p,s);}
 else {check(!s.pending&&s.state==='ready','Resident session has an unresolved run; inspect/stop it first','unity_resident_pending');check(same(s.binding,graph.binding)&&s.unityVersion===graph.unityVersion&&same(s.editor,fileIdentity(editor)),'Resident build/Editor changed; stop the session before replacement');idle(await inspect(s,cli));await verifyWorking(s);
  check(same(s.sourceFiles.filter(f=>f.path.startsWith('Packages/')),graph.files.filter(f=>f.path.startsWith('Packages/'))),'Package changes require a new resident session','unity_resident_packages_changed');
  s.pending=request.runId;save(p,s);
 }
 const delta=sourceDelta(s.sourceFiles,graph.files);
 try{
  if(!fresh)await evaluate(s,'UnityEditor.AssetDatabase.DisallowAutoRefresh(); UnityEditor.AssetDatabase.StartAssetEditing(); return true;',cli);
  try{
   for(const f of delta.remove)fs.unlinkSync(inside(s.project,f.path));
   for(const f of delta.copy){const to=inside(s.project,f.path);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(inside(projectDir,f.path),to);const id=fileIdentity(to);check(id.sha256===f.sha256&&id.size===f.size,'Source changed while synchronizing resident project');}
   writeHelper(s.project,helperFile);
   check(fileIdentity(inside(s.project,'Assets/REToolkitValidation/Editor/REToolkitValidation.cs')).sha256===helperSha256&&fileIdentity(path.join(runDir,'project/Assets/REToolkitValidation/Editor/REToolkitValidation.cs')).sha256===helperSha256,'Validation helper changed during staging');
   if(!fresh)s.importFiles=(await inventoryUnityProject(s.project)).files;
  }finally{if(!fresh)await evaluate(s,'UnityEditor.AssetDatabase.StopAssetEditing(); UnityEditor.AssetDatabase.AllowAutoRefresh(); return true;',cli);}
  if(fresh){
   await cli(['pipeline','install','--project-path',s.project],cliOptions(s,timeoutSeconds));
   s.importFiles=(await inventoryUnityProject(s.project)).files;save(p,s);
   s.leaseToken=acquirePersistentToolchainRead(toolkit.root,s.sessionId);s.launchAttempted=true;save(p,s);
   s.pid=await (dependencies.launchEditor??launchEditor)(editor,s,path.join(path.dirname(s.project),'Editor.log'));save(p,s);
   const deadline=Date.now()+timeoutSeconds*1000;let ready=false;
   while(Date.now()<deadline){try{idle(await inspect(s,cli));ready=true;break;}catch(error){if(error.preserveToolchainGate)throw error;if(!(dependencies.alive??alive)(s.pid))throw assetError('unity_resident_start_failed','Resident Editor exited before readiness');await (dependencies.sleep??sleep)(1000);}}
   check(ready,'Resident Editor did not become ready; inspect its retained log','unity_resident_pending');
  }
  s.sourceFiles=graph.files;s.helperSha256=helperSha256;save(p,s);
  await verifyGraphFiles(projectDir,graph);
  return {projectDir:s.project,request,requestFile:path.join(runDir,'request.json'),reportFile:path.join(runDir,'observation.json'),progressReportFile:path.join(path.dirname(s.project),'runs',request.runId,'observation.json'),requestSha256:fileIdentity(path.join(runDir,'request.json')).sha256,helperSha256,resident:{sessionId:s.sessionId,copiedFiles:delta.copy.length,removedFiles:delta.remove.length,reused:!fresh}};
 }catch(error){s.state='needs-inspection';save(p,s);if(s.leaseToken)error.residentSessionProtected=true;throw error;}
}

export async function runResidentEditor({toolkit,name,staged,editor,timeoutSeconds=600},dependencies={}){
 const p=locations(toolkit,name),s=load(p),cli=dependencies.cli??runUnityCli;
 check(s&&s.pending===staged.request.runId&&s.project===staged.projectDir,'Resident run binding differs');
 try{
  await cli(['recompile','--project-path',s.project,'--timeout',String(timeoutSeconds)],cliOptions(s,timeoutSeconds));
  idle(await inspect(s,cli));await verifySource(s.project,s.sourceFiles,s.unityVersion);
  const imported=(await inventoryUnityProject(s.project)).files;
  const changes=sourceDelta(s.importFiles,imported),previous=new Set(s.importFiles.map(f=>f.path));
  check(!changes.remove.length&&changes.copy.every(f=>f.path==='ProjectSettings/ProjectVersion.txt'&&versionOnly(inside(s.project,f.path),s.unityVersion)||!previous.has(f.path)&&(f.path.endsWith('.meta')||f.path.startsWith('ProjectSettings/')||f.path==='Packages/packages-lock.json')),'Unexpected executable/package/helper change during import','unity_resident_stale');
  const liveDir=inside(path.dirname(s.project),`runs/${staged.request.runId}`);fs.mkdirSync(liveDir,{recursive:true});
  const requestFile=path.join(liveDir,'request.json'),reportFile=path.join(liveDir,'observation.json');fs.copyFileSync(staged.requestFile,requestFile,fs.constants.COPYFILE_EXCL);
  const returned=await evaluate(s,`return REToolkit.EditorValidation.RunLive(${JSON.stringify(requestFile)}, ${JSON.stringify(reportFile)});`,cli,timeoutSeconds);
  check(returned===staged.request.runId,'Resident validation did not acknowledge the exact run');
  const after=await inspect(s,cli);idle(after);await verifySource(s.project,s.sourceFiles,s.unityVersion);
  check(fileIdentity(requestFile).sha256===staged.requestSha256&&fileIdentity(editor).sha256===s.editor.sha256,'Resident request or Editor changed');
  check(same(imported,(await inventoryUnityProject(s.project)).files),'Resident project changed during observation','unity_resident_stale');
  fs.copyFileSync(reportFile,staged.reportFile,fs.constants.COPYFILE_EXCL);
  const execution={kind:'retoolkit-unity-resident-execution',schemaVersion:1,mode:'resident',completed:true,operationId:staged.request.runId,sessionId:s.sessionId,project:s.project,editor:s.editor,graphRevision:staged.request.graphRevision,binding:staged.request.binding,helperSha256:staged.helperSha256,requestSha256:staged.requestSha256,observationSha256:fileIdentity(staged.reportFile).sha256,completedAt:new Date().toISOString()};
  writeJson(path.join(path.dirname(staged.requestFile),'execution.json'),seal(execution),{exclusive:true});
  s.workingFiles=(await inventoryUnityProject(s.project)).files;s.pending=null;s.state='ready';save(p,s);
  return {closed:false,completed:true,execution,exitCode:0,timedOut:false,logTail:'',resident:staged.resident};
 }catch(error){s.state='needs-inspection';save(p,s);if(s.leaseToken)error.residentSessionProtected=true;throw error;}
}

export async function residentSessionOperation(toolkit,name,command,dependencies={}){
 const p=locations(toolkit,name),s=load(p);if(!s)return {state:'not-started'};
 const summary=()=>({state:s.state,sessionId:s.sessionId,project:s.project,pending:s.pending,unityVersion:s.unityVersion,pid:s.pid});
 if(command==='status')return {...summary(),processAlive:s.pid?(dependencies.alive??alive)(s.pid):s.launchAttempted&&s.state!=='stopped'?null:false};
 check(command==='stop','Unknown resident session command');
 if(s.state==='stopped')return summary();
 if(s.launchAttempted&&(!s.pid||!(dependencies.alive??alive)(s.pid))){const processState=await (dependencies.inspectProcess??inspectResidentProcess)(s.project);check(processState.state!=='unknown'&&processState.pids.length<=1,'Resident Editor identity cannot be recovered','unity_resident_pending');s.pid=processState.pids[0]??null;save(p,s);}
 if(s.pid&&(dependencies.alive??alive)(s.pid)){
  const cli=dependencies.cli??runUnityCli;await inspect(s,cli);
  // Exit only the explicitly selected toolkit project. Never kill by a reused PID.
  try{await evaluate(s,'UnityEditor.EditorApplication.delayCall += () => UnityEditor.EditorApplication.Exit(0); return true;',cli);}catch(error){if(!error.preserveToolchainGate)throw error;}
  const deadline=Date.now()+30000;while((dependencies.alive??alive)(s.pid)&&Date.now()<deadline)await (dependencies.sleep??sleep)(250);
  check(!(dependencies.alive??alive)(s.pid),'Resident Editor closure remains unverified','unity_resident_pending');
 }
 if(s.leaseToken){releasePersistentToolchainRead(toolkit.root,s.sessionId,s.leaseToken,{allowMissing:true});delete s.leaseToken;}
 s.state='stopped';s.pending=null;save(p,s);return summary();
}
