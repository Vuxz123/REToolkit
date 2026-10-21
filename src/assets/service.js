import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {assetPaths,selectedAssetBinding,assertAssetPath,assetError,safeAssetExportPath} from './context.js';
import {indexUnityProject,locateUnityProject,verifyGraphFiles,queryGraph,UNITY_PROJECT_LIMITS} from './graph.js';
import {assertGraphManifest,isSqliteGraph,openStoredGraph,verifyStoredGraph,focusStoredGraph} from './graph-storage.js';
import {buildScriptMap} from '../reconstruction/map.js';
import {createReconstructionPlan,applyReconstructionPlan,verifyReconstruction} from '../reconstruction/plan.js';
import {fingerprint,reusable,withWorkspaceLock,ownsWorkspaceLock} from '../state.js';
import {stepFingerprint,within} from '../inputs.js';
import {acquireToolchainRead} from '../toolchain/lease.js';

const MiB=1024**2;
export const assetMethods=new Set(['assets.index','assets.list','assets.get','assets.tree','assets.refs','assets.scripts','assets.source','reconstruct.plan','reconstruct.apply','reconstruct.verify','reconstruct.validate','reconstruct.validation']);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export function readAssetJson(file,maxBytes=128*MiB) {
  assertAssetPath(file);const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.size>maxBytes)throw assetError('asset_payload_limit','Invalid or oversized asset JSON file');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file)).replace(/^\uFEFF/,''));
}
function writeJson(file,value,{exclusive=false,maxBytes=128*MiB,compact=false}={}) {
  assertAssetPath(file);const bytes=JSON.stringify(value,null,compact?undefined:2)+'\n';
  if(Buffer.byteLength(bytes)>maxBytes)throw assetError('asset_payload_limit','Asset JSON exceeds its local storage budget');
  fs.mkdirSync(path.dirname(file),{recursive:true});assertAssetPath(file);
  const temp=file+'.tmp-'+randomUUID();
  try{fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});if(exclusive)fs.linkSync(temp,file);else fs.renameSync(temp,file);}
  finally{fs.rmSync(temp,{force:true});}
}
function paramsShape(params,allowed) {
  if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(k=>!allowed.includes(k)))throw assetError('asset_params_invalid','Unknown or invalid asset parameters');
}
async function exportRoot(selected) {
  const directory=safeAssetExportPath(selected.workspace,selected.project.reconstructedSourceDir??path.join(selected.workspace,'05_ReconstructedSource'),selected.inputPath);
  if(within(directory,path.join(selected.workspace,'04_Notes'))||within(directory,selected.inputPath)||within(selected.inputPath,directory))throw assetError('asset_path_invalid','Export directory overlaps input or notes');
  const projectDir=await locateUnityProject(directory);assertAssetPath(projectDir,selected.workspace);return projectDir;
}
function currentGraph(paths,selected) {
  const graph=readAssetJson(paths.graphFile,UNITY_PROJECT_LIMITS.maxStoredGraphBytes);
  assertGraphManifest(graph,{expectedStorage:selected.project.assetReconstruction?.graphStorage});
  if(fingerprint(graph.binding)!==fingerprint(selected.binding))throw assetError('stale_graph','Asset graph binding changed; index the current export again');
  return graph;
}
function graphProgress(toolkit){let last=0,phase;return event=>{const now=Date.now();if(event.phase!==phase||now-last>=10000){phase=event.phase;last=now;toolkit.log(JSON.stringify({kind:'asset-index-progress',...event}));}};}
export async function indexOwnedGraph(projectDir,binding,paths,{storage='json',graphLimitBytes,onProgress}={}){
 if(storage==='json')return indexUnityProject(projectDir,{binding,graphLimitBytes});
 if(storage!=='sqlite')throw assetError('asset_params_invalid','Unknown graph storage');
 const generation=randomUUID(),relativePath=`indexes/${generation}/graph.sqlite`,databaseFile=assertAssetPath(path.join(paths.base,...relativePath.split('/')),paths.workspace);
 fs.mkdirSync(path.dirname(databaseFile),{recursive:true});
 const {indexUnityProjectSqlite}=await import('./sqlite-index.js');
 return indexUnityProjectSqlite(projectDir,{binding,databaseFile,storageRelativePath:relativePath,onProgress});
}
async function recordAssetState(toolkit,name,binding,change) {
  const project=toolkit.read(name),previous=project.assetReconstruction;
  project.assetReconstruction={...(previous?.binding&&fingerprint(previous.binding)===fingerprint(binding)?previous:{}),binding,...change,compileReady:false,bindingsVerified:false,behavior:'unverified'};
  await toolkit.save(name,project);
}
function verifiedDump(toolkit,selected) {
  const file=assertAssetPath(path.join(selected.workspace,'02_Il2CppDumperOutput/dump.cs'),selected.workspace);
  if(!fs.existsSync(file))return undefined;
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>128*MiB)throw assetError('asset_payload_limit','Dump source exceeds limit');
  // Exported declarations alone never establish a matching native build.
  let verified=false;
  try{verified=reusable(selected.project,'dump',stepFingerprint(selected.project,'dump',toolkit.tools,toolkit.root));}catch{}
  const text=fs.readFileSync(file,'utf8');return {text,sha256:createHash('sha256').update(text).digest('hex'),verified,build:selected.binding};
}
function pageScripts(map,params) {
  const limit=params.limit??100;
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000||params.query!==undefined&&(typeof params.query!=='string'||params.query.length>2048))throw assetError('asset_params_invalid','Invalid script paging parameters');
  const rows=map.scripts.filter(s=>!params.query||s.path.includes(params.query)||s.identity.fullName?.includes(params.query));let offset=0;
  if(params.cursor!==undefined){try{const cursor=JSON.parse(Buffer.from(params.cursor,'base64url').toString());if(cursor.revision!==map.graphRevision||cursor.query!==(params.query??'')||!Number.isSafeInteger(cursor.offset)||cursor.offset<0)throw Error();offset=cursor.offset;}catch{throw assetError('asset_params_invalid','Invalid script cursor');}}
  return {revision:map.graphRevision,items:rows.slice(offset,offset+limit),nextCursor:offset+limit<rows.length?Buffer.from(JSON.stringify({revision:map.graphRevision,query:params.query??'',offset:offset+limit})).toString('base64url'):null,limitations:map.limitations};
}

