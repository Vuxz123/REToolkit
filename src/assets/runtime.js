import fs from 'node:fs';
import path from 'node:path';
import {fileIdentity,fingerprint} from '../state.js';
import {rejectOutputLinks} from '../artifacts.js';
import {BridgeError} from './protocol.js';
export {atomicJson,readJson,secureDirectory} from '../ghidra/runtime.js';
import {readJson} from '../ghidra/runtime.js';
export function runtimePaths(toolkit,name,runId) {
 const workspace=fs.realpathSync(toolkit.workspace(name));
 const key=fingerprint(process.platform==='win32'?workspace.toLowerCase():workspace).slice(0,32);
 const base=path.join(toolkit.root,'.cache/asset-sessions',key);rejectOutputLinks(base);
 if(runId!==undefined&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId))throw new BridgeError('protocol_mismatch','Invalid asset run identity');
 const run=runId?path.join(base,runId):null;
 return {base,current:path.join(base,'current.json'),gate:path.join(base,'starting'),run,config:run?path.join(run,'config.json'):null,endpoint:run?path.join(run,'endpoint.json'):null,cancel:run?path.join(run,'cancel.json'):null,log:run?path.join(run,'engine.log'):null};
}
export function readSession(toolkit,name) {const p=runtimePaths(toolkit,name);if(!fs.existsSync(p.current))return null;rejectOutputLinks(p.current);const record=readJson(p.current);runtimePaths(toolkit,name,record.runId);return record;}
export function publicSession(record) {if(!record)return {state:'stopped'};const {runId,phase,startedAt,completedAt,error,job,engineVersion}=record;return {runId,state:phase,startedAt,completedAt,error,job,engineVersion};}
export function releaseGate(paths,token) {const marker=path.join(paths.gate,'owner-'+token);try{fs.unlinkSync(marker);fs.rmdirSync(paths.gate);}catch(error){if(error.code!=='ENOENT')throw error;}}
export function manifest(input) {
 rejectOutputLinks(input);const files=[];let count=0;
 const visit=(directory,relative='',depth=0)=>{
  if(depth>64)throw new BridgeError('input_limit','Source depth exceeds 64');
  for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   if(++count>100000)throw new BridgeError('input_limit','Source manifest exceeds 100000 entries');const file=path.join(directory,entry.name),rel=relative?relative+'/'+entry.name:entry.name;
   if(entry.isSymbolicLink())throw new BridgeError('input_link','Linked source assets are unsupported');
   if(entry.isDirectory())visit(file,rel,depth+1);else if(entry.isFile()){const {sha256,size}=fileIdentity(file);files.push({path:rel,sha256,size});}else throw new BridgeError('input_type','Source has a non-regular entry');
  }
 };
 if(fs.statSync(input).isDirectory())visit(input);else {const {sha256,size}=fileIdentity(input);files.push({path:path.basename(input),sha256,size});}
 if(Buffer.byteLength(JSON.stringify(files))>32*1024*1024)throw new BridgeError('input_limit','Source manifest exceeds 32 MiB');return files;
}
export async function bindingFor(toolkit,name) {
 const {selectedAssetBinding}=await import('./context.js');return selectedAssetBinding(toolkit,name);
}
export async function verifyBinding(config,toolkit) {
 const current=await bindingFor(toolkit,config.name);
 if(current.workspace!==config.workspace||current.inputPath!==config.inputPath||fingerprint(current.binding)!==fingerprint(config.binding)||fingerprint(current.sourceManifest)!==fingerprint(config.sourceManifest))throw new BridgeError('input_changed','Selected asset source or build binding changed; stop and restart the session');return current;
}
export function copyEngine(toolkit,run) {
 const source=toolkit.tools.assetripper;rejectOutputLinks(source);
 if(fs.readFileSync(path.join(path.dirname(source),'.retk-version'),'utf8').trim()!=='1.3.14')throw new BridgeError('engine_version','AssetRipper 1.3.14 is required');
 const directory=path.join(run,'engine');fs.mkdirSync(directory,{mode:0o700});const inventory=[];
 for(const name of fs.readdirSync(path.dirname(source)).filter(n=>n===path.basename(source)||n.toLowerCase().endsWith('.dll')).sort()){
  const original=path.join(path.dirname(source),name),target=path.join(directory,name);rejectOutputLinks(original);const before=fileIdentity(original);fs.copyFileSync(original,target,fs.constants.COPYFILE_EXCL);const after=fileIdentity(target);if(before.sha256!==after.sha256||before.size!==after.size||fileIdentity(original).sha256!==before.sha256)throw new BridgeError('engine_changed','Engine changed during private copy');inventory.push({path:name,sha256:before.sha256,size:before.size});
 }
 return {file:path.join(directory,path.basename(source)),inventory,settings:{version:'1.3.14',source:'upstream-defaults',defaultFile:'AssetRipper.Settings.json'}};
}
