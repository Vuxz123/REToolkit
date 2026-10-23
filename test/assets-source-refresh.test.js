import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createToolkit} from '../src/toolkit.js';import {runAssetOperation} from '../src/assets/service.js';import {createUnityFixture} from './fixtures/unity-export-fixture.mjs';import {openStoredGraph} from '../src/assets/graph-storage.js';
import {startJob,executeJob,getJob} from '../src/jobs/service.js';
import {refreshSqliteGraph} from '../src/assets/sqlite-store.js';
import {refreshSourceGraph} from '../src/assets/source-refresh.js';
import {fingerprint} from '../src/state.js';
async function setup(t,storage='sqlite'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-source-refresh-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Game');const workspace=toolkit.workspace('Game'),input=path.join(workspace,'01_Extracted');
 fs.writeFileSync(path.join(input,'libil2cpp.so'),'native');fs.writeFileSync(path.join(input,'global-metadata.dat'),'metadata');await toolkit.scan('Game',input);
 const fixture=await createUnityFixture(path.join(workspace,'05_ReconstructedSource')),project=toolkit.read('Game');project.reconstructedSourceDir=fixture.projectDir;await toolkit.save('Game',project);
 const indexed=await runAssetOperation(toolkit,'Game','assets.index',{storage}),graphFile=path.join(workspace,'04_Notes/assets/graph.json'),graph=JSON.parse(fs.readFileSync(graphFile));
 const script=graph.assets.find(a=>a.path==='Assets/Player.cs');const request={kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:indexed.revision,changes:[{scriptId:script.id,source:fixture.source.replace('string text = "{ }";','health += 1;')}]};
 const preview=await runAssetOperation(toolkit,'Game','reconstruct.plan',{request});return {toolkit,workspace,fixture,graph,graphFile,script,preview};
}
test('source-only apply refreshes sealed SQLite rows without rebuilding serialized structure and retries reuse it',async t=>{
 const f=await setup(t),events=[];f.toolkit.onAssetProgress=e=>events.push(e);
 const oldFile=path.join(path.dirname(f.graphFile),f.graph.storage.relativePath),oldBytes=fs.readFileSync(oldFile),oldReader=openStoredGraph(f.graph,f.graphFile);
 const nodes=[...oldReader.readNodes()],edges=[...oldReader.readEdges()];oldReader.close();
 const result=await runAssetOperation(f.toolkit,'Game','reconstruct.apply',{operationId:f.preview.operationId});
 assert.equal(result.graphRefresh.strategy,'source-refresh');assert.equal(result.graphRefresh.changedScripts,1);
 const updated=JSON.parse(fs.readFileSync(f.graphFile));assert.notEqual(updated.revision,f.graph.revision);assert.notEqual(updated.storage.relativePath,f.graph.storage.relativePath);assert.deepEqual(updated.coverage,f.graph.coverage);
 assert.deepEqual(fs.readFileSync(oldFile),oldBytes);const reader=openStoredGraph(updated,f.graphFile);
 assert.deepEqual([...reader.readNodes()],nodes);assert.deepEqual([...reader.readEdges()],edges);assert.deepEqual(reader.query('assets.get',{id:f.script.id}).item,updated.assets.find(a=>a.id===f.script.id));reader.close();
 assert(events.some(e=>e.phase==='source.receipt'));assert(events.some(e=>e.phase==='refresh.copying'));assert(events.some(e=>e.phase==='refresh.sealed'));assert(!events.some(e=>e.phase==='indexing'));
 const repeated=await runAssetOperation(f.toolkit,'Game','reconstruct.apply',{operationId:f.preview.operationId});assert.equal(repeated.graphRefresh.strategy,'reuse');assert.equal(JSON.parse(fs.readFileSync(f.graphFile)).storage.relativePath,updated.storage.relativePath);
});
test('JSON source refresh keeps the complete graph rather than publishing the script-only saved graph',async t=>{
 const f=await setup(t,'json'),result=await runAssetOperation(f.toolkit,'Game','reconstruct.apply',{operationId:f.preview.operationId}),updated=JSON.parse(fs.readFileSync(f.graphFile));
 assert.equal(result.graphRefresh.strategy,'source-refresh');assert.deepEqual(updated.nodes,f.graph.nodes);assert.deepEqual(updated.edges,f.graph.edges);assert.equal(updated.assets.length,f.graph.assets.length);
 assert.deepEqual((await runAssetOperation(f.toolkit,'Game','assets.tree',{id:f.graph.assets.find(a=>a.kind==='scene').id})).items.length>0,true);
});

