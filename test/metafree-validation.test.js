import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture} from './reconstruction-fixture.js';
import {createToolkit} from '../src/toolkit.js';
import {withWorkspaceLock,fileIdentity} from '../src/state.js';
import {selectedAssetBinding} from '../src/assets/context.js';
import {createValidationSourceSnapshot} from '../src/assets/validation-snapshot.js';
import {validateUnityProject} from '../src/unity/validation.js';
import {classifyMetaFreeSources} from '../src/unity/source-identities.js';

const editor='C:/Program Files/Unity/Hub/Editor/2022.3.62f2/Editor/Unity.exe';
const compilerAvailable=process.platform==='win32'&&fs.existsSync(editor);
async function setup(t,sources){
 const f=await fixture(t),toolkit=createToolkit(f.root,{log:()=>{}});await toolkit.init('Game');
 const input=path.join(toolkit.workspace('Game'),'01_Extracted');fs.writeFileSync(path.join(input,'GameAssembly.dll'),'native');fs.writeFileSync(path.join(input,'global-metadata.dat'),'metadata');await toolkit.scan('Game',input);
 fs.writeFileSync(path.join(f.projectDir,'ProjectSettings/ProjectVersion.txt'),'m_EditorVersion: 2022.3.62f2\n');
 for(const [name,source]of Object.entries(sources)){const file=path.join(f.projectDir,'Assets',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);}
 fs.mkdirSync(path.join(f.root,'templates/Unity'),{recursive:true});fs.writeFileSync(path.join(f.root,'templates/Unity/REToolkitValidation.cs'),'fixture helper never executed');
 const graph=await createValidationSourceSnapshot({projectDir:f.projectDir,binding:selectedAssetBinding(toolkit,'Game').binding});
 const before=graph.files.map(file=>[file.path,fileIdentity(path.join(f.projectDir,file.path)).sha256]);
 const invoke=async(mutate=()=>{})=>{const result=await withWorkspaceLock(toolkit.workspace('Game'),()=>validateUnityProject({toolkit,name:'Game',projectDir:f.projectDir,graph},{editor,runEditor:async config=>{
  const request=JSON.parse(fs.readFileSync(config.requestFile));
  const report={kind:'retoolkit-unity-observation',schemaVersion:1,runId:request.runId,graphRevision:request.graphRevision,unityVersion:request.unityVersion,complete:true,compilation:{state:'succeeded'},traversal:{policy:'reference-scan-v2'},scripts:request.scripts.map((s,i)=>({...s,guid:s.path==='Assets/Player.cs'?'a'.repeat(32):(i+1).toString(16).padStart(32,'0'),fileID:'11500000',fullName:s.path==='Assets/Player.cs'?'Game.Player':null,assembly:s.path.includes('/Editor/')?'Assembly-CSharp-Editor':'Assembly-CSharp',resolved:s.path==='Assets/Player.cs',classification:s.path==='Assets/Player.cs'?'attachable':'compiled-source'})),assets:request.assets.map(a=>({...a,loaded:true,missingScripts:0,missingReferences:0,traversal:{complete:true,objects:1,properties:2,skippedSubtrees:0,stopReason:'',objectPath:'',componentType:'',propertyPath:''}})),diagnostics:[]};
  mutate(report);fs.writeFileSync(config.reportFile,JSON.stringify(report));return {exitCode:0,closed:true,timedOut:false,logTail:''};
 }}));
 assert.deepEqual(graph.files.map(file=>[file.path,fileIdentity(path.join(f.projectDir,file.path)).sha256]),before);for(const name of Object.keys(sources))assert.equal(fs.existsSync(path.join(f.projectDir,'Assets',name+'.meta')),false);return result;};
 return {...f,graph,invoke};
}

