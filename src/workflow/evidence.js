import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fingerprint} from '../state.js';
import {assertAssetPath} from '../assets/context.js';
import {readJson} from '../recovery/artifacts.js';
import {check} from './store.js';
import {verifyReconstruction} from '../reconstruction/plan.js';
import {createValidationSourceSnapshot} from '../assets/validation-snapshot.js';
import {readUnityValidation} from '../unity/validation.js';

// Job result bytes must match the durable worker reference. Large results are
// read here only after the bounded reference and exact path have been checked.
export function jobResult(workspace,job){
 const ref=job.resultReference,expected=`04_Notes/jobs/${job.jobId}/result.json`;
 check(ref?.path===expected&&ref.bytes<=128*1024**2,'Missing bound job result','workflow_evidence_invalid');
 const file=assertAssetPath(path.join(workspace,expected),workspace),stat=fs.lstatSync(file);check(stat.isFile()&&stat.nlink===1&&stat.size===ref.bytes,'Job result changed','workflow_evidence_invalid');
 const bytes=fs.readFileSync(file);check(bytes.length===ref.bytes&&createHash('sha256').update(bytes).digest('hex')===ref.sha256,'Job result hash changed','workflow_evidence_invalid');return JSON.parse(bytes);
}
export function jobRequest(workspace,job){
 const request=readJson(assertAssetPath(path.join(workspace,'04_Notes/jobs',job.jobId,'request.json'),workspace),1024**2+8192);
 check(request.jobId===job.jobId&&request.workspace===workspace&&request.operation===job.operation,'Job request binding changed','workflow_evidence_invalid');return request;
}
export function effectiveOperation(r,job,request){
 check(r.authorizedOperations.includes(job.operation),'Job operation outside saved task','workflow_scope_invalid');
 if(job.operation==='recovery.run'){
  check(r.candidate.artifactId&&request.params.artifactId===r.candidate.artifactId,'Job artifact differs','workflow_scope_invalid');
  check(r.authorizedOperations.includes(request.params.operation),'Nested operation outside saved task','workflow_scope_invalid');return request.params.operation;
 }
 check(!r.candidate.artifactId,'Direct command targets a different output branch','workflow_scope_invalid');return job.operation;
}
export async function acceptance(step,operation,result,candidate){
 if(operation==='recovery.run')throw Error('Expected effective domain operation');
 const value=result?.result&&result.artifactId?result.result:result;
 if(step.dimension==='data'&&operation==='data.verify'){
  const {verifyDataAcceptance}=await import('../data/service.js');
  return verifyDataAcceptance({toolkit:candidate.toolkit,name:candidate.name,operationId:value.operationId,baselineId:step.baselineId,assetIds:step.assetIds,projectDir:candidate.project});
 }
 if(step.dimension==='source'&&['reconstruct.apply','reconstruct.verify'].includes(operation)){
  const id=value.operationId;check(typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id),'Missing source operation identity','workflow_evidence_invalid');
  const file=assertAssetPath(path.join(candidate.base,'reconstruction/journal',id,'receipt.json'),candidate.base),receipt=readJson(file);
  check(fingerprint(receipt.binding)===fingerprint(candidate.binding),'Source receipt input differs','workflow_evidence_invalid');
  const verified=await verifyReconstruction({projectDir:candidate.project,receipt});check(verified.valid,'Source receipt is stale','workflow_evidence_invalid');
  if(!step.sourcePaths?.every(p=>receipt.changes.some(c=>c.path===p)))return {verified:false,reason:'source_scope_incomplete'};
  const changed=new Set(receipt.changes.flatMap(c=>[c.path,c.path+'.meta']));return {verified:true,reference:path.relative(candidate.base,file),operationId:id,files:candidate.files.filter(f=>changed.has(f.path))};
 }
 if(['compilation','bindings'].includes(step.dimension)&&['reconstruct.validate','data.capture','data.verify'].includes(operation)){
  const id=operation.startsWith('data.')?value.validationOperationId:value.operationId;check(typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id),'Missing validation identity','workflow_evidence_invalid');
  if(operation.startsWith('data.')){const {loadDataContract}=await import('../data/provenance.js');const {receipt}=loadDataContract(candidate.toolkit,candidate.name,value.operationId);check(receipt.validationOperationId===id&&receipt.projectDir===candidate.project,'Data job validation belongs to another candidate','workflow_evidence_invalid');}
  const file=assertAssetPath(path.join(candidate.base,'unity-validation',id,'receipt.json'),candidate.base);
  // The existing verifier rechecks the exact source snapshot, receipt, request,
  // observation and checkpoint hashes. Do not create a second acceptance rule.
  const graph=await createValidationSourceSnapshot({projectDir:candidate.project,binding:candidate.binding});
  const receipt=await readUnityValidation({toolkit:candidate.toolkit,name:candidate.name,projectDir:candidate.project,graph,operationId:id});
  if(!receipt.process?.closed||receipt.process.exitCode!==0||receipt.process.timedOut||!receipt.compileReady)return {verified:false,reason:'validation_not_ready'};
  if(step.dimension==='bindings')check(step.assetIds?.length&&step.assetIds.every(id=>receipt.scope.assetIds.includes(id)),'Validation does not cover saved asset scope','workflow_scope_invalid');
  return {verified:step.dimension==='compilation'||receipt.scopeBindingsVerified===true,reference:path.relative(candidate.base,file),operationId:id};
 }
 // No generic gameplay engine exists. Notes and a green compiler are never
 // promoted into verified gameplay; a future runner needs its own attestation.
 return {verified:false,reason:step.dimension==='gameplay'?'gameplay_observation_required':'job_is_not_acceptance'};
}
