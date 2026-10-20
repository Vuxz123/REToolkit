import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {rejectOutputLinks} from '../artifacts.js';

const busy=message=>Object.assign(new Error(message),{code:'TOOLCHAIN_BUSY'});
function directories(root){
 const base=path.join(path.resolve(root),'.cache/toolchain');rejectOutputLinks(base);
 rejectOutputLinks(path.join(base,'readers'));fs.mkdirSync(path.join(base,'readers'),{recursive:true});rejectOutputLinks(path.join(base,'readers'));
 return {base,readers:path.join(base,'readers'),writer:path.join(base,'writer')};
}
function publishOwner(file,token){fs.writeFileSync(file,JSON.stringify({pid:process.pid,token,startedAt:new Date().toISOString()}),{flag:'wx',mode:0o600});}
function removeOwner(file,token){
 rejectOutputLinks(file);let owner;try{owner=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw busy('Toolchain lease ownership could not be verified; inspection required');}
 if(owner.token!==token)throw busy('Toolchain lease ownership changed; inspection required');fs.unlinkSync(file);
}
export function acquireToolchainRead(root){
 const paths=directories(root);if(fs.existsSync(paths.writer))throw busy('A toolchain update or uncertain writer requires inspection before engine launch');
 const token=randomUUID(),file=path.join(paths.readers,token+'.json');publishOwner(file,token);
 if(fs.existsSync(paths.writer)){removeOwner(file,token);throw busy('Toolchain update acquired the gate before engine launch');}
 let released=false;return {release(){if(released)return;removeOwner(file,token);released=true;}};
}
function projectBusy(root){
 const workspaces=path.join(root,'workspaces');rejectOutputLinks(workspaces);if(!fs.existsSync(workspaces))return false;
 const walk=(folder,depth=0)=>{
  if(depth>64)throw busy('Workspace project depth cannot be inspected safely');
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
   if(entry.isSymbolicLink())throw busy('Linked workspace/project prevents safe toolchain update');
   if(entry.name==='.retk-lock'||/\.lock$|\.dbDirLock$/i.test(entry.name))return true;
   if(entry.isDirectory()&&walk(path.join(folder,entry.name),depth+1))return true;
  }return false;
 };
 for(const entry of fs.readdirSync(workspaces,{withFileTypes:true})){
  if(entry.isSymbolicLink())throw busy('Linked workspace prevents safe toolchain update');
  if(!entry.isDirectory())continue;const workspace=path.join(workspaces,entry.name);
  if(fs.existsSync(path.join(workspace,'.retk-lock')))return true;
  const project=path.join(workspace,'03_GhidraProject');rejectOutputLinks(project);if(fs.existsSync(project)&&walk(project))return true;
 }return false;
}
// Return only process IDs/names, never raw command lines (which may contain
// credentials). Protected or unavailable engine identity stays unknown.
export async function inspectToolchainProcesses(root,{spawnImpl=spawnSync}={}){
 if(process.platform!=='win32')return {state:'unknown',processes:[]};
 const script=`$ErrorActionPreference='Stop'
$scanRoot=[IO.Path]::GetFullPath($env:RETK_PROCESS_ROOT).TrimEnd('\\')
$matchesFound=@();$unverifiable=$false
foreach($item in @(Get-CimInstance Win32_Process -ErrorAction Stop)){
 $exe=([string]$item.ExecutablePath).Replace('/','\\');$line=([string]$item.CommandLine).Replace('/','\\')
 $matched=$false
 foreach($part in @('tools','runtime')){
  $prefix=$scanRoot+'\\'+$part+'\\'
  if($exe.IndexOf($prefix,[StringComparison]::OrdinalIgnoreCase)-ge 0 -or $line.IndexOf($prefix,[StringComparison]::OrdinalIgnoreCase)-ge 0){$matched=$true}
 }
 if($matched){$matchesFound+=@{pid=[int]$item.ProcessId;name=[string]$item.Name}}
 if($item.Name -match '^(javaw?|pythonw?|dotnet|AssetRipper(?:[.][\\w.-]+)?|Il2CppDumper|cmd|powershell|pwsh|node)[.]exe$' -and (!$exe -or !$line) -and !$matched){$unverifiable=$true}
}
@{state=$(if($unverifiable){'unknown'}elseif($matchesFound.Count){'busy'}else{'idle'});processes=$matchesFound}|ConvertTo-Json -Compress -Depth 4`;
 const result=spawnImpl('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:1024*1024,env:{...process.env,RETK_PROCESS_ROOT:path.resolve(root)}});
 if(result.status!==0||result.error)return {state:'unknown',processes:[]};
 try{const report=JSON.parse(result.stdout.replace(/^\uFEFF/,''));if(!['idle','busy','unknown'].includes(report.state)||!Array.isArray(report.processes))throw Error();return report;}catch{return {state:'unknown',processes:[]};}
}
export async function assertToolchainIdle(root,{inspectProcesses=inspectToolchainProcesses}={}){
 const paths=directories(root);
 if(fs.readdirSync(paths.readers).length||projectBusy(path.resolve(root)))throw busy('Engine/workspace/project lease exists; finish the owning operation or inspect uncertain owners');
 let report;try{report=await inspectProcesses(path.resolve(root));}catch{throw busy('Running engine process inspection is unavailable; update refused');}
 if(report?.state!=='idle'||!Array.isArray(report.processes)||report.processes.length)throw busy(report?.state==='busy'?'Toolkit engine processes are running; close them before updating':'Engine process identity is unverified; update refused');
}
export async function withToolchainWrite(root,action,options={}){
 const paths=directories(root),token=randomUUID();
 try{fs.mkdirSync(paths.writer);}catch(error){if(error.code==='EEXIST')throw busy('Another toolchain writer or uncertain update requires inspection');throw error;}
 const owner=path.join(paths.writer,'owner.json');let preserve=false;
 try{
  publishOwner(owner,token);await assertToolchainIdle(root,options);return await action();
 }catch(error){preserve=error.code==='TOOLCHAIN_RECOVERY_REQUIRED'||error.preserveToolchainGate===true;throw error;}
 finally{if(!preserve){removeOwner(owner,token);fs.rmdirSync(paths.writer);}}
}