test('missing-meta compiler sources validate enum, assembly attributes and inherited open generic Unity bases',{skip:!compilerAvailable},async t=>{
 const f=await setup(t,{'BirdType.cs':'namespace Game { public enum BirdType { A, B } }','Editor/AssemblyInfo.cs':'[assembly: System.Reflection.AssemblyTitle("Game")]','Singleton.cs':'namespace Game { public class Singleton<T> : UnityEngine.MonoBehaviour where T : Singleton<T> {} }','SingletonSO.cs':'namespace Game { public class SingletonSO<T> : UnityEngine.ScriptableObject {} }','BS_Singleton.cs':'namespace Game { public class BS_Singleton<T> : Singleton<T> where T : BS_Singleton<T> {} }'});
 const result=await f.invoke();assert.equal(result.compileReady,true);assert.equal(result.scopeBindingsVerified,true);assert.equal(result.bindingsVerified,true);
});

test('missing-meta compiler classification does not certify concrete or ambiguous declarations',{skip:!compilerAvailable},async t=>{
 const cases=[
  ['component','class Missing : UnityEngine.MonoBehaviour {}'],
  ['scriptable-object','class Missing : UnityEngine.ScriptableObject {}'],
  ['indirect-component','class Missing : Game.Player {}'],
  ['partial','partial class Missing<T> : UnityEngine.MonoBehaviour {}'],
  ['conditional','#if UNITY_EDITOR\nclass Missing<T> : UnityEngine.MonoBehaviour {}\n#endif'],
  ['incomplete','class Missing<T> : UnityEngine.MonoBehaviour {'],
  ['duplicate','class Missing<T> : UnityEngine.MonoBehaviour {} class Missing<T> {}'],
  ['concrete-descendant','class Missing<T> : UnityEngine.MonoBehaviour {} class Concrete : Missing<int> {}'],
  ['malformed-enum','enum Missing {'],
 ];
 for(const [name,source]of cases)await t.test(name,async t=>{const f=await setup(t,{'Missing.cs':source});const result=await f.invoke();assert.equal(result.compileReady,true);assert.equal(result.bindingsVerified,false);});
});

test('meta-free declarations require compiler assembly membership and unambiguous cross-file identities',{skip:!compilerAvailable},async t=>{
 for(const mode of ['wrong-assembly','unresolved','wrong-reflected-generic','duplicate-file','conditional-duplicate','partial-duplicate','original-guid'])await t.test(mode,async t=>{
  const sources={'Missing.cs':'class Missing<T> : UnityEngine.MonoBehaviour {}'};
  if(mode==='duplicate-file')sources['Duplicate.cs']='class Missing<T> {}';
  if(mode==='conditional-duplicate')sources['Duplicate.cs']='#if OTHER\nclass Missing<T> {}\n#endif';
  if(mode==='partial-duplicate')sources['Duplicate.cs']='partial class Missing<T> {}';
  const f=await setup(t,sources),result=await f.invoke(report=>{const row=report.scripts.find(s=>s.path==='Assets/Missing.cs');if(mode==='wrong-assembly')row.assembly='Other';if(mode==='unresolved'){row.classification='unresolved';row.assembly=null;}if(mode==='wrong-reflected-generic')Object.assign(row,{classification:'non-attachable',resolved:true,fullName:'Other`1'});if(mode==='original-guid')report.scripts.find(s=>s.path==='Assets/Player.cs').guid='b'.repeat(32);});
  assert.equal(result.compileReady,mode!=='original-guid');assert.equal(result.bindingsVerified,false);
 });
});

