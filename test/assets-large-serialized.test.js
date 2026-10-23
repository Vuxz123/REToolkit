import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createUnityFixture} from './fixtures/unity-export-fixture.mjs';
import {indexUnityProject,inventoryUnityProject,readUnitySerializedRecords} from '../src/assets/graph.js';
import {indexUnityProjectSqlite} from '../src/assets/sqlite-index.js';
import {openSqliteGraph} from '../src/assets/sqlite-store.js';

async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-large-yaml-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return {root,...await createUnityFixture(root)};}

test('prefabs larger than 16MiB preserve every document and tail reference in JSON and SQLite',async t=>{
 const f=await fixture(t),file=path.join(f.projectDir,'Assets/Large.prefab'),guid='abcdef0123456789abcdef0123456789',documents=1100;
 await fs.writeFile(file+'.meta',`guid: ${guid}\n`);
 const handle=await fs.open(file,'w');try{await handle.write('\uFEFF%YAML 1.1\r\n%TAG !u! tag:unity3d.com,2011:\r\n');for(let i=0;i<documents;i++)await handle.write(`--- !u!1 &${i+1}\r\nGameObject:\r\n  # ${'a'.repeat(16*1024)}é😀\r\n  m_Name: Node${i}\r\n  next: {fileID: ${i===documents-1?'9223372036854775807':i+2}}\r\n`);await handle.write(`--- !u!114 &9223372036854775807\r\nMonoBehaviour:\r\n  m_Name: Tail\r\n  m_Script: {fileID: 11500000, guid: ${f.guids.script}}\r\n  target: {fileID: -9223372036854775808, guid: ${f.guids.prefab}}`);}finally{await handle.close();}
 assert.ok((await fs.stat(file)).size>16*1024**2);
 const graph=await indexUnityProject(f.projectDir),nodes=graph.nodes.filter(n=>n.guid===guid),tail=nodes.at(-1);
 assert.equal(nodes.length,documents+1);assert.equal(tail.fileID,'9223372036854775807');assert.equal(tail.name,'Tail');assert.ok(graph.edges.some(e=>e.from===tail.id&&e.fileID==='-9223372036854775808'&&e.status==='resolved'));assert.ok(graph.edges.some(e=>e.to===tail.id&&e.status==='resolved'));
 const localEdges=graph.edges.filter(e=>e.guid===guid&&e.field==='next');assert.equal(localEdges.length,documents);for(let i=0;i<documents;i++){assert.equal(localEdges[i].fileID,i===documents-1?'9223372036854775807':String(i+2));assert.equal(localEdges[i].status,'resolved');}
 const databaseFile=path.join(f.root,'large.sqlite'),manifest=await indexUnityProjectSqlite(f.projectDir,{databaseFile,storageRelativePath:'large.sqlite'}),reader=openSqliteGraph({file:databaseFile,receipt:manifest.storage,graph:manifest});try{assert.deepEqual([...reader.readNodes()],graph.nodes);assert.deepEqual([...reader.readEdges()],graph.edges);}finally{reader.close();}assert.deepEqual(manifest.coverage,graph.coverage);
 await fs.appendFile(file,'\n--- !u!1 &7000\nGameObject:\n  target: !Unsupported {fileID: 1}\n');await assert.rejects(indexUnityProject(f.projectDir),e=>e.code==='invalid_yaml');const badOutput=path.join(f.root,'invalid-tail.sqlite');await assert.rejects(indexUnityProjectSqlite(f.projectDir,{databaseFile:badOutput,storageRelativePath:'invalid-tail.sqlite'}),e=>e.code==='invalid_yaml');await assert.rejects(fs.stat(badOutput),{code:'ENOENT'});
});

test('one oversized Unity document fails with a document budget error and no sealed SQLite output',async t=>{
 const f=await fixture(t),file=path.join(f.projectDir,'Assets/Huge.prefab');await fs.writeFile(file,'--- !u!1 &1\nGameObject:\n  m_Name: '+ 'a'.repeat(16*1024**2));
 const check=e=>e.code==='unity_document_byte_limit'&&e.message.includes('Assets/Huge.prefab');await assert.rejects(indexUnityProject(f.projectDir),check);
 const databaseFile=path.join(f.root,'huge.sqlite');await assert.rejects(indexUnityProjectSqlite(f.projectDir,{databaseFile,storageRelativePath:'huge.sqlite'}),check);await assert.rejects(fs.stat(databaseFile),{code:'ENOENT'});
});

test('large binary serialized assets stay opaque without the text-file limit',async t=>{
 const f=await fixture(t),file=path.join(f.projectDir,'Assets/Binary.asset');await fs.writeFile(file,Buffer.alloc(17*1024**2));const graph=await indexUnityProject(f.projectDir);assert.equal(graph.assets.find(a=>a.path==='Assets/Binary.asset').kind,'opaque');
});

