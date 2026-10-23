import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixture} from './reconstruction-fixture.js';
import {indexUnityProject} from '../src/assets/graph.js';
import {buildScriptMap} from '../src/reconstruction/map.js';
import {createReconstructionPlan,applyReconstructionPlan} from '../src/reconstruction/plan.js';
import {fingerprint} from '../src/state.js';
import {analyzeSourceContracts} from '../src/reconstruction/source-contract.js';
import {proveInitialization} from '../src/reconstruction/source-initialization.js';
import {inspectMetadataImageRanges} from '../src/reconstruction/dump-images.js';

const editorPath='C:/Program Files/Unity/Hub/Editor/2022.3.62f2/Editor/Unity.exe';
const sha=value=>createHash('sha256').update(value).digest('hex');
const original='namespace Game { public class Player : UnityEngine.MonoBehaviour { public int health = 7; public int Run() { return 1; } public static class Flow { public static object Signal; } } }';
const replacement=original.replace('public static object Signal;','public static object Signal; static Flow() { Signal = new object(); }').replace('public int Run()', 'public Player() { health = 9; } public int Run()');
function observation(binding,rva){return {kind:'retoolkit-evidence',schemaVersion:1,query:{method:'functions.decompile',params:{selector:`ram:0x${(0x1000+rva).toString(16)}`,limit:10}},build:{native:{...binding.native,abi:'unknown'},metadata:binding.metadata},programIdentity:{program:'libil2cpp.so',projectName:'Game',sha256:binding.native.sha256,imageBase:'ram:0x1000'},runId:'11111111-1111-4111-8111-111111111111',revision:1,collectedAt:'2026-10-20T00:00:00.000Z',result:{items:[{line:1,text:'owned native observation'}],nextCursor:null,address:`ram:0x${(0x1000+rva).toString(16)}`},coverage:{state:'observed',source:'loaded-program',explanation:'Whole observed function'},limitations:[],dataTrust:'untrusted-target-content'};}
async function setup(t){
 try{await fs.access(editorPath);}catch{t.skip('Exact Unity Editor Roslyn required');return;}
 const f=await fixture(t);await fs.writeFile(path.join(f.projectDir,'ProjectSettings/ProjectVersion.txt'),'m_EditorVersion: 2022.3.62f2\n');
 await fs.writeFile(path.join(f.projectDir,'Assets/Player.cs'),original);
 const binding={...f.graph.binding,program:'libil2cpp.so',projectName:'Game'};
 const graph=await indexUnityProject(f.projectDir,{binding}),evidence=[observation(binding,0x1234),observation(binding,0x5678)];
 const text='// Image 0: Assembly-CSharp.dll - 0\n// Namespace: Game\npublic class Player : MonoBehaviour // TypeDefIndex: 0\n{\n// RVA: 0x1234 Offset: 0x1234 VA: 0x1234\npublic void .ctor() { }\n}\n// Namespace: Game\npublic static class Player.Flow // TypeDefIndex: 1\n{\n// RVA: 0x5678 Offset: 0x5678 VA: 0x5678\nprivate static void .cctor() { }\n}\n';
 const dump={text,sha256:sha(text),verified:true,build:binding},scriptMap=await buildScriptMap(graph,{projectDir:f.projectDir,dump,evidence}),scriptId=scriptMap.scripts.find(s=>s.path==='Assets/Player.cs').scriptId;
 const constructors=[{fullName:'Game.Player',kind:'instance',evidenceId:fingerprint(evidence[0])},{fullName:'Game.Player+Flow',kind:'static',evidenceId:fingerprint(evidence[1])}];
 return {...f,graph,scriptMap,dump,evidence,editorPath,request:{kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:graph.revision,changes:[{scriptId,mode:'initialization',source:replacement,constructors}]}};
}
test('explicit initialization adds only evidenced missing nested static and parameterless instance constructors and retries safely',async t=>{
 const f=await setup(t);if(!f)return;
 const plan=await createReconstructionPlan(f);assert.equal(plan.changes[0].mode,'initialization');
 assert.equal(plan.changes[0].initializationProof.constructors.length,2);
 const receipt=await applyReconstructionPlan({...f,plan});assert.equal(receipt.compileReady,false);
 assert.equal(await fs.readFile(path.join(f.projectDir,'Assets/Player.cs'),'utf8'),replacement);
 assert.deepEqual(await applyReconstructionPlan({...f,plan}),receipt);
});

