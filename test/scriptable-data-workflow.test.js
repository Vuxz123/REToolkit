import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {invokeAssetApi} from '../src/assets/api.js';
import {startJob,executeJob} from '../src/jobs/service.js';
import {verifyDataAcceptance} from '../src/data/service.js';
import {dataFixture} from './helpers/data-service-fixture.js';
const spawn=()=>({pid:process.pid,once(){},unref(){}});
async function workflow(f,baselineId,scope=f.scope){
 const call=(c,p)=>invokeAssetApi(f.toolkit,'Game','workflow.'+c,p);
 const r=await call('create',{goal:'Preserve data and play',authorizedOperations:['data.verify'],steps:[{id:'data',label:'Level data',dimension:'data',baselineId,assetIds:scope,dependsOn:[]},{id:'play',label:'Play',dimension:'gameplay',dependsOn:['data'],scenario:{entry:'Level',actions:['start'],expected:'interactive'}}]});
 const c=await call('claim',{runId:r.runId,sequence:r.sequence,harness:'codex',threadId:process.env.CODEX_THREAD_ID??randomUUID()});return {call,c,bound:{runId:r.runId,sequence:c.sequence,claimId:c.controller.claimId}};
}
test('workflow requires exact successful data verification without completing gameplay',async t=>{
 const f=await dataFixture(t),b=await f.call('capture',{assetIds:f.scope}),w=await workflow(f,b.baselineId);
 const j=await startJob(f.toolkit,'Game',{operation:'data.verify',params:{baselineId:b.baselineId}},{spawn});await executeJob(f.toolkit,'Game',j.jobId,{invoke:()=>f.call('verify',{baselineId:b.baselineId})});
 const r=await w.call('checkpoint',{...w.bound,stepId:'data',outcome:'job',jobId:j.jobId});assert.equal(r.steps[0].state,'verified');assert.equal(r.complete,false);assert.equal(r.nextStep.id,'play');
 fs.appendFileSync(path.join(f.root,'templates/Unity/REToolkitValidation.cs'),'\n// new helper revision');const stale=await w.call('next',{runId:r.runId});assert.equal(stale.state,'needs-inspection');assert.equal(stale.reason,'workflow_data_evidence_stale');
 const id=r.steps[0].evidence.operationId;fs.appendFileSync(path.join(f.project,'Assets/Player.cs'),'// later edit');
 await assert.rejects(verifyDataAcceptance({toolkit:f.toolkit,name:'Game',operationId:id,baselineId:b.baselineId,assetIds:f.scope,projectDir:f.project}),{code:'data_observation_stale'});
});
test('data differences remain unfinished and do not count as a successful acceptance job',async t=>{
 const f=await dataFixture(t),b=await f.call('capture',{assetIds:f.scope}),w=await workflow(f,b.baselineId);f.edit(d=>d.objects[0].properties[2].value='999');
 const j=await startJob(f.toolkit,'Game',{operation:'data.verify',params:{baselineId:b.baselineId}},{spawn});await executeJob(f.toolkit,'Game',j.jobId,{invoke:()=>f.call('verify',{baselineId:b.baselineId})});
 const r=await w.call('checkpoint',{...w.bound,stepId:'data',outcome:'job',jobId:j.jobId});assert.equal(r.steps[0].state,'unverified');assert.equal(r.complete,false);assert.notEqual(r.nextStep?.id,'play');
});
test('a different saved asset scope cannot reuse a verification receipt',async t=>{
 const f=await dataFixture(t),b=await f.call('capture',{assetIds:f.scope}),w=await workflow(f,b.baselineId,['asset:'+'c'.repeat(32)]);
 const j=await startJob(f.toolkit,'Game',{operation:'data.verify',params:{baselineId:b.baselineId}},{spawn});await executeJob(f.toolkit,'Game',j.jobId,{invoke:()=>f.call('verify',{baselineId:b.baselineId})});
 await assert.rejects(w.call('checkpoint',{...w.bound,stepId:'data',outcome:'job',jobId:j.jobId}),{code:'data_scope_invalid'});
});
test('one data verification job supplies compile/data/scoped-binding evidence without a second Editor run',async t=>{
 const f=await dataFixture(t),b=await f.call('capture',{assetIds:f.scope}),call=(c,p)=>invokeAssetApi(f.toolkit,'Game','workflow.'+c,p);
 const run=await call('create',{goal:'Data boundary',authorizedOperations:['data.verify'],steps:[{id:'compile',label:'Compile',dimension:'compilation',dependsOn:[]},{id:'data',label:'Data',dimension:'data',baselineId:b.baselineId,assetIds:f.scope,dependsOn:['compile']},{id:'bind',label:'Bindings',dimension:'bindings',assetIds:f.scope,dependsOn:['data']},{id:'play',label:'Play',dimension:'gameplay',dependsOn:['bind'],scenario:{entry:'Level',actions:['start'],expected:'interactive'}}]});
 let r=await call('claim',{runId:run.runId,sequence:run.sequence,harness:'codex',threadId:process.env.CODEX_THREAD_ID??randomUUID()});
 const j=await startJob(f.toolkit,'Game',{operation:'data.verify',params:{baselineId:b.baselineId}},{spawn});await executeJob(f.toolkit,'Game',j.jobId,{invoke:()=>f.call('verify',{baselineId:b.baselineId})});
 for(const stepId of ['compile','data','bind']){r=await call('checkpoint',{runId:r.runId,sequence:r.sequence,claimId:r.controller.claimId,stepId,outcome:'job',jobId:j.jobId});assert.equal(r.steps.find(s=>s.id===stepId).state,'verified',stepId);}
 assert.equal(f.calls(),2);assert.equal(r.complete,false);assert.equal(r.nextStep.id,'play');
});
