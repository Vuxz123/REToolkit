import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createSqliteStore} from '../src/assets/sqlite-store.js';
import * as storage from '../src/assets/graph-storage.js';
import {scriptBindings} from '../src/reconstruction/bindings.js';
import {buildScriptMap} from '../src/reconstruction/map.js';

const guid='a'.repeat(32),otherGuid='b'.repeat(32);
const asset={id:`asset:${guid}`,guid,path:'Assets/Slot.cs',script:{assembly:'Assembly-CSharp',supported:true,types:[{fullName:'Slot',fields:[]}]}};
function fixture(t,{count=20005,tail='valid'}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-streamed-bindings-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const relativePath=`indexes/${randomUUID()}/graph.sqlite`,file=path.join(root,...relativePath.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});
 const graph={kind:'retoolkit-asset-graph',schemaVersion:2,revision:'c'.repeat(64),binding:{fixture:true},coverage:{complete:true},files:[{path:'Assets/Slot.cs',sha256:'d'.repeat(64),size:1}],assets:[asset,{id:'scene',path:'Assets/Main.unity',kind:'scene'}]};
 const store=createSqliteStore({file});for(const a of graph.assets)store.addAsset(a);
 for(let i=0;i<count;i++)store.addNode({id:`n${i}`,assetId:'scene',scriptRef:i===count-1&&tail==='wrong-ref'?{guid:otherGuid,fileID:'11500000'}:{guid,fileID:i===count-1&&tail==='wrong-fileid'?'0':'11500000'}});
 for(let i=0;i<count;i++){
  if(i===count-1&&tail==='missing')continue;
  const edge={from:`n${i}`,to:asset.id,kind:'script',field:'m_Script',guid,fileID:'11500000',status:'resolved'};
  if(i===count-1){if(tail==='wrong-to')edge.to='wrong';if(tail==='wrong-guid')edge.guid=otherGuid;if(tail==='wrong-edge-fileid')edge.fileID='0';if(tail==='wrong-kind')edge.kind='other';if(tail==='wrong-field')edge.field='other';if(tail==='unresolved')edge.status='missing';}
  store.addEdge(edge);if(i===count-1&&tail==='duplicate')store.addEdge(edge);
 }
 graph.storage={...store.seal(graph),kind:'sqlite',relativePath};
 return {root,file,graph,graphFile:path.join(root,'graph.json')};
}

test('streamed focus traverses over 20000 bindings completely with bounded previews and complete source inventory',async t=>{
 const f=fixture(t);assert.equal(typeof storage.focusStoredScriptGraph,'function','dedicated streamed script focus must exist');
 assert.throws(()=>storage.focusStoredGraph(f.graph,f.graphFile,{scriptIds:[asset.id]}),{code:'graph_scope_limit'});
 const focused=storage.focusStoredScriptGraph(f.graph,f.graphFile,{scriptIds:[asset.id]}),bindings=scriptBindings(focused,asset);
 assert.equal(bindings.componentCount,20005);assert.equal(bindings.unresolvedBindingCount,0);assert.equal(bindings.traversedBindingCount,20005);assert.equal(bindings.traversalComplete,true);assert.equal(bindings.componentsTruncated,true);assert.equal(bindings.components.length,64);assert.match(bindings.bindingSha256,/^[a-f0-9]{64}$/);
 assert.equal(focused.files,f.graph.files);assert.equal(focused.assets,f.graph.assets);assert.equal(focused.nodes.length,0);assert.equal(focused.edges.length,0);
 const mapped=(await buildScriptMap(focused,{scriptIds:[asset.id]})).scripts[0];assert.equal(mapped.componentCount,20005);assert.equal(mapped.state.bindings,'resolved');assert.equal(mapped.traversalComplete,true);assert(Buffer.byteLength(JSON.stringify(mapped))<20000);
 assert.equal(scriptBindings(storage.focusStoredScriptGraph(f.graph,f.graphFile,{scriptIds:[asset.id]}),asset).bindingSha256,bindings.bindingSha256);
});

test('late binding errors and duplicates cannot be hidden by preview limits',async t=>{
 assert.equal(typeof storage.focusStoredScriptGraph,'function','dedicated streamed script focus must exist');
 for(const tail of ['missing','duplicate','wrong-to','wrong-guid','wrong-fileid','wrong-edge-fileid','wrong-ref','wrong-kind','wrong-field','unresolved'])await t.test(tail,()=>{
  const f=fixture(t,{tail}),focused=storage.focusStoredScriptGraph(f.graph,f.graphFile,{scriptIds:[asset.id]}),bindings=scriptBindings(focused,asset);
  assert.equal(bindings.componentCount,20004);assert.equal(bindings.unresolvedBindingCount,1);assert.equal(bindings.unresolvedBindings[0].componentId,'n20004');assert.equal(bindings.traversedBindingCount,20005);assert.equal(bindings.traversalComplete,true);
 });
});

