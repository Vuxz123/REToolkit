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

async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-glyphs-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const unity=await createUnityFixture(root);return {root,...unity};}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const packed=['39000000e2010000','0000000000000000','0100000000000000','0e000000','FFFFFFFF00000000'];
function font(guid,values=packed){return `--- !u!114 &11400000\nMonoBehaviour:\n  m_Name: MergePro-Bold SDF\n  m_Script: {fileID: 11500000, guid: ${guid}, type: 3}\n  m_FontFeatureTable:\n    m_LigatureSubstitutionRecords:\n${values.map(value=>`    - m_ComponentGlyphIDs: ${value}\n      m_LigatureGlyphID: 42\n`).join('')}  tail: {fileID: -9223372036854775808, guid: 33333333333333333333333333333333}\n`;}

test('packed font glyph IDs retain exact hexadecimal bytes in JSON and SQLite with all references',async t=>{
 const f=await fixture(t),file=path.join(f.projectDir,'Assets/Font.asset'),guid='abcdefabcdefabcdefabcdefabcdefab',text=font(f.guids.script);await fs.writeFile(file,text);await fs.writeFile(file+'.meta',`guid: ${guid}\n`);const before=sha(await fs.readFile(file));
 const json=await indexUnityProject(f.projectDir),node=json.nodes.find(n=>n.guid===guid),records=node.fields.m_FontFeatureTable.m_LigatureSubstitutionRecords;
 assert.deepEqual(records.map(r=>r.m_ComponentGlyphIDs),packed);assert.equal(json.edges.filter(e=>e.from===node.id).length,2);assert(json.edges.some(e=>e.from===node.id&&e.fileID==='-9223372036854775808'&&e.status==='resolved'));
 const databaseFile=path.join(f.root,'glyphs.sqlite'),manifest=await indexUnityProjectSqlite(f.projectDir,{databaseFile,storageRelativePath:'glyphs.sqlite'}),reader=openSqliteGraph({file:databaseFile,receipt:manifest.storage,graph:manifest});try{assert.deepEqual([...reader.readNodes()],json.nodes);assert.deepEqual([...reader.readEdges()],json.edges);}finally{reader.close();}
 assert.equal(sha(await fs.readFile(file)),before);assert.equal(manifest.coverage.summarizedFields,0);
});

test('nonfinite numeric fields, explicit float tags and invalid ID syntax still fail',async t=>{
 const f=await fixture(t),file=path.join(f.projectDir,'Assets/Font.asset');
 for(const text of [font(f.guids.script,['.inf']),font(f.guids.script,['.nan']),font(f.guids.script,['1e999']),font(f.guids.script,['!!float 39000000e2010000'])]){await fs.writeFile(file,text);await assert.rejects(indexUnityProject(f.projectDir),error=>error.code==='invalid_yaml_number');}
 await fs.writeFile(file,font(f.guids.script).replace('fileID: 11500000','fileID: 1e999'));await assert.rejects(indexUnityProject(f.projectDir),error=>error.code==='invalid_file_id'||error.code==='invalid_yaml_number');
});

test('unknown packed numeric-looking level fields retain ambiguous source tokens without losing references',async t=>{
 const f=await fixture(t),file=path.join(f.projectDir,'Assets/Level.asset'),guid='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',values=['320000000e00000018000000','32000000180000000e00000018000000','08000000e0000000'];
 await fs.writeFile(file+'.meta',`guid: ${guid}\n`);await fs.writeFile(file,`--- !u!114 &11400000\nMonoBehaviour:\n  m_Name: Level_17_1\n  m_Script: {fileID: 11500000, guid: ${f.guids.script}}\n  bubbles:\n${values.map(value=>`  - birds: ${value}\n    position: {x: 1.7351947, y: 1.3534}\n`).join('')}  tail: {fileID: -9223372036854775808, guid: ${f.guids.prefab}}\n`);
 const json=await indexUnityProject(f.projectDir),node=json.nodes.find(n=>n.guid===guid);
 assert.deepEqual(node.fields.bubbles.map(b=>b.birds),values.map(source=>({kind:'ambiguous-unity-scalar',source,readOnly:true})));
 assert.deepEqual(node.fields.bubbles[0].position,{x:1.7351947,y:1.3534});assert.equal(json.edges.filter(e=>e.from===node.id).length,2);
 const databaseFile=path.join(f.root,'levels.sqlite'),manifest=await indexUnityProjectSqlite(f.projectDir,{databaseFile,storageRelativePath:'levels.sqlite'}),reader=openSqliteGraph({file:databaseFile,receipt:manifest.storage,graph:manifest});try{assert.deepEqual([...reader.readNodes()],json.nodes);assert.deepEqual([...reader.readEdges()],json.edges);}finally{reader.close();}
 await fs.appendFile(file,'  invalid: {fileID: 320000000e00000018000000}\n');await assert.rejects(indexUnityProject(f.projectDir),error=>error.code==='invalid_file_id');
});

test('Sprite render-data GUID keys preserve all 32 characters while other numeric keys remain invalid',async t=>{
 const f=await fixture(t),file=path.join(f.projectDir,'Assets/Sprite.asset'),keys=['00000000000000000000000000000000','1000000000000000e000000000000000'];
 await fs.writeFile(file,`--- !u!213 &21300000\nSprite:\n  m_RenderDataKey:\n    ${keys[0]}: 0\n    ${keys[1]}: 1\n  texture: {fileID: -9223372036854775808, guid: ${f.guids.prefab}}\n`);
 const json=await indexUnityProject(f.projectDir),node=json.nodes.find(n=>n.type==='Sprite');assert.deepEqual(Object.keys(node.fields.m_RenderDataKey),keys);assert.equal(node.fields.m_RenderDataKey[keys[1]],1);assert(json.edges.some(e=>e.from===node.id&&e.status==='resolved'));
 const databaseFile=path.join(f.root,'sprite.sqlite'),manifest=await indexUnityProjectSqlite(f.projectDir,{databaseFile,storageRelativePath:'sprite.sqlite'}),reader=openSqliteGraph({file:databaseFile,receipt:manifest.storage,graph:manifest});try{assert.deepEqual([...reader.readNodes()],json.nodes);assert.deepEqual([...reader.readEdges()],json.edges);}finally{reader.close();}
 for(const text of ['--- !u!213 &1\nSprite:\n  other:\n    123: value\n','--- !u!213 &1\nSprite:\n  m_RenderDataKey:\n    123: value\n',`--- !u!213 &1\nSprite:\n  m_RenderDataKey:\n    !!int ${keys[0]}: value\n`]){await fs.writeFile(file,text);await assert.rejects(indexUnityProject(f.projectDir),error=>error.code==='invalid_yaml_key');}
});