test('durable apply jobs expose bounded source/index progress and restore their callback',async t=>{
 const f=await setup(t),job=await startJob(f.toolkit,'Game',{operation:'reconstruct.apply',params:{operationId:f.preview.operationId}},{spawn:()=>({pid:process.pid,once(){return this;},unref(){}})});
 let release,ready;const gate=new Promise(resolve=>release=resolve),announced=new Promise(resolve=>ready=resolve);const prior=()=>{};f.toolkit.onAssetProgress=prior;
 const running=executeJob(f.toolkit,'Game',job.jobId,{invoke:async tk=>{
  try{tk.onAssetProgress({phase:'refresh.copying',changedScripts:1,databaseBytes:9264693248,elapsedMs:2345,source:'private source text'});tk.onAssetProgress({phase:'private source text',elapsedMs:2});tk.onAssetProgress({phase:'refresh.updating',elapsedMs:2,changedScripts:-1});ready();await gate;return {graphRefresh:{strategy:'source-refresh'}};}catch(e){ready();throw e;}
 }});
 await announced;
 try{const current=await getJob(f.toolkit,'Game',{jobId:job.jobId});assert.equal(current.stage,'assets.refresh.copying');assert.deepEqual(current.assetProgress,{phase:'refresh.copying',changedScripts:1,databaseBytes:9264693248,elapsedMs:2345});assert(!JSON.stringify(current).includes('private source text'));}
 finally{release();await running;}
 assert.equal(f.toolkit.onAssetProgress,prior);
});

