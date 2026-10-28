import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture} from './reconstruction-fixture.js';
import {createToolkit} from '../src/toolkit.js';
import {runDataOperation} from '../src/data/service.js';
import {dataSnapshot} from './helpers/scriptable-data.js';
import {runRecoveryOperation} from '../src/recovery/service.js';

import {dataFixture as setup} from './helpers/data-service-fixture.js';

test('data baseline and fresh verification preserve original export and expose bounded property pages',async t=>{
 const f=await setup(t),before=fs.readFileSync(path.join(f.project,'Assets/Level.asset'));
 const baseline=await f.call('capture',{assetIds:f.scope});assert.equal(baseline.state,'captured');assert.equal(baseline.runtimeInitialized,'unverified');
 const result=await f.call('verify',{baselineId:baseline.baselineId});assert.equal(result.dataPreserved,true);assert.equal(result.schemaCompatible,true);assert.equal(f.calls(),2);assert.equal(result.gameplay,'unverified');assert.deepEqual(fs.readFileSync(path.join(f.project,'Assets/Level.asset')),before);
 const page=await f.call('report',{operationId:baseline.operationId,section:'properties',limit:1});assert.equal(page.items.length,1);assert(page.nextCursor);assert.equal((await f.call('report',{operationId:baseline.operationId,section:'properties',limit:1,cursor:page.nextCursor})).items.length,1);
});
test('array values, schema and refs differences fail preservation without overwriting baseline',async t=>{
 const f=await setup(t),baseline=await f.call('capture',{assetIds:f.scope});f.edit(d=>{d.objects[0].properties[2].value='99';d.objects[0].properties[3].type='long';});
 const changed=await f.call('verify',{baselineId:baseline.baselineId});assert.equal(changed.state,'changed');assert.equal(changed.dataPreserved,false);assert.equal(changed.differenceCount,2);assert.equal(changed.schemaCompatible,false);
 assert.equal((await f.call('report',{operationId:baseline.operationId})).state,'captured');assert.equal((await f.call('report',{operationId:changed.operationId,section:'differences'})).total,2);
});
test('unsupported property coverage and missing Editor cannot become verified data',async t=>{
 const f=await setup(t);f.edit(d=>{d.complete=false;d.objects[0].complete=false;d.unsupportedProperties=1;d.objects[0].properties.push({path:'curve',kind:'AnimationCurve',type:'AnimationCurve',value:null});});
 const partial=await f.call('capture',{assetIds:f.scope});assert.equal(partial.state,'partial');assert.equal(partial.dataCaptureComplete,false);await assert.rejects(f.call('verify',{baselineId:partial.baselineId}));
});
test('baseline and observation edits, different inputs and missing meta remain explicit gates',async t=>{
 const f=await setup(t),baseline=await f.call('capture',{assetIds:f.scope});const receipt=path.join(f.workspace,baseline.storedReceipt),value=JSON.parse(fs.readFileSync(receipt));value.assetIds=[];fs.writeFileSync(receipt,JSON.stringify(value));await assert.rejects(f.call('verify',{baselineId:baseline.baselineId}));
 const g=await setup(t),good=await g.call('capture',{assetIds:g.scope});const observation=path.join(g.workspace,'04_Notes/assets/unity-validation',good.validationOperationId,'observation.json');fs.appendFileSync(observation,' ');await assert.rejects(g.call('verify',{baselineId:good.baselineId}));
 fs.unlinkSync(path.join(g.project,'Assets/Level.asset.meta'));await assert.rejects(g.call('capture',{assetIds:g.scope}));
});
test('shared artifacts isolate data contracts and compose verification with later generations',async t=>{
 const f=await setup(t),a=await runRecoveryOperation(f.toolkit,'Game','create',{}),b=await runRecoveryOperation(f.toolkit,'Game','create',{});
 const capture=await runRecoveryOperation(f.toolkit,'Game','run',{artifactId:a.artifactId,revision:a.revision,operation:'data.capture',params:{assetIds:f.scope}},{data:f.dependencies});assert.equal(capture.result.state,'captured');
 const verify=await runRecoveryOperation(f.toolkit,'Game','run',{artifactId:a.artifactId,revision:capture.revision,operation:'data.verify',params:{baselineId:capture.result.baselineId}},{data:f.dependencies});assert.equal(verify.result.dataPreserved,true);
 await assert.rejects(runRecoveryOperation(f.toolkit,'Game','run',{artifactId:b.artifactId,revision:b.revision,operation:'data.verify',params:{baselineId:capture.result.baselineId}},{data:f.dependencies}));
});
test('an uncompileable/missing-Editor baseline retains original asset and meta bytes',async t=>{
 const f=await setup(t);fs.writeFileSync(path.join(f.project,'ProjectSettings/ProjectVersion.txt'),'m_EditorVersion: 2099.1.0f1\n');
 const b=await runDataOperation(f.toolkit,'Game','capture',{assetIds:f.scope});assert.equal(b.state,'blocked');assert.equal(b.dataCaptureComplete,false);assert(b.storedRaw);
 const original=path.join(f.workspace,b.storedRaw,'Assets/Level.asset');assert.deepEqual(fs.readFileSync(original),fs.readFileSync(path.join(f.project,'Assets/Level.asset')));assert(fs.existsSync(original+'.meta'));
 assert.equal((await f.call('report',{operationId:b.operationId})).state,'blocked');
});
test('edited raw baseline bytes invalidate provenance before another Editor operation',async t=>{
 const f=await setup(t),b=await f.call('capture',{assetIds:f.scope});fs.appendFileSync(path.join(f.workspace,b.storedRaw,'Assets/Level.asset'),'changed');
 await assert.rejects(f.call('verify',{baselineId:b.baselineId}),{code:'data_raw_changed'});assert.equal(f.calls(),1);
});
test('mixed-case Unity .asset extensions remain readable and verifiable after capture',async t=>{
 const f=await setup(t);for(const suffix of ['', '.meta'])fs.renameSync(path.join(f.project,'Assets/Level.asset'+suffix),path.join(f.project,'Assets/Level.ASSET'+suffix));
 const b=await f.call('capture',{assetIds:f.scope});assert.equal(b.state,'captured');assert.equal((await f.call('report',{operationId:b.operationId})).state,'captured');assert.equal((await f.call('verify',{baselineId:b.baselineId})).dataPreserved,true);
});
