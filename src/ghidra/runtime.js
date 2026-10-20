import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fingerprint } from '../state.js';
import { BridgeError } from './protocol.js';
import {performance} from 'node:perf_hooks';

export function atomicJson(file,value) {
  const temp=`${file}.tmp-${randomUUID()}`;
  try {
    fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
    const deadline=performance.now()+1000,pause=new Int32Array(new SharedArrayBuffer(4));
    for(;;)try{fs.renameSync(temp,file);break;}
    catch(error){
      // Keep the old target intact while a Windows sharing handle closes.
      if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||performance.now()>=deadline)throw error;
      Atomics.wait(pause,0,0,Math.min(20,Math.max(1,deadline-performance.now())));
    }
  }
  finally {fs.rmSync(temp,{force:true});}
}
export function readJson(file) {return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
export function releaseStartupGate(paths,token) {
  const marker=path.join(paths.gate,`owner-${token}`);
  try {fs.unlinkSync(marker);fs.rmdirSync(paths.gate);}catch(error){if(error.code!=='ENOENT')throw error;}
}
function rejectLinks(directory) {
  let current=path.resolve(directory);
  for(;;) {if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink()) throw new BridgeError('runtime_insecure','Runtime links/junctions are unsupported');
    const parent=path.dirname(current);if(parent===current)break;current=parent;}
}
let sid;
export function secureDirectory(directory) {
  rejectLinks(directory);fs.mkdirSync(directory,{recursive:true,mode:0o700});
  if(process.platform!=='win32') {fs.chmodSync(directory,0o700);if((fs.statSync(directory).mode&0o777)!==0o700)throw new BridgeError('runtime_insecure','Private runtime permissions could not be verified');return;}
  const system=path.join(process.env.SystemRoot??'C:\\Windows','System32');
  sid??=execFileSync(path.join(system,'whoami.exe'),['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true}).match(/S-1-5-\d+(?:-\d+)+/)?.[0];
  if(!sid)throw new BridgeError('runtime_insecure','Cannot resolve current Windows user SID');
  execFileSync(path.join(system,'icacls.exe'),[directory,'/inheritance:r','/grant:r',`*${sid}:(OI)(CI)F`,'*S-1-5-18:(OI)(CI)F'],{windowsHide:true,stdio:'pipe'});
  const literal=directory.replaceAll("'","''");
  const script=`$ProgressPreference='SilentlyContinue'; $a=Get-Acl -LiteralPath '${literal}'; $s=@($a.Access | ForEach-Object { [pscustomobject]@{sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;type=$_.AccessControlType.ToString();rights=[int]$_.FileSystemRights} }); [pscustomobject]@{protected=$a.AreAccessRulesProtected;access=$s}|ConvertTo-Json -Depth 4 -Compress`;
  let acl;try {acl=JSON.parse(execFileSync(path.join(system,'WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true}));}
  catch {throw new BridgeError('runtime_insecure','Cannot verify private runtime ACL');}
  const entries=Array.isArray(acl.access)?acl.access:[acl.access];
  if(!acl.protected||entries.some(entry=>!entry||![sid,'S-1-5-18'].includes(entry.sid)||entry.type!=='Allow')||!entries.some(entry=>entry.sid===sid&&(entry.rights&2032127)===2032127))throw new BridgeError('runtime_insecure','Private runtime ACL includes unexpected principals or lacks full control');
}
export function runtimePaths(toolkit,name,runId) {
  const workspace=toolkit.workspace(name);
  const canonical=fs.realpathSync(workspace);
  const key=fingerprint(process.platform==='win32'?canonical.toLowerCase():canonical).slice(0,32);
  const base=path.join(toolkit.root,'.cache/ghidra-sessions',key);
  if(runId!==undefined&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(runId))throw new BridgeError('protocol_mismatch','Invalid run ID');
  const run=runId?path.join(base,runId):null;
  return {base,current:path.join(base,'current.json'),gate:path.join(base,'starting'),run,
    config:run?path.join(run,'config.json'):null,endpoint:run?path.join(run,'endpoint.json'):null,
    cancel:run?path.join(run,'cancel.json'):null,log:run?path.join(run,'engine.log'):null};
}
export function readSession(toolkit,name) {
  const paths=runtimePaths(toolkit,name);rejectLinks(paths.base);
  if(!fs.existsSync(paths.current))return null;
  const result=readJson(paths.current);runtimePaths(toolkit,name,result.runId);
  return result;
}
export function publicSession(record) {
  if(!record)return {state:'stopped'};
  const {runId,phase,mode,startedAt,completedAt,logPath,backupPath,error,revision,reconciliationPending}=record;
  return {runId,state:phase,mode,startedAt,completedAt,logPath,backupPath,error,revision,reconciliationPending};
}
export function activeSession(toolkit,name) {
  const record=readSession(toolkit,name);
  return record&&!['stopped','failed'].includes(record.phase)?record:null;
}
export function assertNoSession(toolkit,name) {
  const session=activeSession(toolkit,name);
  if(session)throw new BridgeError('session_conflict',`Workspace has a Ghidra session (${session.phase}). Run: node re.js session stop ${name}`,{runId:session.runId});
}