test('initialization native proof rejects missing, stale, ambiguous and incomplete metadata/evidence independently of pseudocode text',async t=>{
 const f=await setup(t);if(!f)return;const change=f.request.changes[0];
 const analysis=await analyzeSourceContracts({projectDir:f.projectDir,editorPath,documents:[{path:'before.cs',source:original},{path:'after.cs',source:replacement,omitConstructors:change.constructors.map(({fullName,kind})=>({fullName,kind}))}]});
 const proofInput={change,before:analysis.documents[0],after:analysis.documents[1],originalSource:original,assembly:'Assembly-CSharp',graph:f.graph,dump:f.dump,evidence:f.evidence};
 assert.equal(proveInitialization(proofInput).constructors.length,2);
 for(const mutate of [
  x=>{x.dump.verified=false;},
  x=>{x.dump.build.native.sha256='f'.repeat(64);},
  x=>{x.dump.sha256='f'.repeat(64);},
  x=>{x.dump.text=x.dump.text.replace('.cctor()','.cctor(int value)');x.dump.sha256=sha(x.dump.text);},
  x=>{x.dump.text=x.dump.text.replace('Player.Flow','Other.Flow');x.dump.sha256=sha(x.dump.text);},
  x=>{x.dump.text=x.dump.text.replace('Player.Flow','Player.Flow<T>');x.dump.sha256=sha(x.dump.text);},
  x=>{x.dump.text=x.dump.text.replace('Assembly-CSharp.dll','Other.dll');x.dump.sha256=sha(x.dump.text);},
  x=>{x.dump.text=x.dump.text.replace('RVA: 0x5678','RVA: 0x0');x.dump.sha256=sha(x.dump.text);},
  x=>{x.evidence[1].result.address='ram:0x6679';},
  x=>{x.evidence[1].result.address='other:0x6678';},
  x=>{x.evidence[1].build.metadata.sha256='f'.repeat(64);},
  x=>{x.evidence[1].programIdentity.projectName='Other';},
  x=>{x.evidence[1].programIdentity.program='Other.so';},
  x=>{x.evidence[1].result.items=[];},
  x=>{x.evidence[1].query.params.cursor='invalid';},
  x=>{const e=x.evidence[1];e.result.nextCursor=Buffer.from(JSON.stringify({runId:e.runId,method:e.query.method,revision:e.revision,offset:1,binding:{selector:e.query.params.selector}})).toString('base64url');e.coverage.state='partial';},
  x=>{x.evidence.push(structuredClone(x.evidence[1]));},
 ]){
  const input=structuredClone(proofInput);mutate(input);
  // Keep the request ID tied to the changed envelope; rejection must rely on
  // the actual build/address/coverage check, not simply a stale envelope ID.
  input.change.constructors[1].evidenceId=fingerprint(input.evidence[1]);
  assert.throws(()=>proveInitialization(input));
 }
 const textOnly=structuredClone(proofInput);textOnly.evidence[1].result.items[0].text='This text claims class Other .ctor';textOnly.change.constructors[1].evidenceId=fingerprint(textOnly.evidence[1]);
 assert.doesNotThrow(()=>proveInitialization(textOnly),'text is untrusted observation, never a declaration proof');
});