test('attestations ignore forged summaries and invalidate reused focus after database tampering',()=>{
 const graph={nodes:[{id:'n',scriptRef:{guid,fileID:'11500000'}}],edges:[],bindingSummaries:{[asset.id]:{components:['forged'],unresolvedBindings:[]}}};
 assert.equal(scriptBindings(graph,asset).unresolvedBindings.length,1);
});

test('sealed database mutation invalidates the old focus and a fresh scan',t=>{
 assert.equal(typeof storage.focusStoredScriptGraph,'function','dedicated streamed script focus must exist');
 const f=fixture(t,{count:2}),focused=storage.focusStoredScriptGraph(f.graph,f.graphFile,{scriptIds:[asset.id]});
 fs.appendFileSync(f.file,'tampered');assert.throws(()=>scriptBindings(focused,asset),/changed|receipt|identity/i);assert.throws(()=>storage.focusStoredScriptGraph(f.graph,f.graphFile,{scriptIds:[asset.id]}),/receipt|size|hash/i);
});

test('streamed attestation cannot be serialized, copied, mutated or used outside its selected scope',t=>{
 assert.equal(typeof storage.focusStoredScriptGraph,'function','dedicated streamed script focus must exist');
 const f=fixture(t,{count:2,tail:'missing'}),focused=storage.focusStoredScriptGraph(f.graph,f.graphFile,{scriptIds:[asset.id]});
 const first=scriptBindings(focused,asset);first.unresolvedBindings.length=0;assert.equal(scriptBindings(focused,asset).unresolvedBindingCount,1);assert.equal(scriptBindings(focused,asset).unresolvedBindings.length,1);
 assert.throws(()=>scriptBindings({...focused},asset),/authenticated|attestation|traversal/i);assert.throws(()=>scriptBindings(JSON.parse(JSON.stringify(focused)),asset),/authenticated|attestation|traversal/i);
 assert.throws(()=>scriptBindings(focused,{...asset,id:'outside'}),/scope|included/i);
 focused.files.push({path:'forged'});assert.throws(()=>scriptBindings(focused,asset),/changed|identity/i);
});

test('JSON bindings enforce the same edge correspondence and duplicate node checks',()=>{
 const node={id:'n',scriptRef:{guid,fileID:'11500000'}},edge={from:'n',to:asset.id,kind:'script',field:'m_Script',guid,fileID:'11500000',status:'resolved'};
 assert.equal(scriptBindings({nodes:[node],edges:[edge]},asset).componentCount,1);
 assert.equal(scriptBindings({nodes:[node,node],edges:[edge]},asset).unresolvedBindingCount,2);
 assert.equal(scriptBindings({nodes:[{...node,scriptRef:{guid:otherGuid,fileID:'11500000'}}],edges:[edge]},asset).unresolvedBindingCount,1);
 assert.equal(scriptBindings({nodes:[],edges:[edge]},asset).unresolvedBindingCount,1,'orphan claimed script edges are unresolved');
});

test('GUID-less source bindings claimed by exact asset destination remain unresolved in JSON and SQLite',t=>{
 const opaque={...asset,id:'source:Assets/Generic.cs',guid:null,path:'Assets/Generic.cs'},node={id:'n',assetId:'scene'},edge={from:'n',to:opaque.id,kind:'script',field:'m_Script',guid:otherGuid,fileID:'11500000',status:'resolved'};
 assert.equal(scriptBindings({nodes:[node],edges:[edge]},opaque).unresolvedBindingCount,1,'a destination claim cannot be hidden by a missing asset GUID');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-opaque-binding-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const relativePath=`indexes/${randomUUID()}/graph.sqlite`,file=path.join(root,...relativePath.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});
 const graph={kind:'retoolkit-asset-graph',schemaVersion:2,revision:'c'.repeat(64),binding:{fixture:true},coverage:{complete:true},files:[],assets:[opaque,{id:'scene',path:'Assets/Main.unity'}]},store=createSqliteStore({file});
 for(const a of graph.assets)store.addAsset(a);store.addNode(node);store.addNode({id:'unrelated-no-scriptRef',assetId:'scene'});store.addEdge(edge);graph.storage={...store.seal(graph),kind:'sqlite',relativePath};
 const focused=storage.focusStoredScriptGraph(graph,path.join(root,'graph.json'),{scriptIds:[opaque.id]}),binding=scriptBindings(focused,opaque);assert.equal(binding.traversedBindingCount,1);assert.equal(binding.componentCount,0);assert.equal(binding.unresolvedBindingCount,1);
});
