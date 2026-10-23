import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createToolkit} from '../src/toolkit.js';
import {runAssetOperation} from '../src/assets/service.js';
import {createUnityFixture} from './fixtures/unity-export-fixture.mjs';
import {scriptBindings} from '../src/reconstruction/bindings.js';

async function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-binding-route-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Game');
 const workspace=toolkit.workspace('Game'),input=path.join(workspace,'01_Extracted');fs.writeFileSync(path.join(input,'libil2cpp.so'),'native');fs.writeFileSync(path.join(input,'global-metadata.dat'),'metadata');await toolkit.scan('Game',input);
 const fixture=await createUnityFixture(path.join(workspace,'05_ReconstructedSource')),project=toolkit.read('Game');project.reconstructedSourceDir=fixture.projectDir;await toolkit.save('Game',project);
 return {toolkit,workspace,fixture,graphFile:path.join(workspace,'04_Notes/assets/graph.json')};
}

test('typed script/plan/apply routes stream over 20000 bindings and fail closed after sealed database tampering',async t=>{
 const f=await setup(t),{toolkit,fixture,workspace,graphFile}=f;
 const count=20005,guid=fixture.guids.script;
 fs.writeFileSync(fixture.scenePath,'%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n'+Array.from({length:count},(_,i)=>`--- !u!114 &${i+1}\nMonoBehaviour:\n  m_Script: {fileID: 11500000, guid: ${guid}, type: 3}\n`).join(''));
 const scene=fs.readFileSync(fixture.scenePath),meta=fs.readFileSync(fixture.scriptPath+'.meta');
 const indexed=await runAssetOperation(toolkit,'Game','assets.index',{storage:'sqlite'});
 const page=await runAssetOperation(toolkit,'Game','assets.scripts',{limit:1}),script=page.items[0];assert.equal(script.componentCount,count);assert.equal(script.components.length,64);assert.equal(script.traversalComplete,true);assert(Buffer.byteLength(JSON.stringify(page))<1024**2);
 const request={kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:indexed.revision,changes:[{scriptId:script.scriptId,source:fixture.source.replace('string text = "{ }";','health += 1;')}]};
 const preview=await runAssetOperation(toolkit,'Game','reconstruct.plan',{request}),planFile=path.join(workspace,preview.storedPlan),saved=JSON.parse(fs.readFileSync(planFile));
 assert.equal(saved.graph.files.length,JSON.parse(fs.readFileSync(graphFile)).files.length);assert.equal(saved.graph.nodes,undefined);assert(Buffer.byteLength(JSON.stringify(preview))<1024**2);
 // A caller-controlled summary must not bypass a fresh scan of the sealed bytes.
 saved.graph.bindingSummaries={[script.scriptId]:{componentCount:1,unresolvedBindingCount:0,traversalComplete:true}};fs.writeFileSync(planFile,JSON.stringify(saved));
 await assert.rejects(runAssetOperation(toolkit,'Game','reconstruct.apply',{operationId:preview.operationId}),/manifest|metadata/i);
 delete saved.graph.bindingSummaries;fs.writeFileSync(planFile,JSON.stringify(saved));
 const receipt=await runAssetOperation(toolkit,'Game','reconstruct.apply',{operationId:preview.operationId});assert.equal(receipt.compileReady,false);assert.deepEqual(fs.readFileSync(fixture.scenePath),scene);assert.deepEqual(fs.readFileSync(fixture.scriptPath+'.meta'),meta);
 const db=path.join(path.dirname(graphFile),saved.graph.storage.relativePath);fs.appendFileSync(db,'bad tail');
 await assert.rejects(runAssetOperation(toolkit,'Game','reconstruct.apply',{operationId:preview.operationId}),/receipt|hash|size/i);
});

test('saved JSON reconstruction retains malformed script edges and claimed nodes without scriptRef',async t=>{
 const {toolkit,fixture,workspace,graphFile}=await setup(t),otherGuid='e'.repeat(32);
 fs.writeFileSync(path.join(fixture.projectDir,'Assets/Other.cs'),fixture.source.replaceAll('Player','Other'));fs.writeFileSync(path.join(fixture.projectDir,'Assets/Other.cs.meta'),`fileFormatVersion: 2\nguid: ${otherGuid}\n`);
 const indexed=await runAssetOperation(toolkit,'Game','assets.index'),graph=JSON.parse(fs.readFileSync(graphFile)),other=graph.assets.find(a=>a.guid===otherGuid);
 graph.nodes.push({id:'claimed-only',assetId:graph.nodes[0].assetId});graph.edges.push({from:'claimed-only',to:other.id,kind:'other',field:'m_Script',guid:otherGuid,fileID:'11500000',status:'resolved'});fs.writeFileSync(graphFile,JSON.stringify(graph));
 const selected=(await runAssetOperation(toolkit,'Game','assets.scripts')).items.find(a=>a.guid!==otherGuid),request={kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:indexed.revision,changes:[{scriptId:selected.scriptId,source:fixture.source.replace('string text = "{ }";','health += 1;')}]};
 const plan=await runAssetOperation(toolkit,'Game','reconstruct.plan',{request}),saved=JSON.parse(fs.readFileSync(path.join(workspace,plan.storedPlan)));
 assert.equal(scriptBindings(saved.graph,other).unresolvedBindingCount,1);
});

test('script pages obey the RPC byte budget and resume at the first omitted script',async t=>{
 const {toolkit,graphFile}=await setup(t);await runAssetOperation(toolkit,'Game','assets.index');const graph=JSON.parse(fs.readFileSync(graphFile)),template=graph.assets.find(a=>a.script);
 for(let i=0;i<100;i++){
  const guid=i.toString(16).padStart(32,'0'),asset={...template,id:`asset:fake${i}`,guid,path:`Assets/Fake${i}.cs`,script:{...template.script,types:[{...template.script.types[0],fullName:`Fake${i}`} ]}};graph.assets.push(asset);
  for(let j=0;j<4;j++){const id=`node:${i}:${j}:`+'x'.repeat(4000);graph.nodes.push({id,scriptRef:{guid,fileID:'11500000'}});graph.edges.push({from:id,to:asset.id,kind:'script',field:'m_Script',guid,fileID:'11500000',status:'resolved'});}
 }
 fs.writeFileSync(graphFile,JSON.stringify(graph));const first=await runAssetOperation(toolkit,'Game','assets.scripts',{limit:1000});assert(Buffer.byteLength(JSON.stringify(first))<=1024**2);assert(first.nextCursor);assert(first.items.length<101);
 const second=await runAssetOperation(toolkit,'Game','assets.scripts',{limit:1000,cursor:first.nextCursor});assert.equal(first.items.length+second.items.length,101);assert.equal(new Set([...first.items,...second.items].map(a=>a.scriptId)).size,101);
});
