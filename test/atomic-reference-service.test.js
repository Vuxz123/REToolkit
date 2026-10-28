import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {dataFixture} from './helpers/data-service-fixture.js';
import {compareDataSnapshots} from '../src/data/contracts.js';
import {seal,unseal} from '../src/recovery/artifacts.js';
import {runRecoveryOperation} from '../src/recovery/service.js';
import {spawnSync} from 'node:child_process';
async function legacyFixture(t){
 const f=await dataFixture(t),helper=path.join(f.root,'templates/Unity/REToolkitValidation.cs'),current=fs.readFileSync(helper);fs.copyFileSync(path.resolve('test/fixtures/unity-helper/LegacyReflectedValidationV1.cs.txt'),helper);
 f.edit(data=>data.objects[0].properties.push({path:'m_Script.m_FileID',kind:'Integer',type:'int',value:'2672'}));const b=await f.call('capture',{assetIds:f.scope});f.edit(data=>data.objects[0].properties.push({path:'m_Script.m_FileID',kind:'Integer',type:'int',value:'2676'}));const v=await f.call('verify',{baselineId:b.operationId});
 const receiptFile=path.join(f.workspace,v.storedReceipt),receipt=unseal(JSON.parse(fs.readFileSync(receiptFile))),baseline=unseal(JSON.parse(fs.readFileSync(path.join(f.workspace,b.storedData)))),observed=unseal(JSON.parse(fs.readFileSync(path.join(f.workspace,v.storedData))));receipt.comparison=compareDataSnapshots(baseline.assets,observed.assets);delete receipt.comparisonPolicy;delete receipt.evaluationHelperSha256;receipt.dataPreserved=false;receipt.state='changed';fs.writeFileSync(receiptFile,JSON.stringify(seal(receipt)));fs.writeFileSync(helper,current);await f.call('qualify',{baselineId:b.operationId});return {...f,b,v};
}
test('stored complete legacy verification can be recomputed atomically without Editor or baseline edits',async t=>{
 const f=await legacyFixture(t),files=[f.b.storedReceipt,f.b.storedData,f.v.storedReceipt,f.v.storedData].map(p=>path.join(f.workspace,p)),before=files.map(p=>fs.readFileSync(p));assert.equal((await f.call('report',{operationId:f.v.operationId})).differenceCount,1);
 const next=await f.call('verify',{baselineId:f.b.operationId,reuseVerificationId:f.v.operationId});assert.equal(next.dataPreserved,true);assert.equal(next.state,'verified');assert.equal(next.reusedVerificationId,f.v.operationId);assert.equal(f.calls(),2);files.forEach((p,i)=>assert.deepEqual(fs.readFileSync(p),before[i]));assert.equal((await f.call('report',{operationId:f.v.operationId})).state,'changed');assert.equal((await f.call('report',{operationId:next.operationId})).dataPreserved,true);
});
test('reuse refuses a changed candidate before Editor execution',async t=>{const f=await legacyFixture(t);fs.appendFileSync(path.join(f.project,'Assets/Level.asset'),'\nchanged: 1');await assert.rejects(f.call('verify',{baselineId:f.b.operationId,reuseVerificationId:f.v.operationId}),/changed|stale/i);assert.equal(f.calls(),2);});
test('recovery reanalysis preserves project revision and reuses a closed validated packet',async t=>{
 const f=await dataFixture(t),call=(command,params={})=>runRecoveryOperation(f.toolkit,'Game',command,params,{data:f.dependencies}),artifact=await call('create');let revision=artifact.revision;const run=async(operation,params)=>{const result=await call('run',{artifactId:artifact.artifactId,revision,operation,params});revision=result.revision;return result;};const b=await run('data.capture',{assetIds:f.scope}),v=await run('data.verify',{baselineId:b.result.operationId}),before=revision,reused=await run('data.verify',{baselineId:b.result.operationId,reuseVerificationId:v.result.operationId});assert.equal(reused.result.dataPreserved,true);assert.equal(reused.revision,before);assert.equal(f.calls(),2);
});
test('actual CLI reanalysis uses the saved packet without an Editor selection',async t=>{const f=await legacyFixture(t),result=spawnSync(process.execPath,['re.js','data','verify','Game','--root',f.root,'--baseline',f.b.operationId,'--reuse-verification',f.v.operationId,'--json'],{encoding:'utf8',timeout:30000});assert.equal(result.status,0,result.stderr);const r=JSON.parse(result.stdout);assert.equal(r.dataPreserved,true);assert.equal(r.reusedVerificationId,f.v.operationId);assert.equal(f.calls(),2);});
