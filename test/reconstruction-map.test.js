import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './reconstruction-fixture.js';
test('script map preserves exact identity, component IDs and unverified logic',async t=>{
  const {scriptMap}=await fixture(t); const script=scriptMap.scripts[0];
  assert.equal(script.identity.fullName,'Game.Player');assert.equal(script.identity.assembly,'Assembly-CSharp');
  assert.equal(script.guid,'a'.repeat(32));assert.ok(script.components.some(id=>id.endsWith(':9007199254740993')));
  assert.deepEqual(script.serializedFields.map(f=>f.name),['health']);assert.equal(script.state.logic,'unverified');
});
test('dump mapping requires verified hash/build and exact assembly plus full name',async t=>{
  const {graph,projectDir}=await fixture(t);const {buildScriptMap}=await import('../src/reconstruction/map.js');
  const text='// Image 0: Assembly-CSharp.dll - 0\n// Namespace: Game\npublic class Player : MonoBehaviour // TypeDefIndex: 0\n{\n// RVA: 0x1234 Offset: 0x1234 VA: 0x1234\npublic void Run() { }\n}\n';
  const dump={text,sha256:createHash('sha256').update(text).digest('hex'),verified:true,build:graph.binding};
  const map=await buildScriptMap(graph,{projectDir,dump});assert.equal(map.scripts[0].state.metadata,'matched');assert.equal(map.scripts[0].methods[0].rva,'0x1234');
  const wrong=text.replace('Namespace: Game','Namespace: Else');const no=await buildScriptMap(graph,{projectDir,dump:{...dump,text:wrong,sha256:createHash('sha256').update(wrong).digest('hex')}});assert.equal(no.scripts[0].state.metadata,'unmatched');
  await assert.rejects(buildScriptMap(graph,{projectDir,dump:{...dump,sha256:'f'.repeat(64)}}),/dump/i);
  const unknown=await buildScriptMap(graph,{projectDir,dump:{...dump,verified:false}});assert.equal(unknown.scripts[0].state.metadata,'unverified');
});
test('same full type in two scripts is an ambiguous identity',async t=>{
  const {graph,projectDir}=await fixture(t);const {buildScriptMap}=await import('../src/reconstruction/map.js');
  const duplicate=structuredClone(graph.assets.find(a=>a.script));duplicate.id='asset:'+'b'.repeat(32);duplicate.guid='b'.repeat(32);duplicate.path='Assets/Duplicate.cs';graph.assets.push(duplicate);
  const map=await buildScriptMap(graph,{projectDir});assert.equal(map.scripts[0].state.identity,'ambiguous');
});
test('component binding requires the exact supported local fileID and resolved script edge',async t=>{
  const f=await fixture(t),{indexUnityProject}=await import('../src/assets/graph.js'),{buildScriptMap}=await import('../src/reconstruction/map.js');
  assert.equal(f.scriptMap.scripts[0].components.length,1);
  await fs.writeFile(path.join(f.projectDir,'Assets/Main.unity'),f.files['Assets/Main.unity'].replace('fileID: 11500000','fileID: 123'));
  const graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding}),map=await buildScriptMap(graph,{projectDir:f.projectDir}),script=map.scripts[0];
  assert.equal(graph.edges.find(e=>e.kind==='script').status,'missing');
  assert.deepEqual(script.components,[]);assert.equal(script.unresolvedBindings[0].fileID,'123');assert.equal(script.state.bindings,'unresolved');
  assert.ok(script.limitations.some(v=>/local fileID|binding/.test(v)));
});
function observation(build){return {kind:'retoolkit-evidence',schemaVersion:1,query:{method:'functions.decompile',params:{selector:'ram:0x2234',limit:1}},build:{native:{...build.native,abi:'unknown'},metadata:build.metadata},programIdentity:{program:'libil2cpp.so',projectName:'Game',sha256:build.native.sha256,imageBase:'ram:0x1000'},runId:'11111111-1111-4111-8111-111111111111',revision:1,collectedAt:'2026-10-20T00:00:00.000Z',result:{items:[{line:1,text:'synthetic native observation'}],nextCursor:null,address:'ram:0x2234'},coverage:{state:'observed',source:'loaded-program',explanation:'One observed function'},limitations:[],dataTrust:'untrusted-target-content'};}
test('native evidence requires exact selected build/Program and matches method RVA independently of text',async t=>{
  const {graph,projectDir}=await fixture(t);const {buildScriptMap}=await import('../src/reconstruction/map.js');
  graph.binding.program='libil2cpp.so';graph.binding.projectName='Game';
  const text='// Image 0: Assembly-CSharp.dll - 0\n// Namespace: Game\npublic class Player : MonoBehaviour // TypeDefIndex: 0\n{\n// RVA: 0x1234 Offset: 0x1234 VA: 0x1234\npublic void Run() { }\n}\n';
  const dump={text,sha256:createHash('sha256').update(text).digest('hex'),verified:true,build:graph.binding},evidence=observation(graph.binding);
  const map=await buildScriptMap(graph,{projectDir,dump,evidence:[evidence]});assert.equal(map.scripts[0].methods[0].evidence.length,1);assert.equal(map.scripts[0].state.logic,'unverified');
  for(const mutate of [e=>e.build.metadata.sha256='f'.repeat(64),e=>e.programIdentity.program='Wrong',e=>e.programIdentity.projectName='Wrong']){const wrong=structuredClone(evidence);mutate(wrong);await assert.rejects(buildScriptMap(graph,{projectDir,dump,evidence:[wrong]}),/evidence|binding|match/i);}
  const elsewhere=structuredClone(evidence);elsewhere.result.address='ram:0x2235';assert.equal((await buildScriptMap(graph,{projectDir,dump,evidence:[elsewhere]})).scripts[0].methods[0].evidence.length,0);
});
