import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture} from './reconstruction-fixture.js';
import {createToolkit} from '../src/toolkit.js';
import {withWorkspaceLock,fingerprint} from '../src/state.js';
import {validateUnityProject,readUnityValidation} from '../src/unity/validation.js';
import {indexUnityProject} from '../src/assets/graph.js';
import {selectedAssetBinding} from '../src/assets/context.js';
const traversal=complete=>({complete,objects:1,properties:complete?2:200000,skippedSubtrees:0,stopReason:complete?'':'property_limit',objectPath:'',componentType:'',propertyPath:complete?'':'data.Array.data[199999]'});
async function setup(t){
 const f=await fixture(t),toolkit=createToolkit(f.root,{log:()=>{}});await toolkit.init('Game');
 const input=path.join(toolkit.workspace('Game'),'01_Extracted');fs.writeFileSync(path.join(input,'GameAssembly.dll'),'native');fs.writeFileSync(path.join(input,'global-metadata.dat'),'metadata');await toolkit.scan('Game',input);
 fs.writeFileSync(path.join(f.projectDir,'Assets/Other.prefab'),f.files['Assets/Main.unity']);
 const graph=await indexUnityProject(f.projectDir,{binding:selectedAssetBinding(toolkit,'Game').binding});
 fs.mkdirSync(path.join(f.root,'templates/Unity'),{recursive:true});fs.writeFileSync(path.join(f.root,'templates/Unity/REToolkitValidation.cs'),'owned fixture helper');
 const editor=path.join(f.root,'Unity.exe');fs.writeFileSync(editor,'owned fixture editor');
 const invoke=(options={},runEditor=engine())=>withWorkspaceLock(toolkit.workspace('Game'),()=>validateUnityProject({toolkit,name:'Game',projectDir:f.projectDir,graph,...options},{editor,runEditor}));
 const read=(id,section='summary')=>readUnityValidation({toolkit,name:'Game',projectDir:f.projectDir,graph,operationId:id,section});
 return {...f,toolkit,graph,editor,invoke,read};
}
function engine({partial=false,legacy=false,exitCode=0,timedOut=false,logTail='',onRequest=()=>{}}={}){return async config=>{
 const request=JSON.parse(fs.readFileSync(config.requestFile));onRequest(request,config);
 fs.writeFileSync(config.reportFile,JSON.stringify({kind:'retoolkit-unity-observation',schemaVersion:1,runId:request.runId,graphRevision:request.graphRevision,unityVersion:request.unityVersion,complete:!partial,compilation:{state:'succeeded'},...(!legacy?{traversal:{policy:'reference-scan-v2'}}:{}),scripts:request.scripts.map(s=>({...s,guid:'a'.repeat(32),fileID:'11500000',fullName:'Game.Player',assembly:'Assembly-CSharp',resolved:true,...(!legacy?{classification:'attachable'}:{})})),assets:request.assets.map((a,i)=>({...a,loaded:true,missingScripts:0,missingReferences:0,...(!legacy?{traversal:traversal(!partial||i!==0)}:{})})),diagnostics:[]}));
 return {exitCode,closed:true,timedOut,logTail};
};}
test('partial asset budgets preserve compilation and resume only completed rows into immutable merged evidence',async t=>{
 const f=await setup(t),first=await f.invoke({},engine({partial:true}));
 assert.equal(first.compileReady,true);assert.equal(first.compilation.state,'succeeded');assert.equal(first.state,'partial');assert.equal(first.bindingsVerified,false);
 assert.equal(first.coverage.completedAssets,1);assert.equal(first.coverage.pendingAssets,1);assert.equal(first.nextAction,'resume');
 let requested;const next=await f.invoke({resumeOperationId:first.operationId},engine({onRequest:r=>requested=r}));
 assert.equal(requested.assets.length,1);assert.equal(requested.scripts.length,1);assert.notEqual(next.operationId,first.operationId);assert.equal(next.bindingsVerified,true);
 assert.equal((await f.read(next.operationId,'assets')).items.length,2);assert.equal((await f.read(first.operationId)).state,'partial');
});
test('exact selected asset coverage never grants global bindings',async t=>{
 const f=await setup(t),assetIds=[f.graph.assets.find(a=>a.path==='Assets/Other.prefab').id];
 const result=await f.invoke({assetIds});assert.equal(result.compileReady,true);assert.equal(result.scopeBindingsVerified,true);assert.equal(result.bindingsVerified,false);assert.equal(result.scope.kind,'assets');
 await assert.rejects(f.invoke({assetIds:['unknown']}));await assert.rejects(f.invoke({assetIds:[assetIds[0],assetIds[0]]}));
});
test('scoped resume inherits its attested exact scope when asset IDs are omitted',async t=>{
 const f=await setup(t),assetIds=[f.graph.assets.find(a=>a.path==='Assets/Other.prefab').id],first=await f.invoke({assetIds},engine({partial:true}));
 const second=await f.invoke({resumeOperationId:first.operationId});assert.deepEqual(second.scope,first.scope);assert.equal(second.scopeBindingsVerified,true);assert.equal(second.bindingsVerified,false);
});