test('missing-meta non-attachable observations match exact compiler type identity',{skip:!compilerAvailable},async t=>{
 const sources={'Missing.cs':'namespace Game { public abstract class Missing : UnityEngine.MonoBehaviour {} }','Generic.cs':'namespace Game { public class Generic<T> : UnityEngine.ScriptableObject {} }','YieldHelpers.cs':'namespace Game { static class YieldHelpers { class Wait : global::UnityEngine.CustomYieldInstruction {} } }','BaseBehaviour.cs':'namespace Game { abstract class BaseBehaviour : UnityEngine.Playables.PlayableBehaviour {} abstract class BaseBehaviour<T> : BaseBehaviour {} }'};
 const fullNames={'Assets/Missing.cs':'Game.Missing','Assets/Generic.cs':'Game.Generic`1','Assets/YieldHelpers.cs':'Game.YieldHelpers','Assets/BaseBehaviour.cs':'Game.BaseBehaviour'};
 const f=await setup(t,sources),result=await f.invoke(report=>{for(const row of report.scripts.filter(row=>row.path!=='Assets/Player.cs'))Object.assign(row,{classification:'non-attachable',resolved:true,fullName:fullNames[row.path],nonAttachableTypes:[fullNames[row.path],...(row.path==='Assets/YieldHelpers.cs'?['Game.YieldHelpers+Wait']:[])]});});
 assert.equal(result.compileReady,true);assert.equal(result.bindingsVerified,true);
});

test('outer reflection leaves unlisted inherited helpers unknown across aliases and shadow names',{skip:!compilerAvailable},async t=>{
 for(const mode of ['local-shadow','cross-file-shadow','using-alias','global-alias','escaped-alias'])await t.test(mode,async t=>{
  const sources={'Missing.cs':'static class Missing { class Wait : global::UnityEngine.CustomYieldInstruction {} }'};
  if(mode==='local-shadow')sources['Missing.cs']+=' class CustomYieldInstruction : UnityEngine.MonoBehaviour {}';
  if(mode==='cross-file-shadow')sources['Other.cs']='class CustomYieldInstruction : UnityEngine.MonoBehaviour {}';
  if(mode==='using-alias')sources['Missing.cs']='using CustomYieldInstruction = UnityEngine.MonoBehaviour; '+sources['Missing.cs'];
  if(mode==='global-alias')sources['Other.cs']='global using CustomYieldInstruction = UnityEngine.MonoBehaviour;';
  if(mode==='escaped-alias')sources['Other.cs']='global using CustomYield\\u0049nstruction = UnityEngine.MonoBehaviour;';
  const f=await setup(t,sources),result=await f.invoke(report=>{Object.assign(report.scripts.find(row=>row.path==='Assets/Missing.cs'),{classification:'non-attachable',resolved:true,fullName:'Missing'});});
  assert.equal(result.compileReady,true);assert.equal(result.bindingsVerified,false);
 });
});

test('reflected non-attachable sources cannot mask concrete Unity descendants or wrong identities',{skip:!compilerAvailable},async t=>{
 for(const [mode,source]of [
  ['hidden-component','abstract class Missing : UnityEngine.MonoBehaviour {} class Hidden : UnityEngine.MonoBehaviour {}'],
  ['hidden-descendant','abstract class Missing : UnityEngine.MonoBehaviour {} class Hidden : Missing {}'],
  ['hidden-nested','static class Missing { class Hidden : UnityEngine.ScriptableObject {} }'],
  ['wrong-type','abstract class Missing : UnityEngine.MonoBehaviour {}'],
  ['wrong-assembly','abstract class Missing : UnityEngine.MonoBehaviour {}'],
  ['attachable','class Missing : UnityEngine.MonoBehaviour {}'],
 ])await t.test(mode,async t=>{
  const f=await setup(t,{'Missing.cs':source}),result=await f.invoke(report=>{const row=report.scripts.find(row=>row.path==='Assets/Missing.cs');Object.assign(row,{classification:mode==='attachable'?'attachable':'non-attachable',resolved:true,fullName:mode==='wrong-type'?'Other':'Missing',...(mode==='wrong-assembly'?{assembly:'Other'}:{})});});assert.equal(result.compileReady,true);assert.equal(result.bindingsVerified,false);
 });
});

