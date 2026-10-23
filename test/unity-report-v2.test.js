import test from 'node:test';
import assert from 'node:assert/strict';
import {validateUnityObservation,validateUnityRequest} from '../src/unity/report.js';
function fixture(){
 const guid='a'.repeat(32),request={kind:'retoolkit-unity-validation-request',schemaVersion:1,runId:'11111111-1111-4111-8111-111111111111',graphRevision:'b'.repeat(64),binding:{native:{sha256:'c'.repeat(64),size:1},metadata:{sha256:'d'.repeat(64),size:2},assetsSha256:'e'.repeat(64)},unityVersion:'2022.3.62f2',scanPolicy:'reference-scan-v2',scripts:[{assetId:`asset:${guid}`,path:'Assets/Test.cs'}],assets:[{assetId:'scene',path:'Assets/Test.unity',kind:'scene'}]};
 const report={kind:'retoolkit-unity-observation',schemaVersion:1,runId:request.runId,graphRevision:request.graphRevision,unityVersion:request.unityVersion,complete:false,compilation:{state:'succeeded'},traversal:{policy:'reference-scan-v2'},scripts:[{...request.scripts[0],guid,fileID:'11500000',fullName:'Example.Test',assembly:'Assembly-CSharp',resolved:true,classification:'attachable'}],assets:[{...request.assets[0],loaded:true,missingScripts:0,missingReferences:0,traversal:{complete:false,objects:1,properties:200000,skippedSubtrees:1,stopReason:'property_limit',objectPath:'Root',componentType:'Example.Test',propertyPath:'values.Array.data[1]'}}],diagnostics:[]};
 return {request,report};
}

test('v2 accepts .asset table observations only with exact kind/path and explicit traversal coverage',()=>{
 const {request,report}=fixture();request.assets=[{assetId:'table',path:'Assets/Slots.asset',kind:'asset'}];Object.assign(report.assets[0],request.assets[0]);
 assert.doesNotThrow(()=>validateUnityRequest(request));assert.equal(validateUnityObservation(report,request),report);
 for(const change of [r=>delete r.report.traversal,r=>r.report.assets[0].kind='prefab',r=>r.request.assets[0].path='Assets/Slots.mat',r=>delete r.request.scanPolicy]){const pair=structuredClone({request,report});change(pair);assert.throws(()=>validateUnityObservation(pair.report,pair.request),{code:'unity_report_invalid'});}
});
test('v2 rejects contradictory traversal completion, unversioned extensions and hostile counters/locations',()=>{
 for(const mutation of [
  p=>p.request.scanPolicy='future-policy',p=>p.report.traversal.policy='future-policy',p=>delete p.request.scanPolicy,
  p=>delete p.report.traversal,p=>delete p.report.assets[0].traversal,p=>p.report.traversal.extra=true,
  p=>p.report.complete=true,p=>p.report.assets[0].traversal.complete=true,p=>p.report.assets[0].traversal.stopReason='',
  p=>p.report.assets[0].traversal.stopReason='unknown',p=>p.report.assets[0].traversal.objects=200001,
  p=>p.report.assets[0].traversal.properties=-1,p=>p.report.assets[0].traversal.properties=2000001,p=>p.report.assets[0].traversal.skippedSubtrees=0.5,
  p=>p.report.assets[0].traversal.skippedSubtrees=200001,
  p=>p.report.assets[0].traversal.propertyPath='x'.repeat(2049),p=>p.report.assets[0].traversal.objectPath='bad\u0000path',
  p=>p.report.assets[0].traversal.extra=true,
  p=>p.report.scripts[0].classification='safe',p=>p.report.scripts[0].classification='compiled-source',p=>p.report.scripts[0].classification='unresolved'
 ]){const pair=fixture();mutation(pair);assert.throws(()=>validateUnityObservation(pair.report,pair.request),{code:'unity_report_invalid'},mutation.toString());}
});
test('v2 distinguishes reflected nonattachable class identity from compiled source membership',()=>{
 const pair=fixture(),row=pair.report.scripts[0];row.classification='non-attachable';assert.equal(validateUnityObservation(pair.report,pair.request),pair.report);
 Object.assign(row,{classification:'compiled-source',fullName:null,resolved:false});assert.equal(validateUnityObservation(pair.report,pair.request),pair.report);
 for(const change of [{assembly:null},{guid:null},{fileID:null},{resolved:true},{fullName:'Example.Test'}]){
  const before={...row};Object.assign(row,change);assert.throws(()=>validateUnityObservation(pair.report,pair.request),{code:'unity_report_invalid'});Object.assign(row,before);
 }
});
test('v2 completion is explicit for every asset even when global report is incomplete',()=>{
 const pair=fixture();Object.assign(pair.report.assets[0].traversal,{complete:true,stopReason:'',objects:200000,properties:2000000,skippedSubtrees:2000000});
 assert.equal(validateUnityObservation(pair.report,pair.request),pair.report);
 pair.report.complete=true;assert.equal(validateUnityObservation(pair.report,pair.request),pair.report);
 pair.report.assets[0].loaded=false;assert.throws(()=>validateUnityObservation(pair.report,pair.request),{code:'unity_report_invalid'});
});
