import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import syncFs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createUnityFixture} from './fixtures/unity-export-fixture.mjs';
import {indexUnityProject} from '../src/assets/graph.js';
const api=()=>import('../src/assets/sqlite-index.js');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-sqlite-index-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=await createUnityFixture(root),storageRelativePath='04_Notes/assets/fixture.sqlite',databaseFile=path.join(root,...storageRelativePath.split('/'));await fs.mkdir(path.dirname(databaseFile),{recursive:true});return {root,...source,databaseFile,storageRelativePath};}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
test('SQLite index preserves legacy metadata, IDs, references and read-only source bytes without node/edge arrays',async t=>{
 const f=await fixture(t),{indexUnityProjectSqlite}=await api(),binding={build:'fixture'},before=await indexUnityProject(f.projectDir,{binding}),manifest=await indexUnityProjectSqlite(f.projectDir,{binding,databaseFile:f.databaseFile,storageRelativePath:f.storageRelativePath});
 assert.equal(manifest.kind,'retoolkit-asset-graph');assert.equal(manifest.schemaVersion,2);assert.equal(manifest.storage.kind,'sqlite');assert.equal(manifest.storage.schemaVersion,1);assert.equal(manifest.storage.relativePath,f.storageRelativePath);assert.equal(Object.hasOwn(manifest,'nodes'),false);assert.equal(Object.hasOwn(manifest,'edges'),false);assert.equal(manifest.revision,before.revision);assert.equal(manifest.unityVersion,before.unityVersion);assert.deepEqual(manifest.files,before.files);assert.deepEqual(manifest.assets,before.assets);assert.deepEqual(manifest.coverage,before.coverage);assert.deepEqual(manifest.storage.counts,{assets:before.assets.length,nodes:before.nodes.length,edges:before.edges.length});
 const bytes=await fs.readFile(f.databaseFile);assert.equal(hash(bytes),manifest.storage.sha256);assert.equal(bytes.length,manifest.storage.size);const after=await indexUnityProject(f.projectDir,{binding});assert.deepEqual(after.files,before.files);
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(f.databaseFile,{readOnly:true});try{const metadata=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();assert.ok(metadata.length>=4);}finally{db.close();}
});
test('missing metadata and opaque/builtin/null/64-bit references keep exact coverage',async t=>{
 const f=await fixture(t),{indexUnityProjectSqlite}=await api();await fs.appendFile(f.scenePath,'--- !u!114 &-9223372036854775807\nMonoBehaviour:\n  local: {fileID: 0}\n  builtin: {fileID: 1, guid: 0000000000000000e000000000000000}\n  broken: {fileID: 99, guid: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}\n');await fs.writeFile(path.join(f.projectDir,'Assets/opaque.asset'),Buffer.from([0,1,2]));const legacy=await indexUnityProject(f.projectDir),graph=await indexUnityProjectSqlite(f.projectDir,{databaseFile:f.databaseFile,storageRelativePath:f.storageRelativePath});assert.deepEqual(graph.coverage,legacy.coverage);assert.deepEqual(graph.assets,legacy.assets);
});
test('structural/metadata caps reject without a complete database or replacing an existing manifest',async t=>{
 for(const limits of [{maxNodes:1},{maxEdges:1},{maxManifestBytes:1}]){const f=await fixture(t),{indexUnityProjectSqlite}=await api(),old=path.join(path.dirname(f.databaseFile),'graph.json');await fs.writeFile(old,'previous graph manifest');await assert.rejects(indexUnityProjectSqlite(f.projectDir,{databaseFile:f.databaseFile,storageRelativePath:f.storageRelativePath,limits}),/limit|budget/i);assert.equal(await fs.readFile(old,'utf8'),'previous graph manifest');assert.equal(syncFs.existsSync(f.databaseFile),false);}
});
test('source changes after database creation refuse the receipt and preserve changed source',async t=>{
 const f=await fixture(t),{indexUnityProjectSqlite}=await api();let changed=false;const watcher=syncFs.watch(path.dirname(f.databaseFile),(_event,file)=>{if(!changed&&String(file)===path.basename(f.databaseFile)){changed=true;syncFs.appendFileSync(f.scriptPath,'// external change');}});t.after(()=>watcher.close());await assert.rejects(indexUnityProjectSqlite(f.projectDir,{databaseFile:f.databaseFile,storageRelativePath:f.storageRelativePath}),e=>e.code==='stale_graph');assert.equal(changed,true);assert.match(await fs.readFile(f.scriptPath,'utf8'),/external change/);assert.equal(syncFs.existsSync(f.databaseFile),false);
});
test('existing databases, linked outputs and traversal descriptors are refused without source writes',async t=>{
 const f=await fixture(t),{indexUnityProjectSqlite}=await api();await fs.writeFile(f.databaseFile,'previous database');await assert.rejects(indexUnityProjectSqlite(f.projectDir,{databaseFile:f.databaseFile,storageRelativePath:f.storageRelativePath}));assert.equal(await fs.readFile(f.databaseFile,'utf8'),'previous database');await fs.unlink(f.databaseFile);
 for(const storageRelativePath of ['../escape.sqlite','/absolute.sqlite','C:/absolute.sqlite','04_Notes\\escape.sqlite',''])await assert.rejects(indexUnityProjectSqlite(f.projectDir,{databaseFile:f.databaseFile,storageRelativePath}));assert.equal(syncFs.existsSync(f.databaseFile),false);
 await assert.rejects(indexUnityProjectSqlite(f.projectDir,{databaseFile:path.join(f.projectDir,'Assets/graph.sqlite'),storageRelativePath:'Assets/graph.sqlite'}));
});
test('trusted progress callbacks receive bounded counters during large incremental record passes',async t=>{
 const f=await fixture(t),{indexUnityProjectSqlite}=await api(),events=[];await fs.writeFile(f.scenePath,Array.from({length:2001},(_,i)=>`--- !u!1 &${i+1}\nGameObject:\n  m_Name: Node${i}\n`).join(''));const graph=await indexUnityProjectSqlite(f.projectDir,{databaseFile:f.databaseFile,storageRelativePath:f.storageRelativePath,onProgress:event=>{events.push(event);assert.ok(Buffer.byteLength(JSON.stringify(event))<512);}});assert.ok(events.some(e=>e.phase==='indexing'&&e.nodes>=1000));assert.ok(events.some(e=>e.phase==='sealed'));assert.equal(graph.coverage.nodes,2002);assert.ok(events.length<20);
});
test('bulk payload projection metadata and exact stored rows equal the legacy graph',async t=>{
 const f=await fixture(t),{indexUnityProjectSqlite}=await api();await fs.writeFile(path.join(f.projectDir,'Assets/Mesh.asset'),'--- !u!43 &43\nMesh:\n  m_Name: Mesh\n  m_IndexBuffer: '+('01'.repeat(4096))+'\n');const legacy=await indexUnityProject(f.projectDir),graph=await indexUnityProjectSqlite(f.projectDir,{databaseFile:f.databaseFile,storageRelativePath:f.storageRelativePath}),{openSqliteGraph}=await import('../src/assets/sqlite-store.js'),reader=openSqliteGraph({file:f.databaseFile,receipt:graph.storage,graph});try{assert.deepEqual([...reader.readNodes()],legacy.nodes);assert.deepEqual([...reader.readEdges()],legacy.edges);assert.deepEqual(graph.coverage,legacy.coverage);assert.equal(graph.coverage.summarizedFields,1);}finally{reader.close();}
});
test('an externally replaced closed database is preserved when progress publication fails',async t=>{
 const f=await fixture(t),{indexUnityProjectSqlite}=await api();await assert.rejects(indexUnityProjectSqlite(f.projectDir,{databaseFile:f.databaseFile,storageRelativePath:f.storageRelativePath,onProgress:async e=>{if(e.phase!=='sealed')return;await fs.rename(f.databaseFile,f.databaseFile+'.original');await fs.writeFile(f.databaseFile,'external replacement');throw Error('injected progress failure');}}),e=>e.code==='sqlite_index_recovery_required');assert.equal(await fs.readFile(f.databaseFile,'utf8'),'external replacement');
});
test('post-seal progress cannot change source and leave a current receipt',async t=>{
 const f=await fixture(t),{indexUnityProjectSqlite}=await api();await assert.rejects(indexUnityProjectSqlite(f.projectDir,{databaseFile:f.databaseFile,storageRelativePath:f.storageRelativePath,onProgress:async e=>{if(e.phase==='sealed')await fs.appendFile(f.scriptPath,'// post-seal external edit');}}),e=>e.code==='stale_graph');assert.equal(syncFs.existsSync(f.databaseFile),false);
});
test('sealed receipt authenticates complete manifest asset declarations and profile, not only database bytes',async t=>{
 const f=await fixture(t),{indexUnityProjectSqlite}=await api(),graph=await indexUnityProjectSqlite(f.projectDir,{databaseFile:f.databaseFile,storageRelativePath:f.storageRelativePath}),{openSqliteGraph}=await import('../src/assets/sqlite-store.js');for(const mutate of [g=>g.assets[0].path='Assets/Forged.asset',g=>g.profile.projectionPolicy='forged',g=>g.limitations.push('forged'),g=>g.files[0].size++]){const tampered=structuredClone(graph);mutate(tampered);assert.throws(()=>{const opened=openSqliteGraph({file:f.databaseFile,receipt:graph.storage,graph:tampered});opened.close();},e=>e.code==='sqlite_graph_metadata'||e.code==='sqlite_graph_receipt');}
});

test('database-construction and row/asset caps clean only the exclusively reserved output',async t=>{
 for(const limits of [{maxDatabaseBytes:4096},{maxRowBytes:1},{maxAssets:1},{maxFiles:1}]){const f=await fixture(t),{indexUnityProjectSqlite}=await api();const before=await indexUnityProject(f.projectDir);await assert.rejects(indexUnityProjectSqlite(f.projectDir,{databaseFile:f.databaseFile,storageRelativePath:f.storageRelativePath,limits}));assert.equal(syncFs.existsSync(f.databaseFile),false);assert.deepEqual((await indexUnityProject(f.projectDir)).files,before.files);}
});