test('two table asset scope validates and resumes without widening to scenes or prefabs',async t=>{
 const f=await setup(t),ids=['asset:'+'d'.repeat(32),'asset:'+'e'.repeat(32)];
 for(const [index,id]of ids.entries()){fs.writeFileSync(path.join(f.projectDir,'Assets/Table'+index+'.asset'),'table');fs.writeFileSync(path.join(f.projectDir,'Assets/Table'+index+'.asset.meta'),'guid: '+id.slice(6)+'\n');}
 const {createValidationSourceSnapshot}=await import('../src/assets/validation-snapshot.js'),graph=await createValidationSourceSnapshot({projectDir:f.projectDir,binding:f.graph.binding}),invoke=(options,runEditor)=>withWorkspaceLock(f.toolkit.workspace('Game'),()=>validateUnityProject({toolkit:f.toolkit,name:'Game',projectDir:f.projectDir,graph,...options},{editor:f.editor,runEditor}));
 let firstRequest;const first=await invoke({assetIds:ids},engine({partial:true,onRequest:r=>firstRequest=r}));assert.deepEqual(firstRequest.assets.map(a=>a.assetId).sort(),ids);assert.ok(firstRequest.assets.every(a=>a.kind==='asset'));assert.equal(first.coverage.requestedAssets,2);assert.equal(first.coverage.completedAssets,1);assert.equal(first.compileReady,true);assert.equal(first.bindingsVerified,false);
 let resumedRequest;const second=await invoke({resumeOperationId:first.operationId},engine({onRequest:r=>resumedRequest=r}));assert.equal(resumedRequest.assets.length,1);assert.deepEqual(second.scope.assetIds,ids);assert.equal(second.scopeBindingsVerified,true);assert.equal(second.bindingsVerified,false);assert.equal(second.coverage.reusedAssets,1);assert.equal(second.behavior,'unverified');
 const read=await readUnityValidation({toolkit:f.toolkit,name:'Game',projectDir:f.projectDir,graph,operationId:second.operationId,section:'assets'});assert.deepEqual(read.items.map(a=>a.assetId).sort(),ids);
});

