import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './reconstruction-fixture.js';
import {indexUnityProject} from '../src/assets/graph.js';
import {buildScriptMap} from '../src/reconstruction/map.js';
import {createReconstructionPlan,applyReconstructionPlan,verifyReconstruction} from '../src/reconstruction/plan.js';
import {fingerprint} from '../src/state.js';

const version='2022.3.62f2';
const editor=path.join(process.env.ProgramFiles??'C:/Program Files','Unity/Hub/Editor',version,'Editor/Unity.exe');
const bodySource='using UnityEngine; namespace Game { public class Player : MonoBehaviour { [SerializeField] private int health = 7; public int Count => 0; public int Size { get { return 0; } private set { health = 0; } } public class Row { public int value = 3; public int Read() { return 0; } } public void Run() {} } }';
const genericSource='using UnityEngine; namespace Game { public class Singleton<T> : MonoBehaviour where T : class, new() { private static T instance; public static T Instance { get { return null; } } public Singleton() { } protected void Awake() { } public class Row<U> { public U value; public U Read() { return default(U); } } } }';
async function available(t){try{await fs.access(editor);return true;}catch{t.skip('Exact Unity Editor Roslyn required');return false;}}
async function setup(t,{generic=false}={}){
 const f=await fixture(t);await fs.writeFile(path.join(f.projectDir,'ProjectSettings/ProjectVersion.txt'),`m_EditorVersion: ${version}\n`);
 const source=generic?genericSource:bodySource,target=generic?'Assets/Singleton.cs':'Assets/Player.cs';
 if(generic)await fs.writeFile(path.join(f.projectDir,target),source);else await fs.writeFile(path.join(f.projectDir,target),source);
 const graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding}),scriptMap=await buildScriptMap(graph,{projectDir:f.projectDir});
 const script=scriptMap.scripts.find(s=>s.path===target),replacement=generic?source.replace('return null;','return instance ?? (instance = new T());').replace('protected void Awake() { }','protected void Awake() { var value = Instance; }'):source.replace('Count => 0','Count => health').replace('return 0;','return health;').replace('Run() {}','Run() { health++; }');
 return {...f,graph,scriptMap,target,source,replacement,scriptId:script.scriptId,request:{kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:graph.revision,changes:[{scriptId:script.scriptId,source:replacement,mode:'bodies'}]}};
}

test('body mode replaces property and nested method bodies preserving serialized bytes',async t=>{
 if(!await available(t))return;const f=await setup(t);assert.equal(f.graph.assets.find(a=>a.id===f.scriptId).script.supported,false);
 const plan=await createReconstructionPlan(f);assert.equal(plan.changes[0].mode,'bodies');
 assert.equal(plan.changes[0].identity.contract.kind,'retoolkit-csharp-body-contract');
 const receipt=await applyReconstructionPlan({...f,plan});assert.equal(receipt.compileReady,false);assert.equal((await verifyReconstruction({...f,receipt})).valid,true);
 assert.equal(await fs.readFile(path.join(f.projectDir,f.target),'utf8'),f.replacement);
 assert.equal(await fs.readFile(path.join(f.projectDir,'Assets/Player.cs.meta'),'utf8'),f.files['Assets/Player.cs.meta']);
 assert.equal(await fs.readFile(path.join(f.projectDir,'Assets/Main.unity'),'utf8'),f.files['Assets/Main.unity']);
 assert.deepEqual(await applyReconstructionPlan({...f,plan}),receipt);
});

test('body mode supports exact existing generic compiler source without inventing meta or GUID',async t=>{
 if(!await available(t))return;const f=await setup(t,{generic:true}),plan=await createReconstructionPlan(f),change=plan.changes[0];
 assert.equal(change.guid,null);assert.equal(change.meta,null);assert.equal(change.identity.targetKind,'generic-source');
 assert(change.identity.contract.types.some(type=>type.fullName==='Game.Singleton`1'));
 assert(change.identity.contract.types.some(type=>type.fullName==='Game.Singleton`1+Row`1'));
 const receipt=await applyReconstructionPlan({...f,plan});assert.equal((await verifyReconstruction({...f,receipt})).valid,true);
 await assert.rejects(fs.access(path.join(f.projectDir,f.target+'.meta')),{code:'ENOENT'});
 assert.deepEqual(await applyReconstructionPlan({...f,plan}),receipt);
});

