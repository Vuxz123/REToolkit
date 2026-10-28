import test from 'node:test';
import assert from 'node:assert/strict';
import {definitions,validateAssetParamsForJob,invokeAssetApi} from '../src/assets/api.js';
import {assetTools} from '../src/assets/mcp.js';
import {parseRecoveryArgs} from '../src/recovery/cli.js';
import {buildDesktopCommand} from '../src/desktop/operations.js';
import {fixture} from './reconstruction-fixture.js';
import {createToolkit} from '../src/toolkit.js';
import fs from 'node:fs';
import path from 'node:path';
import {startJob,executeJob,getJob} from '../src/jobs/service.js';
const artifactId='11111111-1111-4111-8111-111111111111',revision='22222222-2222-4222-8222-222222222222';
test('typed recovery MCP/jobs reject unknown nested operations and validate domain arguments',()=>{
 for(const method of ['create','status','history','diagnose','run']){assert.ok(definitions['recovery.'+method]);assert.ok(assetTools.some(t=>t.name==='recovery_'+method));}
 validateAssetParamsForJob('recovery.run',{artifactId,revision,operation:'assets.index',params:{storage:'sqlite'}});
 for(const params of [{artifactId,revision,operation:'shell.exec',params:{}},{artifactId,revision,operation:'assets.index',params:{storage:'arbitrary'}},{artifactId,revision,operation:'recovery.run',params:{}},{artifactId,revision,operation:'assets.source',params:{}},{artifactId,revision,operation:'reconstruct.apply',params:{operationId:'../bad'}}])assert.throws(()=>validateAssetParamsForJob('recovery.run',params));
});
test('CLI and desktop expose artifact ID and exact revision without a target path',()=>{
 const p=parseRecoveryArgs(['recovery','run','Game','--artifact',artifactId,'--revision',revision,'--operation','assets.index','--params','{"storage":"sqlite"}','--json']);
 assert.equal(p.params.artifactId,artifactId);assert.deepEqual(p.params.params,{storage:'sqlite'});
 assert.equal(parseRecoveryArgs(['recovery','run','Game','--artifact',artifactId,'--revision',revision,'--operation','reconstruct.plan','--params-file','request.json']).options['params-file'],'request.json');
 assert.equal(parseRecoveryArgs(['recovery','--help']).help,true);
 for(const args of [['recovery','create','Game','--project','C:/other'],['recovery','run','Game','--artifact',artifactId],['recovery','status','Game','--artifact',artifactId,'--artifact',artifactId]])assert.throws(()=>parseRecoveryArgs(args));
 assert.deepEqual(buildDesktopCommand('recovery.create',{name:'Game'}),['recovery','create','Game']);
 assert.ok(buildDesktopCommand('recovery.diagnose',{name:'Game',artifactId}).includes(artifactId));
});
test('public API creates and reads the same durable artifact as the CLI contract',async t=>{
 const f=await fixture(t),toolkit=createToolkit(f.root,{log:()=>{}});await toolkit.init('Game');const workspace=toolkit.workspace('Game'),input=path.join(workspace,'01_Extracted');
 fs.writeFileSync(path.join(input,'libil2cpp.so'),'n');fs.writeFileSync(path.join(input,'global-metadata.dat'),'m');await toolkit.scan('Game',input);fs.cpSync(f.projectDir,path.join(workspace,'05_ReconstructedSource'),{recursive:true});
 const a=await invokeAssetApi(toolkit,'Game','recovery.create',{}),status=await invokeAssetApi(toolkit,'Game','recovery.status',{artifactId:a.artifactId});assert.equal(status.revision,a.revision);assert.equal(status.freshness,'current');
});
test('durable worker reports controlled recovery progress and final artifact identity',async t=>{
 const f=await fixture(t),toolkit=createToolkit(f.root,{log:()=>{}});await toolkit.init('Game');const workspace=toolkit.workspace('Game'),input=path.join(workspace,'01_Extracted');
 fs.writeFileSync(path.join(input,'libil2cpp.so'),'n');fs.writeFileSync(path.join(input,'global-metadata.dat'),'m');await toolkit.scan('Game',input);fs.cpSync(f.projectDir,path.join(workspace,'05_ReconstructedSource'),{recursive:true});
 const job=await startJob(toolkit,'Game',{operation:'recovery.create',params:{}},{spawn:()=>({pid:123,once(){},unref(){}})});
 const completed=await executeJob(toolkit,'Game',job.jobId);assert.equal(completed.state,'succeeded');assert.equal(completed.recoveryProgress.phase,'snapshot.complete');
 const observed=await getJob(toolkit,'Game',{jobId:job.jobId});assert.ok(observed.result.artifactId);assert.equal(observed.result.compileReady,false);
});
test('unconfirmed child cleanup never becomes a verified failure outcome',async t=>{
 const f=await fixture(t),toolkit=createToolkit(f.root,{log:()=>{}});await toolkit.init('Game');
 const job=await startJob(toolkit,'Game',{operation:'recovery.run',params:{artifactId,revision,operation:'reconstruct.validate',params:{}}},{spawn:()=>({pid:123,once(){},unref(){}})});
 const result=await executeJob(toolkit,'Game',job.jobId,{invoke:async()=>{throw Object.assign(Error('owned fixture cleanup unknown'),{code:'unity_recovery_required',preserveToolchainGate:true});}});
 assert.equal(result.state,'unknown');assert.equal(result.outcomeVerified,false);
});