test('legacy project-wide receipt cannot certify data assets omitted from its original request',async t=>{
 const f=await setup(t);fs.writeFileSync(path.join(f.projectDir,'Assets/Table.asset'),'table');fs.writeFileSync(path.join(f.projectDir,'Assets/Table.asset.meta'),'guid: '+'d'.repeat(32)+'\n');
 const {createValidationSourceSnapshot}=await import('../src/assets/validation-snapshot.js'),graph=await createValidationSourceSnapshot({projectDir:f.projectDir,binding:f.graph.binding}),legacy={...graph,assets:graph.assets.filter(a=>a.kind!=='asset')};
 const old=await withWorkspaceLock(f.toolkit.workspace('Game'),()=>validateUnityProject({toolkit:f.toolkit,name:'Game',projectDir:f.projectDir,graph:legacy},{editor:f.editor,runEditor:engine()}));assert.equal(old.bindingsVerified,true);
 const file=path.join(f.toolkit.workspace('Game'),old.storedReceipt),receipt=JSON.parse(fs.readFileSync(file));delete receipt.checkpointSha256;delete receipt.receiptSha256;fs.writeFileSync(file,JSON.stringify({...receipt,receiptSha256:fingerprint(receipt)}));
 await assert.rejects(readUnityValidation({toolkit:f.toolkit,name:'Game',projectDir:f.projectDir,graph,operationId:old.operationId}),{code:'unity_validation_scope_changed'});
});
test('legacy incomplete assets are rerun even with zero missing references',async t=>{
 const f=await setup(t),first=await f.invoke({},engine({partial:true,legacy:true}));let request;
 assert.equal(first.compileReady,true);await f.invoke({resumeOperationId:first.operationId},engine({onRequest:r=>request=r}));assert.equal(request.assets.length,2);
});
test('resume rejects changed helper, Editor, scope, source and attested artifact bytes',async t=>{
 for(const changed of ['helper','editor','scope','source','request','observation','checkpoint','receipt']){
  const f=await setup(t),first=await f.invoke({},engine({partial:true}));let options={resumeOperationId:first.operationId};
  const dir=path.join(f.toolkit.workspace('Game'),'04_Notes/assets/unity-validation',first.operationId);
  if(changed==='helper')fs.appendFileSync(path.join(f.root,'templates/Unity/REToolkitValidation.cs'),'changed');
  else if(changed==='editor')fs.appendFileSync(f.editor,'changed');
  else if(changed==='scope')options.assetIds=[f.graph.assets.find(a=>a.path==='Assets/Other.prefab').id];
  else if(changed==='source')fs.appendFileSync(path.join(f.projectDir,'Assets/Player.cs'),'changed');
  else if(changed==='receipt'){const file=path.join(dir,'receipt.json'),receipt=JSON.parse(fs.readFileSync(file));receipt.compileReady=false;fs.writeFileSync(file,JSON.stringify(receipt));}
  else fs.appendFileSync(path.join(dir,changed+'.json'),' ');
  await assert.rejects(f.invoke(options),undefined,changed);
 }
});
test('compiler errors and timed out processes cannot attest successful compilation',async t=>{
 const f=await setup(t);
 for(const flags of [{logTail:'error CS1002: expected'},{timedOut:true},{exitCode:1}]){
  const result=await f.invoke({},engine(flags));assert.equal(result.compileReady,false);assert.equal(result.bindingsVerified,false);
 }
});
test('compiler failure directs source repair and fresh validation before any resume',async t=>{
 const f=await setup(t),result=await f.invoke({},engine({partial:true,exitCode:1,logTail:'error CS1002: ; expected'}));
 assert.equal(result.compilation.state,'failed');assert.equal(result.nextAction,'fix-compilation');assert.equal(result.resume,undefined);
});
test('Editor licensing and fatal process failures leave compilation unverified',async t=>{
 const f=await setup(t),result=await f.invoke({},engine({partial:true,exitCode:1,logTail:'Fatal error: license invalid'}));
 assert.equal(result.compilation.state,'unverified');assert.equal(result.state,'partial');
});
test('script classification accepts compiler-backed ordinary sources and reflection nonattachable types, retains required component identity',async t=>{
 for(const mode of ['enum','assembly-info','generic','abstract','lost-component','conditional-inherited','partial-declaration','wrong-type','unresolved']){
  const f=await setup(t),file=path.join(f.projectDir,'Assets/Player.cs');
  if(mode==='enum')fs.writeFileSync(file,'namespace Game { public enum Player { A } }');
  if(mode==='assembly-info')fs.writeFileSync(file,'[assembly: System.Reflection.AssemblyTitle("Game")]');
  if(mode==='generic')fs.writeFileSync(file,'namespace Game { public class Player<T> {} }');
  if(mode==='abstract')fs.writeFileSync(file,'namespace Game { public abstract class Player : UnityEngine.MonoBehaviour {} }');
  if(mode==='conditional-inherited')fs.writeFileSync(file,'#if UNITY_EDITOR\nclass Lost /* { */ : Game.ComponentBase { }\n#endif');
  if(mode==='partial-declaration')fs.writeFileSync(file,'namespace Game { public partial class Player {} }');
  const graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding});
  const result=await withWorkspaceLock(f.toolkit.workspace('Game'),()=>validateUnityProject({toolkit:f.toolkit,name:'Game',projectDir:f.projectDir,graph},{editor:f.editor,runEditor:async config=>{
   const result=await engine()(config),report=JSON.parse(fs.readFileSync(config.reportFile)),row=report.scripts[0];
   if(['enum','assembly-info','generic','lost-component','conditional-inherited','partial-declaration'].includes(mode))Object.assign(row,{classification:'compiled-source',resolved:false,fullName:null});
   else if(mode==='abstract')row.classification='non-attachable';
   else if(mode==='wrong-type')row.fullName='Game.Other';
   else Object.assign(row,{classification:'unresolved',resolved:false});
   fs.writeFileSync(config.reportFile,JSON.stringify(report));return result;
  }}));
  assert.equal(result.compileReady,true,mode);assert.equal(result.bindingsVerified,['enum','assembly-info','generic','abstract'].includes(mode),mode);
 }
});
test('resumed checkpoints remain self-contained when an older ancestor is unavailable',async t=>{
 const f=await setup(t),first=await f.invoke({},engine({partial:true})),second=await f.invoke({resumeOperationId:first.operationId},engine({partial:true}));
 const ancestor=path.join(f.toolkit.workspace('Game'),'04_Notes/assets/unity-validation',first.operationId,'receipt.json');fs.renameSync(ancestor,ancestor+'.unavailable');
 const third=await f.invoke({resumeOperationId:second.operationId});assert.equal(third.bindingsVerified,true);assert.equal((await f.read(third.operationId,'assets')).items.length,2);
});
test('uncertain child closure preserves recovery without publishing a receipt',async t=>{
 const f=await setup(t);let reportFile;
 await assert.rejects(f.invoke({},async config=>{reportFile=config.reportFile;return {closed:false};}),{code:'unity_recovery_required',preserveToolchainGate:true});
 assert.equal(fs.existsSync(path.join(path.dirname(reportFile),'receipt.json')),false);
});
test('changed request bytes during Editor work cannot publish a misleading receipt',async t=>{
 const f=await setup(t);let reportFile;
 await assert.rejects(f.invoke({},async config=>{reportFile=config.reportFile;const value=await engine()(config);fs.appendFileSync(config.requestFile,' ');return value;}));
 assert.equal(fs.existsSync(path.join(path.dirname(reportFile),'receipt.json')),false);
});
test('progress exposes bounded verified completion while Editor work is pending',async t=>{
 const f=await setup(t),events=[];f.toolkit.onValidationProgress=event=>events.push(event);
 let activePath;
 const result=await f.invoke({},async config=>{
  const value=await engine({partial:true})(config),report=JSON.parse(fs.readFileSync(config.reportFile));activePath=report.assets.at(-1).path;
  report.assets.at(-1).traversal={...traversal(false),stopReason:'interrupted'};fs.writeFileSync(config.reportFile,JSON.stringify(report));
  await new Promise(resolve=>setTimeout(resolve,2050));report.assets.at(-1).traversal=traversal(true);fs.writeFileSync(config.reportFile,JSON.stringify(report));return value;
 });
 assert(events.length>=3);assert(events.some(e=>e.completedAssets===1&&e.pendingAssets===1));assert(events.every(e=>e.operationId===result.operationId&&e.requestedAssets===2));
 assert(events.filter(e=>e.currentAsset).every(e=>e.currentAsset===activePath),'Older incomplete assets must not obscure the latest observed asset');
 assert(events.some(e=>e.currentAsset===activePath&&e.pendingAssets===2),'Poll observes the last active asset before it completes');
});