test('body mode rederives declaration contract for a rehashed forged plan',async t=>{
 if(!await available(t))return;const f=await setup(t),original=await createReconstructionPlan(f);
 const {createHash}=await import('node:crypto');
 for(const mutate of [p=>{p.changes[0].source=p.changes[0].source.replace('health = 7','health = 8');},p=>{p.changes[0].identity.contract.parser={forged:true};}]){
  const plan=structuredClone(original);mutate(plan);plan.changes[0].afterSha256=createHash('sha256').update(plan.changes[0].source).digest('hex');plan.changes[0].afterSize=Buffer.byteLength(plan.changes[0].source);
  const {payloadSha256,...rest}=plan;plan.payloadSha256=fingerprint(rest);
  await assert.rejects(applyReconstructionPlan({...f,plan}),/contract|declaration|identity|parser/i);
 }
 assert.equal(await fs.readFile(path.join(f.projectDir,f.target),'utf8'),f.source);
});

test('generic source mode preserves meta absence, complete inventory and rollback',async t=>{
 if(!await available(t))return;
 for(const mode of ['meta-added','rollback']){
  const f=await setup(t,{generic:true}),plan=await createReconstructionPlan(f);
  if(mode==='meta-added')await fs.writeFile(path.join(f.projectDir,f.target+'.meta'),'fileFormatVersion: 2\nguid: cccccccccccccccccccccccccccccccc\n');
  await assert.rejects(applyReconstructionPlan({...f,plan,onEvent:async e=>{if(mode==='rollback'&&e.phase==='published')throw Error('injected body rollback');}}),/stale|changed|inventory|injected/i);
  assert.equal(await fs.readFile(path.join(f.projectDir,f.target),'utf8'),f.source);
 }
});

test('body target ambiguity is derived from source inventory even if a graph omits a script',async t=>{
 if(!await available(t))return;const f=await setup(t,{generic:true});
 await fs.writeFile(path.join(f.projectDir,'Assets/Hidden.cs'),genericSource);
 const graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding});
 graph.assets=graph.assets.filter(asset=>asset.path!=='Assets/Hidden.cs');
 const scriptMap=await buildScriptMap(graph,{projectDir:f.projectDir});
 await assert.rejects(createReconstructionPlan({...f,graph,scriptMap,request:{...f.request,graphRevision:graph.revision}}),/ambiguous/i);
});

test('body contract keeps GUID/fileID guards and refuses meta-free component classes',async t=>{
 if(!await available(t))return;
 for(const mode of ['fileID','nongeneric']){
  const f=await setup(t,{generic:mode==='nongeneric'});
  if(mode==='fileID')await fs.writeFile(path.join(f.projectDir,'Assets/Main.unity'),f.files['Assets/Main.unity'].replace('fileID: 11500000','fileID: 123'));
  else await fs.writeFile(path.join(f.projectDir,f.target),genericSource.replace('Singleton<T> : MonoBehaviour where T : class, new()','Singleton : MonoBehaviour'));
  const graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding}),scriptMap=await buildScriptMap(graph,{projectDir:f.projectDir});
  const source=await fs.readFile(path.join(f.projectDir,f.target),'utf8');
  await assert.rejects(createReconstructionPlan({...f,graph,scriptMap,request:{...f.request,graphRevision:graph.revision,changes:[{scriptId:f.scriptId,mode:'bodies',source:source.replace('return null;','return instance;')}]}}),/fileID|binding|generic|meta/i);
 }
});

test('typed MCP and job schemas expose only the explicit body mode',async()=>{
 const {assetTools}=await import('../src/assets/mcp.js'),{validateSchema}=await import('../src/jobs/definitions.js');
 const schema=assetTools.find(tool=>tool.name==='reconstruct_plan').inputSchema;
 const request={kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:'a'.repeat(64),changes:[{scriptId:'opaque:Assets/Singleton.cs',source:genericSource,mode:'bodies'}]};
 assert.doesNotThrow(()=>validateSchema({request},schema));
 assert.throws(()=>validateSchema({request:{...request,changes:[{...request.changes[0],mode:'unsafe'}]}},schema));
});

test('body batches keep same full names distinct across known compiler assemblies',async t=>{
 if(!await available(t))return;const f=await fixture(t);await fs.writeFile(path.join(f.projectDir,'ProjectSettings/ProjectVersion.txt'),`m_EditorVersion: ${version}\n`);
 for(const name of ['A','B']){
  await fs.mkdir(path.join(f.projectDir,'Assets',name));
  await fs.writeFile(path.join(f.projectDir,'Assets',name,name+'.asmdef'),JSON.stringify({name}));
  await fs.writeFile(path.join(f.projectDir,'Assets',name,'Singleton.cs'),genericSource);
 }
 const graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding}),scriptMap=await buildScriptMap(graph,{projectDir:f.projectDir});
 const changes=scriptMap.scripts.filter(script=>script.path.endsWith('/Singleton.cs')).map(script=>({scriptId:script.scriptId,mode:'bodies',source:genericSource.replace('return null;','return instance;')}));
 const plan=await createReconstructionPlan({...f,graph,scriptMap,request:{...f.request,graphRevision:graph.revision,changes}});
 assert.deepEqual(plan.changes.map(change=>change.identity.assembly),['A','B']);
});
