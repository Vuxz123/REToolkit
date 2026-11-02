import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createUnityFixture} from './fixtures/unity-export-fixture.mjs';
import {indexUnityProject} from '../src/assets/graph.js';
import {indexUnityProjectSqlite} from '../src/assets/sqlite-index.js';
import {openSqliteGraph} from '../src/assets/sqlite-store.js';

test('collider hash numeric-looking export stays opaque in both graphs without changing bytes or references',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-collider-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const f=await createUnityFixture(root),file=path.join(f.projectDir,'Assets/Collider.asset'),guid='abcdefabcdefabcdefabcdefabcdefab';
 const source='04475814170509.587e1942100000000';
 const text=value=>`--- !u!114 &11400000\nMonoBehaviour:\n  m_Name: Collider\n  m_Script: {fileID: 11500000, guid: ${f.guids.script}}\n  ConvexMeshes:\n  - {fileID: -9223372036854775808, guid: ${f.guids.prefab}}\n  HashOfSourceMeshes: ${value}\n`;
 await fs.writeFile(file+'.meta',`guid: ${guid}\n`);await fs.writeFile(file,text(source));
 const digest=async()=>createHash('sha256').update(await fs.readFile(file)).digest('hex'),before=await digest();
 const json=await indexUnityProject(f.projectDir),node=json.nodes.find(n=>n.guid===guid);
 assert.deepEqual(node.fields.HashOfSourceMeshes,{kind:'ambiguous-unity-scalar',source,readOnly:true});
 assert.equal(json.edges.filter(e=>e.from===node.id).length,2);
 assert(json.edges.some(e=>e.from===node.id&&e.fileID==='-9223372036854775808'&&e.status==='resolved'));
 const databaseFile=path.join(root,'collider.sqlite'),manifest=await indexUnityProjectSqlite(f.projectDir,{databaseFile,storageRelativePath:'collider.sqlite'});
 const reader=openSqliteGraph({file:databaseFile,receipt:manifest.storage,graph:manifest});
 try{assert.deepEqual([...reader.readNodes()],json.nodes);assert.deepEqual([...reader.readEdges()],json.edges);}finally{reader.close();}
 assert.equal(await digest(),before);
 for(const invalid of ['.inf','.nan','!!float '+source]){await fs.writeFile(file,text(invalid));await assert.rejects(indexUnityProject(f.projectDir),e=>e.code==='invalid_yaml_number');}
 await fs.writeFile(file,text(source).replace('HashOfSourceMeshes:','other:'));await assert.rejects(indexUnityProject(f.projectDir),e=>e.code==='invalid_yaml_number');
 await fs.writeFile(file,text(source).replace('fileID: 11500000','fileID: 1e999'));await assert.rejects(indexUnityProject(f.projectDir),e=>['invalid_yaml_number','invalid_file_id'].includes(e.code));
});
