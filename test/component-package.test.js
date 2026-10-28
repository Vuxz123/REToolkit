import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {componentFixture} from './helpers/component-fixture.js';
import {fileIdentity} from '../src/state.js';
import {runAssetOperation} from '../src/assets/service.js';
import {runComponentOperation} from '../src/components/service.js';
async function packageFixture(t){
 const f=await componentFixture(t),root=path.join(f.project,'Packages/com.example.ui');fs.mkdirSync(root,{recursive:true});
 for(const file of ['Replacement.cs','Replacement.cs.meta']){fs.renameSync(path.join(f.project,'Assets',file),path.join(root,file));}
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'com.example.ui',version:'1.0.0'}));fs.writeFileSync(path.join(root,'Runtime.asmdef'),JSON.stringify({name:'Example.UI'}));
 const files=fs.readdirSync(root).map(file=>({...fileIdentity(path.join(root,file)),path:file})).map(({path,size,sha256})=>({path,size,sha256}));
 fs.writeFileSync(path.join(f.project,'Packages/retk-libraries.lock.json'),JSON.stringify({kind:'retoolkit-managed-libraries',schemaVersion:1,operationId:randomUUID(),catalogRevision:'a'.repeat(64),packages:[{id:'com.example.ui',version:'1.0.0',libraryId:'fixture-ui',catalogPackageId:'b'.repeat(64),archiveSha256:'c'.repeat(64),root:'Packages/com.example.ui',files}]}));
 await runAssetOperation(f.toolkit,'Game','assets.index',{storage:'sqlite'});f.edit(report=>{report.scripts[1].path='Packages/com.example.ui/Replacement.cs';report.scripts[1].assembly='Example.UI';for(const row of report.components)if(row.script?.guid==='b'.repeat(32))row.script.assembly='Example.UI';});return f;
}
test('a managed inventoried Packages source can be targeted through the canonical migration staging route',async t=>{
 const f=await packageFixture(t),call=(command,params={})=>runComponentOperation(f.toolkit,'Game',command,params,f.dependencies),obs=await call('observe',{componentIds:[f.id]}),targets=await call('report',{operationId:obs.operationId,section:'targets'}),target=targets.items.find(t=>t.origin==='package');assert.equal(target.writable,true);
 const plan=await call('plan',{observationId:obs.operationId,mappings:[{componentId:f.id,targetId:target.targetId}]});assert.equal(plan.state,'planned',JSON.stringify(plan));const applied=await call('apply',{operationId:plan.operationId});assert.equal(applied.state,'staged');
 const fresh=await call('observe',{componentIds:[f.id],stageOperationId:applied.operationId});assert.equal((await call('verify',{operationId:plan.operationId,observationId:fresh.operationId})).bindingsVerified,true);
});
test('package-cache-only implementations are readable but cannot authorize source rebinding',async t=>{
 const f=await componentFixture(t),call=(command,params={})=>runComponentOperation(f.toolkit,'Game',command,params,f.dependencies);f.edit(report=>{report.scripts.push({path:'Packages/com.unity.textmeshpro/TextMeshProUGUI.cs',guid:'d'.repeat(32),fileID:'11500000',fullName:'TMPro.TextMeshProUGUI',assembly:'Unity.TextMeshPro',fields:[]});});
 const obs=await call('observe',{componentIds:[f.id]}),targets=await call('report',{operationId:obs.operationId,section:'targets'}),target=targets.items.find(t=>t.fullName==='TMPro.TextMeshProUGUI');assert.equal(target.writable,false);assert.equal(target.libraries.descriptors[0].id,'textmeshpro');const plan=await call('plan',{observationId:obs.operationId,mappings:[{componentId:f.id,targetId:target.targetId}]});assert.equal(plan.state,'blocked');await assert.rejects(call('apply',{operationId:plan.operationId}),/actionable|blocked/i);
});