test('the document budget also bounds many individually small YAML lines',async t=>{
 const f=await fixture(t);await fs.writeFile(f.scenePath,'--- !u!1 &1\nGameObject:\n'+('  # '+ 'a'.repeat(64*1024)+'\n').repeat(256));await assert.rejects(indexUnityProject(f.projectDir),e=>e.code==='unity_document_byte_limit');
});

test('streamed serialized records reject source mutation between documents',async t=>{
 const f=await fixture(t);await fs.writeFile(f.scenePath,Array.from({length:2000},(_,i)=>`--- !u!1 &${i+1}\nGameObject:\n  m_Name: Node${i}\n`).join(''));const snapshot=await inventoryUnityProject(f.projectDir),file=snapshot.files.find(v=>v.path===path.relative(f.projectDir,f.scenePath).split(path.sep).join('/')),records=await readUnitySerializedRecords(f.projectDir,file),iterator=records[Symbol.asyncIterator]();assert.equal((await iterator.next()).value.fileID,'1');await fs.appendFile(f.scenePath,'# changed\n');await assert.rejects(async()=>{for await(const _record of iterator){}},e=>e.code==='stale_graph');
});

test('YAML-looking serialized sources reject malformed UTF-8 and NUL instead of silently becoming opaque',async t=>{
 const f=await fixture(t),prefix=Buffer.from('--- !u!1 &1\nGameObject:\n  m_Name: ');for(const bad of [Buffer.from([0xc3,0x28]),Buffer.from([0])]){await fs.writeFile(f.scenePath,Buffer.concat([prefix,bad]));await assert.rejects(indexUnityProject(f.projectDir),e=>e.code==='invalid_unity_encoding');}
});

test('UTF-8, CRLF and document headers crossing read chunks retain exact fields',async t=>{
 const f=await fixture(t),base='\uFEFF%YAML 1.1\r\n--- !u!1 &1\r\nGameObject:\r\n  m_Name: ',width=64*1024;
 for(const suffix of ['\u00e9\ud83d\ude00\r\n','\r\n']){const name='a'.repeat(width-1-Buffer.byteLength(base)),text=base+name+suffix+'--- !u!1 &2\r\nGameObject:\r\n  target: {fileID: 1}';await fs.writeFile(f.scenePath,text);const graph=await indexUnityProject(f.projectDir);assert.equal(graph.nodes.find(n=>n.guid===f.guids.scene&&n.fileID==='1').name,name+suffix.trim());assert.ok(graph.edges.some(e=>e.from===`object:${f.guids.scene}:2`&&e.status==='resolved'));}
 const prefix='\uFEFF%YAML 1.1\r\n--- !u!1 &1\r\nGameObject: {}\r\n#',padding='a'.repeat(width-2-Buffer.byteLength(prefix));await fs.writeFile(f.scenePath,prefix+padding+'\n--- !u!1 &2\nGameObject: {}\n');const graph=await indexUnityProject(f.projectDir);assert.equal(graph.nodes.filter(n=>n.guid===f.guids.scene).length,2);
});

test('serialized reads verify inventory hashes and source identity even when lengths match',async t=>{
 const f=await fixture(t),snapshot=await inventoryUnityProject(f.projectDir),file=snapshot.files.find(v=>v.path==='Assets/Main.unity'),original=await fs.readFile(f.scenePath,'utf8');await fs.writeFile(f.scenePath,original.replace('Player','Edited'));const records=await readUnitySerializedRecords(f.projectDir,file);await assert.rejects(async()=>{for await(const _record of records){}},e=>e.code==='stale_graph');
 await fs.writeFile(f.scenePath,original);const second=await readUnitySerializedRecords(f.projectDir,file),iterator=second[Symbol.asyncIterator]();await iterator.next();await fs.rename(f.scenePath,f.scenePath+'.saved');await fs.writeFile(f.scenePath,original);await assert.rejects(async()=>{for await(const _record of iterator){}},e=>e.code==='stale_graph');
});

test('serialized sources reject an ancestor linked between format detection and streaming',async t=>{
 const f=await fixture(t),snapshot=await inventoryUnityProject(f.projectDir),file=snapshot.files.find(v=>v.path==='Assets/Main.unity'),records=await readUnitySerializedRecords(f.projectDir,file),assets=path.dirname(f.scenePath);await fs.rename(assets,assets+'.saved');await fs.symlink(assets+'.saved',assets,'junction');await assert.rejects(async()=>{for await(const _record of records){}},e=>e.code==='unsafe_symlink');
});

test('the serialized preamble budget rejects an undiscovered or oversized header explicitly',async t=>{
 const f=await fixture(t);for(const text of [' '.repeat(64*1024)+'--- !u!1 &1\nGameObject: {}\n',' '.repeat(64*1024-4)+'--- !u!1 &1\nGameObject: {}\n','%YAML 1.1\n'+'\n'.repeat(64*1024)+'--- !u!1 &1\nGameObject: {}\n']){await fs.writeFile(f.scenePath,text);await assert.rejects(indexUnityProject(f.projectDir),e=>e.code==='unity_preamble_byte_limit');}
});
