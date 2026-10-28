import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fingerprint,fileIdentity,withWorkspaceLock} from '../state.js';
import {assetPaths,selectedAssetBinding,assetProjectPath,assertAssetPath} from '../assets/context.js';
import {handleOwnedAssetOperation,readAssetJson,indexOwnedGraph} from '../assets/service.js';
import {locateUnityProject,verifyGraphFiles,UNITY_PROJECT_LIMITS} from '../assets/graph.js';
import {isSqliteGraph,openStoredGraph,focusStoredGraph} from '../assets/graph-storage.js';
import {acquireToolchainRead} from '../toolchain/lease.js';
import {hasAssetSession} from '../assets/session.js';
import {validateSchema} from '../jobs/definitions.js';
import {readJson,writeJson,seal,unseal,page,check,uuid} from '../recovery/artifacts.js';
import {readLibraryCatalog} from '../libraries/service.js';
import {observeMigration} from '../reconstruction/migration-observation.js';
import {runMigrationOperation} from '../reconstruction/migration-cli.js';
import {componentDefinitions} from './definitions.js';
import {identityOf} from './registry.js';
import {inventoryComponents,isComponent,enrichComponentGraph,componentTargets,resolveComponents,libraryHints} from './resolver.js';

function pathsFor(toolkit,name,id){check(uuid(id),'Invalid component operation UUID');const paths=assetPaths(toolkit,name),directory=assertAssetPath(path.join(paths.base,'components',id),paths.workspace);return {...paths,directory,record:path.join(directory,'record.json')};}
const helperFile=toolkit=>assertAssetPath(path.join(toolkit.root,'templates/Unity/REToolkitMigrationObservation.cs'));
function load(toolkit,name,id){const paths=pathsFor(toolkit,name,id),record=unseal(readJson(paths.record));check(record.kind==='retoolkit-component-operation'&&record.schemaVersion===1&&record.operationId===id,'Invalid component record','components_record_invalid');return {record,paths};}
function summary(r,p){return {kind:r.kind,operationId:r.operationId,command:r.command,state:r.state,graphRevision:r.graphRevision,scopeCount:r.componentIds?.length??0,...(r.inventory?{total:r.inventory.total,groupCount:r.inventory.groups.length,samplesComplete:r.inventory.samplesComplete,coverage:r.inventory.coverage}:{}),targetCount:r.targets?.length??0,counts:r.resolution?.counts??{},blockers:r.blockers??[],limitations:r.limitations??[],implementation:'unverified',bindingsVerified:false,gameplay:'unverified',...(r.migration?{migrationOperationId:r.migration.operationId}:{}),storedRecord:path.relative(p.workspace,p.record).split(path.sep).join('/')};}
function targetsWithHints(graph,observation,catalog){return componentTargets(graph,observation).map(target=>({...target,libraries:libraryHints(target,catalog)}));}
function save(toolkit,name,value){const p=pathsFor(toolkit,name,value.operationId);writeJson(p.record,seal(value),{exclusive:true});return summary(value,p);}
function report(toolkit,name,params){const {record:r,paths:p}=load(toolkit,name,params.operationId),section=params.section??'summary';if(section==='summary')return {...summary(r,p),freshness:'not-rechecked'};const rows=section==='groups'?r.inventory?.groups??[]:section==='targets'?r.targets??[]:r.resolution?.decisions??[];return {operationId:r.operationId,section,...page(rows,params,fingerprint({id:r.operationId,section,payload:fingerprint(r)})),freshness:'not-rechecked'};}
async function current(toolkit,name){const p=assetPaths(toolkit,name),fresh=await handleOwnedAssetOperation(toolkit,name,'assets.list',{limit:1}),selected=selectedAssetBinding(toolkit,name),graph=readAssetJson(p.graphFile,UNITY_PROJECT_LIMITS.maxStoredGraphBytes);check(fresh.revision===graph.revision&&fingerprint(graph.binding)===fingerprint(selected.binding),'Component graph is stale','components_source_stale');const projectDir=await locateUnityProject(assetProjectPath(toolkit,name,selected));return {p,selected,graph,projectDir};}
function focus(graph,graphFile,ids){check(new Set(ids).size===ids.length,'Duplicate component IDs');const g=isSqliteGraph(graph)?focusStoredGraph(graph,graphFile,{nodeIds:ids}):{...graph,nodes:graph.nodes.filter(n=>ids.includes(n.id)),edges:graph.edges.filter(e=>ids.includes(e.from))};check(ids.every(id=>g.nodes.some(n=>n.id===id&&isComponent(n)&&n.guid)),'Component scope requires exact serialized GameObject component IDs','components_scope_invalid');const assets=new Set(g.nodes.map(n=>n.assetId));return {...g,assets:g.assets.filter(a=>!['scene','prefab','asset'].includes(a.kind)||assets.has(a.id))};}
function checkObservation(toolkit,name,id,context,{allowStage=false}={}){
 const loaded=load(toolkit,name,id),{record:r,paths:p}=loaded;
 check(r.command==='observe'&&r.state==='observed'&&(allowStage||!r.stageOperationId)&&r.helperSha256===fileIdentity(helperFile(toolkit)).sha256&&fingerprint(r.binding)===fingerprint(context.selected.binding),'Component observation is stale or belongs to another stage/build/helper','components_observation_stale');
 const observation=readJson(path.join(p.directory,'editor/observations.json'),32*1024**2),request=readJson(path.join(p.directory,'editor/request.json'),8*1024**2),process=readJson(path.join(p.directory,'editor/process.json'));
 check(fingerprint(observation)===r.observationSha256&&fingerprint(readJson(path.join(p.directory,'editor/observation.json'),32*1024**2))===r.observationSha256&&fileIdentity(path.join(p.directory,'editor/project/Assets/REToolkitValidation/Editor/REToolkitValidation.cs')).sha256===r.helperSha256&&fileIdentity(path.join(p.directory,'editor/request.json')).sha256===r.requestSha256&&fingerprint(process)===r.processSha256&&process.closed===true&&process.exitCode===0&&!process.timedOut&&request.componentMode===true&&request.runId===observation.runId&&request.graphRevision===r.graphRevision&&request.inventorySha256===r.inventorySha256&&observation.graphRevision===r.graphRevision&&observation.inventorySha256===r.inventorySha256&&observation.unityVersion===context.graph.unityVersion&&observation.complete===true&&observation.compilation?.state==='succeeded','Component Editor provenance changed','components_observation_invalid');
 check(fingerprint(request.components.map(c=>c.componentId).sort())===fingerprint([...r.componentIds].sort()),'Component observation selector mismatch','components_scope_invalid');
 if(!allowStage)check(r.graphRevision===context.graph.revision&&r.inventorySha256===fingerprint(context.graph.files),'Component source inventory changed; observe again','components_source_stale');
 return {...loaded,observation};
}
async function makePlan(toolkit,name,params,context){
 const observed=checkObservation(toolkit,name,params.observationId,context),ids=observed.record.componentIds,graph=await enrichComponentGraph(context.projectDir,focus(context.graph,context.p.graphFile,ids)),targets=targetsWithHints(graph,observed.observation,context.catalog),mappings=params.mappings??[];
 check(new Set(mappings.map(m=>m.componentId)).size===mappings.length&&mappings.every(m=>graph.nodes.some(n=>n.id===m.componentId&&n.classID===114)),'Mappings must select distinct observed script components; native mapping is unsupported','components_mapping_invalid');
 const resolution=resolveComponents({graph,targets,observation:observed.observation,mappings}),blockers=resolution.decisions.filter(d=>!['preserve','rebind'].includes(d.state)).map(d=>({componentId:d.componentId,code:d.reason}));
 const request={kind:'retoolkit-migration-request',schemaVersion:1,graphRevision:graph.revision,rebindings:resolution.decisions.filter(d=>d.state==='rebind').map(d=>({componentId:d.componentId,from:d.from,to:d.to})),fieldRenames:[]};
 return {observed,graph,targets,resolution,blockers,request};
}
export async function runComponentOperation(toolkit,name,command,params={},dependencies={}){
 const schema=componentDefinitions['components.'+command];check(schema,'Unknown component operation');validateSchema(params,{type:'object',additionalProperties:false,...schema});
 if(command==='report')return report(toolkit,name,params);
 check(!hasAssetSession(toolkit,name),'Stop AssetRipper before component operations','asset_session_active');const p=assetPaths(toolkit,name),lease=acquireToolchainRead(toolkit.root);let uncertain=false,marker;
 try{return await withWorkspaceLock(p.workspace,async()=>{try{
  const context=await current(toolkit,name),{selected,graph,projectDir}=context,catalog=await readLibraryCatalog(toolkit);context.catalog=catalog;
  const base={kind:'retoolkit-component-operation',schemaVersion:1,operationId:randomUUID(),command,binding:selected.binding,graphRevision:graph.revision,inventorySha256:fingerprint(graph.files),catalogRevision:catalog.revision,helperSha256:fileIdentity(helperFile(toolkit)).sha256,createdAt:new Date().toISOString()};
  if(command==='scan'){
   let reader;let inventory;try{reader=isSqliteGraph(graph)?openStoredGraph(graph,p.graphFile):null;inventory=inventoryComponents(reader?reader.readNodes():graph.nodes);}finally{reader?.close();}
   const privateGraph=await enrichComponentGraph(projectDir,{...graph,nodes:[],edges:[]}),targets=targetsWithHints(privateGraph,undefined,catalog);
   for(const group of inventory.groups){const source=privateGraph.assets.find(a=>a.guid===group.script?.guid),types=source?.script?.types??[];group.origin=group.classID!==114?'engine':source?.path.startsWith('Packages/')?'package':source?'project':'unresolved';group.path=source?.path??null;group.fullName=types.length===1?types[0].fullName:null;group.assembly=source?.script?.assembly??null;if(group.classID===114)group.libraries=libraryHints(group,catalog);group.binding='unverified';}
   return save(toolkit,name,{...base,state:'scanned',inventory,targets,limitations:['Opaque or stripped nodes without m_GameObject are outside serialized component coverage.','Static names and catalog hints do not establish implementation or binding.']});
  }
  if(command==='observe'){
   const cp=pathsFor(toolkit,name,base.operationId);let sourceGraph=graph,sourceProject=projectDir,graphFile=p.graphFile;
   if(params.stageOperationId){const directory=assertAssetPath(path.join(p.base,'migration',params.stageOperationId,'apply'),p.workspace),receipt=readJson(path.join(directory,'receipt.json')),{receiptSha256,...payload}=receipt;check(receipt.kind==='retoolkit-migration-receipt'&&receipt.operationId===params.stageOperationId&&receiptSha256===fingerprint(payload)&&fingerprint(receipt.binding)===fingerprint(selected.binding),'Invalid stage receipt','components_stage_invalid');sourceProject=path.join(directory,'project');await verifyGraphFiles(sourceProject,{files:receipt.files});if(fingerprint(receipt.files)!==fingerprint(graph.files))sourceGraph=await indexOwnedGraph(sourceProject,selected.binding,p,{storage:'sqlite'});}
   const scoped=await enrichComponentGraph(sourceProject,focus(sourceGraph,graphFile,params.componentIds));
   marker=path.join(p.workspace,'.retk-lock','components-'+base.operationId+'.json');writeJson(marker,{kind:'components-in-progress',operationId:base.operationId});
   toolkit.log(JSON.stringify({kind:'components-progress',phase:'editor.observe',componentCount:params.componentIds.length,operationId:base.operationId}));
   const runDir=path.join(cp.directory,'editor'),observed=await observeMigration({projectDir:sourceProject,graph:scoped,runDir,templateRoot:path.join(toolkit.root,'templates'),componentMode:true,editor:selected.project.unityEditorPath,lockDirectory:path.join(p.workspace,'.retk-lock'),toolkitRoot:toolkit.root,timeoutSeconds:params.timeoutSeconds??600},dependencies);
   writeJson(path.join(runDir,'observations.json'),observed.observation,{exclusive:true});
   check(fingerprint(selectedAssetBinding(toolkit,name).binding)===fingerprint(selected.binding),'Input build changed during component observation','components_source_stale');
   return save(toolkit,name,{...base,state:'observed',graphRevision:scoped.revision,inventorySha256:fingerprint(scoped.files),componentIds:params.componentIds,stageOperationId:params.stageOperationId??null,requestSha256:observed.requestSha256,processSha256:fingerprint(readJson(path.join(runDir,'process.json'))),observationSha256:fingerprint(observed.observation),targets:targetsWithHints(scoped,observed.observation,catalog),resolution:resolveComponents({graph:scoped,observation:observed.observation,targets:componentTargets(scoped,observed.observation)})});
  }
  if(command==='plan'){
   const plan=await makePlan(toolkit,name,params,context),record={...base,state:plan.blockers.length?'blocked':plan.request.rebindings.length?'planned':'no-change',componentIds:plan.observed.record.componentIds,observationId:params.observationId,mappings:params.mappings??[],targets:plan.targets,resolution:plan.resolution,blockers:plan.blockers};
   if(record.state==='planned'){
    const cp=pathsFor(toolkit,name,record.operationId),requestFile=path.join(cp.directory,'request.json');writeJson(requestFile,plan.request,{exclusive:true});
    try{record.migration=await runMigrationOperation(toolkit,name,'plan',{request:requestFile,observations:path.join(plan.observed.paths.directory,'editor/observations.json')});}
    catch(error){if(!String(error.code??'').startsWith('migration_'))throw error;record.state='blocked';record.blockers.push({code:error.code,message:error.message.slice(0,1024)});}
   }
   return save(toolkit,name,record);
  }
  const loaded=load(toolkit,name,params.operationId),plan=loaded.record;check(plan.command==='plan'&&(plan.migration&&plan.state==='planned'||plan.state==='no-change'),'Component operation is not an actionable saved plan','components_plan_blocked');
  if(plan.state==='no-change'){
   const rebuilt=await makePlan(toolkit,name,{observationId:params.observationId??plan.observationId,mappings:plan.mappings},context);check(plan.graphRevision===graph.revision&&!rebuilt.blockers.length&&!rebuilt.request.rebindings.length&&fingerprint(rebuilt.resolution)===fingerprint(plan.resolution),'Preserved component plan is stale','components_plan_stale');
   return {...summary(plan,loaded.paths),valid:true,compileReady:command==='verify',bindingsVerified:command==='verify',scope:'selected-component-bindings',nextAction:{operation:'reconstruct.validate',params:{assetIds:[...new Set(plan.componentIds.map(id=>'asset:'+id.split(':')[1]))]}}};
  }
  if(command==='apply'){
   check(plan.graphRevision===graph.revision&&plan.inventorySha256===fingerprint(graph.files)&&plan.helperSha256===base.helperSha256&&plan.catalogRevision===base.catalogRevision,'Component plan/source/helper/catalog changed','components_plan_stale');
   const rebuilt=await makePlan(toolkit,name,{observationId:plan.observationId,mappings:plan.mappings},context);
   check(!rebuilt.blockers.length&&fingerprint(rebuilt.resolution)===fingerprint(plan.resolution)&&fingerprint(rebuilt.targets)===fingerprint(plan.targets),'Component mapping changed; create a fresh plan','components_plan_stale');
   const request=readJson(path.join(loaded.paths.directory,'request.json')),migrationPlan=readJson(path.join(p.workspace,plan.migration.storedPlan));check(fingerprint(request)===fingerprint(rebuilt.request)&&fingerprint(migrationPlan.request)===fingerprint(rebuilt.request),'Component migration request changed','components_plan_stale');
   const result=await runMigrationOperation(toolkit,name,'apply',{plan:path.join(p.workspace,plan.migration.storedPlan),observations:path.join(p.workspace,plan.migration.storedObservations)});return {...result,componentPlanId:plan.operationId};
  }
  const receiptFile=assertAssetPath(path.join(p.base,'migration',plan.migration.operationId,'apply/receipt.json'),p.workspace);let observations,allBindings=false;
  if(params.observationId){const fresh=checkObservation(toolkit,name,params.observationId,context,{allowStage:true}),receipt=readJson(receiptFile);check(fresh.record.inventorySha256===fingerprint(receipt.files)&&(!fresh.record.stageOperationId||fresh.record.stageOperationId===plan.migration.operationId)&&plan.componentIds.every(id=>fresh.record.componentIds.includes(id)),'Verification observation is stale or describes another stage/inventory','components_observation_stale');observations=path.join(fresh.paths.directory,'editor/observations.json');
   allBindings=plan.resolution.decisions.every(decision=>{const rows=fresh.observation.components.filter(c=>c.componentId===decision.componentId);if(rows.length!==1)return false;const row=rows[0];if(decision.classID!==114)return row.native===true&&row.fullName===decision.fullName&&row.assembly===decision.assembly;const wanted=decision.to??decision.from;return row.script&&fingerprint(identityOf(row.script))===fingerprint(wanted)&&fresh.observation.scripts.filter(s=>s.fullName===wanted.fullName).length===1;});
  }
  const result=await runMigrationOperation(toolkit,name,'verify',{receipt:receiptFile,...(observations?{observations}:{})});return {...result,bindingsVerified:result.bindingsVerified===true&&allBindings,componentPlanId:plan.operationId,scope:'selected-component-bindings',gameplay:'unverified',nextAction:observations?{operation:'reconstruct.validate',params:{assetIds:[...new Set(plan.componentIds.map(id=>'asset:'+id.split(':')[1]))]}}:{operation:'components.observe',params:{componentIds:plan.componentIds,stageOperationId:plan.migration.operationId}}};
 }catch(error){uncertain=error.preserveToolchainGate===true||['unity_recovery_required','migration_recovery_required'].includes(error.code);throw error;}
 finally{if(!uncertain&&marker)fs.rmSync(marker,{force:true});}});}
 finally{if(!uncertain)lease.release();}
}
