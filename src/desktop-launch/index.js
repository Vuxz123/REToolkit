import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {fileIdentity,fingerprint} from '../state.js';
import {rejectOutputLinks} from '../artifacts.js';
import {acquireToolchainRead} from '../toolchain/lease.js';
import {assertNoSession,atomicJson,secureDirectory} from '../ghidra/runtime.js';
import {inspectDesktopRuntime,verifyDesktopRuntime,desktopRuntimeEnvironment} from '../desktop-runtime/index.js';
import {snapshotPythonGeneration} from '../python-runtime/verify.js';
import {WINDOWS_SITE_SCRIPT} from '../python-runtime/windows-site.js';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
export const validRunId=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
function inside(root,file){const rel=path.relative(root,file);return !rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);}
function read(file,limit=1024**2){rejectOutputLinks(file);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>limit)fail('DESKTOP_METADATA_INVALID','Desktop metadata must be a bounded regular file.');const bytes=fs.readFileSync(file);if(bytes.length>limit)fail('DESKTOP_METADATA_INVALID','Desktop metadata exceeds its byte limit.');return bytes;}
function required(file,label){rejectOutputLinks(file);try{const s=fs.lstatSync(file);if(s.isFile()&&s.size>0)return {file,...fileIdentity(file)};}catch{}fail('DESKTOP_RUNTIME_MISSING',label+' runtime file is missing. Install the exact local runtime before launch.');}
function properties(file){const result={};for(const line of read(file).toString('utf8').replace(/^\uFEFF/,'').split(/\r?\n/)){const p=/^([^#!\s=]+)\s*=\s*(.*)$/.exec(line);if(p)result[p[1]]=p[2].trim();}return result;}
function validateOptions(options){if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['mode','name','console'].includes(k))||!['ghidra','pyghidra'].includes(options.mode)||(options.name!==undefined&&(typeof options.name!=='string'||!options.name))||(options.console!==undefined&&typeof options.console!=='boolean'))fail('DESKTOP_ARGUMENT_INVALID','Invalid desktop launcher options.');}
export function desktopLaunchPaths(root,runId){if(!validRunId(runId))fail('DESKTOP_RUN_INVALID','Invalid desktop run identity.');const run=path.join(path.resolve(root),'.cache/desktop-launch/runs',runId);rejectOutputLinks(run);return {run,config:path.join(run,'config.json'),receipt:path.join(run,'receipt.json'),log:path.join(run,'engine.log')};}

function binding(toolkit,name){
 if(!name)return null;const workspace=toolkit.workspace(name);rejectOutputLinks(workspace);assertNoSession(toolkit,name);const file=path.join(workspace,'project.re.json'),project=toolkit.read(name),dir=path.resolve(project.ghidraProjectDir??'');if(!inside(workspace,dir)||dir===workspace)fail('DESKTOP_PROJECT_PATH','Ghidra project must remain inside its selected workspace.');rejectOutputLinks(dir);
 const projectName=project.ghidraProjectName;if(typeof projectName!=='string'||! /^[A-Za-z0-9_.-]{1,64}$/.test(projectName)||['.','..'].includes(projectName))fail('DESKTOP_PROJECT_PATH','Invalid Ghidra project name.');
 const gpr=path.join(dir,projectName+'.gpr'),inputs=[];for(const [key,selected]of [['nativeBinary',project.identities?.native],['metadata',project.identities?.metadata]])if(project[key]){const identity=required(project[key],'Selected '+key);if(selected&&(identity.sha256!==selected.sha256||identity.size!==selected.size))fail('DESKTOP_INPUT_CHANGED','Selected project input differs from its recorded identity.');inputs.push(identity);}
 return {workspace,project:{file,...fileIdentity(file)},projectFile:fs.existsSync(gpr)?gpr:null,projectIdentity:fs.existsSync(gpr)?required(gpr,'Ghidra project'):null,inputs};
}
export function verifyDesktopLaunchBinding(toolkit,expected){const actual=binding(toolkit,expected?.workspace?path.basename(expected.workspace):undefined);if(fingerprint(actual)!==fingerprint(expected))fail('DESKTOP_BINDING_CHANGED','Workspace project binding or selected inputs changed before GUI launch.');}

export const PYGHIDRA_GUI_SCRIPT=`# RETK_PYGHIDRA_GUI
${WINDOWS_SITE_SCRIPT}
import json
from pathlib import Path
from pyghidra import GuiPyGhidraLauncher
config = json.loads(sys.argv[2])
launcher = GuiPyGhidraLauncher(install_dir=Path(config['install']))
launcher.add_vmargs(*config['vmargs'])
launcher.args = config['args']
launcher.start()
`;
async function privateExtension(profile,target){
 rejectOutputLinks(target);const expected=await snapshotPythonGeneration(profile.extension);
 if(!fs.existsSync(target)){
  fs.mkdirSync(path.dirname(target),{recursive:true});const stage=target+'.stage-'+randomUUID();rejectOutputLinks(stage);fs.cpSync(profile.extension,stage,{recursive:true,errorOnExist:true,force:false});
  if(JSON.stringify(await snapshotPythonGeneration(stage))!==JSON.stringify(expected))fail('DESKTOP_EXTENSION_CHANGED','Private extension copy failed integrity verification.');
  try{fs.renameSync(stage,target);}catch(error){if(!fs.existsSync(target))throw error;rejectOutputLinks(stage);fs.rmSync(stage,{recursive:true,force:true});}
 }
 if(JSON.stringify(await snapshotPythonGeneration(target))!==JSON.stringify(expected))fail('DESKTOP_EXTENSION_CHANGED','Private Ghidra extension changed; inspect the toolkit profile before launching.');
 return {folder:target,fingerprint:fingerprint(expected)};
}
export async function buildDesktopLaunchSpec(toolkit,options){
 validateOptions(options);const projectBinding=binding(toolkit,options.name),ghidra=toolkit.tools.ghidra;
 const identities=[required(toolkit.tools.java,'Java'),required(path.join(ghidra,'Ghidra/Framework/Utility/lib/Utility.jar'),'Ghidra'),required(path.join(ghidra,'Ghidra/application.properties'),'Ghidra'),required(path.join(ghidra,'support/launch.properties'),'Ghidra launcher')];
 const app=properties(path.join(ghidra,'Ghidra/application.properties')),version=app['application.version'],release=app['application.release.name']??'PUBLIC';if(!/^\d+(?:\.\d+){1,3}$/.test(version??'')||! /^[A-Za-z0-9_-]{1,32}$/.test(release))fail('DESKTOP_GHIDRA_INVALID','Installed Ghidra application metadata is invalid.');
 const selected=inspectDesktopRuntime(toolkit.root);if(selected.state==='invalid')fail(selected.error.code,selected.error.message);let profile=null;if(selected.state==='selected'){const verified=await verifyDesktopRuntime(toolkit.root);if(!verified.ok)fail('DESKTOP_PROFILE_INVALID','Selected desktop profile files changed; launch is blocked.');profile=verified.profile;}
 const settings=profile?.settings??path.join(toolkit.root,'runtime/desktop/legacy-settings'),home=path.join(settings,'home'),appdata=path.join(home,'appdata'),local=path.join(home,'local'),temp=path.join(home,'temp');
 for(const folder of [home,appdata,local,temp]){rejectOutputLinks(folder);fs.mkdirSync(folder,{recursive:true,mode:0o700});}
 const env={};for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','USERNAME','USERDOMAIN','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE'])if(typeof toolkit.env?.[key]==='string')env[key]=toolkit.env[key];
 Object.assign(env,{JAVA_HOME:toolkit.tools.jdk,JAVA_HOME_OVERRIDE:toolkit.tools.jdk,GHIDRA_INSTALL_DIR:ghidra,PYGHIDRA_PYTHON:toolkit.tools.pyghidra,HOME:home,USERPROFILE:home,APPDATA:appdata,LOCALAPPDATA:local,TEMP:temp,TMP:temp,PIP_CONFIG_FILE:'NUL',PATH:path.join(toolkit.tools.jdk,'bin')+path.delimiter+path.join(env.SystemRoot??env.SYSTEMROOT??'C:\\Windows','System32')});
 if(profile)Object.assign(env,desktopRuntimeEnvironment(profile,env));
 const vmargs=[];for(const line of read(path.join(ghidra,'support/launch.properties')).toString('utf8').split(/\r?\n/)){const match=/^VMARGS(?:_WINDOWS)?=(.*)$/.exec(line);if(match){const arg=match[1].trim();if(arg){if(/[\x00\r\n]/.test(arg)||arg.length>8192||!arg.startsWith('-'))fail('DESKTOP_GHIDRA_INVALID','Ghidra VM arguments are invalid.');vmargs.push(arg);}}}
 vmargs.push('-Duser.home='+home,'-Dapplication.settingsdir='+appdata,'-Dapplication.cachedir='+local,'-Dapplication.tempdir='+temp,'-Djava.io.tmpdir='+temp);
 const args=projectBinding?.projectFile?[projectBinding.projectFile]:[];
 let file=toolkit.tools.java,launchArgs=[...vmargs,'-cp',path.join(ghidra,'Ghidra/Framework/Utility/lib/Utility.jar'),'ghidra.Ghidra','ghidra.GhidraRun',...args],site=null;
 const extension=profile?await privateExtension(profile,path.join(appdata,'ghidra',`ghidra_${version}_${release}`,'Extensions/GhidraMCP')):null;
 if(options.mode==='pyghidra'){
  file=profile?.python??toolkit.tools.pyghidra;site=profile?.site??path.join(path.dirname(path.dirname(file)),'Lib/site-packages');identities.push(required(file,'PyGhidra Python'),required(path.join(site,'pyghidra/__init__.py'),'PyGhidra package'));
  env.PYGHIDRA_PYTHON=file;launchArgs=['-B','-I','-S','-c',PYGHIDRA_GUI_SCRIPT,site,JSON.stringify({install:ghidra,vmargs:vmargs.filter(arg=>!arg.startsWith('-Djava.system.class.loader=')),args})];
 }
 return {file,args:launchArgs,env,cwd:toolkit.root,console:options.console===true,identities,binding:projectBinding,privateExtension:extension,profile:profile?{generation:profile.generation,receiptSha256:profile.receiptSha256}:null};
}

export function statusDesktopLauncher(toolkit,runId){const {receipt}=desktopLaunchPaths(toolkit.root,runId);let r;try{r=JSON.parse(read(receipt));}catch(error){if(error.code==='ENOENT')fail('DESKTOP_RUN_MISSING','Desktop launch receipt does not exist.');throw error;}if(r.kind!=='retoolkit-desktop-launch'||r.schemaVersion!==1||r.runId!==runId||!['starting','launched','closed','failed','cleanup-pending'].includes(r.state))fail('DESKTOP_RECEIPT_INVALID','Desktop launch receipt is invalid.');return r;}

export async function startDesktopLauncher(toolkit,options){
 validateOptions(options);const lease=acquireToolchainRead(toolkit.root);let child,paths;
 try{
  const spec=await buildDesktopLaunchSpec(toolkit,options),runId=randomUUID();paths=desktopLaunchPaths(toolkit.root,runId);secureDirectory(paths.run);
  const config={root:toolkit.root,runId,run:paths.run,mode:options.mode,name:options.name??null,workspace:options.name?toolkit.workspace(options.name):path.join(toolkit.root,'.cache/desktop-launch/global'),spec};
  atomicJson(paths.config,config);atomicJson(paths.receipt,{kind:'retoolkit-desktop-launch',schemaVersion:1,runId,mode:options.mode,name:options.name??null,state:'starting',launchObserved:false,childCloseObserved:false,startedAt:new Date().toISOString(),analysis:'unverified',mcp:'unverified',logPath:paths.log});
  child=spawn(process.execPath,[fileURLToPath(new URL('./worker.js',import.meta.url)),paths.config],{cwd:toolkit.root,detached:true,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
  const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(Object.assign(new Error('Desktop owner startup observation timed out; inspect its retained run receipt and leases.'),{code:'DESKTOP_STARTUP_UNCERTAIN',runId}));},15000);const cleanup=()=>{clearTimeout(timer);child.removeListener('message',message);child.removeListener('error',error);child.removeListener('exit',exit);};const message=value=>{if(value?.type==='retk-desktop-observed'&&value.runId===runId){cleanup();resolve(value);}};const error=e=>{cleanup();reject(e);};const exit=()=>{cleanup();try{resolve(statusDesktopLauncher(toolkit,runId));}catch(e){reject(e);}};child.on('message',message);child.once('error',error);child.once('exit',exit);});
  const receipt=statusDesktopLauncher(toolkit,runId);if(result.error||receipt.state==='failed')fail(result.error?.code??receipt.error?.code??'DESKTOP_START_FAILED',result.error?.message??receipt.error?.message??'Desktop process could not start.');return receipt;
 }finally{lease.release();if(child){if(child.connected)child.disconnect();child.unref();}}
}