test('unreflected helper ancestry cannot use incomplete compiler declaration inventories',{skip:!compilerAvailable},async t=>{
 const f=await setup(t,{'Missing.cs':'static class Missing { class Wait : Data {} }','Data.cs':'class Data {}','Conditional.cs':'#if HIDDEN\nclass Data : UnityEngine.MonoBehaviour {}\n#endif'});
 const assets=f.graph.assets.filter(asset=>asset.kind==='script'),target=assets.find(asset=>asset.path==='Assets/Missing.cs');
 const classification=await classifyMetaFreeSources({assets,targets:[target],files:f.graph.files,projectDir:f.projectDir,editorPath:editor,observations:[{assetId:target.id,path:target.path,assembly:target.script.assembly,classification:'non-attachable',resolved:true,fullName:'Missing'}]});
 assert.equal(classification.verified.has(target.id),false);
 const result=await f.invoke(report=>{for(const row of report.scripts){if(row.path==='Assets/Missing.cs')Object.assign(row,{classification:'non-attachable',resolved:true,fullName:'Missing'});if(row.path==='Assets/Conditional.cs')Object.assign(row,{classification:'non-attachable',resolved:true,fullName:'Data'});}});
 assert.equal(result.bindingsVerified,false);
});

test('unreflected ancestry cannot reinterpret aliases as plain source namespace inheritance',{skip:!compilerAvailable},async t=>{
 for(const mode of ['scoped','global'])await t.test(mode,async t=>{
  const sources={'Missing.cs':'namespace Game { '+(mode==='scoped'?'using B = UnityEngine; ':'')+'static class Missing { class Hidden : B.MonoBehaviour {} } } namespace B { class MonoBehaviour {} }'};
  if(mode==='global')sources['Aliases.cs']='global using B = UnityEngine;';
  const f=await setup(t,sources),result=await f.invoke(report=>{Object.assign(report.scripts.find(row=>row.path==='Assets/Missing.cs'),{classification:'non-attachable',resolved:true,fullName:'Game.Missing'});});
  assert.equal(result.bindingsVerified,false);
 });
});

test('unqualified external yield base remains unknown despite a reflected outer class',{skip:!compilerAvailable},async t=>{
 const f=await setup(t,{'Missing.cs':'using UnityEngine; namespace Game { static class Missing { class Wait : CustomYieldInstruction {} } }'});
 const result=await f.invoke(report=>Object.assign(report.scripts.find(row=>row.path==='Assets/Missing.cs'),{classification:'non-attachable',resolved:true,fullName:'Game.Missing'}));
 assert.equal(result.bindingsVerified,false);
});

test('exact nested reflection inventory certifies an inherited yield helper without guessing its base',{skip:!compilerAvailable},async t=>{
 const f=await setup(t,{'Missing.cs':'using UnityEngine; namespace Game { static class Missing { class Wait : CustomYieldInstruction {} } }'});
 const result=await f.invoke(report=>Object.assign(report.scripts.find(row=>row.path==='Assets/Missing.cs'),{classification:'non-attachable',resolved:true,fullName:'Game.Missing',nonAttachableTypes:['Game.Missing','Game.Missing+Wait']}));
 assert.equal(result.compileReady,true);assert.equal(result.bindingsVerified,true);
});

test('nested inherited concrete declarations require their own exact reflected inventory entry',{skip:!compilerAvailable},async t=>{
 for(const [mode,source]of [
  ['plain-parent','class Base {} static class Missing { class Wait : Base {} }'],
  ['hidden-component','static class Missing { class Wait : UnityEngine.MonoBehaviour {} }'],
  ['hidden-scriptable','static class Missing { class Wait : UnityEngine.ScriptableObject {} }'],
  ['wrong-nested-name','static class Missing { class Wait : SomeBase {} }'],
 ])await t.test(mode,async t=>{
  const f=await setup(t,{'Missing.cs':source}),result=await f.invoke(report=>Object.assign(report.scripts.find(row=>row.path==='Assets/Missing.cs'),{classification:'non-attachable',resolved:true,fullName:'Missing',nonAttachableTypes:['Missing',...(mode==='wrong-nested-name'?['Other+Wait']:[])]}));
  assert.equal(result.compileReady,true);assert.equal(result.bindingsVerified,false);
 });
});