test('symbolic dump headers require authenticated same-build raw metadata image ranges for constructor proof',async t=>{
 const f=await setup(t);if(!f)return;
 const strings=Buffer.from('Assembly-CSharp.dll\0Other.dll\0'),typeBytes=88*3,imageOffset=256+strings.length+typeBytes,raw=Buffer.alloc(imageOffset+80);
 raw.writeUInt32LE(0xfab11baf,0);raw.writeUInt32LE(31,4);raw.writeUInt32LE(256,24);raw.writeUInt32LE(strings.length,28);raw.writeUInt32LE(256+strings.length,160);raw.writeUInt32LE(typeBytes,164);raw.writeUInt32LE(imageOffset,168);raw.writeUInt32LE(80,172);strings.copy(raw,256);
 for(const [index,name,start,count] of [[0,0,0,2],[1,20,2,1]]){const at=imageOffset+index*40;raw.writeUInt32LE(name,at);raw.writeUInt32LE(index,at+4);raw.writeInt32LE(start,at+8);raw.writeUInt32LE(count,at+12);}
 const imageRanges=inspectMetadataImageRanges(raw),graph=structuredClone(f.graph);graph.binding.metadata=imageRanges.metadata;
 const evidence=f.evidence.map(e=>({...structuredClone(e),build:{...e.build,metadata:imageRanges.metadata}}));
 const change=structuredClone(f.request.changes[0]);change.constructors.forEach((c,index)=>{c.evidenceId=fingerprint(evidence[index]);});
 const analysis=await analyzeSourceContracts({projectDir:f.projectDir,editorPath,documents:[{path:'before.cs',source:original},{path:'after.cs',source:replacement,omitConstructors:change.constructors.map(({fullName,kind})=>({fullName,kind}))}]});
 const text=f.dump.text.replace('// Image 0: Assembly-CSharp.dll - 0','// Image 0: Assembly-CSharp.dll - Il2CppDumper.TypeDefinitionIndex\n// Image 1: Other.dll - Il2CppDumper.TypeDefinitionIndex');
 const dump={...f.dump,build:graph.binding,text,sha256:sha(text),imageRanges},input={change,before:analysis.documents[0],after:analysis.documents[1],originalSource:original,assembly:'Assembly-CSharp',graph,dump,evidence};
 assert.equal(proveInitialization(input).dump.imageRangesSha256,fingerprint(imageRanges));
 for(const badDump of [
  {...dump,imageRanges:undefined},
  {...dump,imageRanges:structuredClone(imageRanges)},
  {...dump,build:{...dump.build,metadata:{...dump.build.metadata,sha256:'f'.repeat(64)}}},
  {...dump,text:text.replace('TypeDefIndex: 1','TypeDefIndex: 2'),sha256:sha(text.replace('TypeDefIndex: 1','TypeDefIndex: 2'))},
  {...dump,text:text.replace('Other.dll','Wrong.dll'),sha256:sha(text.replace('Other.dll','Wrong.dll'))},
 ])assert.throws(()=>proveInitialization({...input,dump:badDump}));
 const wrongRanges=inspectMetadataImageRanges(raw);wrongRanges.images[0].count=3;
 assert.throws(()=>proveInitialization({...input,dump:{...dump,imageRanges:wrongRanges}}));
});

test('initialization Roslyn guard preserves every existing body, member, attribute and initializer token',async t=>{
 const f=await setup(t);if(!f)return;const change=f.request.changes[0],omitConstructors=change.constructors.map(({fullName,kind})=>({fullName,kind}));
 const invalid=[
  replacement.replace('health = 7','health = 8'),
  replacement.replace('return 1;','return 2;'),
  replacement.replace('public int Run()','[System.Obsolete] public int Run()'),
  replacement.replace('public static object Signal;','public static object Signal = new object();'),
  replacement.replace('public static object Signal;','public static object Signal; public static int Extra;'),
  replacement.replace('public static object Signal;','public static object Signal; public static void Extra() {}'),
  replacement.replace('public Player() {','public Player() : base() {'),
  replacement.replace('static Flow() {','[System.Obsolete] static Flow() {'),
  replacement.replace('public Player() {','private Player() {'),
 ];
 // One owned parser invocation covers the complete candidate matrix.
 const analysis=await analyzeSourceContracts({projectDir:f.projectDir,editorPath,documents:[{path:'before.cs',source:original},...invalid.map((source,index)=>({path:`invalid-${index}.cs`,source,omitConstructors}))]});
 for(const after of analysis.documents.slice(1))assert.throws(()=>proveInitialization({change,before:analysis.documents[0],after,originalSource:original,assembly:'Assembly-CSharp',graph:f.graph,dump:f.dump,evidence:f.evidence}));
});

test('initialization rejects existing constructors, wrong target kinds, overloads and undeclared additions',async t=>{
 const f=await setup(t);if(!f)return;
 const originalWithCtor=original.replace('public int Run()','public Player() {} public int Run()');
 const docs=await analyzeSourceContracts({projectDir:f.projectDir,editorPath,documents:[{path:'existing.cs',source:originalWithCtor},{path:'after.cs',source:replacement,omitConstructors:f.request.changes[0].constructors.map(({fullName,kind})=>({fullName,kind}))}]});
 assert.throws(()=>proveInitialization({change:f.request.changes[0],before:docs.documents[0],after:docs.documents[1],originalSource:originalWithCtor,assembly:'Assembly-CSharp',graph:f.graph,dump:f.dump,evidence:f.evidence}));
 for(const [source,constructors] of [
  [replacement.replace('public Player()','public Player(int value)'),f.request.changes[0].constructors],
  [replacement.replace('public Player() { health = 9; }','public Player() => health = 9;'),f.request.changes[0].constructors],
  [replacement.replace('public class Player : UnityEngine.MonoBehaviour','public struct Player'),f.request.changes[0].constructors],
  [replacement,f.request.changes[0].constructors.slice(0,1)],
  [replacement,f.request.changes[0].constructors.map(c=>({...c,fullName:'Game.Other'}))],
  [replacement,[...f.request.changes[0].constructors,{...f.request.changes[0].constructors[0],rva:'0x1234'}]],
 ])await assert.rejects(createReconstructionPlan({...f,request:{...f.request,changes:[{...f.request.changes[0],source,constructors}]}}));
});

