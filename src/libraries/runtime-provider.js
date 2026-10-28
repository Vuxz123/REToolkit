import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {fileIdentity,fingerprint,withWorkspaceLock} from '../state.js';
import {assertAssetPath,assetPaths,assetProjectPath,selectedAssetBinding,assetError} from '../assets/context.js';
import {locateUnityProject,inventoryUnityProject,readUnityProjectVersion,verifyGraphFiles} from '../assets/graph.js';
import {hasAssetSession} from '../assets/session.js';
import {assertNoSession} from '../ghidra/runtime.js';
import {acquireToolchainRead} from '../toolchain/lease.js';
import {assertPortablePackages,resolveUnityEditor} from '../unity/validation.js';
import {readJson,writeJson,seal,unseal,uuid} from '../recovery/artifacts.js';
import {inspectManagedAssembly} from './managed-inspector.js';
import {compareRuntimeProvider} from './runtime-contract.js';
const check=(ok,message,code='runtime_provider_invalid')=>{if(!ok)throw assetError(code,message);};
const same=(a,b)=>fingerprint(a)===fingerprint(b);
const identity=(file,maximum=128*1024**2)=>{assertAssetPath(file);const stat=fs.lstatSync(file);check(stat.isFile()&&stat.size<=maximum,'Invalid bounded provider file');const {sha256,size}=fileIdentity(file);return {sha256,size};};
const policyIdentity=()=>identity(fileURLToPath(new URL('./runtime-contract.js',import.meta.url))).sha256;
const safeDll=value=>typeof value==='string'&&value.length<=2048&&/^Assets\/.+\.dll$/i.test(value)&&!/[\\:\x00-\x1f]/.test(value)&&value.split('/').every(v=>v&&v!=='.'&&v!=='..');
const inside=(root,relative)=>assertAssetPath(path.join(root,...relative.split('/')),root);
function summary(record,directory,workspace){return {operationId:record.operationId,state:record.state,dll:record.dll,storedPlan:path.relative(workspace,path.join(directory,'plan.json')).split(path.sep).join('/'),storedInspection:path.relative(workspace,path.join(directory,'inspection.json')).split(path.sep).join('/'),blockerCount:record.comparison.blockers.length,blockers:record.comparison.blockers.slice(0,30),originalAssembly:record.comparison.originalAssembly,replacementAssembly:record.comparison.replacementAssembly,serializedFields:record.comparison.serializedFields,improvedMethods:record.comparison.improvedMethods,compileReady:false,bindingsVerified:false,runtimeVerified:false};}
export async function runRuntimeProviderOperation(toolkit,name,command,params={},dependencies={}){
 const allowed={plan:['dll','replacement'],apply:['operationId'],verify:['operationId']};check(allowed[command]&&params&&typeof params==='object'&&!Array.isArray(params)&&Object.keys(params).every(k=>allowed[command].includes(k)),'Invalid runtime provider parameters');
 if(command==='plan')check(safeDll(params.dll)&&typeof params.replacement==='string'&&path.isAbsolute(params.replacement)&&/\.dll$/i.test(params.replacement),'Expected Assets DLL path and explicit absolute replacement DLL');else check(uuid(params.operationId),'Expected provider plan UUID');
 assertNoSession(toolkit,name);check(!hasAssetSession(toolkit,name),'Stop AssetRipper before provider operations','asset_session_active');
 const p=assetPaths(toolkit,name),lease=acquireToolchainRead(toolkit.root);
 try{return await withWorkspaceLock(p.workspace,async()=>{
  const selected=selectedAssetBinding(toolkit,name),project=await locateUnityProject(assetProjectPath(toolkit,name,selected)),{files}=await inventoryUnityProject(project),inventorySha256=fingerprint(files);
  assertPortablePackages(project,files);
  const unityVersion=await readUnityProjectVersion(project,files),editorPath=(dependencies.resolveEditor??resolveUnityEditor)(unityVersion,selected.project);check(editorPath,'Exact Unity Editor is required for provider metadata inspection');
  const operationId=command==='plan'?randomUUID():params.operationId,directory=assertAssetPath(path.join(p.base,'runtime-providers',operationId),p.workspace),planFile=path.join(directory,'plan.json'),snapshot=path.join(directory,'replacement.dll');
  const inspect=dependencies.inspect??inspectManagedAssembly;
  async function derive(dll,replacement){
   const original=inside(project,dll),old=await inspect({toolkitRoot:toolkit.root,editorPath,assemblyPath:original}),next=await inspect({toolkitRoot:toolkit.root,editorPath,assemblyPath:replacement});
   check(old.targetExecuted===false&&next.targetExecuted===false,'Inspector must not execute target assemblies');
   const comparison=compareRuntimeProvider(old.metadata,next.metadata);
   return {comparison,old,next,original:identity(original),replacement:identity(replacement),inspectorPolicySha256:policyIdentity()};
  }
  if(command==='plan'){
   const source=files.find(f=>f.path===params.dll),meta=files.find(f=>f.path===params.dll+'.meta');check(source&&meta&&meta.size<=1024**2,'DLL and original .meta must be inventoried');
   const text=fs.readFileSync(inside(project,meta.path),'utf8'),guids=[...text.matchAll(/^guid:\s*([a-f0-9]{32})\s*$/gm)];check(guids.length===1,'Original DLL meta GUID must be unique');
   const candidate=assertAssetPath(params.replacement),candidateIdentity=identity(candidate);check(!same(candidateIdentity,identity(inside(project,params.dll))),'Replacement DLL is unchanged');
   fs.mkdirSync(directory,{recursive:true});fs.copyFileSync(candidate,snapshot,fs.constants.COPYFILE_EXCL);check(same(identity(snapshot),candidateIdentity)&&same(identity(candidate),candidateIdentity),'Replacement changed during snapshot');
   const inspection=await derive(params.dll,snapshot);await verifyGraphFiles(project,{files});check(same(selectedAssetBinding(toolkit,name).binding,selected.binding),'Selected input changed');
   const record={kind:'retoolkit-runtime-provider-plan',schemaVersion:1,operationId,createdAt:new Date().toISOString(),state:inspection.comparison.compatible?'planned':'blocked',binding:selected.binding,inventorySha256,files,unityVersion,dll:params.dll,metaGuid:guids[0][1],source:inspection.original,replacement:inspection.replacement,sourcePath:candidate,meta:{path:meta.path,...identity(inside(project,meta.path))},inspectionSha256:fingerprint(inspection),inspectorPolicySha256:inspection.inspectorPolicySha256,comparison:inspection.comparison};
   writeJson(path.join(directory,'inspection.json'),seal(inspection),{exclusive:true});writeJson(planFile,seal(record),{exclusive:true});return summary(record,directory,p.workspace);
  }
  const record=unseal(readJson(planFile));check(record.kind==='retoolkit-runtime-provider-plan'&&record.schemaVersion===1&&record.operationId===operationId&&safeDll(record.dll)&&same(record.binding,selected.binding)&&record.unityVersion===unityVersion,'Invalid or stale runtime provider plan');
  const stage=path.join(directory,'project'),receiptFile=path.join(directory,'receipt.json');
  if(command==='verify'){
   const receipt=readJson(receiptFile),{receiptSha256,...payload}=receipt;check(receiptSha256===fingerprint(payload)&&receipt.kind==='retoolkit-runtime-provider-receipt'&&receipt.operationId===operationId&&receipt.planSha256===fingerprint(record)&&same(receipt.binding,selected.binding),'Invalid provider stage receipt');
   const expected=record.files.map(f=>f.path===record.dll?{...f,...record.replacement}:f);
   check(receipt.schemaVersion===1&&receipt.state==='staged'&&receipt.dll===record.dll&&receipt.metaGuid===record.metaGuid&&receipt.sourceInventorySha256===record.inventorySha256&&same(receipt.files,expected),'Provider inventory differs from the planned single-DLL replacement');
   check([record.inventorySha256,fingerprint(receipt.files)].includes(inventorySha256),'Current candidate differs from both provider source and stage','runtime_provider_stale');
   await verifyGraphFiles(stage,{files:receipt.files});check(same(identity(inside(stage,record.dll)),record.replacement)&&same(identity(inside(stage,record.meta.path)),{size:record.meta.size,sha256:record.meta.sha256}),'Staged DLL or meta changed');
   return {...summary(record,directory,p.workspace),state:'integrity-verified',integrityVerified:true,currentMatchesStage:inventorySha256===fingerprint(receipt.files),scope:'staged-provider-inventory',nextOperation:'reconstruct.validate'};
  }
  check(record.state==='planned'&&record.comparison.compatible&&record.inventorySha256===inventorySha256&&same(record.files,files)&&record.inspectorPolicySha256===policyIdentity(),'Provider plan is blocked or source/policy changed','runtime_provider_stale');
  check(same(identity(snapshot),record.replacement),'Provider snapshot changed','runtime_provider_stale');
  const inspection=await derive(record.dll,snapshot);check(inspection.comparison.compatible&&fingerprint(inspection)===record.inspectionSha256,'Provider metadata, inspector or compatibility changed','runtime_provider_stale');
  check(!fs.existsSync(stage)&&!fs.existsSync(receiptFile),'Provider stage already exists; inspect/verify it instead of replaying','runtime_provider_exists');
  await verifyGraphFiles(project,{files});fs.mkdirSync(stage);
  for(const file of files){const to=inside(stage,file.path),from=inside(project,file.path);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);check(same(identity(to,Number.MAX_SAFE_INTEGER),{size:file.size,sha256:file.sha256}),'Source changed during provider staging');}
  fs.copyFileSync(snapshot,inside(stage,record.dll));
  const expected=files.map(f=>f.path===record.dll?{...f,...record.replacement}:f);await verifyGraphFiles(stage,{files:expected});await verifyGraphFiles(project,{files});check(same(selectedAssetBinding(toolkit,name).binding,selected.binding),'Input build changed while staging');
  const payload={kind:'retoolkit-runtime-provider-receipt',schemaVersion:1,operationId,state:'staged',binding:selected.binding,planSha256:fingerprint(record),sourceInventorySha256:inventorySha256,files:expected,dll:record.dll,metaGuid:record.metaGuid,compileReady:false,bindingsVerified:false,runtimeVerified:false,createdAt:new Date().toISOString()};writeJson(receiptFile,{...payload,receiptSha256:fingerprint(payload)},{exclusive:true});
  return {...summary(record,directory,p.workspace),state:'staged',project:path.relative(p.workspace,stage).split(path.sep).join('/'),storedReceipt:path.relative(p.workspace,receiptFile).split(path.sep).join('/'),nextOperation:'reconstruct.validate'};
 });}finally{lease.release();}
}
