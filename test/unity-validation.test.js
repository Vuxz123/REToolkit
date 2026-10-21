import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture} from './reconstruction-fixture.js';
import {stageUnityProject,resolveUnityEditor,validateUnityProject,readUnityValidation} from '../src/unity/validation.js';
import {fileIdentity,withWorkspaceLock} from '../src/state.js';
import {createToolkit} from '../src/toolkit.js';
const templateRoot=path.resolve(import.meta.dirname,'../templates');
test('Unity stage copies exact source inventory and injects helper without modifying original',async t=>{
 const f=await fixture(t);fs.mkdirSync(path.join(f.projectDir,'Library'));fs.writeFileSync(path.join(f.projectDir,'Library/private'),'excluded');
 fs.writeFileSync(path.join(f.projectDir,'Assets/Binary.unity'),Buffer.from([0,1,2]));
 fs.writeFileSync(path.join(f.projectDir,'Assets/Upper.CS'),'public class Upper : UnityEngine.MonoBehaviour {}');
 const {indexUnityProject}=await import('../src/assets/graph.js');f.graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding});
 const runDir=path.join(f.root,'run');const staged=await stageUnityProject({projectDir:f.projectDir,graph:f.graph,runDir,templateRoot});
 assert.equal(fs.existsSync(path.join(staged.projectDir,'Library/private')),false);
 assert.equal(fs.readFileSync(path.join(f.projectDir,'Assets/Player.cs'),'utf8'),f.files['Assets/Player.cs']);
 for(const file of f.graph.files)assert.equal(fileIdentity(path.join(staged.projectDir,file.path)).sha256,file.sha256);
 assert(fs.existsSync(path.join(staged.projectDir,'Assets/REToolkitValidation/Editor/REToolkitValidation.cs')));
 assert.equal(staged.request.scripts[0].assetId,f.scriptMap.scripts[0].scriptId);
 assert.equal(staged.request.assets[0].kind,'scene');
  assert(staged.request.assets.some(a=>a.path==='Assets/Binary.unity'&&a.kind==='scene'));
  assert(staged.request.scripts.some(a=>a.path==='Assets/Upper.CS'));
});
test('stage refuses stale source, local packages, reserved helper and linked paths',async t=>{
 for(const failure of ['stale','package','package-case','embedded-package','reserved','linked']){
  const f=await fixture(t);
  if(failure==='stale')fs.appendFileSync(path.join(f.projectDir,'Assets/Player.cs'),'changed');
  if(failure==='package'){fs.mkdirSync(path.join(f.projectDir,'Packages'));fs.writeFileSync(path.join(f.projectDir,'Packages/manifest.json'),JSON.stringify({dependencies:{'x':'file:../../private'}}));}
  if(failure==='package-case'){fs.mkdirSync(path.join(f.projectDir,'Packages'));fs.writeFileSync(path.join(f.projectDir,'Packages/Manifest.json'),JSON.stringify({dependencies:{'x':'file:../../private'}}));}
  if(failure==='embedded-package'){fs.mkdirSync(path.join(f.projectDir,'Packages/local'),{recursive:true});fs.writeFileSync(path.join(f.projectDir,'Packages/local/package.json'),JSON.stringify({dependencies:{'x':'file:../../private'}}));}
  if(failure==='reserved'){fs.mkdirSync(path.join(f.projectDir,'Assets/REToolkitValidation'));fs.writeFileSync(path.join(f.projectDir,'Assets/REToolkitValidation/existing'),'keep');}
  if(failure==='linked')fs.symlinkSync(f.projectDir,path.join(f.root,'linked'),'junction');
  const {indexUnityProject}=await import('../src/assets/graph.js');const graph=failure==='stale'?f.graph:await indexUnityProject(f.projectDir,{binding:f.graph.binding});
  await assert.rejects(stageUnityProject({projectDir:failure==='linked'?path.join(f.root,'linked'):f.projectDir,graph,runDir:path.join(f.root,'run'),templateRoot}));
 }
});
test('Editor resolver never upgrades missing exact project version',async t=>{
 const f=await fixture(t);assert.equal(resolveUnityEditor('2099.1.0f1',{}, {installRoot:f.root}),null);
 assert.throws(()=>resolveUnityEditor('2022.3.1f1 -executeMethod Other',{}, {installRoot:f.root}));
  const fake=path.join(f.root,'2022.3.1f1/Editor/Unity.exe');fs.mkdirSync(path.dirname(fake),{recursive:true});fs.writeFileSync(fake,'renamed unrelated executable');
  assert.throws(()=>resolveUnityEditor('2022.3.1f1',{unityEditorPath:fake},{getEditorVersion:()=> '6000.0.66f2'}),{code:'unity_editor_mismatch'});
  assert.equal(resolveUnityEditor('2022.3.1f1',{unityEditorPath:fake},{getEditorVersion:()=> '2022.3.1f1'}),fake);
});
test('validation derives readiness from closed process and complete bound observation, preserves original bytes',async t=>{
 for(const state of ['success','missing-script','opaque-script','compile-failure','missing-report','wrong-run']){
  const f=await fixture(t),toolkit=createToolkit(f.root,{log:()=>{}});await toolkit.init('Game');
  const source=path.join(toolkit.workspace('Game'),'01_Extracted');fs.writeFileSync(path.join(source,'GameAssembly.dll'),'native');fs.writeFileSync(path.join(source,'global-metadata.dat'),'metadata');await toolkit.scan('Game',source);
  const {selectedAssetBinding}=await import('../src/assets/context.js');const binding=selectedAssetBinding(toolkit,'Game').binding;
  if(state==='opaque-script')fs.unlinkSync(path.join(f.projectDir,'Assets/Player.cs.meta'));
  const {indexUnityProject}=await import('../src/assets/graph.js');const graph=await indexUnityProject(f.projectDir,{binding});
  fs.mkdirSync(path.join(f.root,'templates/Unity'),{recursive:true});fs.copyFileSync(path.join(templateRoot,'Unity/REToolkitValidation.cs'),path.join(f.root,'templates/Unity/REToolkitValidation.cs'));
  const editor=path.join(f.root,'Unity.exe');fs.writeFileSync(editor,'owned fixture editor');
  const result=await withWorkspaceLock(toolkit.workspace('Game'),()=>validateUnityProject({toolkit,name:'Game',projectDir:f.projectDir,graph},{editor,runEditor:async config=>{
   const request=JSON.parse(fs.readFileSync(config.requestFile));
   if(state!=='missing-report')fs.writeFileSync(config.reportFile,JSON.stringify({kind:'retoolkit-unity-observation',schemaVersion:1,runId:state==='wrong-run'?'bad':request.runId,graphRevision:request.graphRevision,unityVersion:request.unityVersion,complete:true,compilation:{state:'succeeded'},scripts:request.scripts.map(s=>({...s,guid:'a'.repeat(32),fileID:'11500000',fullName:'Game.Player',assembly:'Assembly-CSharp',resolved:true})),assets:request.assets.map(a=>({...a,loaded:true,missingScripts:state==='missing-script'?1:0,missingReferences:0})),diagnostics:state==='success'?Array.from({length:300},(_,i)=>({severity:'warning',message:i+':'+ '"'.repeat(4000),path:''})):[]}));
   return {exitCode:state==='compile-failure'?1:0,closed:true,timedOut:false,logTail:state==='compile-failure'?'Assets/Player.cs(1,2): error CS1002: ; expected':''};
  }}));
  assert.equal(result.compileReady,['success','missing-script','opaque-script'].includes(state),state);assert.equal(result.bindingsVerified,state==='success',state);
  assert.equal(fs.readFileSync(path.join(f.projectDir,'Assets/Player.cs'),'utf8'),f.files['Assets/Player.cs']);
  const saved=await readUnityValidation({toolkit,name:'Game',projectDir:f.projectDir,graph,operationId:result.operationId});assert.equal(saved.compileReady,result.compileReady);
  if(state==='success'){
   const scripts=await readUnityValidation({toolkit,name:'Game',projectDir:f.projectDir,graph,operationId:result.operationId,section:'scripts',limit:1});
   assert.equal(scripts.items[0].guid,'a'.repeat(32));assert.equal(scripts.items[0].fileID,'11500000');
   const page=await readUnityValidation({toolkit,name:'Game',projectDir:f.projectDir,graph,operationId:result.operationId,section:'diagnostics',limit:1000});
   assert(page.items.length<300&&page.items.length>0);assert(page.nextCursor);assert(Buffer.byteLength(JSON.stringify(JSON.stringify(page)))<2*1024**2);
   const next=await readUnityValidation({toolkit,name:'Game',projectDir:f.projectDir,graph,operationId:result.operationId,section:'diagnostics',limit:1000,cursor:page.nextCursor});assert(next.items[0].message.startsWith(page.items.length+':'));
   await assert.rejects(readUnityValidation({toolkit,name:'Game',projectDir:f.projectDir,graph,operationId:result.operationId,section:'assets',cursor:'wrong'}));
   const requestFile=path.join(toolkit.workspace('Game'),'04_Notes/assets/unity-validation',result.operationId,'request.json');fs.appendFileSync(requestFile,' ');
   await assert.rejects(readUnityValidation({toolkit,name:'Game',projectDir:f.projectDir,graph,operationId:result.operationId}),/request bytes changed/);
  }
 }
});