test('initialization apply rederives syntax/native proof and checks fresh dump even for a completed receipt',async t=>{
 const f=await setup(t);if(!f)return;const originalPlan=await createReconstructionPlan(f);
 for(const mutate of [
  p=>{p.changes[0].source=p.changes[0].source.replace('return 1;','return 2;');},
  p=>{p.changes[0].initializationProof.dump.sha256='f'.repeat(64);},
  p=>{p.changes[0].initializationProof.originalSource=original.replace('health = 7','health = 8');},
  p=>{p.changes[0].initializationProof.constructors[1].metadata.rva='0x1234';},
  p=>{p.changes[0].identity.contract.tokenSha256='f'.repeat(64);},
 ]){
  const plan=structuredClone(originalPlan);mutate(plan);const c=plan.changes[0];c.afterSha256=sha(c.source);c.afterSize=Buffer.byteLength(c.source);const {payloadSha256,...rest}=plan;plan.payloadSha256=fingerprint(rest);
  await assert.rejects(applyReconstructionPlan({...f,plan}));
 }
 await applyReconstructionPlan({...f,plan:originalPlan});
 const text=f.dump.text.replace('RVA: 0x5678','RVA: 0x5679');
 await assert.rejects(applyReconstructionPlan({...f,plan:originalPlan,dump:{...f.dump,text,sha256:sha(text)}}));
 await assert.rejects(applyReconstructionPlan({...f,plan:originalPlan,dump:undefined}));
});

test('initialization context races roll back publication and repeated receipts still require current context',async t=>{
 const f=await setup(t);if(!f)return;const plan=await createReconstructionPlan(f);let contextCurrent=true;
 await assert.rejects(applyReconstructionPlan({...f,plan,assertContextCurrent:async()=>{assert(contextCurrent,'fresh native/dump context changed');},onEvent:async event=>{if(event.phase==='published')contextCurrent=false;}}),/context changed/);
 assert.equal(await fs.readFile(path.join(f.projectDir,'Assets/Player.cs'),'utf8'),original);
 const next=await createReconstructionPlan(f);await applyReconstructionPlan({...f,plan:next});
 await assert.rejects(applyReconstructionPlan({...f,plan:next,assertContextCurrent:async()=>{throw Error('fresh native/dump context changed');}}),/context changed/);
});

test('typed reconstruction schema exposes strict initialization declarations and forbids caller supplied RVAs',async()=>{
 const {assetTools}=await import('../src/assets/mcp.js'),{validateSchema}=await import('../src/jobs/definitions.js');
 const schema=assetTools.find(tool=>tool.name==='reconstruct_plan').inputSchema;
 const request={kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:'a'.repeat(64),changes:[{scriptId:'opaque:Assets/Player.cs',source:replacement,mode:'initialization',constructors:[{fullName:'Game.Player',kind:'instance',evidenceId:'a'.repeat(64)}]}]};
 assert.doesNotThrow(()=>validateSchema({request},schema));
 request.changes[0].constructors[0].rva='0x1234';assert.throws(()=>validateSchema({request},schema));
});

