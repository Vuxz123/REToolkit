import fs from 'node:fs';
import path from 'node:path';
import {fingerprint,fileIdentity} from '../state.js';
import {assetPaths,assertAssetPath,assetError} from '../assets/context.js';
import {readJson,unseal,uuid} from '../recovery/artifacts.js';
import {validateUnityObservation,validateUnityRequest} from '../unity/report.js';
import {compareDataSnapshots} from './contracts.js';
import {readBaselineQualification} from './qualification.js';
import {assertReferenceComparisonPolicy,atomicReferencePolicy} from './reference-policy.js';

export const check=(ok,message,code='data_contract_invalid')=>{if(!ok)throw assetError(code,message);};
export function dataPaths(toolkit,name,operationId){const paths=assetPaths(toolkit,name);check(uuid(operationId),'Expected data operation UUID');const directory=assertAssetPath(path.join(paths.base,'data-contracts',operationId),paths.workspace);return {...paths,directory,receipt:path.join(directory,'receipt.json'),data:path.join(directory,'data.json')};}
export function readCapturedValidation(toolkit,name,operationId){
 check(uuid(operationId),'Expected validation operation UUID');const paths=assetPaths(toolkit,name),base=assertAssetPath(path.join(paths.base,'unity-validation',operationId),paths.workspace);
 const receipt=readJson(path.join(base,'receipt.json'),32*1024**2),{receiptSha256,...payload}=receipt;
 check(receipt.kind==='retoolkit-unity-validation'&&receipt.operationId===operationId&&receiptSha256===fingerprint(payload),'Validation receipt changed');
 if(!receipt.requestSha256)return {receipt,rows:[],ready:false,reason:'unity_validation_unavailable'};
 const requestFile=path.join(base,'request.json');check(fileIdentity(requestFile).sha256===receipt.requestSha256,'Data validation request changed');const request=readJson(requestFile,16*1024**2);validateUnityRequest(request);
 check(request.dataCapture===true&&request.runId===operationId&&request.graphRevision===receipt.graphRevision&&request.unityVersion===receipt.unityVersion&&fingerprint(request.binding)===fingerprint(receipt.binding),'Data validation binding differs');
 check(receipt.scope?.kind==='assets'&&fingerprint([...request.assets.map(a=>a.assetId)].sort())===fingerprint(receipt.scope.assetIds),'Data validation scope differs');
 if(!receipt.observationSha256)return {receipt,request,rows:[],ready:false,reason:'unity_data_observation_unavailable'};
 const file=path.join(base,'observation.json');check(fileIdentity(file).sha256===receipt.observationSha256,'Data observation bytes changed');const observation=validateUnityObservation(readJson(file,16*1024**2),request);
 const rows=observation.assets.map(a=>({assetId:a.assetId,path:a.path,data:a.data}));
 let ready=receipt.compileReady===true&&receipt.scopeBindingsVerified===true&&receipt.process?.closed===true&&receipt.process.exitCode===0&&!receipt.process.timedOut&&observation.complete&&observation.compilation.state==='succeeded'&&!observation.diagnostics.some(d=>d.severity==='error');
 const scripts=new Map(observation.scripts.filter(s=>s.resolved).map(s=>[s.guid.toLowerCase()+':'+s.fileID,s]));let scriptable=0;
 for(const row of rows){if(!row.data?.complete)ready=false;for(const o of row.data?.objects??[])if(o.scriptable){scriptable++;const ref=o.properties.find(p=>p.path==='m_Script'&&p.kind==='ObjectReference'),script=scripts.get(ref?.value?.toLowerCase());if(!script||script.fullName!==o.fullName||script.assembly!==o.assembly)ready=false;}}
 ready=Boolean(ready&&scriptable>0&&rows.length===request.assets.length);
 return {receipt,request,observation,rows,ready,reason:ready?null:'data_coverage_or_script_identity_unverified'};
}
export function loadDataContract(toolkit,name,operationId){
 const paths=dataPaths(toolkit,name,operationId),receipt=unseal(readJson(paths.receipt,16*1024**2));
 check(receipt.kind==='retoolkit-data-contract'&&receipt.schemaVersion===1&&receipt.operationId===operationId&&['capture','verify'].includes(receipt.command),'Invalid data contract');
 check(Array.isArray(receipt.rawFiles)&&receipt.rawFiles.length===receipt.assetIds.length*2&&new Set(receipt.rawFiles.map(f=>f.path)).size===receipt.rawFiles.length,'Invalid data file inventory');
 if(receipt.command==='capture')for(const f of receipt.rawFiles){check(typeof f.path==='string'&&/^Assets\/.+\.asset(?:\.meta)?$/i.test(f.path)&&!f.path.includes('\\')&&f.path.split('/').every(s=>s&&s!=='.'&&s!=='..'),'Unsafe raw data path');const file=assertAssetPath(path.join(paths.directory,'raw',f.path),paths.directory),identity=fileIdentity(file);check(identity.size===f.size&&identity.sha256===f.sha256,'Raw data baseline changed','data_raw_changed');}
 const data=unseal(readJson(paths.data,32*1024**2));check(data.kind==='retoolkit-data-snapshot'&&data.operationId===operationId&&fingerprint(data)===receipt.dataSha256,'Data snapshot changed');
 const evidence=readCapturedValidation(toolkit,name,receipt.validationOperationId);
 // A missing-Editor capture retains raw bytes but has no executed helper or
 // typed observation to attest. It must remain readable and unqualified.
 const noEditorPacket=!evidence.receipt.requestSha256&&!evidence.receipt.observationSha256&&!evidence.receipt.compileReady;
 check(fingerprint(evidence.receipt)===receipt.validationReceiptSha256&&evidence.receipt.graphRevision===receipt.graphRevision&&fingerprint(evidence.receipt.binding)===fingerprint(receipt.binding)&&(noEditorPacket||evidence.receipt.helperSha256===receipt.helperSha256),'Data provenance/helper differs');
 check(fingerprint(data.assets)===fingerprint(evidence.rows)&&evidence.ready===receipt.dataCaptureComplete,'Data rows or coverage changed');
 if(evidence.request)check(fingerprint(receipt.assetIds)===fingerprint(evidence.request.assets.map(a=>a.assetId).sort()),'Saved data scope changed');
 if(receipt.command==='capture')check(receipt.baselineId===operationId&&receipt.dataPreserved===false,'Baseline is not verification');
 else{
  check(uuid(receipt.baselineId)&&receipt.baselineId!==operationId,'Invalid baseline identity');const p=dataPaths(toolkit,name,receipt.baselineId),b=unseal(readJson(p.receipt,16*1024**2));check(b.command==='capture','Verification requires an original baseline');
  const baseline=loadDataContract(toolkit,name,receipt.baselineId),qualification=receipt.baselineQualificationId?readBaselineQualification(toolkit,baseline):null;
  check(!receipt.baselineQualificationId||qualification?.operationId===receipt.baselineQualificationId&&fingerprint(qualification)===receipt.baselineQualificationSha256,'Baseline qualification changed');
  check(fingerprint(baseline.receipt)===receipt.baselineReceiptSha256&&(baseline.receipt.dataCaptureComplete||qualification?.dataCaptureComplete)&&fingerprint(baseline.receipt.binding)===fingerprint(receipt.binding)&&fingerprint(baseline.receipt.assetIds)===fingerprint(receipt.assetIds)&&(baseline.receipt.helperSha256===receipt.helperSha256||qualification?.dataCaptureComplete),'Baseline changed or scope differs');
  if(receipt.comparisonPolicy)assertReferenceComparisonPolicy(receipt.comparisonPolicy,toolkit,name,baseline,evidence);
  if(receipt.reusedVerificationId){
   check(uuid(receipt.reusedVerificationId)&&receipt.reusedVerificationId!==operationId,'Invalid reused verification identity');
   const prior=dataPaths(toolkit,name,receipt.reusedVerificationId),r=unseal(readJson(prior.receipt,16*1024**2));check(r.command==='verify'&&!r.reusedVerificationId&&r.operationId===receipt.reusedVerificationId&&fingerprint(r)===receipt.reusedVerificationReceiptSha256,'Reused verification provenance changed');
   const original=loadDataContract(toolkit,name,receipt.reusedVerificationId);check(original.receipt.dataCaptureComplete&&original.evidence.ready&&r.baselineId===receipt.baselineId&&r.graphRevision===receipt.graphRevision&&r.validationOperationId===receipt.validationOperationId&&fingerprint(original.rows)===fingerprint(data.assets)&&fingerprint(r.binding)===fingerprint(receipt.binding)&&fingerprint(r.assetIds)===fingerprint(receipt.assetIds)&&receipt.comparisonPolicy&&receipt.evaluationHelperSha256===receipt.comparisonPolicy.evaluationHelperSha256,'Reused data packet/candidate differs');
  }
  const comparison=compareDataSnapshots(baseline.rows,data.assets,receipt.comparisonPolicy?{referencePolicy:atomicReferencePolicy}:{});
  check(fingerprint(comparison)===fingerprint(receipt.comparison)&&receipt.dataPreserved===(evidence.ready&&comparison.dataPreserved)&&receipt.schemaCompatible===(evidence.ready&&comparison.complete&&comparison.counts.schema===0),'Data comparison changed');
 }
 return {paths,receipt,rows:data.assets,evidence};
}
