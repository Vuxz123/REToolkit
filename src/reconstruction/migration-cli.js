import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createToolkit} from '../toolkit.js';
import {fingerprint,withWorkspaceLock} from '../state.js';
import {acquireToolchainRead} from '../toolchain/lease.js';
import {assetPaths,assertAssetPath,selectedAssetBinding,safeAssetExportPath} from '../assets/context.js';
import {handleOwnedAssetOperation,readAssetJson,indexOwnedGraph} from '../assets/service.js';
import {hasAssetSession} from '../assets/session.js';
import {locateUnityProject,indexUnityProject,verifyGraphFiles,UNITY_PROJECT_LIMITS} from '../assets/graph.js';
import {createMigrationPlan,applyMigrationPlan,verifyMigration} from './migration.js';
import {observeMigration} from './migration-observation.js';
import {isSqliteGraph,focusStoredGraph} from '../assets/graph-storage.js';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const allowed={observe:['receipt','editor','timeoutSeconds','components'],plan:['request','observations'],apply:['plan','observations'],verify:['receipt','observations']};
const required={observe:[],plan:['request','observations'],apply:['plan','observations'],verify:['receipt']};
function check(ok,message,code='migration_cli_invalid'){if(!ok)throw Object.assign(Error(message),{code});}
export const isMigrationCommand=argv=>argv[0]==='migration';
export const migrationUsage=`Explicit Unity script and serialized field migration
  node re.js migration observe <Game> [--receipt <saved receipt>] [--components <object ID array JSON>] [--editor <Unity.exe>] [--timeout-seconds 600]
  node re.js migration plan <Game> --request <json> --observations <json>
  node re.js migration apply <Game> --plan <json> --observations <json>
  node re.js migration verify <Game> --receipt <json> [--observations <json>]
Global: --root <toolkit>, --json, --help.
Observe with a receipt inspects that migration's staged project. Original exports remain unchanged.
Only observed explicit identities and supported scalar/reference field renames are accepted.
DLL removal/conversion, complex fields, managed references and type conversions remain unsupported.
`;
function paramsValid(command,params){
 check(Object.hasOwn(allowed,command)&&params&&typeof params==='object'&&!Array.isArray(params)&&Object.keys(params).every(k=>allowed[command].includes(k))&&required[command].every(k=>typeof params[k]==='string'&&params[k].length>0),'Unknown migration operation or missing/unsupported options');
 for(const [key,value] of Object.entries(params))if(key==='timeoutSeconds')check(Number.isSafeInteger(value)&&value>=1&&value<=3600,'Migration timeout must be 1..3600 seconds');else check(typeof value==='string'&&value.length>0&&value.length<32768&&!/[\0\r\n]/.test(value),'Invalid migration input path');
}
export function parseMigrationArgs(argv){
 const positional=[],params={},options={},seen=new Set();
 for(let i=0;i<argv.length;i++){
  const token=argv[i];if(!token.startsWith('--')){positional.push(token);continue;}
  const key=token.slice(2);check(!seen.has(key),'Duplicate migration option');seen.add(key);
  if(['json','help'].includes(key)){options[key]=true;continue;}
  check(['root','request','observations','plan','receipt','editor','timeout-seconds','components'].includes(key),'Unknown migration option');const value=argv[++i];check(value&&!value.startsWith('--'),'Missing migration option value');
  if(key==='root')options.root=value;else if(key==='timeout-seconds'){check(/^[1-9]\d*$/.test(value),'Invalid migration timeout');params.timeoutSeconds=Number(value);}else params[key]=value;
 }
 if(options.help)return {help:true};const [group,command,name,...extra]=positional;check(group==='migration'&&extra.length===0&&typeof name==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(name)&&name!=='.'&&name!=='..','Expected one migration workspace name');paramsValid(command,params);return {command,name,params,options};
}
async function json(file,value,{sameExisting=false}={}){
 assertAssetPath(file);const bytes=JSON.stringify(value,null,2)+'\n';check(Buffer.byteLength(bytes)<=128*1024**2,'Migration artifact exceeds byte limit');await fs.mkdir(path.dirname(file),{recursive:true});assertAssetPath(file);
 let handle;try{handle=await fs.open(file,'wx');}catch(error){if(error.code==='EEXIST'&&sameExisting){check(fingerprint(readAssetJson(file))===fingerprint(value),'Existing migration artifact differs');return;}throw error;}
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
}
function relative(workspace,file){return path.relative(workspace,file).split(path.sep).join('/');}
function samePath(a,b){return process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);}
function sourceUnchanged(toolkit,name,binding){check(fingerprint(selectedAssetBinding(toolkit,name).binding)===fingerprint(binding),'Selected source build changed during migration','asset_input_stale');}
async function savedReceipt(params,base,workspace,binding,{requireValid=true}={}){
 const file=assertAssetPath(path.resolve(params.receipt),workspace),receipt=readAssetJson(file);check(receipt.kind==='retoolkit-migration-receipt'&&uuid.test(receipt.operationId??'')&&fingerprint(receipt.binding)===fingerprint(binding),'Invalid or stale migration receipt binding');
 const {receiptSha256,...payload}=receipt;check(receiptSha256===fingerprint(payload),'Migration receipt hash changed');
 const expected=assertAssetPath(path.join(base,receipt.operationId,'apply/receipt.json'),workspace);check(samePath(file,expected),'Receipt must be the saved canonical workspace migration receipt');const projectDir=assertAssetPath(path.join(base,receipt.operationId,'apply/project'),workspace);if(requireValid)await verifyGraphFiles(projectDir,{files:receipt.files});return {receipt,file,projectDir};
}
function componentScope(ids){check(Array.isArray(ids)&&ids.length>0&&ids.length<=1000&&new Set(ids).size===ids.length&&ids.every(id=>typeof id==='string'&&id.startsWith('object:')&&id.length<=2048),'Expected 1..1000 distinct component object IDs');return ids;}
function requestScope(request){const rows=[...(Array.isArray(request?.rebindings)?request.rebindings:[]),...(Array.isArray(request?.fieldRenames)?request.fieldRenames:[])];return componentScope([...new Set(rows.map(row=>row?.componentId))]);}
function migrationScope(graph,graphFile,ids){
 if(!isSqliteGraph(graph)&&!ids)return graph;
 const focused=isSqliteGraph(graph)?focusStoredGraph(graph,graphFile,{nodeIds:ids}):{...graph,nodes:graph.nodes.filter(n=>ids.includes(n.id)),edges:graph.edges.filter(e=>ids.includes(e.from))};
 if(ids)check(ids.every(id=>focused.nodes.some(n=>n.id===id&&n.classID===114&&n.scriptRef)),'Selected migration component is missing or unsupported');
 const selectedAssets=new Set(focused.nodes.map(n=>n.assetId));return {...focused,assets:focused.assets.filter(a=>!['scene','prefab','asset'].includes(a.kind)||selectedAssets.has(a.id))};
}
/** Shared typed CLI/desktop boundary; all output and recovery paths are fixed. */
export async function runMigrationOperation(toolkit,name,command,params={},dependencies={}){
 paramsValid(command,params);check(typeof name==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(name)&&!['.','..'].includes(name),'Invalid migration workspace name');
 check(!hasAssetSession(toolkit,name),'Stop the owned AssetRipper session before migration','asset_session_active');const paths=assetPaths(toolkit,name),base=assertAssetPath(path.join(paths.base,'migration'),paths.workspace),reader=acquireToolchainRead(toolkit.root);let uncertain=false;
 try{return await withWorkspaceLock(paths.workspace,async()=>{
  const marker=assertAssetPath(path.join(paths.workspace,'.retk-lock','migration-'+randomUUID()+'.json'),paths.workspace);await json(marker,{kind:'migration-in-progress',command});
  try{
   // Existing asset service establishes selected-build and graph freshness while
   // this same caller owns the workspace lease. Its result stays bounded.
   const current=await handleOwnedAssetOperation(toolkit,name,'assets.list',{limit:1}),selected=selectedAssetBinding(toolkit,name);let graph=readAssetJson(paths.graphFile,UNITY_PROJECT_LIMITS.maxStoredGraphBytes);
   check(current.revision===graph.revision&&fingerprint(graph.binding)===fingerprint(selected.binding),'Asset graph changed while selecting migration inputs','stale_graph');
   const original=await locateUnityProject(safeAssetExportPath(paths.workspace,selected.project.reconstructedSourceDir??path.join(paths.workspace,'05_ReconstructedSource'),selected.inputPath));await verifyGraphFiles(original,graph);
   if(command==='observe'){
    const saved=params.receipt?await savedReceipt(params,base,paths.workspace,selected.binding):null,projectDir=saved?.projectDir??original,operationId=randomUUID(),runDir=assertAssetPath(path.join(base,operationId),paths.workspace);
    const originalStorage=isSqliteGraph(graph),sourceGraph=saved?await indexOwnedGraph(projectDir,selected.binding,paths,{storage:originalStorage?'sqlite':'json',graphLimitBytes:graph.profile?.limits?.maxGraphBytes}):graph;
    const ids=params.components?componentScope(readAssetJson(path.resolve(params.components),1024**2)):undefined;
    const targetGraph=migrationScope(sourceGraph,paths.graphFile,ids);

    const observed=await (dependencies.observeMigration??observeMigration)({projectDir,graph:targetGraph,runDir,templateRoot:path.join(toolkit.root,'templates'),editor:params.editor?assertAssetPath(path.resolve(params.editor)):selected.project.unityEditorPath,lockDirectory:path.join(paths.workspace,'.retk-lock'),toolkitRoot:toolkit.root,timeoutSeconds:params.timeoutSeconds??600},dependencies);
    sourceUnchanged(toolkit,name,selected.binding);const file=path.join(runDir,'observations.json');await json(file,observed.observation);
    return {state:'observed',operationId,graphRevision:targetGraph.revision,complete:observed.observation.complete,compileReady:observed.observation.compilation.state==='succeeded',bindingsVerified:false,migratedValuesVerified:false,behavior:'unverified',scripts:observed.observation.scripts.length,components:observed.observation.components.length,storedObservations:relative(paths.workspace,file),storedEditorOutput:relative(paths.workspace,path.join(runDir,'editor-output.txt'))};
   }
   if(command==='plan'){
    const request=readAssetJson(path.resolve(params.request),8*1024**2),observations=readAssetJson(path.resolve(params.observations),32*1024**2);graph=migrationScope(graph,paths.graphFile,requestScope(request));const plan=await createMigrationPlan({projectDir:original,graph,observations,request});sourceUnchanged(toolkit,name,selected.binding);
    const directory=assertAssetPath(path.join(base,plan.operationId),paths.workspace);await fs.mkdir(directory,{recursive:true});const file=path.join(directory,'plan.json');await json(file,plan);await json(path.join(directory,'observations.json'),observations);
    return {state:'planned',operationId:plan.operationId,graphRevision:graph.revision,files:plan.changes.length,rebindings:request.rebindings.length,fieldRenames:request.fieldRenames.length,payloadSha256:plan.payloadSha256,compileReady:false,bindingsVerified:false,migratedValuesVerified:false,behavior:'unverified',storedPlan:relative(paths.workspace,file),storedObservations:relative(paths.workspace,path.join(directory,'observations.json'))};
   }
   if(command==='apply'){
    const plan=readAssetJson(path.resolve(params.plan),128*1024**2),observations=readAssetJson(path.resolve(params.observations),32*1024**2);check(uuid.test(plan.operationId??''),'Invalid migration operation UUID');const directory=assertAssetPath(path.join(base,plan.operationId),paths.workspace),runDir=path.join(directory,'apply');
    graph=migrationScope(graph,paths.graphFile,requestScope(plan.request));
    // Validate the untrusted plan before creating its fixed operation directory.
    const {payloadSha256:givenHash,...candidate}=plan;check(givenHash===fingerprint(candidate),'Migration plan payload hash changed');
    const {operationId,payloadSha256,...rest}=await createMigrationPlan({projectDir:original,graph,observations,request:plan.request});check(fingerprint({...plan,operationId:undefined,payloadSha256:undefined})===fingerprint({...rest,operationId:undefined,payloadSha256:undefined}),'Migration plan/hash/patches do not match current source');
    await json(path.join(directory,'plan.json'),plan,{sameExisting:true});await json(path.join(directory,'observations.json'),observations,{sameExisting:true});
    const receipt=await (dependencies.applyMigrationPlan??applyMigrationPlan)({projectDir:original,graph,observations,plan,runDir,onEvent:async()=>sourceUnchanged(toolkit,name,selected.binding)});sourceUnchanged(toolkit,name,selected.binding);
    return {state:'staged',operationId:receipt.operationId,compileReady:false,bindingsVerified:false,migratedValuesVerified:false,behavior:'unverified',inventoryFiles:receipt.files.length,storedReceipt:relative(paths.workspace,path.join(runDir,'receipt.json')),stagedProject:relative(paths.workspace,path.join(runDir,'project'))};
   }
   const saved=await savedReceipt(params,base,paths.workspace,selected.binding,{requireValid:false}),observations=params.observations?readAssetJson(path.resolve(params.observations),32*1024**2):undefined,result=await verifyMigration({projectDir:saved.projectDir,receipt:saved.receipt,observations});sourceUnchanged(toolkit,name,selected.binding);return {...result,storedReceipt:relative(paths.workspace,saved.file)};
  }catch(error){uncertain=error.preserveToolchainGate===true||['unity_recovery_required','migration_recovery_required'].includes(error.code);throw error;}
  finally{if(!uncertain)await fs.unlink(marker);}
 });}finally{if(!uncertain)reader.release();}
}
export async function runMigrationCli(argv,defaultRoot,dependencies={}){
 const parsed=parseMigrationArgs(argv);if(parsed.help){process.stdout.write(migrationUsage);return;}
 const toolkit=createToolkit(path.resolve(parsed.options.root??defaultRoot),{log:message=>console.error(message)}),result=await runMigrationOperation(toolkit,parsed.name,parsed.command,parsed.params,dependencies);process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