const dataSource='using System.Collections.Generic; namespace Game { public class PoolRow { public List<object> InactiveObjects; public int Count() { return 0; } } }';
async function dataSetup(t,source=dataSource){
 const f=await setup(t);if(!f)return;
 await fs.writeFile(path.join(f.projectDir,'Assets/PoolRow.cs'),source);
 const graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding}),evidence=[observation(graph.binding,0x1234)];
 const text='// Image 0: Assembly-CSharp.dll - 0\n// Namespace: Game\npublic class PoolRow // TypeDefIndex: 0\n{\n// RVA: 0x1234 Offset: 0x1234 VA: 0x1234\npublic void .ctor() { }\n}\n';
 const dump={text,sha256:sha(text),verified:true,build:graph.binding},scriptMap=await buildScriptMap(graph,{projectDir:f.projectDir,dump,evidence});
 const scriptId='opaque:Assets/PoolRow.cs',replacement=source.replace('public int Count()', 'public PoolRow() { InactiveObjects = new List<object>(); } public int Count()');
 const request={kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:graph.revision,changes:[{scriptId,mode:'initialization',source:replacement,constructors:[{fullName:'Game.PoolRow',kind:'instance',evidenceId:fingerprint(evidence[0])}]}]};
 return {...f,graph,scriptMap,dump,evidence,request,replacement};
}
test('evidenced nongeneric compiler-only data constructor applies and retries without inventing meta',async t=>{
 const f=await dataSetup(t);if(!f)return;
 const plan=await createReconstructionPlan(f);assert.equal(plan.changes[0].identity.targetKind,'data-source');assert.equal(plan.changes[0].guid,null);assert.equal(plan.changes[0].meta,null);
 const receipt=await applyReconstructionPlan({...f,plan});assert.equal(receipt.compileReady,false);
 assert.equal(await fs.readFile(path.join(f.projectDir,'Assets/PoolRow.cs'),'utf8'),f.replacement);
 await assert.rejects(fs.access(path.join(f.projectDir,'Assets/PoolRow.cs.meta')),{code:'ENOENT'});
 assert.deepEqual(await applyReconstructionPlan({...f,plan}),receipt);
 const graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding}),scriptMap=await buildScriptMap(graph,{projectDir:f.projectDir});
 const request={...f.request,graphRevision:graph.revision,changes:[{scriptId:'opaque:Assets/PoolRow.cs',mode:'bodies',source:f.replacement.replace('return 0;','return InactiveObjects.Count;')}]};
 const bodyPlan=await createReconstructionPlan({...f,graph,scriptMap,request});assert.equal(bodyPlan.changes[0].identity.targetKind,'data-source');
 await applyReconstructionPlan({...f,graph,plan:bodyPlan});
});
test('meta-free data constructor refuses inheritance, missing proof and identity changes',async t=>{
 const f=await dataSetup(t);if(!f)return;
 await assert.rejects(createReconstructionPlan({...f,evidence:[]}),/evidence/i);
 const plan=await createReconstructionPlan(f);
 await fs.writeFile(path.join(f.projectDir,'Assets/PoolRow.cs.meta'),'guid: eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\n');
 await assert.rejects(applyReconstructionPlan({...f,plan}),/meta|inventory|changed|identity/i);
 await fs.unlink(path.join(f.projectDir,'Assets/PoolRow.cs.meta'));
 const claimed=structuredClone(f.graph);claimed.edges.push({from:claimed.nodes[0].id,to:'opaque:Assets/PoolRow.cs',kind:'script',field:'m_Script',fileID:'11500000',status:'resolved'});
 await assert.rejects(createReconstructionPlan({...f,graph:claimed}),/binding|fileID/i);
 await fs.writeFile(path.join(f.projectDir,'Assets/Duplicate.cs'),dataSource);
 const duplicate=await indexUnityProject(f.projectDir,{binding:f.graph.binding}),duplicateMap=await buildScriptMap(duplicate,{projectDir:f.projectDir});
 await assert.rejects(createReconstructionPlan({...f,graph:duplicate,scriptMap:duplicateMap,request:{...f.request,graphRevision:duplicate.revision}}),/ambiguous/i);
 await fs.unlink(path.join(f.projectDir,'Assets/Duplicate.cs'));
 for(const base of ['UnityEngine.MonoBehaviour','UnityEngine.ScriptableObject','UnknownBase','object']){
  const source=dataSource.replace('class PoolRow {',`class PoolRow : ${base} {`);
  await fs.writeFile(path.join(f.projectDir,'Assets/PoolRow.cs'),source);
  const graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding}),scriptMap=await buildScriptMap(graph,{projectDir:f.projectDir});
  const request={...f.request,graphRevision:graph.revision,changes:[{...f.request.changes[0],source:source.replace('public int Count()', 'public PoolRow() { InactiveObjects = new List<object>(); } public int Count()')}]};
  await assert.rejects(createReconstructionPlan({...f,graph,scriptMap,request}),/meta|data|base|generic/i);
 }
});