test('source drift during refresh preserves the published manifest and source receipt; explicit retry after repair can refresh',async t=>{
 const f=await setup(t),manifest=fs.readFileSync(f.graphFile),scene=fs.readFileSync(f.fixture.scenePath);
 f.toolkit.onAssetProgress=e=>{if(e.phase==='refresh.copying')fs.appendFileSync(f.fixture.scenePath,'# outside change\n');};
 await assert.rejects(runAssetOperation(f.toolkit,'Game','reconstruct.apply',{operationId:f.preview.operationId}),/inventory|changed/i);
 assert.deepEqual(fs.readFileSync(f.graphFile),manifest);
 assert.equal(fs.readdirSync(path.join(path.dirname(f.graphFile),'indexes')).length,1,'Failed post-seal refresh must discard its owned unpublished copy');
 assert(fs.existsSync(path.join(f.workspace,'04_Notes/assets/reconstruction/journal',f.preview.operationId,'receipt.json')));
 fs.writeFileSync(f.fixture.scenePath,scene);f.toolkit.onAssetProgress=undefined;
 assert.equal((await runAssetOperation(f.toolkit,'Game','reconstruct.apply',{operationId:f.preview.operationId})).graphRefresh.strategy,'source-refresh');
});
test('a database modified in the final progress callback cannot be published as a successful refresh',async t=>{
 const f=await setup(t),manifest=fs.readFileSync(f.graphFile);
 f.toolkit.onAssetProgress=event=>{if(event.phase==='refresh.sealed'){
  const directory=path.join(path.dirname(f.graphFile),'indexes'),original=f.graph.storage.relativePath.split('/')[1],fresh=fs.readdirSync(directory).find(name=>name!==original);
  fs.appendFileSync(path.join(directory,fresh,'graph.sqlite'),'external change');
 }};
 await assert.rejects(runAssetOperation(f.toolkit,'Game','reconstruct.apply',{operationId:f.preview.operationId}),/changed|identity|database/i);
 assert.deepEqual(fs.readFileSync(f.graphFile),manifest);
});
for(const phase of ['refresh.updating','refresh.sealing'])test(`database callback boundary ${phase} refuses changes instead of sealing them as trusted output`,async t=>{
 const f=await setup(t),manifest=fs.readFileSync(f.graphFile);
 f.toolkit.onAssetProgress=event=>{if(event.phase===phase){
  const directory=path.join(path.dirname(f.graphFile),'indexes'),original=f.graph.storage.relativePath.split('/')[1],fresh=fs.readdirSync(directory).find(name=>name!==original);
  fs.appendFileSync(path.join(directory,fresh,'graph.sqlite'),'external change');
 }};
 await assert.rejects(runAssetOperation(f.toolkit,'Game','reconstruct.apply',{operationId:f.preview.operationId}),/changed|identity|database/i);
 assert.deepEqual(fs.readFileSync(f.graphFile),manifest);
});
test('manifest publication failure discards only the owned unpublished database',async t=>{
 const f=await setup(t),manifest=fs.readFileSync(f.graphFile);
 f.toolkit.onAssetProgress=event=>{if(event.phase==='refresh.sealed'){fs.renameSync(f.graphFile,f.graphFile+'.saved');fs.mkdirSync(f.graphFile);}};
 await assert.rejects(runAssetOperation(f.toolkit,'Game','reconstruct.apply',{operationId:f.preview.operationId}));
 assert.equal(fs.readdirSync(path.join(path.dirname(f.graphFile),'indexes')).length,1);
 assert.deepEqual(fs.readFileSync(f.graphFile+'.saved'),manifest);
});
test('an error after manifest rename preserves its referenced generation and retry reuses it',async t=>{
 const f=await setup(t),rename=fs.renameSync;
 fs.renameSync=(from,to)=>{const result=rename(from,to);if(path.resolve(to)===f.graphFile)throw Error('owned fixture error after publication');return result;};
 try{await assert.rejects(runAssetOperation(f.toolkit,'Game','reconstruct.apply',{operationId:f.preview.operationId}),/after publication/i);}finally{fs.renameSync=rename;}
 const updated=JSON.parse(fs.readFileSync(f.graphFile)),reader=openStoredGraph(updated,f.graphFile);reader.close();
 assert.notEqual(updated.storage.relativePath,f.graph.storage.relativePath);
 assert.equal((await runAssetOperation(f.toolkit,'Game','reconstruct.apply',{operationId:f.preview.operationId})).graphRefresh.strategy,'reuse');
});
test('refresh refuses altered database bytes and exclusive destination collisions',async t=>{
 const f=await setup(t),result=await runAssetOperation(f.toolkit,'Game','reconstruct.apply',{operationId:f.preview.operationId}),updated=JSON.parse(fs.readFileSync(f.graphFile)),file=path.join(path.dirname(f.graphFile),f.graph.storage.relativePath),outputFile=path.join(f.workspace,'04_Notes/existing.sqlite');
 fs.writeFileSync(outputFile,'keep');
 await assert.rejects(refreshSqliteGraph({file,outputFile,graph:f.graph,updatedGraph:updated,scriptIds:[f.script.id]}),{code:'EEXIST'});assert.equal(fs.readFileSync(outputFile,'utf8'),'keep');
 const receipt=JSON.parse(fs.readFileSync(path.join(f.workspace,result.storedReceipt))),manifest=fs.readFileSync(f.graphFile);
 await assert.rejects(refreshSourceGraph({projectDir:f.fixture.projectDir,graph:f.graph,graphFile:f.graphFile,receipt,onProgress:event=>{if(event.phase==='refresh.copying')fs.appendFileSync(file,'tamper');}}),/match|changed|hash/i);
 assert.deepEqual(fs.readFileSync(f.graphFile),manifest);
});
test('source refresh rejects forged receipt changes outside the applied scripts',async t=>{
 const f=await setup(t),result=await runAssetOperation(f.toolkit,'Game','reconstruct.apply',{operationId:f.preview.operationId}),receipt=JSON.parse(fs.readFileSync(path.join(f.workspace,result.storedReceipt)));
 receipt.files.find(file=>file.path.endsWith('.unity')).sha256='f'.repeat(64);const {receiptSha256,...unsigned}=receipt;receipt.receiptSha256=fingerprint(unsigned);
 await assert.rejects(refreshSourceGraph({projectDir:f.fixture.projectDir,graph:f.graph,graphFile:f.graphFile,receipt}),/non-source/i);
});
test('missing complete JSON baseline falls back to full indexing instead of publishing a saved projection',async t=>{
 const f=await setup(t,'json'),saved=JSON.parse(fs.readFileSync(path.join(f.workspace,f.preview.storedPlan)));
 assert(saved.graph.nodes.length<f.graph.nodes.length);fs.writeFileSync(f.graphFile,JSON.stringify(saved.graph));
 const result=await runAssetOperation(f.toolkit,'Game','reconstruct.apply',{operationId:f.preview.operationId});assert.equal(result.graphRefresh.strategy,'full-index');
 const updated=JSON.parse(fs.readFileSync(f.graphFile));assert.equal(updated.nodes.length,f.graph.nodes.length);assert.equal(updated.assets.length,f.graph.assets.length);
});