/** Internal dispatcher: caller holds the existing workspace lease. */
export async function handleOwnedAssetOperation(toolkit,name,method,params={}) {
  if(!assetMethods.has(method))throw assetError('asset_method_invalid','Unknown asset operation');
  const paths=assetPaths(toolkit,name);
  if(!ownsWorkspaceLock(paths.workspace))throw assetError('asset_lease_required','Asset operation requires the workspace lease');
  const selected=selectedAssetBinding(toolkit,name),projectDir=await exportRoot(selected);
  if(method==='assets.index') {
    paramsShape(params,['graphMaxMiB','storage']);if(params.storage!==undefined&&!['json','sqlite'].includes(params.storage)||params.graphMaxMiB!==undefined&&(![128,256,512].includes(params.graphMaxMiB)||params.storage==='sqlite'))throw assetError('asset_params_invalid','Invalid graph storage or JSON budget');
    const graphLimitBytes=(params.graphMaxMiB??128)*MiB,graph=await indexOwnedGraph(projectDir,selected.binding,paths,{storage:params.storage??'json',graphLimitBytes,onProgress:graphProgress(toolkit)});
    if(fingerprint(selectedAssetBinding(toolkit,name).binding)!==fingerprint(selected.binding))throw assetError('asset_input_stale','Inputs changed while indexing');
    writeJson(paths.graphFile,graph,{maxBytes:UNITY_PROJECT_LIMITS.maxStoredGraphBytes,compact:true});await recordAssetState(toolkit,name,selected.binding,{state:'graph_ready',graph:'ready',graphRevision:graph.revision,graphStorage:params.storage??'json',...(isSqliteGraph(graph)?{}:{graphLimitBytes})});
    return {state:'indexed',storage:params.storage??'json',revision:graph.revision,profile:graph.profile,coverage:graph.coverage,limitations:graph.limitations};
  }
  if(method==='reconstruct.apply'||method==='reconstruct.verify') {
    paramsShape(params,['operationId']);if(!uuid(params.operationId))throw assetError('asset_params_invalid','Expected a saved reconstruction operation UUID');
    const saved=readAssetJson(assertAssetPath(path.join(paths.reconstructionDir,'plans',params.operationId+'.json'),paths.workspace));
    assertGraphManifest(saved.graph,{expectedStorage:selected.project.assetReconstruction?.graphStorage==='sqlite'?'sqlite':undefined});
    if(saved.plan?.operationId!==params.operationId||fingerprint(saved.graph?.binding)!==fingerprint(selected.binding))throw assetError('stale_graph','Saved reconstruction binding changed');
    const journalDir=assertAssetPath(path.join(paths.reconstructionDir,'journal'),paths.workspace);
    if(method==='reconstruct.verify') {
      const receipt=readAssetJson(path.join(journalDir,params.operationId,'receipt.json'));
      if(fingerprint(receipt.binding)!==fingerprint(selected.binding))throw assetError('stale_graph','Receipt binding changed');
      return verifyReconstruction({projectDir,receipt});
    }
    let receipt,uncertain=false;
    const marker=path.join(paths.workspace,'.retk-lock/assets-write-'+randomUUID()+'.json');
    // Persist a second owner before source mutation. Even process death or a full
    // disk cannot make PID-only reclamation discard an unfinished transaction.
    writeJson(marker,{kind:'assets-write-in-progress',operationId:params.operationId},{exclusive:true});
    try{receipt=await applyReconstructionPlan({projectDir,graph:focusStoredGraph(saved.graph,paths.graphFile,{scriptIds:saved.plan?.changes?.map(c=>c.scriptId)}),plan:saved.plan,journalDir,onEvent:async()=>{
      if(fingerprint(selectedAssetBinding(toolkit,name).binding)!==fingerprint(selected.binding))throw assetError('asset_input_stale','Asset source changed during reconstruction');
    }});}
    catch(error){uncertain=error.code==='reconstruction_recovery_required';throw error;}
    finally{if(!uncertain)fs.unlinkSync(assertAssetPath(marker,paths.workspace));}
    // Keep returned receipt stable across retries; graph refresh errors remain visible.
    let updated;
    if(fs.existsSync(paths.graphFile)){
      const candidate=readAssetJson(paths.graphFile,UNITY_PROJECT_LIMITS.maxStoredGraphBytes);
      // applyReconstructionPlan already verified the receipt's complete current
      // inventory. A retry can reuse that exact sealed graph without generating
      // another multi-million-row database.
      if(Array.isArray(candidate.files)&&fingerprint(candidate.binding)===fingerprint(selected.binding)&&fingerprint(candidate.files)===fingerprint(receipt.files)&&isSqliteGraph(candidate)===isSqliteGraph(saved.graph)){assertGraphManifest(candidate);verifyStoredGraph(candidate,paths.graphFile);updated=candidate;}
    }
    if(!updated){updated=await indexOwnedGraph(projectDir,selected.binding,paths,{storage:isSqliteGraph(saved.graph)?'sqlite':'json',graphLimitBytes:saved.graph.profile?.limits?.maxGraphBytes});writeJson(paths.graphFile,updated,{maxBytes:UNITY_PROJECT_LIMITS.maxStoredGraphBytes,compact:true});}
    await recordAssetState(toolkit,name,selected.binding,{state:'source_applied',source:'applied',graph:'ready',graphRevision:updated.revision,graphStorage:isSqliteGraph(updated)?'sqlite':'json',graphLimitBytes:isSqliteGraph(updated)?null:updated.profile?.limits?.maxGraphBytes,lastOperation:params.operationId});
    const {files,...summary}=receipt;
    return {...summary,inventoryFiles:files.length,storedReceipt:path.relative(paths.workspace,path.join(journalDir,params.operationId,'receipt.json')).split(path.sep).join('/')};
  }
  const graph=currentGraph(paths,selected);await verifyGraphFiles(projectDir,graph);
  if(method==='reconstruct.validate'||method==='reconstruct.validation') {
    verifyStoredGraph(graph,paths.graphFile);
    const {validateUnityProject,readUnityValidation}=await import('../unity/validation.js');
    if(method==='reconstruct.validation'){paramsShape(params,['operationId','section','limit','cursor']);return readUnityValidation({toolkit,name,projectDir,graph,...params});}
    paramsShape(params,['timeoutSeconds']);
    const {hasAssetSession}=await import('./session.js');
    if(hasAssetSession(toolkit,name))throw assetError('asset_session_active','Stop the owned AssetRipper session before starting Unity validation');
    const result=await validateUnityProject({toolkit,name,projectDir,graph,timeoutSeconds:params.timeoutSeconds??600});
    const project=toolkit.read(name);project.assetReconstruction={...project.assetReconstruction,state:result.compileReady?(result.bindingsVerified?'bindings_verified':'compile_ready'):result.state,compileReady:result.compileReady,bindingsVerified:result.bindingsVerified,behavior:'unverified',validationOperation:result.operationId};await toolkit.save(name,project);
    return result;
  }
  if(method==='assets.source') {
    verifyStoredGraph(graph,paths.graphFile);
    paramsShape(params,['id']);if(typeof params.id!=='string'||params.id.length>2048)throw assetError('asset_params_invalid','Expected a script asset ID');
    const asset=graph.assets.find(a=>a.id===params.id);
    if(!asset?.path?.startsWith('Assets/')||!asset.path.endsWith('.cs'))throw assetError('asset_source_unsupported','Only exported C# source assets can be read');
    const file=assertAssetPath(path.join(projectDir,asset.path),projectDir),stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.size>MiB)throw assetError('asset_source_limit','Source exceeds 1 MiB');
    const bytes=fs.readFileSync(file),sha256=createHash('sha256').update(bytes).digest('hex'),record=graph.files.find(f=>f.path===asset.path);
    if(!record||sha256!==record.sha256||bytes.length!==record.size)throw assetError('stale_graph','Source changed while reading');
    const source=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    const result={revision:graph.revision,coverage:graph.coverage,id:asset.id,path:asset.path,sha256,size:bytes.length,encoding:'utf8',source,dataTrust:'untrusted-target-content'};
    if(Buffer.byteLength(JSON.stringify(JSON.stringify(result)))>1800000)throw assetError('asset_source_limit','Escaped source exceeds the response limit; inspect the exported file by its recorded path');
    return result;
  }
  if(['assets.list','assets.get','assets.tree','assets.refs'].includes(method)) {
    if(isSqliteGraph(graph)){const reader=openStoredGraph(graph,paths.graphFile);try{return reader.query(method,params);}finally{reader.close();}}
    return queryGraph(graph,method,params);
  }
  paramsShape(params,method==='assets.scripts'?['limit','cursor','query','evidence']:['request','evidence']);
  if(params.evidence!==undefined&&Buffer.byteLength(JSON.stringify(params.evidence))>MiB)throw assetError('asset_payload_limit','Evidence exceeds 1 MiB');
  const sqlite=isSqliteGraph(graph),selection=sqlite&&method==='assets.scripts'?pageScripts({graphRevision:graph.revision,scripts:graph.assets.filter(a=>a.script||/\.(?:cs|dll)$/i.test(a.path)).map(a=>({scriptId:a.id,path:a.path,identity:{fullName:a.script?.types?.length===1?a.script.types[0].fullName:null}})),limitations:graph.limitations},params):null;
  const scriptIds=sqlite?(selection?selection.items.map(s=>s.scriptId):params.request?.changes?.map(c=>c.scriptId)):undefined;
  const focused=sqlite?focusStoredGraph(graph,paths.graphFile,{scriptIds}):graph;
  const map=await buildScriptMap(focused,{projectDir,dump:verifiedDump(toolkit,selected),evidence:params.evidence??[],scriptIds});writeJson(paths.mapFile,{...map,...(sqlite?{scope:{kind:'selected-scripts',scriptIds}}:{})});
  if(method==='assets.scripts')return {...(selection?{...selection,items:map.scripts,limitations:map.limitations}:pageScripts(map,params)),coverage:graph.coverage};
  const plan=await createReconstructionPlan({projectDir,graph:focused,scriptMap:map,request:params.request});
  const file=path.join(paths.reconstructionDir,'plans',plan.operationId+'.json');
  // Saved reconstruction needs the complete file inventory, all source type
  // identities and all script bindings. Bulk/scene payloads are unnecessary.
  const focusedGraph=sqlite?graph:{kind:graph.kind,schemaVersion:graph.schemaVersion,binding:graph.binding,revision:graph.revision,unityVersion:graph.unityVersion,profile:graph.profile,files:graph.files,assets:graph.assets.filter(a=>a.script),nodes:graph.nodes.filter(n=>n.scriptRef).map(n=>({id:n.id,scriptRef:n.scriptRef})),edges:graph.edges.filter(e=>e.kind==='script')};
  writeJson(file,{plan,graph:focusedGraph},{exclusive:true,compact:true});
  const {inventory,...preview}=plan;
  const result={...preview,storedPlan:path.relative(paths.workspace,file).split(path.sep).join('/'),inventoryFiles:inventory.length};
  // A saved concrete plan remains reviewable even when its source payload is
  // larger than the RPC/MCP response cap. Never lose its operation ID on success.
  if(Buffer.byteLength(JSON.stringify(result))>1024**2) {
    result.changes=plan.changes.map(({source,...change})=>({...change,sourceInSavedPlan:true}));
  }
  return result;
}

export async function runAssetOperation(toolkit,name,method,params={}) {
  if(!assetMethods.has(method))throw assetError('asset_method_invalid','Unknown asset operation');
  const {hasAssetSession,requestAssetSession}=await import('./session.js');
  if(hasAssetSession(toolkit,name)){
    if(method==='reconstruct.validate')throw assetError('asset_session_active','Stop the owned AssetRipper session before starting Unity validation');
    return requestAssetSession(toolkit,name,'operation',{method,params});
  }
  const paths=assetPaths(toolkit,name),lease=acquireToolchainRead(toolkit.root);let uncertain=false;
  try{return await withWorkspaceLock(paths.workspace,async()=>{
    try{return await handleOwnedAssetOperation(toolkit,name,method,params);}catch(error){uncertain=['reconstruction_recovery_required','unity_recovery_required'].includes(error.code);throw error;}
  });}finally{if(!uncertain)lease.release();}
}
