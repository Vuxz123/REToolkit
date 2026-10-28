import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {componentFixture} from './helpers/component-fixture.js';
import {runRecoveryOperation} from '../src/recovery/service.js';
test('artifact adopts component migration and continues observation on the current combined generation',async t=>{
 const f=await componentFixture(t),call=(command,params={})=>runRecoveryOperation(f.toolkit,'Game',command,params,{components:f.dependencies});let artifact=await call('create');const artifactId=artifact.artifactId;
 const run=async(operation,params={})=>{const next=await call('run',{artifactId,revision:artifact.revision,operation,params});artifact=next;return next.result;};
 await run('assets.index',{storage:'sqlite'});const observed=await run('components.observe',{componentIds:[f.id,f.nativeId]});
 const targets=await run('components.report',{operationId:observed.operationId,section:'targets'}),target=targets.items.find(t=>t.fullName==='Game.Replacement');
 const plan=await run('components.plan',{observationId:observed.operationId,mappings:[{componentId:f.id,targetId:target.targetId}]}),parent=artifact.revision,applied=await run('components.apply',{operationId:plan.operationId});
 assert.equal(applied.state,'staged');assert.notEqual(artifact.revision,parent);assert.match(fs.readFileSync(path.join(f.workspace,artifact.project,'Assets/Main.unity'),'utf8'),new RegExp('guid: '+'b'.repeat(32)));assert.match(fs.readFileSync(path.join(f.project,'Assets/Main.unity'),'utf8'),new RegExp('guid: '+'a'.repeat(32)));
 const stageObserved=await run('components.observe',{componentIds:[f.id,f.nativeId],stageOperationId:applied.operationId});assert.equal(stageObserved.state,'observed');
 const fresh=await run('components.observe',{componentIds:[f.id,f.nativeId]});assert.equal((await run('components.verify',{operationId:plan.operationId,observationId:fresh.operationId})).bindingsVerified,true);
 const scripts=await run('assets.scripts'),script=scripts.items.find(s=>s.path==='Assets/Player.cs'),index=await run('assets.list',{limit:1});
 const sourcePlan=await run('reconstruct.plan',{request:{kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:index.revision,changes:[{scriptId:script.scriptId,source:f.files['Assets/Player.cs'].replace('Run() {}','Run() { health += 1; }')}]}});await run('reconstruct.apply',{operationId:sourcePlan.operationId});
 await assert.rejects(run('components.observe',{componentIds:[f.id],stageOperationId:applied.operationId}),/historical|current|stale/i);
 await assert.rejects(run('components.verify',{operationId:plan.operationId,observationId:fresh.operationId}),/historical|current|stale/i);
});
test('component observations from another artifact cannot be referenced by UUID',async t=>{
 const f=await componentFixture(t),call=(command,params={})=>runRecoveryOperation(f.toolkit,'Game',command,params,{components:f.dependencies}),a=await call('create'),b=await call('create');
 for(const artifact of [a,b])await call('run',{artifactId:artifact.artifactId,revision:artifact.revision,operation:'assets.index',params:{storage:'sqlite'}});
 const observe=await call('run',{artifactId:a.artifactId,revision:a.revision,operation:'components.observe',params:{componentIds:[f.id]}});
 await assert.rejects(call('run',{artifactId:b.artifactId,revision:b.revision,operation:'components.plan',params:{observationId:observe.result.operationId}}));
});
