import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createToolkit} from '../src/toolkit.js';
import {runAssetOperation} from '../src/assets/service.js';
import {createUnityFixture} from './fixtures/unity-export-fixture.mjs';
import {inspectAssetReadiness} from '../src/assets/readiness.js';
import {runLibraryOperation} from '../src/libraries/service.js';
import {parseAssetArgs} from '../src/assets/cli.js';

test('SQLite graph supports paged inspection, exact script filling and idempotent receipts through shared service',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-sqlite-service-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Game');
 const input=path.join(toolkit.workspace('Game'),'01_Extracted');fs.writeFileSync(path.join(input,'libil2cpp.so'),'native');fs.writeFileSync(path.join(input,'global-metadata.dat'),'metadata');await toolkit.scan('Game',input);
 const fixture=await createUnityFixture(path.join(toolkit.workspace('Game'),'05_ReconstructedSource'));const project=toolkit.read('Game');project.reconstructedSourceDir=fixture.projectDir;await toolkit.save('Game',project);
 const indexed=await runAssetOperation(toolkit,'Game','assets.index',{storage:'sqlite'});assert.equal(indexed.state,'indexed');assert.equal(indexed.storage,'sqlite');
 const graphFile=path.join(toolkit.workspace('Game'),'04_Notes/assets/graph.json'),graph=JSON.parse(fs.readFileSync(graphFile));assert.equal(graph.schemaVersion,2);assert.equal(graph.nodes,undefined);assert.equal(graph.edges,undefined);
 assert.equal((await inspectAssetReadiness(toolkit,'Game')).state,'indexed');
 await runLibraryOperation(toolkit,null,'libraries.scan');const libraries=await runLibraryOperation(toolkit,'Game','libraries.identify');assert.equal(libraries.graphRevision,indexed.revision);assert.deepEqual(libraries.items,[]);
 const originalGraph=fs.readFileSync(graphFile),downgraded={...graph,schemaVersion:1,nodes:[],edges:[],profile:{...graph.profile}};delete downgraded.storage;delete downgraded.profile.storage;fs.writeFileSync(graphFile,JSON.stringify(downgraded));await assert.rejects(runAssetOperation(toolkit,'Game','assets.scripts'));assert.notEqual((await inspectAssetReadiness(toolkit,'Game')).state,'indexed');fs.writeFileSync(graphFile,originalGraph);
 const list=await runAssetOperation(toolkit,'Game','assets.list',{limit:1});assert.equal(list.items.length,1);assert.ok(list.nextCursor);
 const scripts=await runAssetOperation(toolkit,'Game','assets.scripts',{limit:1});assert.equal(scripts.items[0].components.length,1);assert.equal(scripts.items[0].identity.fullName,'Demo.Player');
 const source=await runAssetOperation(toolkit,'Game','assets.source',{id:scripts.items[0].scriptId});assert.equal(source.source,fixture.source);
 const scene=fs.readFileSync(fixture.scenePath),meta=fs.readFileSync(fixture.scriptPath+'.meta');
 const request={kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:indexed.revision,changes:[{scriptId:scripts.items[0].scriptId,source:fixture.source.replace('string text = "{ }";','health += 1;')}]};
 const plan=await runAssetOperation(toolkit,'Game','reconstruct.plan',{request}),saved=JSON.parse(fs.readFileSync(path.join(toolkit.workspace('Game'),plan.storedPlan)));assert.equal(saved.graph.schemaVersion,2);assert.equal(saved.graph.nodes,undefined);
 const planFile=path.join(toolkit.workspace('Game'),plan.storedPlan),originalPlan=fs.readFileSync(planFile),downgradedPlan=JSON.parse(originalPlan);downgradedPlan.graph={...downgradedPlan.graph,schemaVersion:1,nodes:[],edges:[],profile:{...downgradedPlan.graph.profile}};delete downgradedPlan.graph.storage;delete downgradedPlan.graph.profile.storage;fs.writeFileSync(planFile,JSON.stringify(downgradedPlan));await assert.rejects(runAssetOperation(toolkit,'Game','reconstruct.apply',{operationId:plan.operationId}));assert.equal(fs.readFileSync(fixture.scriptPath,'utf8'),fixture.source);fs.writeFileSync(planFile,originalPlan);await runAssetOperation(toolkit,'Game','assets.index',{storage:'json'});
 const receipt=await runAssetOperation(toolkit,'Game','reconstruct.apply',{operationId:plan.operationId});assert.equal(receipt.compileReady,false);assert.equal(toolkit.read('Game').assetReconstruction.graphStorage,'sqlite');assert.equal((await inspectAssetReadiness(toolkit,'Game')).state,'indexed');const generations=fs.readdirSync(path.join(path.dirname(graphFile),'indexes'));
 const {graphRefresh:retryRefresh,...retryReceipt}=await runAssetOperation(toolkit,'Game','reconstruct.apply',{operationId:plan.operationId}),{graphRefresh:firstRefresh,...firstReceipt}=receipt;
 assert.deepEqual(retryReceipt,firstReceipt);assert.equal(retryRefresh.strategy,'reuse');assert.equal(firstRefresh.strategy,'source-refresh');assert.deepEqual(fs.readdirSync(path.join(path.dirname(graphFile),'indexes')),generations,'receipt retry must reuse the already current sealed graph');
 assert.deepEqual(fs.readFileSync(fixture.scenePath),scene);assert.deepEqual(fs.readFileSync(fixture.scriptPath+'.meta'),meta);assert.equal(JSON.parse(fs.readFileSync(graphFile)).storage.kind,'sqlite');
 const current=JSON.parse(fs.readFileSync(graphFile)),db=path.join(path.dirname(graphFile),current.storage.relativePath);fs.appendFileSync(db,'corrupt');assert.notEqual((await inspectAssetReadiness(toolkit,'Game')).state,'indexed');await assert.rejects(runAssetOperation(toolkit,'Game','assets.list'));
});

test('SQLite storage selector is explicit and cannot combine with JSON graph budgets',()=>{
 assert.deepEqual(parseAssetArgs(['assets','index','Game','--storage','sqlite']).params,{storage:'sqlite'});
 assert.throws(()=>parseAssetArgs(['assets','index','Game','--storage','unknown']));
 assert.throws(()=>parseAssetArgs(['assets','index','Game','--storage','sqlite','--max-graph-mib','512']));
});
