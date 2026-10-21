import test from 'node:test';
import assert from 'node:assert/strict';

const api=()=>import('../src/unity/report.js');
const guid='a'.repeat(32),runId='11111111-1111-4111-8111-111111111111';
function fixture(){
  const request={kind:'retoolkit-unity-validation-request',schemaVersion:1,runId,graphRevision:'b'.repeat(64),binding:{native:{sha256:'c'.repeat(64),size:1},metadata:{sha256:'d'.repeat(64),size:2},assetsSha256:'e'.repeat(64)},unityVersion:'2022.3.62f2',scripts:[{assetId:`asset:${guid}`,path:'Assets/Test.cs'}],assets:[{assetId:'scene-id',path:'Assets/Test.unity',kind:'scene'},{assetId:'prefab-id',path:'Assets/Test.prefab',kind:'prefab'}]};
  const report={kind:'retoolkit-unity-observation',schemaVersion:1,runId,graphRevision:request.graphRevision,unityVersion:request.unityVersion,complete:true,compilation:{state:'succeeded'},scripts:[{...request.scripts[0],guid,fileID:'11500000',fullName:'Example.Test',assembly:'Assembly-CSharp',resolved:true}],assets:request.assets.map(a=>({...a,loaded:true,missingScripts:0,missingReferences:0})),diagnostics:[]};
  return {request,report};
}
async function rejectMutations(mutations,target='report'){
  const {validateUnityObservation}=await api();
  for(const mutate of mutations){const pair=fixture();mutate(pair[target],pair);assert.throws(()=>validateUnityObservation(pair.report,pair.request),e=>e.code==='unity_report_invalid',mutate.toString());}
}

test('Unity observation accepts only observed DTO and preserves unresolved/incomplete results',async()=>{
  const {validateUnityObservation}=await api();const {request,report}=fixture(),before=structuredClone(report);
  assert.equal(validateUnityObservation(report,request),report);assert.deepEqual(report,before);
  report.scripts[0]={...report.scripts[0],guid:null,fileID:null,fullName:null,assembly:null,resolved:false};
  report.compilation.state='failed';report.assets[0].loaded=false;report.assets[0].missingScripts=2;
  report.diagnostics=[{severity:'error',message:'Compiler failed',path:'Assets/Test.cs'}];
  assert.equal(validateUnityObservation(report,request),report);
  report.complete=false;report.scripts=[];report.assets=[];assert.equal(validateUnityObservation(report,request),report);
});

test('Unity observation accepts uppercase Unity source extensions while matching requested paths exactly',async()=>{
  const {validateUnityObservation}=await api();const {request,report}=fixture();
  request.scripts[0].path=report.scripts[0].path='Assets/Test.CS';
  request.assets[0].path=report.assets[0].path='Assets/Test.UNITY';
  request.assets[1].path=report.assets[1].path='Assets/Test.PREFAB';
  assert.equal(validateUnityObservation(report,request),report);
  report.scripts[0].path='Assets/Test.cs';
  assert.throws(()=>validateUnityObservation(report,request),e=>e.code==='unity_report_invalid');
});

test('Unity observation binds exact run, graph revision, version and known envelope keys',async()=>{
  await rejectMutations([v=>v.kind='other',v=>v.schemaVersion=2,v=>v.runId='22222222-2222-4222-8222-222222222222',v=>v.graphRevision='f'.repeat(64),v=>v.unityVersion='6000.0.66f2',v=>v.complete='true',v=>v.compilation.state='complete',v=>v.compilation.ready=true,v=>v.compileReady=true,v=>delete v.assets,v=>v.compilation=null]);
});

test('Unity observation rejects unrequested, duplicate and omitted rows',async()=>{
  await rejectMutations([v=>v.scripts.push({...v.scripts[0]}),v=>v.assets.push({...v.assets[0]}),v=>v.scripts[0].assetId='unknown',v=>v.assets[0].assetId='unknown',v=>v.scripts[0].path='Assets/Other.cs',v=>v.assets[0].path='Assets/Other.unity',v=>v.assets[0].kind='prefab',v=>v.scripts=[],v=>v.assets.pop(),v=>v.scripts[0].identity='extra']);
});

