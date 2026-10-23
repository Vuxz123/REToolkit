import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createToolkit} from '../src/toolkit.js';
import {runAssetOperation,handleOwnedAssetOperation} from '../src/assets/service.js';
import {assetPaths,selectedAssetBinding} from '../src/assets/context.js';
import {inspectAssetReadiness} from '../src/assets/readiness.js';
import {indexUnityProject} from '../src/assets/graph.js';
import {fileIdentity,ownsWorkspaceLock,withWorkspaceLock} from '../src/state.js';
import {runtimePaths} from '../src/assets/runtime.js';
import {createUnityFixture} from './fixtures/unity-export-fixture.mjs';

async function setup(t,{staleGraph=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-independent-validation-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('OwnedFixture');
 const workspace=toolkit.workspace('OwnedFixture'),input=path.join(workspace,'01_Extracted');
 fs.writeFileSync(path.join(input,'GameAssembly.dll'),'owned native placeholder');
 fs.writeFileSync(path.join(input,'global-metadata.dat'),'owned metadata placeholder');
 await toolkit.scan('OwnedFixture',input);
 const fixture=await createUnityFixture(path.join(workspace,'05_ReconstructedSource'));
 const paths=assetPaths(toolkit,'OwnedFixture');
 if(staleGraph){
  const graph=await indexUnityProject(fixture.projectDir,{binding:selectedAssetBinding(toolkit,'OwnedFixture').binding});
  fs.mkdirSync(paths.base,{recursive:true});fs.writeFileSync(paths.graphFile,JSON.stringify(graph));
 }
 // One malformed serialized document larger than the ordinary YAML parse budget.
 const prefab=path.join(fixture.projectDir,'Assets/Thing.prefab');
 fs.writeFileSync(prefab,'%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!1 &1\nGameObject:\n  payload: [unterminated\n#'+ 'x'.repeat(17*1024**2));
 const originalPrefab=fileIdentity(prefab),project=toolkit.read('OwnedFixture');
 project.reconstructedSourceDir=fixture.projectDir;await toolkit.save('OwnedFixture',project);
 fs.mkdirSync(path.join(root,'templates/Unity'),{recursive:true});
 fs.copyFileSync(path.resolve('templates/Unity/REToolkitValidation.cs'),path.join(root,'templates/Unity/REToolkitValidation.cs'));
 const editor=path.join(root,'Unity.exe');fs.writeFileSync(editor,'inert owned fixture editor');
 let mode='success',calls=0;
 const dependencies={validation:{editor,runEditor:async config=>{
  calls++;assert.equal(ownsWorkspaceLock(workspace),true);
  assert.ok(fs.readdirSync(path.join(root,'.cache/toolchain/readers')).length>0);
  const stagedPrefab=fileIdentity(path.join(config.projectDir,'Assets/Thing.prefab'));
  assert.equal(stagedPrefab.sha256,originalPrefab.sha256);assert.equal(stagedPrefab.size,originalPrefab.size);
  const request=JSON.parse(fs.readFileSync(config.requestFile));
  assert.equal(request.scripts.length,1);assert.equal(request.assets.length,2);
  assert.deepEqual(request.binding,selectedAssetBinding(toolkit,'OwnedFixture').binding);
  const observation={kind:'retoolkit-unity-observation',schemaVersion:1,runId:request.runId,graphRevision:request.graphRevision,unityVersion:request.unityVersion,complete:true,compilation:{state:'succeeded'},
   scripts:request.scripts.map(s=>({...s,guid:fixture.guids.script,fileID:'11500000',fullName:'Demo.Player',assembly:'Assembly-CSharp',resolved:true})),
   assets:request.assets.map(a=>({...a,loaded:true,missingScripts:0,missingReferences:mode==='missing-reference'?1:0})),diagnostics:[]};
  if(request.assets.some(a=>a.kind==='asset')){observation.traversal={policy:'reference-scan-v2'};for(const row of observation.assets)row.traversal={complete:true,objects:1,properties:2,skippedSubtrees:0,stopReason:'',objectPath:row.path,componentType:'Owned.Table',propertyPath:''};}
  if(mode==='wrong-revision')observation.graphRevision='0'.repeat(64);
  if(mode!=='missing-report')fs.writeFileSync(config.reportFile,JSON.stringify(observation));
  if(mode==='source-drift')fs.appendFileSync(fixture.scriptPath,'// drift');
  if(mode==='input-drift')fs.writeFileSync(path.join(input,'new.assets'),'drift');
  if(mode==='unconfirmed-close')fs.writeFileSync(path.join(workspace,'.retk-lock/unity-fixture-uncertain.json'),'{}');
  return {closed:mode!=='unconfirmed-close',exitCode:mode==='compile-failure'?1:0,timedOut:false,logTail:mode==='compile-failure'?'error CS1002: fixture compile failure':''};
 }}};
 return {toolkit,workspace,input,fixture,prefab,originalPrefab,dependencies,paths,setMode:value=>{mode=value;},calls:()=>calls,
  validate:params=>runAssetOperation(toolkit,'OwnedFixture','reconstruct.validate',params,dependencies),
  report:params=>runAssetOperation(toolkit,'OwnedFixture','reconstruct.validation',params)};
}

test('shared service validates and reads Unity observations without a graph or parsing a >16 MiB prefab',async t=>{
 const f=await setup(t);assert.equal(fs.existsSync(f.paths.graphFile),false);
 await assert.rejects(handleOwnedAssetOperation(f.toolkit,'OwnedFixture','reconstruct.validate'),{code:'asset_lease_required'});
 await assert.rejects(f.validate({timeoutSeconds:0}),{code:'unity_validation_invalid'});assert.equal(f.calls(),0);
 const result=await f.validate({timeoutSeconds:5});
 assert.equal(result.compileReady,true);assert.equal(result.bindingsVerified,true);assert.equal(result.behavior,'unverified');
 assert.equal(result.sourceSnapshot.kind,'retoolkit-validation-source-snapshot');
 assert.equal(result.sourceSnapshot.coverage.kind,'source-inventory-only');
 assert.equal(result.sourceSnapshot.coverage.serializedReferences,'unverified');
 assert.equal(fs.existsSync(f.paths.graphFile),false);
 assert.deepEqual(fileIdentity(f.prefab),f.originalPrefab);
 const state=f.toolkit.read('OwnedFixture').assetReconstruction;
 assert.deepEqual(state.binding,result.binding);assert.equal(state.graph,undefined);assert.equal(state.compileReady,true);
 assert.equal((await f.report({operationId:result.operationId})).bindingsVerified,true);
 const assets=await f.report({operationId:result.operationId,section:'assets',limit:1});assert.equal(assets.items.length,1);assert.ok(assets.nextCursor);
 assert.equal(assets.sourceSnapshot.coverage.serializedReferences,'unverified');
 assert.equal((await f.report({operationId:result.operationId,section:'assets',limit:1,cursor:assets.nextCursor})).items.length,1);
 // Static graph corruption cannot prevent independent validation/report access.
 fs.writeFileSync(f.paths.graphFile,'invalid graph');
 assert.equal((await f.report({operationId:result.operationId})).compileReady,true);
 const reportDir=path.dirname(path.join(f.workspace,result.storedReceipt));
 fs.appendFileSync(path.join(reportDir,'observation.json'),' ');
 await assert.rejects(f.report({operationId:result.operationId}),/observation bytes changed/);
 assert.equal(fs.existsSync(path.join(f.workspace,'.retk-lock')),false);
 assert.deepEqual(fs.readdirSync(path.join(f.toolkit.root,'.cache/toolchain/readers')),[]);
});

test('shared service accepts two policy table IDs and keeps missing-reference results unverified',async t=>{
 const f=await setup(t),ids=['asset:'+'d'.repeat(32),'asset:'+'e'.repeat(32)];
 for(const [index,id]of ids.entries()){fs.writeFileSync(path.join(f.fixture.projectDir,'Assets/Table'+index+'.asset'),'table data');fs.writeFileSync(path.join(f.fixture.projectDir,'Assets/Table'+index+'.asset.meta'),'guid: '+id.slice(6)+'\n');}
 const result=await f.validate({assetIds:ids});assert.equal(result.compileReady,true);assert.equal(result.scopeBindingsVerified,true);assert.equal(result.bindingsVerified,false);assert.deepEqual(result.scope.assetIds,ids);assert.equal(result.coverage.requestedAssets,2);assert.equal(result.coverage.completedAssets,2);
 const rows=await f.report({operationId:result.operationId,section:'assets'});assert.deepEqual(rows.items.map(a=>a.assetId).sort(),ids);assert.ok(rows.items.every(a=>a.kind==='asset'));
 f.setMode('missing-reference');const missing=await f.validate({assetIds:ids});assert.equal(missing.compileReady,true);assert.equal(missing.scopeBindingsVerified,false);assert.equal(missing.bindingsVerified,false);assert.equal(missing.behavior,'unverified');
});

test('independent validation derives readiness from bound Unity observations only',async t=>{
 const f=await setup(t);
 for(const mode of ['missing-reference','compile-failure','missing-report','wrong-revision']){
  f.setMode(mode);const result=await f.validate({timeoutSeconds:5});
  assert.equal(result.compileReady,mode==='missing-reference',mode);assert.equal(result.bindingsVerified,false,mode);
  assert.equal(result.sourceSnapshot.coverage.serializedReferences,'unverified');
  assert.equal((await f.report({operationId:result.operationId})).compileReady,result.compileReady);
 }
 assert.equal(f.calls(),4);assert.equal(fs.existsSync(f.paths.graphFile),false);
});

test('independent reports reject changed source inventory and changed selected build binding',async t=>{
 const f=await setup(t),first=await f.validate({timeoutSeconds:5});
 fs.appendFileSync(f.fixture.scriptPath,'// source changed');
 await assert.rejects(f.report({operationId:first.operationId}),{code:'stale_graph'});
 const second=await f.validate({timeoutSeconds:5});
 fs.writeFileSync(path.join(f.input,'new.assets'),'different input inventory');
 await assert.rejects(f.report({operationId:second.operationId}),{code:'stale_graph'});
});

test('independent validation detects original source and build drift before publishing a receipt',async t=>{
 for(const mode of ['source-drift','input-drift']){
  const f=await setup(t);f.setMode(mode);
  await assert.rejects(f.validate({timeoutSeconds:5}),{code:'stale_graph'});
  assert.equal(f.toolkit.read('OwnedFixture').assetReconstruction,undefined);
  assert.equal(fs.existsSync(path.join(f.workspace,'.retk-lock')),false);
 }
});

test('readiness retains independent Unity validation while static graph remains missing or stale',async t=>{
 for(const staleGraph of [false,true]){
  const f=await setup(t,{staleGraph}),result=await f.validate({timeoutSeconds:5});
  const readiness=await inspectAssetReadiness(f.toolkit,'OwnedFixture');
  assert.equal(readiness.state,staleGraph?'stale':'unknown');
  assert.equal(readiness.compileReady,true);assert.equal(readiness.bindingsVerified,true);
  assert.equal(readiness.validationOperation,result.operationId);assert.equal(readiness.validationState,'validated');
  assert.equal(readiness.validationSourceSnapshot.coverage.serializedReferences,'unverified');
  assert.equal(readiness.coverage,undefined);assert.equal(readiness.behavior,'unverified');
  fs.appendFileSync(f.fixture.scriptPath,'// no longer observed');
  const changed=await inspectAssetReadiness(f.toolkit,'OwnedFixture');
  assert.equal(changed.compileReady,false);assert.equal(changed.bindingsVerified,false);
  assert.equal(changed.validationState,'stale-or-unavailable');
 }
});

test('independent validation preserves the AssetRipper session gate and uncertain Unity ownership',async t=>{
 const session=await setup(t),runtime=runtimePaths(session.toolkit,'OwnedFixture');
 fs.mkdirSync(runtime.base,{recursive:true});
 fs.writeFileSync(runtime.current,JSON.stringify({runId:'11111111-1111-4111-8111-111111111111',phase:'ready'}));
 await assert.rejects(session.validate({timeoutSeconds:5}),{code:'asset_session_active'});
 await assert.rejects(withWorkspaceLock(session.workspace,()=>handleOwnedAssetOperation(session.toolkit,'OwnedFixture','reconstruct.validate',{},session.dependencies)),{code:'asset_session_active'});
 assert.equal(session.calls(),0);
 const uncertain=await setup(t);uncertain.setMode('unconfirmed-close');
 await assert.rejects(uncertain.validate({timeoutSeconds:5}),{code:'unity_recovery_required'});
 assert.ok(fs.existsSync(path.join(uncertain.workspace,'.retk-lock/unity-fixture-uncertain.json')));
 assert.equal(fs.readdirSync(path.join(uncertain.toolkit.root,'.cache/toolchain/readers')).length,1);
 assert.equal(uncertain.toolkit.read('OwnedFixture').assetReconstruction,undefined);
});
