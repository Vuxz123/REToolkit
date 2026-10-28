import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fingerprint} from '../src/state.js';
import {componentFixture} from './helpers/component-fixture.js';
const api=()=>import('../src/components/service.js');
for(const storage of ['json','sqlite'])test('component lifecycle '+storage+' keeps original bytes and requires a fresh post-apply observation',async t=>{
 const f=await componentFixture(t,storage),{runComponentOperation:run}=await api(),call=(command,params={})=>run(f.toolkit,'Game',command,params,f.dependencies),before=fs.readFileSync(path.join(f.project,'Assets/Main.unity'),'utf8');
 const scan=await call('scan');assert.equal(scan.total,2);assert.equal(scan.implementation,'unverified');assert.equal((await call('report',{operationId:scan.operationId,section:'groups'})).total,2);
 const obs=await call('observe',{componentIds:[f.id,f.nativeId]});assert.equal(obs.state,'observed');
 const targets=await call('report',{operationId:obs.operationId,section:'targets'}),replacement=targets.items.find(t=>t.fullName==='Game.Replacement');assert.equal(replacement.observed,true);
 const plan=await call('plan',{observationId:obs.operationId,mappings:[{componentId:f.id,targetId:replacement.targetId}]});assert.equal(plan.state,'planned');
 const applied=await call('apply',{operationId:plan.operationId});assert.equal(applied.state,'staged');assert.equal(fs.readFileSync(path.join(f.project,'Assets/Main.unity'),'utf8'),before);
 const integrity=await call('verify',{operationId:plan.operationId});assert.equal(integrity.valid,true);assert.equal(integrity.bindingsVerified,false);
 await assert.rejects(call('verify',{operationId:plan.operationId,observationId:obs.operationId}),/stale|stage|inventory/i);
 const fresh=await call('observe',{componentIds:[f.id,f.nativeId],stageOperationId:applied.operationId});assert.equal((await call('verify',{operationId:plan.operationId,observationId:fresh.operationId})).bindingsVerified,true);
});
test('component plans reject forged observation artifacts, native mappings and stale source',async t=>{
 const f=await componentFixture(t),{runComponentOperation:run}=await api(),call=(command,params={})=>run(f.toolkit,'Game',command,params,f.dependencies);
 const obs=await call('observe',{componentIds:[f.id,f.nativeId]});
 await assert.rejects(call('plan',{observationId:obs.operationId,mappings:[{componentId:f.nativeId,targetId:'a'.repeat(64)}]}),/native|mapping/i);
 fs.appendFileSync(path.join(f.project,'Assets/Player.cs'),'// change');await assert.rejects(call('plan',{observationId:obs.operationId}),/stale|changed/i);
});
test('verification covers preserved native components as well as rewritten script bindings',async t=>{
 const f=await componentFixture(t),{runComponentOperation:run}=await api(),call=(command,params={})=>run(f.toolkit,'Game',command,params,f.dependencies),obs=await call('observe',{componentIds:[f.id,f.nativeId]}),targets=await call('report',{operationId:obs.operationId,section:'targets'}),target=targets.items.find(t=>t.fullName==='Game.Replacement'),plan=await call('plan',{observationId:obs.operationId,mappings:[{componentId:f.id,targetId:target.targetId}]}),applied=await call('apply',{operationId:plan.operationId});
 f.edit(report=>{report.components.find(c=>c.componentId===f.nativeId).fullName='UnityEngine.Rigidbody';});const fresh=await call('observe',{componentIds:[f.id,f.nativeId],stageOperationId:applied.operationId});assert.equal((await call('verify',{operationId:plan.operationId,observationId:fresh.operationId})).bindingsVerified,false);
});
test('an already matching component plan verifies without inventing a migration or rewriting data',async t=>{
 const f=await componentFixture(t),{runComponentOperation:run}=await api(),call=(command,params={})=>run(f.toolkit,'Game',command,params,f.dependencies),obs=await call('observe',{componentIds:[f.id,f.nativeId]}),plan=await call('plan',{observationId:obs.operationId});assert.equal(plan.state,'no-change');const verified=await call('verify',{operationId:plan.operationId});assert.equal(verified.bindingsVerified,true);assert.equal(verified.valid,true);assert.equal((await call('apply',{operationId:plan.operationId})).state,'no-change');
});
test('a rehashed observation copy must still match the fixed helper report and staged helper bytes',async t=>{
 const f=await componentFixture(t),{runComponentOperation:run}=await api(),call=(command,params={})=>run(f.toolkit,'Game',command,params,f.dependencies),obs=await call('observe',{componentIds:[f.id]}),recordFile=path.join(f.workspace,obs.storedRecord),record=JSON.parse(fs.readFileSync(recordFile)),copyFile=path.join(path.dirname(recordFile),'editor/observations.json'),copy=JSON.parse(fs.readFileSync(copyFile));copy.scripts[0].fields=[];fs.writeFileSync(copyFile,JSON.stringify(copy));record.observationSha256=fingerprint(copy);delete record.payloadSha256;record.payloadSha256=fingerprint(record);fs.writeFileSync(recordFile,JSON.stringify(record));await assert.rejects(call('plan',{observationId:obs.operationId}),/provenance|report|changed/i);
});
