import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as graphApi from '../src/assets/graph.js';

test('streamed shared records reproduce legacy node and reference identities exactly',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-records-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const guid='a'.repeat(32),scriptGuid='b'.repeat(32),files={
  'ProjectSettings/ProjectVersion.txt':'m_EditorVersion: 2022.3.62f2\n',
  'Assets/Example.prefab.meta':`guid: ${guid}\n`,
  'Assets/Example.cs.meta':`guid: ${scriptGuid}\n`,
  'Assets/Example.cs':'public class Example : UnityEngine.MonoBehaviour {}\n',
  'Assets/Example.prefab':`%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n--- !u!1 &9007199254740993\nGameObject:\n  m_Name: Root\n  m_Component:\n  - component: {fileID: 2}\n--- !u!114 &2\nMonoBehaviour:\n  m_GameObject: {fileID: 9007199254740993}\n  m_Script: {fileID: 11500000, guid: ${scriptGuid}, type: 3}\n  next: {fileID: 0}\n`};
 for(const [name,text]of Object.entries(files)){await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),text);}
 const legacy=await graphApi.indexUnityProject(root),inventory=await graphApi.inventoryUnityProject(root),metadata=await graphApi.readUnitySourceMetadata(root,inventory.files),source=inventory.files.find(f=>f.path==='Assets/Example.prefab');
 const asset=graphApi.makeUnityAsset(source,metadata),records=await graphApi.readUnitySerializedRecords(root,source);
 assert.equal(Array.isArray(records),false,'records must be consumed incrementally');
 const nodes=[...records].map(record=>graphApi.makeUnityGraphNode(source,asset,record));
 assert.deepEqual(nodes,legacy.nodes);assert.deepEqual(asset,legacy.assets.find(a=>a.id===asset.id));
 const edges=nodes.flatMap(node=>[...graphApi.unityReferenceEdges(node,{findAssetGuid:guid=>legacy.assets.find(a=>a.guid===guid),findAssetId:id=>legacy.assets.find(a=>a.id===id),hasNode:id=>nodes.some(n=>n.id===id)})]);
 assert.deepEqual(edges,legacy.edges);assert.equal(nodes[0].fileID,'9007199254740993');
 await fs.writeFile(path.join(root,source.path),files[source.path]+'\n');await assert.rejects(()=>graphApi.readUnitySerializedRecords(root,source),{code:'stale_graph'});
});