test('Unity observation validates MonoScript GUID, signed 64 bit file ID and actual resolved identity',async()=>{
  await rejectMutations([v=>v.scripts[0].guid='f'.repeat(32),v=>v.scripts[0].guid='no-guid',v=>v.scripts[0].guid=null,v=>v.scripts[0].fileID=11500000,v=>v.scripts[0].fileID='9223372036854775808',v=>v.scripts[0].fileID='-9223372036854775809',v=>v.scripts[0].fileID='01',v=>v.scripts[0].fileID='-0',v=>v.scripts[0].fileID='+1',v=>v.scripts[0].fullName='',v=>v.scripts[0].assembly=null,v=>v.scripts[0].resolved=1,v=>{v.scripts[0].resolved=false;v.scripts[0].guid=null;},v=>{v.scripts[0].resolved=false;v.scripts[0].assembly=null;}]);
  const {validateUnityObservation}=await api();for(const id of ['-9223372036854775808','9223372036854775807','0']){const {report,request}=fixture();report.scripts[0].fileID=id;assert.equal(validateUnityObservation(report,request),report);}
});

test('Unity observation validates loaded booleans and bounded missing counters without equating complete with ready',async()=>{
  await rejectMutations([v=>v.assets[0].loaded=1,v=>v.assets[0].missingScripts=-1,v=>v.assets[0].missingReferences=0.5,v=>v.assets[0].missingReferences=200001,v=>v.assets[0].missingScripts=NaN,v=>v.assets[0].ready=true]);
  const {validateUnityObservation}=await api();const {report,request}=fixture();report.assets[0].missingScripts=200000;assert.equal(validateUnityObservation(report,request),report);
});

test('Unity observation bounds diagnostic shapes, text and paths',async()=>{
  const diagnostic={severity:'warning',message:'warning',path:''};
  await rejectMutations([v=>v.diagnostics=[{...diagnostic,severity:'fatal'}],v=>v.diagnostics=[{...diagnostic,message:'x'.repeat(8193)}],v=>v.diagnostics=[{...diagnostic,path:'../outside.cs'}],v=>v.diagnostics=[{...diagnostic,path:'C:/outside.cs'}],v=>v.diagnostics=[{...diagnostic,path:'Assets/../outside.cs'}],v=>v.diagnostics=[{...diagnostic,token:'secret'}],v=>v.diagnostics=Array.from({length:1001},()=>({...diagnostic}))]);
});

test('Unity observation validates expected request and source relative Assets paths defensively',async()=>{
  await rejectMutations([v=>v.kind='wrong',v=>v.schemaVersion=2,v=>v.runId='run',v=>v.graphRevision=1,v=>v.unityVersion='latest',v=>v.binding.native.sha256='invalid',v=>v.binding.native.size=-1,v=>v.binding.extra=true,v=>v.scripts.push({...v.scripts[0]}),v=>v.assets.push({...v.assets[0]}),v=>v.scripts[0].assetId='',v=>v.scripts[0].path='Assets/../../Test.cs',v=>v.scripts[0].path='Assets\\Test.cs',v=>v.scripts[0].path='/Assets/Test.cs',v=>v.scripts[0].path='Assets/Test.cs:stream',v=>v.scripts[0].path='Assets/CON/Test.cs',v=>v.scripts[0].path='Assets/folder./Test.cs',v=>v.scripts[0].path='Assets/Test.txt',v=>v.assets[0].kind='script',v=>v.assets[0].path='Assets/Test.prefab',v=>v.assets[0].extra=true,v=>v.scripts=Array(10001).fill(v.scripts[0]),v=>v.assets=Array(10001).fill(v.assets[0])],'request');
});

test('Unity observation rejects prototype, accessor, symbol, cyclic and sparse structures without invoking getters',async()=>{
  let reads=0;
  await rejectMutations([v=>Object.setPrototypeOf(v,{complete:true}),v=>Object.defineProperty(v,'complete',{get(){reads++;return true;}}),v=>v[Symbol('extra')]=1,v=>Object.defineProperty(v,'extra',{value:1}),v=>v.scripts[0].cycle=v,v=>v.scripts=Array(1),v=>v.scripts.extra=true]);
  await rejectMutations([v=>Object.setPrototypeOf(v.binding,{native:v.binding.native}),v=>v.binding.self=v.binding],'request');assert.equal(reads,0);
});

test('Unity observation rejects JSON over 16 MiB even when individual fields are within bounds',async()=>{
  const {validateUnityObservation}=await api();const {request,report}=fixture();request.scripts=[];report.scripts=[];
  for(let i=0;i<9000;i++){const path=`Assets/${'x'.repeat(1800)}${i}.cs`,assetId=`script-${i}`;request.scripts.push({assetId,path});report.scripts.push({assetId,path,guid,fileID:'11500000',fullName:'Test',assembly:'Assembly-CSharp',resolved:true});}
  assert.throws(()=>validateUnityObservation(report,request),e=>e.code==='unity_report_invalid');
});
