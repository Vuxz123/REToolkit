import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import { locateUnityProject,indexUnityProject,verifyGraphFiles,queryGraph } from '../src/assets/graph.js';
import { createUnityFixture } from './fixtures/unity-export-fixture.mjs';

async function fixture(t) { const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-graph-')); t.after(()=>fs.rm(root,{recursive:true,force:true})); return {root,...await createUnityFixture(root)}; }
test('indexes exact IDs, scripts, cross-asset and missing references, bounded revision queries',async t=>{
 const f=await fixture(t); assert.equal(await locateUnityProject(f.root),f.projectDir);
 const graph=await indexUnityProject(f.root,{binding:{build:'fixture'}}); assert.equal(graph.kind,'retoolkit-asset-graph'); assert.equal(graph.unityVersion,'2022.3.1f1');
 const node=graph.nodes.find(n=>n.fileID==='9007199254740993'); assert.equal(node.fields.health,7); assert.equal(node.scriptRef.guid,f.guids.script);
 assert.ok(graph.nodes.some(n=>n.fileID==='-9223372036854775808')); assert.ok(graph.edges.some(e=>e.fileID==='-9223372036854775808'&&e.status==='resolved')); assert.ok(graph.edges.some(e=>e.status==='missing'));
 const script=graph.assets.find(a=>a.guid===f.guids.script); assert.equal(script.script.assembly,'Assembly-CSharp'); assert.equal(script.script.types[0].fullName,'Demo.Player');
 const page=queryGraph(graph,'assets.list',{limit:1}); assert.equal(page.items.length,1); assert.equal(page.revision,graph.revision); assert.ok(page.nextCursor); assert.equal(queryGraph(graph,'assets.list',{limit:1,cursor:page.nextCursor}).items.length,1);
 assert.throws(()=>queryGraph({...graph,revision:'changed'},'assets.list',{cursor:page.nextCursor}),/cursor/); assert.throws(()=>queryGraph(graph,'assets.list',{limit:1001}),/limit/);
 assert.equal(queryGraph(graph,'assets.get',{id:node.id}).item.id,node.id); assert.ok(queryGraph(graph,'assets.refs',{id:node.id}).items.length); assert.equal(await verifyGraphFiles(f.projectDir,graph),true);
 await fs.writeFile(f.scriptPath,f.source+'// edit'); await assert.rejects(verifyGraphFiles(f.projectDir,graph),/stale_graph/);
});
test('detects added source files but ignores generated Library cache',async t=>{
 const f=await fixture(t),graph=await indexUnityProject(f.projectDir); await fs.mkdir(path.join(f.projectDir,'Library')); await fs.writeFile(path.join(f.projectDir,'Library/cache'),'cache'); assert.equal(await verifyGraphFiles(f.projectDir,graph),true); await fs.writeFile(path.join(f.projectDir,'Assets/new.bin'),'new'); await assert.rejects(verifyGraphFiles(f.projectDir,graph),/stale_graph/);
});
test('fails closed on duplicate GUIDs, YAML aliases, unsafe keys and malformed document IDs',async t=>{
 const f=await fixture(t); const original=await fs.readFile(f.scenePath,'utf8');
 for(const body of ['--- !u!1 &1\nGameObject:\n  x: &v {fileID: 1}\n  y: *v\n','--- !u!1 &1\nGameObject:\n  __proto__: bad\n','--- !u!1 &1\nGameObject: {}\n--- !u!1 &1\nGameObject: {}\n','--- !u!1 &9007199254740993.0\nGameObject: {}\n','--- !u!1 &1\nGameObject:\n  x: 1\n  x: 2\n']) { await fs.writeFile(f.scenePath,body); await assert.rejects(indexUnityProject(f.projectDir)); }
 await fs.writeFile(f.scenePath,original); await fs.writeFile(path.join(f.projectDir,'Assets/duplicate.meta'),`guid: ${f.guids.script}\n`); await assert.rejects(indexUnityProject(f.projectDir),/duplicate_guid/);
});
test('records binary assets as opaque and rejects linked roots and ambiguous projects',async t=>{
 const f=await fixture(t); await fs.writeFile(path.join(f.projectDir,'Assets/blob.asset'),Buffer.from([0,1,2])); const graph=await indexUnityProject(f.projectDir); assert.ok(graph.assets.some(a=>a.path.endsWith('blob.asset')&&a.kind==='opaque'));
 const second=path.join(f.root,'Second'); await fs.mkdir(path.join(second,'Assets'),{recursive:true}); await fs.mkdir(path.join(second,'ProjectSettings')); await assert.rejects(locateUnityProject(f.root),/ambiguous/);
 const link=path.join(f.root,'linked'); await fs.symlink(f.projectDir,link,'junction'); await assert.rejects(indexUnityProject(link),/symlink/);
});
test('preserves zero-prefixed GUIDs, classifies prefab override and UnityEvent references, reports assembly identity',async t=>{
 const f=await fixture(t),guid='00000000000000000000000000000001'; await fs.writeFile(path.join(f.projectDir,'Assets/Data.asset.meta'),`guid: ${guid}\n`); await fs.writeFile(path.join(f.projectDir,'Assets/Data.asset'),`--- !u!114 &17\nMonoBehaviour:\n  m_Name: Data\n  m_Modification:\n    m_TransformParent: {fileID: 4, guid: ${f.guids.scene}}\n  event:\n    m_PersistentCalls:\n      m_Calls:\n      - m_Target: {fileID: 9007199254740993, guid: ${f.guids.scene}}\n`); await fs.writeFile(path.join(f.projectDir,'Assets/Demo.asmdef'),JSON.stringify({name:'Demo.Runtime'}));
 const graph=await indexUnityProject(f.projectDir); assert.ok(graph.assets.some(a=>a.guid===guid)); assert.equal(graph.assets.find(a=>a.guid===f.guids.script).script.assembly,'Demo.Runtime'); assert.ok(graph.edges.some(e=>e.kind==='prefab')); assert.ok(graph.edges.some(e=>e.field==='event.m_PersistentCalls.m_Calls[0].m_Target'&&e.status==='resolved')); assert.equal(graph.nodes.find(n=>n.fileID==='17').type,'MonoBehaviour');
});
test('rejects numeric shorthand fileIDs, unknown tags, metadata aliases, excessive depth and oversized text',async t=>{
 const f=await fixture(t);for(const value of ['1e3','1.0','0x10','+1']){await fs.writeFile(f.scenePath,`--- !u!1 &1\nGameObject:\n  bad: {fileID: ${value}}\n`);await assert.rejects(indexUnityProject(f.projectDir),/invalid_file_id/);}
 await fs.writeFile(f.scenePath,'--- !u!1 &1\nGameObject:\n  bad: !Unknown value\n');await assert.rejects(indexUnityProject(f.projectDir),/yaml/);
 await fs.writeFile(f.scenePath,`--- !u!1 &1\nGameObject:\n  bad: ${'['.repeat(105)}0${']'.repeat(105)}\n`);await assert.rejects(indexUnityProject(f.projectDir),/limit/);
 await fs.writeFile(f.scenePath,'x'.repeat(16*1024*1024+1));await assert.rejects(indexUnityProject(f.projectDir),/text_file_limit/);
});
test('assembly reference boundaries explicitly block guessed source assembly identity and linked Packages',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.projectDir,'Assets/Runtime.asmref'),JSON.stringify({reference:'GUID:deadbeef'}));let graph=await indexUnityProject(f.projectDir);assert.equal(graph.assets.find(a=>a.guid===f.guids.script).script.supported,false);assert.ok(graph.assets.find(a=>a.guid===f.guids.script).script.limitations.some(l=>l.includes('asmref')));
 const external=path.join(f.root,'External');await fs.mkdir(external);await fs.symlink(external,path.join(f.projectDir,'Packages'),'junction');await assert.rejects(indexUnityProject(f.projectDir),/symlink/);
});
test('scene traversal follows hierarchy safely through cycles and pages deterministic nodes',async t=>{
 const f=await fixture(t);await fs.appendFile(f.scenePath,'--- !u!4 &5\nTransform:\n  m_Father: {fileID: 4}\n  m_GameObject: {fileID: 1}\n');const graph=await indexUnityProject(f.projectDir);const id=`object:${f.guids.scene}:4`;const tree=queryGraph(graph,'assets.tree',{id,limit:1});assert.equal(tree.items[0].fileID,'4');assert.equal(queryGraph(graph,'assets.tree',{id,limit:1,cursor:tree.nextCursor}).items[0].fileID,'5');assert.ok(queryGraph(graph,'assets.refs',{id,direction:'incoming'}).items.every(e=>e.to===id));
});
test('normalizes uppercase GUID identity and rejects fileIDs outside signed 64-bit range',async t=>{
 const f=await fixture(t);const guid='abcdefabcdefabcdefabcdefabcdefab';await fs.writeFile(path.join(f.projectDir,'Assets/Player.cs.meta'),`guid: ${guid.toUpperCase()}\n`);await fs.writeFile(f.scenePath,(await fs.readFile(f.scenePath,'utf8')).replaceAll(f.guids.script,guid.toUpperCase()));let graph=await indexUnityProject(f.projectDir);assert.equal(graph.nodes.find(n=>n.scriptRef).scriptRef.guid,guid);
 await fs.writeFile(f.scenePath,'--- !u!1 &9223372036854775808\nGameObject: {}\n');await assert.rejects(indexUnityProject(f.projectDir),/invalid_file_id/);
});
test('tree reaches child GameObjects and their components through Transform hierarchy with meaningful depth',async t=>{
 const f=await fixture(t);await fs.appendFile(f.scenePath,'--- !u!1 &2\nGameObject:\n  m_Name: Child\n  m_Component:\n  - component: {fileID: 5}\n  - component: {fileID: 6}\n--- !u!4 &5\nTransform:\n  m_Father: {fileID: 4}\n  m_GameObject: {fileID: 2}\n--- !u!114 &6\nMonoBehaviour:\n  m_GameObject: {fileID: 2}\n  health: 9\n');
 const graph=await indexUnityProject(f.projectDir),id=`object:${f.guids.scene}:1`,tree=queryGraph(graph,'assets.tree',{id});
 for(const fileID of ['1','4','9007199254740993','2','5','6']) assert.ok(tree.items.some(n=>n.fileID===fileID),fileID);
 assert.equal(new Set(tree.items.map(n=>n.id)).size,tree.items.length);assert.ok(tree.items.find(n=>n.fileID==='2').depth>tree.items.find(n=>n.fileID==='1').depth);
 const scene=queryGraph(graph,'assets.tree',{id:`asset:${f.guids.scene}`});assert.ok(scene.items.find(n=>n.fileID==='2').depth>scene.items.find(n=>n.fileID==='1').depth);
 const shallow=queryGraph(graph,'assets.tree',{id,depth:0});assert.deepEqual(shallow.items.map(n=>n.fileID),['1']);
});
test('platform constrained assembly definitions preserve config and block source replacement eligibility',async t=>{
 const f=await fixture(t),asmdef=path.join(f.projectDir,'Assets/Tooling.asmdef');
 for(const config of [{includePlatforms:['Editor']},{excludePlatforms:['Android']},{defineConstraints:['EDITOR_ONLY']}]){
  await fs.writeFile(asmdef,JSON.stringify({name:'Tooling',...config}));const graph=await indexUnityProject(f.projectDir),script=graph.assets.find(a=>a.guid===f.guids.script).script;
  assert.equal(script.assembly,'Tooling');assert.equal(script.supported,false);assert.deepEqual(script.assemblyDefinition.includePlatforms,config.includePlatforms??[]);assert.deepEqual(script.assemblyDefinition.excludePlatforms,config.excludePlatforms??[]);assert.ok(script.limitations.some(l=>l.includes('Constrained assembly definition')));
 }
 await fs.writeFile(asmdef,JSON.stringify({name:'Tooling',includePlatforms:'Editor'}));await assert.rejects(indexUnityProject(f.projectDir),/invalid_assembly_definition/);
});
test('predefined assembly identity respects top-level firstpass folders and nearest asmdef',async t=>{
 const f=await fixture(t);let previous=f.scriptPath;
 const scenarios=[
  ['Plugins/Player.cs','Assembly-CSharp-firstpass'],
  ['Standard Assets/Nested/Player.cs','Assembly-CSharp-firstpass'],
  ['Pro Standard Assets/Player.cs','Assembly-CSharp-firstpass'],
  ['Plugins/Nested/Editor/Player.cs','Assembly-CSharp-Editor-firstpass'],
  ['Standard Assets/Editor/Player.cs','Assembly-CSharp-Editor-firstpass'],
  ['Pro Standard Assets/Editor/Player.cs','Assembly-CSharp-Editor-firstpass'],
  ['Tools/Editor/Player.cs','Assembly-CSharp-Editor'],
  ['Scripts/Player.cs','Assembly-CSharp'],
 ];
 for(const [relative,assembly] of scenarios){const next=path.join(f.projectDir,'Assets',relative);await fs.mkdir(path.dirname(next),{recursive:true});await fs.rename(previous,next);await fs.rename(previous+'.meta',next+'.meta');previous=next;const graph=await indexUnityProject(f.projectDir),script=graph.assets.find(a=>a.guid===f.guids.script).script;assert.equal(script.assembly,assembly,relative);assert.equal(script.types[0].fullName,'Demo.Player');}
 const next=path.join(f.projectDir,'Assets/Plugins/Override/Player.cs');await fs.mkdir(path.dirname(next),{recursive:true});await fs.rename(previous,next);await fs.rename(previous+'.meta',next+'.meta');await fs.writeFile(path.join(f.projectDir,'Assets/Plugins/Override/Runtime.asmdef'),JSON.stringify({name:'Demo.Runtime'}));const graph=await indexUnityProject(f.projectDir);assert.equal(graph.assets.find(a=>a.guid===f.guids.script).script.assembly,'Demo.Runtime');
});
test('firstpass assembly identity joins only the exact IL2CPP metadata assembly',async t=>{
 const f=await fixture(t),next=path.join(f.projectDir,'Assets/Plugins/Player.cs');await fs.mkdir(path.dirname(next),{recursive:true});await fs.rename(f.scriptPath,next);await fs.rename(f.scriptPath+'.meta',next+'.meta');
 const binding={native:{sha256:'a'.repeat(64),size:1},metadata:{sha256:'b'.repeat(64),size:2}},graph=await indexUnityProject(f.projectDir,{binding}),{buildScriptMap}=await import('../src/reconstruction/map.js');
 for(const assembly of ['Assembly-CSharp-firstpass','Assembly-CSharp']){const text=`// Image 0: ${assembly}.dll - 0\n// Namespace: Demo\npublic class Player : MonoBehaviour // TypeDefIndex: 0\n{\n}\n`,dump={text,sha256:createHash('sha256').update(text).digest('hex'),verified:true,build:binding};const map=await buildScriptMap(graph,{projectDir:f.projectDir,dump}),script=map.scripts.find(s=>s.guid===f.guids.script);assert.equal(script.identity.assembly,'Assembly-CSharp-firstpass');assert.equal(script.state.metadata,assembly==='Assembly-CSharp-firstpass'?'matched':'unmatched');}
});
