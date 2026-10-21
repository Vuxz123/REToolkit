import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {fingerprint} from '../src/state.js';
import {indexUnityProject,queryGraph} from '../src/assets/graph.js';
import {createUnityFixture} from './fixtures/unity-export-fixture.mjs';

const api=async()=>{try{return await import('../src/assets/sqlite-store.js');}catch(error){assert.fail(`SQLite store unavailable: ${error.message}`);}};
const handles=new Map();
function temp(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-sqlite-'));t.after(()=>{for(const [file,readers]of handles)if(file.startsWith(root+path.sep)){for(const reader of readers)reader.close();handles.delete(file);}fs.rmSync(root,{recursive:true,force:true});});return {root,file:path.join(root,'graph.sqlite')};}
const meta={revision:'a'.repeat(64),binding:{source:'fixture'},coverage:{complete:true,missing:1}};
function basic(m,file,limits){const store=m.createSqliteStore({file,limits});store.addAsset({id:'a',guid:'1'.repeat(32),path:'Assets/Main.unity',kind:'scene'});store.addNode({id:'n',assetId:'a',guid:'1'.repeat(32),fileID:'9007199254740993',type:'MonoBehaviour',fields:{health:7},scriptRef:{guid:'2'.repeat(32)}});store.addEdge({from:'n',to:null,kind:'script',guid:'2'.repeat(32),fileID:'11500000',field:'m_Script',status:'missing'});return store;}
function open(m,file,receipt,graph=meta){const reader=m.openSqliteGraph({file,receipt,graph});if(!handles.has(file))handles.set(file,[]);handles.get(file).push(reader);return reader;}

test('fresh SQLite writer stores exact JSON, interleaves assets/nodes and seals independently verified metadata',async t=>{
 const m=await api(),{file}=temp(t),store=basic(m,file);
 assert.equal(store.findAssetGuid('1'.repeat(32)).id,'a');assert.equal(store.findAssetId('a').kind,'scene');assert.equal(store.findAssetId('absent'),null);assert.equal(store.hasNode('n'),true);assert.equal([...store.nodes()][0].fileID,'9007199254740993');
 const receipt=store.seal(meta);assert.deepEqual(receipt.counts,{assets:1,nodes:1,edges:1});assert.equal(receipt.size,fs.statSync(file).size);assert.equal(receipt.sha256,createHash('sha256').update(fs.readFileSync(file)).digest('hex'));assert.throws(()=>store.addNode({id:'late'}),/closed|sealed/i);store.close();
 const graph=open(m,file,{...receipt,kind:'sqlite',relativePath:'graph.sqlite'});t.after(()=>graph.close());assert.equal(graph.query('assets.get',{id:'n'}).item.fields.health,7);assert.equal([...graph.readEdges({scriptGuids:['2'.repeat(32)]})][0].status,'missing');assert.equal([...graph.readNodes({scriptGuids:['2'.repeat(32)]})][0].id,'n');assert.deepEqual([...graph.readNodes({ids:[]})],[]);assert.deepEqual([...graph.readEdges({fromIds:[]})],[]);
 const raw=new DatabaseSync(file,{readOnly:true,allowExtension:false});assert.equal(raw.prepare('PRAGMA journal_mode').get().journal_mode,'delete');raw.close();
});

test('SQLite bounded queries preserve legacy fixture list/get/reference/tree order and contents',async t=>{
 const m=await api(),{root,file}=temp(t),fixture=await createUnityFixture(root);
 fs.appendFileSync(fixture.scenePath,'--- !u!1 &2\nGameObject:\n  m_Name: Child\n  m_Component:\n  - component: {fileID: 5}\n--- !u!4 &5\nTransform:\n  m_Father: {fileID: 4}\n  m_GameObject: {fileID: 2}\n');
 const graph=await indexUnityProject(fixture.projectDir,{binding:meta.binding}),store=m.createSqliteStore({file});for(const a of graph.assets){store.addAsset(a);for(const n of graph.nodes.filter(n=>n.assetId===a.id))store.addNode(n);}for(const e of graph.edges)store.addEdge(e);const receipt=store.seal(graph),reader=open(m,file,receipt,graph);t.after(()=>reader.close());
 const queries=[['assets.list',{}],['assets.list',{kind:'script'}],['assets.list',{search:'MAIN'}],['assets.list',{path:'Assets/'}],['assets.list',{name:'player'}],...graph.nodes.slice(0,4).flatMap(n=>[['assets.get',{id:n.id}],['assets.refs',{id:n.id}],['assets.refs',{id:n.id,direction:'incoming'}],['assets.tree',{id:n.id}]]),['assets.tree',{id:`asset:${fixture.guids.scene}`}],['assets.tree',{id:`object:${fixture.guids.scene}:1`,depth:0}]];
 for(const [method,params]of queries){const expected=queryGraph(graph,method,params),actual=reader.query(method,params);assert.deepEqual(actual.item??actual.items,expected.item??expected.items,`${method} ${JSON.stringify(params)}`);assert.deepEqual(actual.coverage,expected.coverage);}
 const p1=reader.query('assets.list',{limit:1}),p2=reader.query('assets.list',{limit:1,cursor:p1.nextCursor});assert.deepEqual(p2.items,[graph.assets[1]]);assert.throws(()=>reader.query('assets.list',{search:'changed',cursor:p1.nextCursor}),{code:'invalid_cursor'});assert.throws(()=>reader.query('assets.list',{limit:1001}),{code:'invalid_limit'});assert.throws(()=>reader.query('assets.list',{unknown:true}),{code:'invalid_query_parameter'});assert.throws(()=>reader.readNodes({unknown:true}).next(),/selector|parameter/);
});

test('writer rejects overwrite, links, duplicates, late phases and cap increases; row/count/disk failures poison seal',async t=>{
 const m=await api();assert.deepEqual(m.SQLITE_GRAPH_LIMITS,{maxAssets:250000,maxNodes:8000000,maxEdges:32000000,maxDatabaseBytes:32*1024**3,maxRowBytes:20*1024**2});
 for(const scenario of ['overwrite','link','duplicate','late','nodes','edges','row','disk','increased']){
  const {root,file}=temp(t);
  if(scenario==='overwrite'){fs.writeFileSync(file,'preserve');assert.throws(()=>m.createSqliteStore({file}));assert.equal(fs.readFileSync(file,'utf8'),'preserve');continue;}
  if(scenario==='link'){const target=path.join(root,'target');fs.mkdirSync(target);fs.symlinkSync(target,path.join(root,'linked'),'junction');assert.throws(()=>m.createSqliteStore({file:path.join(root,'linked/db.sqlite')}),/link/i);continue;}
  if(scenario==='increased'){assert.throws(()=>m.createSqliteStore({file,limits:{maxNodes:8000001}}),/limit/);continue;}
  let store;try{
   if(scenario==='disk'){assert.throws(()=>{store=m.createSqliteStore({file,limits:{maxDatabaseBytes:4096}});store.addAsset({id:'a',path:'Assets/A',kind:'opaque'});store.seal(meta);},/limit|full|budget/i);continue;}
   store=m.createSqliteStore({file,limits:scenario==='nodes'?{maxNodes:1}:scenario==='edges'?{maxEdges:1}:scenario==='row'?{maxRowBytes:256}:undefined});store.addAsset({id:'a',path:'Assets/A',kind:'scene'});store.addNode({id:'n',assetId:'a'});
   if(scenario==='duplicate')assert.throws(()=>store.addNode({id:'n',assetId:'a'}),/duplicate|unique/i);
   if(scenario==='nodes')assert.throws(()=>store.addNode({id:'n2',assetId:'a'}),/limit/);
   if(scenario==='row')assert.throws(()=>store.addNode({id:'n2',assetId:'a',fields:{text:'x'.repeat(1000)}}),/row.*limit/i);
   if(['late','edges'].includes(scenario)){store.addEdge({from:'n',to:null,status:'missing'});assert.throws(()=>scenario==='late'?store.addAsset({id:'b',path:'Assets/B',kind:'scene'}):store.addEdge({from:'n',to:null,status:'missing'}),/phase|limit/);}
   assert.throws(()=>store.seal(meta),/failed|poison|invalid/i);
  }finally{store?.close();}
 }
});

test('reader rejects byte changes, stale binding/revision, unsealed files and unsupported metadata',async t=>{
 const m=await api(),{file}=temp(t),receipt=basic(m,file).seal(meta);
 assert.throws(()=>open(m,file,receipt,{...meta,revision:'b'.repeat(64)}),/revision|metadata/);assert.throws(()=>open(m,file,receipt,{...meta,binding:{source:'changed'}}),/binding|metadata/);
 const changed=open(m,file,receipt);fs.appendFileSync(file,'x');assert.throws(()=>changed.query('assets.list'),/changed|identity|stale/);changed.close();assert.throws(()=>open(m,file,receipt),/hash|size|receipt/);
 const unsealed=temp(t).file,store=m.createSqliteStore({file:unsealed});store.close();const bytes=fs.readFileSync(unsealed),fake={...receipt,sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length};assert.throws(()=>open(m,unsealed,fake),/seal|metadata/);
});

test('large rows fail explicitly and paginated responses stay below one MiB without dropping row fields',async t=>{
 const m=await api(),{file}=temp(t),store=m.createSqliteStore({file});store.addAsset({id:'a',path:'Assets/A',kind:'scene'});for(let i=0;i<6;i++)store.addNode({id:'n'+i,assetId:'a',fields:{text:'x'.repeat(300000)}});store.addNode({id:'large',assetId:'a',fields:{text:'y'.repeat(1100000)}});for(let i=0;i<6;i++)store.addEdge({from:'n'+i,to:'a',field:'x'.repeat(300000),status:'resolved'});const reader=open(m,file,store.seal(meta));t.after(()=>reader.close());
 const first=reader.query('assets.refs',{id:'a',limit:1000});assert(Buffer.byteLength(JSON.stringify(first))<=1024**2);assert(first.nextCursor);const second=reader.query('assets.refs',{id:'a',cursor:first.nextCursor});assert.equal(first.items.length+second.items.length,6);assert.equal(first.items[0].field.length,300000);assert.throws(()=>reader.query('assets.get',{id:'large'}),{code:'graph_response_limit'});
});

test('tree caps visited IDs and explicitly reports truncation without whole-asset materialization',async t=>{
 const m=await api(),{file}=temp(t),store=m.createSqliteStore({file});store.addAsset({id:'a',path:'Assets/A',kind:'scene'});for(let i=0;i<50005;i++)store.addNode({id:'n'+i,assetId:'a',type:'GameObject'});for(let i=1;i<50005;i++)store.addEdge({from:'n0',to:'n'+i,kind:'component',status:'resolved'});const reader=open(m,file,store.seal(meta));t.after(()=>reader.close());const tree=reader.query('assets.tree',{id:'n0',limit:10});assert.equal(tree.items.length,10);assert.equal(tree.traversalTruncated,true);assert.equal(tree.visitedCount,50000);
});

test('read selectors intersect, preserve every reference status, deduplicate IDs and bind cursors to database bytes',async t=>{
 const m=await api(),{file}=temp(t),store=m.createSqliteStore({file});store.addAsset({id:'a',path:'Assets/A',kind:'scene'});for(let i=0;i<3;i++)store.addNode({id:'n'+i,assetId:'a',scriptRef:{guid:(i===2?'3':'2').repeat(32)}});for(const status of ['resolved','null','builtin','opaque','missing'])store.addEdge({from:'n0',to:status==='resolved'?'n1':null,guid:'2'.repeat(32),status});const receipt=store.seal(meta),reader=open(m,file,receipt);
 assert.deepEqual([...reader.readNodes({ids:['n0','n0','n2'],scriptGuids:['2'.repeat(32)]})].map(n=>n.id),['n0']);assert.deepEqual([...reader.readEdges({fromIds:['n0','n0'],scriptGuids:['2'.repeat(32)]})].map(e=>e.status),['resolved','null','builtin','opaque','missing']);assert.deepEqual(reader.query('assets.refs',{id:'n0'}).items.map(e=>e.status),['resolved','null','builtin','opaque','missing']);assert.throws(()=>reader.readEdges({fromIds:Array(50001).fill('n0')}).next(),/bounded/);
 const second=temp(t).file,other=m.createSqliteStore({file:second});other.addAsset({id:'a',path:'Assets/Other',kind:'scene'});const otherReader=open(m,second,other.seal(meta));const cursor=reader.query('assets.refs',{id:'n0',limit:1}).nextCursor;assert.throws(()=>otherReader.query('assets.refs',{id:'n0',cursor}),{code:'invalid_cursor'});
});

test('writer exposes exclusive ownership identity including failed database construction',async t=>{
 const m=await api(),{file}=temp(t),store=m.createSqliteStore({file});const stat=fs.statSync(file);assert.deepEqual(store.createdIdentity,{dev:stat.dev,ino:stat.ino});store.addAsset({id:'a',path:'Assets/A',kind:'scene'});store.close();
 const {file:limited}=temp(t);let failure;try{m.createSqliteStore({file:limited,limits:{maxDatabaseBytes:4096}});}catch(error){failure=error;}assert(failure?.sqliteCreatedFileIdentity);const partial=fs.statSync(limited);assert.equal(failure.sqliteCreatedFileIdentity.ino,partial.ino);
});

test('seal authenticates all manifest asset declarations, profiles and limitations in addition to source revision',async t=>{
 const m=await api(),{file}=temp(t),graph={...meta,schemaVersion:2,assets:[{id:'script',script:{assembly:'Exact.Runtime',types:[{fullName:'Owned.Player'}]}}],profile:{readOnly:true},limitations:['unverified']},receipt=basic(m,file).seal(graph);
 assert.equal(receipt.graphSha256,fingerprint(graph));
 for(const tamper of [g=>g.assets[0].script.assembly='Other.Runtime',g=>g.profile.readOnly=false,g=>g.limitations=[]]){const changed=structuredClone(graph);tamper(changed);assert.throws(()=>open(m,file,receipt,changed),/manifest|metadata/);}
 const reader=open(m,file,receipt,{...graph,storage:{...receipt,kind:'sqlite',relativePath:'graph.sqlite'}});assert.equal(reader.query('assets.get',{id:'n'}).item.id,'n');
});
