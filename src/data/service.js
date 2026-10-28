import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fingerprint,fileIdentity,withWorkspaceLock} from '../state.js';
import {assetPaths,assetProjectPath,selectedAssetBinding,assertAssetPath} from '../assets/context.js';
import {createValidationSourceSnapshot} from '../assets/validation-snapshot.js';
import {verifyGraphFiles} from '../assets/graph.js';
import {runAssetOperation} from '../assets/service.js';
import {readUnityValidation} from '../unity/validation.js';
import {validateSchema} from '../jobs/definitions.js';
import {readJson,writeJson,seal,page} from '../recovery/artifacts.js';
import {dataDefinitions} from './definitions.js';
import {compareDataSnapshots,valuePreview} from './contracts.js';
import {dataPaths,check,loadDataContract,readCapturedValidation} from './provenance.js';
import {qualifyDataBaseline,readBaselineQualification} from './qualification.js';
import {referenceComparisonPolicy,atomicReferencePolicy} from './reference-policy.js';

function summary(receipt,paths){const {binding,comparison,rawFiles,...value}=receipt;return {...value,rawFilesCount:rawFiles?.length??0,...(receipt.command==='capture'?{storedRaw:path.relative(paths.workspace,path.join(paths.directory,'raw')).split(path.sep).join('/')} : {}),...(comparison?{differenceCount:comparison.differenceCount,counts:comparison.counts,differences:comparison.differences.slice(0,5),differencesTruncated:comparison.differenceCount>5,...(comparison.normalization?{referenceNormalization:comparison.normalization}:{})}:{}),storedReceipt:path.relative(paths.workspace,paths.receipt).split(path.sep).join('/'),storedData:path.relative(paths.workspace,paths.data).split(path.sep).join('/'),runtimeInitialized:'unverified',gameplay:'unverified'};}
function report(toolkit,name,params){
 const loaded=loadDataContract(toolkit,name,params.operationId),{receipt,rows,paths}=loaded,section=params.section??'summary';
 if(section==='summary')return {...summary(receipt,paths),freshness:'not-rechecked'};
 let items;if(section==='differences')items=receipt.comparison?.differences??[];
 else items=rows.flatMap(a=>a.data.objects.flatMap(o=>section==='objects'?[{assetId:a.assetId,path:a.path,guid:o.guid,fileID:o.fileID,fullName:o.fullName,assembly:o.assembly,scriptable:o.scriptable,complete:o.complete,propertyCount:o.properties.length}]:o.properties.map(p=>({assetId:a.assetId,objectFileID:o.fileID,...p,value:valuePreview(p.value,p.kind)}))));
 return {kind:'retoolkit-data-report',operationId:receipt.operationId,section,...page(items,params,fingerprint({operationId:receipt.operationId,section,data:receipt.dataSha256})),...(section==='differences'?{differenceCount:receipt.comparison?.differenceCount??0,differencesTruncated:receipt.comparison?.differencesTruncated??false}: {})};
}
export async function runDataOperation(toolkit,name,command,params={},dependencies={}){
 const schema=dataDefinitions['data.'+command];check(schema,'Unknown data operation');validateSchema(params,{type:'object',additionalProperties:false,...schema});
 if(command==='report')return report(toolkit,name,params);
 const paths=assetPaths(toolkit,name);return withWorkspaceLock(paths.workspace,async()=>{
  if(command==='qualify'){const baseline=loadDataContract(toolkit,name,params.baselineId),selected=selectedAssetBinding(toolkit,name);check(fingerprint(baseline.receipt.binding)===fingerprint(selected.binding),'Baseline belongs to a different input build','data_baseline_stale');return qualifyDataBaseline(toolkit,name,baseline);}
  const selected=selectedAssetBinding(toolkit,name),projectDir=assetProjectPath(toolkit,name,selected),graph=await createValidationSourceSnapshot({projectDir,binding:selected.binding}),helper=assertAssetPath(path.join(toolkit.root,'templates/Unity/REToolkitValidation.cs')),helperSha256=fileIdentity(helper).sha256;
  let baseline=null;const assetIds=command==='capture'?[...params.assetIds].sort():(baseline=loadDataContract(toolkit,name,params.baselineId)).receipt.assetIds;
  check(new Set(assetIds).size===assetIds.length&&assetIds.every(id=>graph.assets.some(a=>a.id===id&&a.kind==='asset'&&a.guid)),'Data scope requires exact exported .asset GUIDs','data_scope_invalid');
  const qualification=baseline&&(!baseline.receipt.dataCaptureComplete||baseline.receipt.helperSha256!==helperSha256)?readBaselineQualification(toolkit,baseline):null;
  if(baseline)check(baseline.receipt.command==='capture'&&(baseline.receipt.dataCaptureComplete||qualification?.dataCaptureComplete)&&fingerprint(baseline.receipt.binding)===fingerprint(selected.binding)&&(baseline.receipt.helperSha256===helperSha256||qualification?.dataCaptureComplete),'Baseline is partial, from another build or uses a different helper; use data qualify for retained complete typed observations','data_baseline_stale');
  const reused=params.reuseVerificationId?loadDataContract(toolkit,name,params.reuseVerificationId):null;
  if(reused)check(reused.receipt.command==='verify'&&!reused.receipt.reusedVerificationId&&reused.receipt.baselineId===params.baselineId&&reused.receipt.dataCaptureComplete&&reused.evidence.ready&&reused.receipt.graphRevision===graph.revision&&reused.receipt.sourceInventorySha256===fingerprint(graph.files)&&fingerprint(reused.receipt.binding)===fingerprint(selected.binding)&&fingerprint(reused.receipt.assetIds)===fingerprint(assetIds),'Stored verification is incomplete, stale or from another candidate/scope','data_observation_stale');
  const operationId=randomUUID(),p=dataPaths(toolkit,name,operationId);fs.mkdirSync(p.directory,{recursive:true});
  writeJson(path.join(p.directory,'intent.json'),seal({command,operationId,assetIds,baselineId:params.baselineId??operationId,graphRevision:graph.revision}),{exclusive:true});
  const assetPathsSet=new Set(graph.assets.filter(a=>assetIds.includes(a.id)).flatMap(a=>[a.path,a.path+'.meta'])),rawFiles=graph.files.filter(f=>assetPathsSet.has(f.path));
  check(rawFiles.length===assetIds.length*2,'Data capture requires each exact .asset and .meta pair','data_scope_invalid');
  if(command==='capture')for(const file of rawFiles){const from=assertAssetPath(path.join(projectDir,file.path),projectDir),to=assertAssetPath(path.join(p.directory,'raw',file.path),p.directory);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);const copy=fileIdentity(to);check(copy.sha256===file.sha256&&copy.size===file.size,'Raw data changed during baseline copy','data_raw_changed');}
  const validation=reused?{operationId:reused.receipt.validationOperationId,state:'validated'}:await runAssetOperation(toolkit,name,'reconstruct.validate',{assetIds,dataCapture:true,...(params.timeoutSeconds?{timeoutSeconds:params.timeoutSeconds}:{})},dependencies);
  await verifyGraphFiles(projectDir,graph);check(fingerprint(selectedAssetBinding(toolkit,name).binding)===fingerprint(selected.binding),'Input build changed during data capture','data_input_stale');check(fileIdentity(helper).sha256===helperSha256,'Data helper changed during capture','data_helper_stale');
  // A fresh domain read verifies current source plus the normal Unity artifacts.
  await readUnityValidation({toolkit,name,projectDir,graph,operationId:validation.operationId});
  const captured=readCapturedValidation(toolkit,name,validation.operationId),data={kind:'retoolkit-data-snapshot',schemaVersion:1,operationId,assets:captured.rows};
  const comparisonPolicy=baseline&&captured.ready?referenceComparisonPolicy(toolkit,name,baseline,captured):null;
  writeJson(p.data,seal(data),{exclusive:true});const comparison=baseline?compareDataSnapshots(baseline.rows,captured.rows,comparisonPolicy?{referencePolicy:atomicReferencePolicy}:{}):null;
  const dataPreserved=Boolean(baseline&&captured.ready&&comparison.dataPreserved),state=validation.state==='blocked'?'blocked':!captured.ready?'partial':baseline?dataPreserved?'verified':'changed':'captured';
  const receipt={kind:'retoolkit-data-contract',schemaVersion:1,operationId,command,baselineId:params.baselineId??operationId,assetIds,rawFiles,binding:selected.binding,graphRevision:graph.revision,sourceInventorySha256:fingerprint(graph.files),projectDir,helperSha256,validationOperationId:validation.operationId,validationReceiptSha256:fingerprint(captured.receipt),dataSha256:fingerprint(data),dataCaptureComplete:captured.ready,dataPreserved,schemaCompatible:Boolean(baseline&&captured.ready&&comparison.complete&&comparison.counts.schema===0),state,reason:captured.reason,createdAt:new Date().toISOString(),coverage:{scope:'selected-scriptable-objects',assets:captured.rows.length,objects:captured.rows.reduce((n,a)=>n+a.data.objects.length,0),scriptableObjects:captured.rows.reduce((n,a)=>n+a.data.objects.filter(o=>o.scriptable).length,0),properties:captured.rows.reduce((n,a)=>n+a.data.objects.reduce((m,o)=>m+o.properties.length,0),0),unsupportedProperties:captured.rows.reduce((n,a)=>n+a.data.unsupportedProperties,0)},...(baseline?{baselineReceiptSha256:fingerprint(baseline.receipt),comparison}:{})};
  if(qualification){receipt.baselineQualificationId=qualification.operationId;receipt.baselineQualificationSha256=fingerprint(qualification);}
  if(comparisonPolicy)receipt.comparisonPolicy=comparisonPolicy;
  if(reused){receipt.helperSha256=captured.receipt.helperSha256;receipt.evaluationHelperSha256=helperSha256;receipt.reusedVerificationId=reused.receipt.operationId;receipt.reusedVerificationReceiptSha256=fingerprint(reused.receipt);}
  writeJson(p.receipt,seal(receipt),{exclusive:true});return summary(receipt,p);
 });
}
export async function verifyDataAcceptance({toolkit,name,operationId,baselineId,assetIds,projectDir}){
 let loaded;try{loaded=loadDataContract(toolkit,name,operationId);}catch(error){if(['data_reference_policy_invalid','data_qualification_stale','data_baseline_stale'].includes(error.code))throw Object.assign(Error('Data policy/helper or baseline evidence is stale'),{code:'data_observation_stale',cause:error});throw error;}const r=loaded.receipt;
 check(r.command==='verify'&&r.baselineId===baselineId,'Data verification uses a different baseline','data_acceptance_unverified');
 check(fingerprint([...assetIds].sort())===fingerprint(r.assetIds),'Data scope differs from saved step','data_scope_invalid');
 const selected=selectedAssetBinding(toolkit,name),graph=await createValidationSourceSnapshot({projectDir,binding:selected.binding});
 const currentHelper=fileIdentity(path.join(toolkit.root,'templates/Unity/REToolkitValidation.cs')).sha256;
 check(path.resolve(r.projectDir)===path.resolve(projectDir)&&r.graphRevision===graph.revision&&r.sourceInventorySha256===fingerprint(graph.files)&&(r.helperSha256===currentHelper||r.reusedVerificationId&&r.comparisonPolicy&&r.evaluationHelperSha256===currentHelper),'Data observation belongs to another candidate','data_observation_stale');
 await readUnityValidation({toolkit,name,projectDir,graph,operationId:r.validationOperationId});return {verified:r.dataPreserved&&r.state==='verified',...(r.dataPreserved?{}:{reason:'data_not_preserved'}),operationId:r.operationId,baselineId:r.baselineId,reference:path.relative(loaded.paths.base,loaded.paths.receipt).split(path.sep).join('/')};
}
