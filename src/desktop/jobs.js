import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';import {spawn} from 'node:child_process';
import {desktopOperations,buildDesktopCommand} from './operations.js';
import {StringDecoder} from 'node:string_decoder';
import {assertAssetPath} from '../assets/context.js';
import {workspaceResultPreview} from './workspace-preview.js';
import {validationResultPreview} from './validation-preview.js';
import {validationProgressPreview} from '../unity/progress.js';
import {createDesktopHistory} from './history.js';
import {withoutJevCredentials} from '../jev-environment.js';
const terminal=new Set(['succeeded','failed','unverified','unknown']);
function capturePreview(job){
 const workspace=workspaceResultPreview(job);if(workspace)return workspace;
 const validation=validationResultPreview(job);if(validation)return validation;
 if(job.operation==='project.create'&&job.result?.kind==='retoolkit-project-intake'){
  const text=value=>typeof value==='string'?value.slice(0,2048):undefined;
  return {kind:'retoolkit-project-intake',schemaVersion:1,name:text(job.result.name),state:text(job.result.state),workspace:text(job.result.workspace),receipt:text(job.result.receipt),analysisReady:false,...(job.result.issue?{issue:{code:text(job.result.issue.code),message:text(job.result.issue.message)}}:{})};
 }
 if(job.operation!=='adb.capture'||job.result?.kind!=='retoolkit-adb-result')return {};
 const text=value=>typeof value==='string'?value.slice(0,2048):undefined,data=job.result.capture?.applicationData;
 const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
 return {kind:'retoolkit-adb-result',schemaVersion:1,state:text(job.result.state),capture:{bundle:text(job.result.capture?.bundle),manifest:text(job.result.capture?.manifest),...(data?{applicationData:{coverage:text(data.coverage),bundle:text(data.bundle),files:count(data.files),scopes:Array.isArray(data.scopes)?data.scopes.slice(0,2).map(scope=>({id:text(scope.id),state:text(scope.state),access:text(scope.access),files:count(scope.files)})):[]}}:{})}};
}
function compact(job){if(Buffer.byteLength(JSON.stringify(job))<=16384)return structuredClone(job);const {id,operation,state,createdAt,completedAt,exitCode,storedResult}=job,preview=capturePreview(job);return {id,operation,state,createdAt,completedAt,exitCode,storedResult,payload:{name:job.payload.name},result:{...preview,notice:preview.kind==='retoolkit-workspace-preview'?'Đã rút gọn danh sách tệp lớn; trạng thái và lựa chọn đầu vào được giữ bên dưới. Kết quả đầy đủ ở đường dẫn đã lưu.':'Output exceeds desktop preview. Inspect storedResult or use a bounded CLI query.'},...(job.error?{error:{code:String(job.error.code).slice(0,128),message:String(job.error.message).slice(0,1024)}}:{}),...(job.progress?{progress:job.progress.slice(-512)}:{}),...(validationProgressPreview(job.validationProgress)?{validationProgress:validationProgressPreview(job.validationProgress)}:{})};}
export function createDesktopBroker(root,{node=process.execPath,spawnImpl=spawn,onChange=()=>{},history=true,jevEnvironment=()=>process.env}={}){
 root=path.resolve(root);const journal=createDesktopHistory(root,{enabled:history!==false}),jobs=journal.load();let active=false;
 const notify=(job,persist=true)=>{if(persist)journal.save(jobs.map(compact));try{onChange(compact(job));}catch{}};
 function pump(){
  if(active)return;const job=jobs.find(job=>job.state==='queued');if(!job)return;active=true;job.state='running';job.startedAt=new Date().toISOString();notify(job);
  const args=buildDesktopCommand(job.operation,job.payload);let child,stdout='',stderr='',stdoutBytes=0,stderrBytes=0,truncated=false,spawnError;
  const outputDecoder=new StringDecoder('utf8'),errorDecoder=new StringDecoder('utf8'),progressDecoder=new StringDecoder('utf8');
  try{const childEnv={...(job.operation==='jev.run'?jevEnvironment():withoutJevCredentials(process.env)),ELECTRON_RUN_AS_NODE:undefined};child=spawnImpl(node,[path.resolve(import.meta.dirname,'../../re.js'),...args,'--root',root,'--json'],{cwd:root,windowsHide:true,shell:false,env:childEnv,stdio:['ignore','pipe','pipe']});}
  catch(error){finish(null,error);return;}
  child.stdout.on('data',bytes=>{stdoutBytes+=bytes.length;if(!truncated&&stdoutBytes<=2*1024**2)stdout+=outputDecoder.write(bytes);else truncated=true;});
  let progressLine='',progressOverflow=false;
  child.stderr.on('data',bytes=>{const accepted=bytes.subarray(0,Math.max(0,512*1024-stderrBytes));stderrBytes+=accepted.length;const decoded=errorDecoder.write(accepted);stderr+=decoded;
   if(job.operation==='reconstruct.validate'){
    const incoming=progressDecoder.write(bytes);let start=0;
    while(start<incoming.length){const end=incoming.indexOf('\n',start),part=incoming.slice(start,end<0?incoming.length:end);if(!progressOverflow){if(progressLine.length+part.length>8192){progressLine='';progressOverflow=true;}else progressLine+=part;}
     if(end<0)break;
     if(!progressOverflow)try{const event=JSON.parse(progressLine);if(event.kind==='unity-validation-progress'){const progress=validationProgressPreview(event);if(progress)job.validationProgress=progress;}}catch{}
     progressLine='';progressOverflow=false;start=end+1;
    }
   }
   job.progress=stderr.slice(-4096);notify(job,false);});
  child.once('error',error=>{spawnError=error;});child.once('close',code=>finish(code,spawnError));
  function finish(code,error){
   if(!truncated)stdout+=outputDecoder.end();if(stderrBytes<512*1024)stderr+=errorDecoder.end();
   job.exitCode=code;job.completedAt=new Date().toISOString();delete job.progress;job.diagnostics=stderr;
   if(error){job.state='failed';job.error={code:error.code??'DESKTOP_SPAWN_FAILED',message:error.message};}
   else if(truncated){job.state='unverified';job.error={code:'DESKTOP_OUTPUT_LIMIT',message:'Command closed; its full output exceeded the desktop limit. Inspect the command receipt or rerun a bounded query.'};}
   else{try{job.result=JSON.parse(stdout);}catch{job.result=stdout;}
    job.state=code===0?'succeeded':'failed';if(code!==0)job.error={code:'DESKTOP_COMMAND_FAILED',message:stderr||'Command exited without success'};
   }
   if(Buffer.byteLength(JSON.stringify(job))>16384){try{const file=assertAssetPath(path.join(root,'.cache/desktop-jobs',job.id,'result.json'),root);fs.mkdirSync(path.dirname(file),{recursive:true});assertAssetPath(file,root);fs.writeFileSync(file,JSON.stringify(job,null,2),{flag:'wx',mode:0o600});job.storedResult=file;}catch{job.state='unverified';job.error={code:'DESKTOP_RESULT_NOT_SAVED',message:'Full result could not be saved; inspect the CLI operation receipt.'};}const preview=compact(job);Object.keys(job).forEach(key=>delete job[key]);Object.assign(job,preview);}
   active=false;notify(job);pump();
  }
 }
 function submit(operation,payload={}){
  buildDesktopCommand(operation,payload);if(jobs.filter(job=>!terminal.has(job.state)).length>=8)throw Error('Desktop job queue is full');
  while(jobs.length>=30&&terminal.has(jobs[0].state))jobs.shift();
  const job={id:randomUUID(),operation,payload:structuredClone(payload),state:'queued',createdAt:new Date().toISOString()};jobs.push(job);notify(job);pump();return compact(job);
 }
 function snapshot(){
  const directory=path.join(root,'workspaces'),workspaces=[];
  if(fs.existsSync(directory)&&!fs.lstatSync(directory).isSymbolicLink())for(const entry of fs.readdirSync(directory,{withFileTypes:true}).slice(0,500)){
   if(!entry.isDirectory()||entry.isSymbolicLink())continue;const file=path.join(directory,entry.name,'project.re.json');if(!fs.existsSync(file))continue;
   try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>16*1024**2)throw Error('Unsupported project file');const project=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
    workspaces.push({name:entry.name.slice(0,64),platform:typeof project.platform==='string'?project.platform.slice(0,64):null,candidatePath:typeof project.reconstructedSourceDir==='string'&&project.reconstructedSourceDir.length<=4096?project.reconstructedSourceDir:path.join(directory,entry.name,'05_ReconstructedSource'),state:fs.existsSync(path.join(directory,entry.name,'.retk-lock'))?'busy':'available',steps:Object.fromEntries(['extract','scan','dump','import','analyze','symbols','notes','assetripper'].filter(key=>project.steps?.[key]).map(key=>[key,String(project.steps[key]?.state??'unknown').slice(0,32)]))});
   }catch(error){workspaces.push({name:entry.name,state:'invalid',error:error.message});}
  }
  return {root,version:JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8')).version,workspaces,jobs:jobs.map(compact),history:journal.status(),operations:desktopOperations};
 }
 return {submit,snapshot,canQuit:()=>!jobs.some(job=>!terminal.has(job.state))};
}
