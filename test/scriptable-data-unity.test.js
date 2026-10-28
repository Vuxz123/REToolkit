import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {validateUnityObservation,validateUnityRequest} from '../src/unity/report.js';
import {stageUnityProject} from '../src/unity/validation.js';
import {fixture} from './reconstruction-fixture.js';
import {dataSnapshot} from './helpers/scriptable-data.js';
const guid='b'.repeat(32);
function pair(){
 const request={kind:'retoolkit-unity-validation-request',schemaVersion:1,runId:'11111111-1111-4111-8111-111111111111',graphRevision:'a'.repeat(64),unityVersion:'2022.3.1f1',binding:{native:{sha256:'c'.repeat(64),size:1},metadata:{sha256:'d'.repeat(64),size:1},assetsSha256:'e'.repeat(64)},scanPolicy:'reference-scan-v2',dataCapture:true,scripts:[],assets:[{assetId:'asset:'+guid,path:'Assets/Level.asset',kind:'asset'}]};
 const report={kind:'retoolkit-unity-observation',schemaVersion:1,runId:request.runId,graphRevision:request.graphRevision,unityVersion:request.unityVersion,complete:true,traversal:{policy:'reference-scan-v2'},compilation:{state:'succeeded'},scripts:[],diagnostics:[],assets:[{...request.assets[0],loaded:true,missingScripts:0,missingReferences:0,traversal:{complete:true,objects:1,properties:5,skippedSubtrees:0,stopReason:'',objectPath:'',componentType:'',propertyPath:''},data:dataSnapshot()}]};return {request,report};
}
test('Unity data capture is opt-in and complete values are bound to exact asset identity',()=>{
 const {request,report}=pair();assert.doesNotThrow(()=>validateUnityRequest(request));assert.equal(validateUnityObservation(report,request),report);
 for(const change of [p=>delete p.report.assets[0].data,p=>p.report.assets[0].data.objects[0].guid='f'.repeat(32),p=>p.request.dataCapture=false,p=>p.request.dataCapture='true']){const p=pair();change(p);assert.throws(()=>validateUnityObservation(p.report,p.request));}
});
test('partial data is independent of successful reference traversal',()=>{
 const p=pair(),d=p.report.assets[0].data;d.complete=false;d.objects[0].complete=false;d.objects[0].properties.push({path:'curve',kind:'AnimationCurve',type:'AnimationCurve',value:null});d.unsupportedProperties=1;
 assert.equal(validateUnityObservation(p.report,p.request).assets[0].data.complete,false);
});
test('ordinary reference-only Unity reports retain the previous strict wire format',()=>{
 const p=pair();delete p.request.dataCapture;delete p.report.assets[0].data;assert.equal(validateUnityObservation(p.report,p.request),p.report);
 p.request.dataCapture=true;assert.throws(()=>validateUnityObservation(p.report,p.request));
});
test('dataCapture is included in the sealed staged request without changing source assets',async t=>{
 const f=await fixture(t);fs.writeFileSync(path.join(f.projectDir,'Assets/Level.asset'),'data');fs.writeFileSync(path.join(f.projectDir,'Assets/Level.asset.meta'),'guid: '+guid+'\n');
 const {indexUnityProject}=await import('../src/assets/graph.js'),graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding});
 const staged=await stageUnityProject({projectDir:f.projectDir,graph,runDir:path.join(f.root,'capture'),templateRoot:path.resolve('templates'),assetIds:['asset:'+guid],dataCapture:true});assert.equal(staged.request.dataCapture,true);assert.equal(staged.request.assets.length,1);assert.equal(fs.readFileSync(path.join(f.projectDir,'Assets/Level.asset'),'utf8'),'data');
});
test('helper captures primitive array contents and marks unsupported values explicitly',()=>{
 const source=fs.readFileSync('templates/Unity/REToolkitValidation.cs','utf8');for(const s of ['dataCapture','DataSnapshot','DataObject','DataProperty','CaptureValue','scriptable-data-v2','unsupportedProperties'])assert(source.includes(s),s);
 assert.match(source,/dataObject == null[\s\S]{0,180}ReferenceFreeArray/);assert.doesNotMatch(source,/(?:SaveAssets|ApplyModifiedProperties|EnterPlaymode)\s*\(/);
});
