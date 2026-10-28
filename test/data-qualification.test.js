import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {dataFixture} from './helpers/data-service-fixture.js';
import {validateAssetParams,registeredJobOperations} from '../src/assets/api.js';
import {assetTools} from '../src/assets/mcp.js';
import {desktopOperations} from '../src/desktop/operations.js';
import {recoveryOperations} from '../src/recovery/definitions.js';
import {runRecoveryOperation} from '../src/recovery/service.js';
import {buildResultModel} from '../src/desktop/result-model.js';
import {fingerprint} from '../src/state.js';
const api=()=>import('../src/data/qualification.js');
async function partialFixture(t){
 const f=await dataFixture(t),extra=path.join(f.project,'Assets/BirdType.cs');fs.writeFileSync(extra,'public enum BirdType { A, B }');
 const run=f.dependencies.validation.runEditor;f.dependencies.validation.runEditor=async config=>{const result=await run(config),report=JSON.parse(fs.readFileSync(config.reportFile));report.scripts=report.scripts.map(s=>s.path.endsWith('BirdType.cs')?{...s,guid:'e'.repeat(32),fullName:null,assembly:'Assembly-CSharp',resolved:false,classification:'compiled-source'}:s);report.traversal={policy:'reference-scan-v2'};fs.writeFileSync(config.reportFile,JSON.stringify(report));return result;};
 // The caller can invalidate unrelated source classification on the first run.
 return f;
}
test('retained typed baseline qualification is explicit and never rewrites the original receipt or data',async t=>{
 const f=await partialFixture(t),run=f.dependencies.validation.runEditor;f.dependencies.validation.runEditor=async config=>{const result=await run(config),r=JSON.parse(fs.readFileSync(config.reportFile));r.scripts.find(s=>s.path.endsWith('BirdType.cs')).assembly='OtherAssembly';fs.writeFileSync(config.reportFile,JSON.stringify(r));return result;};
 const baseline=await f.call('capture',{assetIds:f.scope});assert.equal(baseline.state,'partial');const files=[baseline.storedReceipt,baseline.storedData].map(p=>path.join(f.workspace,p)),before=files.map(p=>fs.readFileSync(p));
 const {qualifyDataBaseline}=await api(),{loadDataContract}=await import('../src/data/provenance.js'),loaded=loadDataContract(f.toolkit,'Game',baseline.operationId),qualified=qualifyDataBaseline(f.toolkit,'Game',loaded);
 assert.equal(qualified.state,'qualified');assert.equal(qualified.baselineId,baseline.baselineId);assert.equal(f.calls(),1);files.forEach((p,i)=>assert.deepEqual(fs.readFileSync(p),before[i]));
 f.dependencies.validation.runEditor=run;fs.unlinkSync(path.join(f.project,'Assets/BirdType.cs'));const after=await f.call('verify',{baselineId:baseline.baselineId});assert.equal(after.dataPreserved,true);assert.equal(after.baselineQualificationId,qualified.operationId);assert.equal(after.gameplay,'unverified');
});
test('true incomplete typed coverage cannot be qualified or replaced by a new baseline',async t=>{
 const f=await dataFixture(t);f.edit(d=>{d.complete=false;d.objects[0].complete=false;d.unsupportedProperties=1;d.objects[0].properties.push({path:'curve',kind:'AnimationCurve',type:'AnimationCurve',value:null});});const b=await f.call('capture',{assetIds:f.scope}),{loadDataContract}=await import('../src/data/provenance.js'),{qualifyDataBaseline}=await api();assert.throws(()=>qualifyDataBaseline(f.toolkit,'Game',loadDataContract(f.toolkit,'Game',b.operationId)),/coverage|unsupported|incomplete/i);assert.equal(f.calls(),1);await assert.rejects(f.call('verify',{baselineId:b.operationId}));
});
test('qualification is typed across MCP jobs GUI and recovery and never forks or launches an Editor',async t=>{
 assert.ok(registeredJobOperations['data.qualify']);assert.ok(assetTools.find(t=>t.name==='data_qualify'));assert.ok(desktopOperations.find(t=>t.id==='data.qualify'));assert.ok(recoveryOperations.has('data.qualify'));assert.throws(()=>validateAssetParams('data.qualify',{baselineId:'x',reset:true}));
 const f=await dataFixture(t),created=await runRecoveryOperation(f.toolkit,'Game','create',{}),captured=await runRecoveryOperation(f.toolkit,'Game','run',{artifactId:created.artifactId,revision:created.revision,operation:'data.capture',params:{assetIds:f.scope}},{data:f.dependencies}),calls=f.calls();
 const result=await runRecoveryOperation(f.toolkit,'Game','run',{artifactId:created.artifactId,revision:captured.revision,operation:'data.qualify',params:{baselineId:captured.result.baselineId}});assert.equal(result.result.state,'qualified');assert.equal(result.revision,captured.revision);assert.equal(f.calls(),calls);
 const model=buildResultModel({operation:'data.qualify',state:'succeeded',exitCode:0,result:result.result});assert.equal(model.status.tone,'info');assert.match(model.status.description,/partial/);
});
test('qualification rejects edited raw data, unresolved SO identity and changed helper',async t=>{
 const {loadDataContract}=await import('../src/data/provenance.js'),{qualifyDataBaseline}=await api(),a=await dataFixture(t),baseline=await a.call('capture',{assetIds:a.scope});fs.appendFileSync(path.join(a.workspace,baseline.storedRaw,'Assets/Level.asset'),'changed');assert.throws(()=>qualifyDataBaseline(a.toolkit,'Game',loadDataContract(a.toolkit,'Game',baseline.operationId)),/Raw data/);
 const b=await dataFixture(t);b.edit(d=>{d.objects[0].fullName='Unmatched.Type';});const mismatch=await b.call('capture',{assetIds:b.scope});assert.equal(mismatch.state,'partial');assert.throws(()=>qualifyDataBaseline(b.toolkit,'Game',loadDataContract(b.toolkit,'Game',mismatch.operationId)),/identity/);
 const c=await dataFixture(t),good=await c.call('capture',{assetIds:c.scope});fs.appendFileSync(path.join(c.root,'templates/Unity/REToolkitValidation.cs'),'// change');assert.throws(()=>qualifyDataBaseline(c.toolkit,'Game',loadDataContract(c.toolkit,'Game',good.operationId)),/helper/);
});
test('qualification binds the original validation helper even when historical receipts are resealed',async t=>{
 const f=await dataFixture(t),b=await f.call('capture',{assetIds:f.scope}),file=path.join(f.workspace,'04_Notes/assets/unity-validation',b.validationOperationId,'receipt.json'),validation=JSON.parse(fs.readFileSync(file));delete validation.receiptSha256;validation.helperSha256='0'.repeat(64);validation.receiptSha256=fingerprint(validation);fs.writeFileSync(file,JSON.stringify(validation));const baselineFile=path.join(f.workspace,b.storedReceipt),baseline=JSON.parse(fs.readFileSync(baselineFile));delete baseline.payloadSha256;baseline.validationReceiptSha256=fingerprint(validation);baseline.payloadSha256=fingerprint(baseline);fs.writeFileSync(baselineFile,JSON.stringify(baseline));const {loadDataContract}=await import('../src/data/provenance.js'),{qualifyDataBaseline}=await api();assert.throws(()=>qualifyDataBaseline(f.toolkit,'Game',loadDataContract(f.toolkit,'Game',b.operationId)),/helper/);
});
test('qualification tampering is rejected before another Editor and value differences remain visible',async t=>{
 const f=await partialFixture(t),run=f.dependencies.validation.runEditor;f.dependencies.validation.runEditor=async config=>{const result=await run(config),r=JSON.parse(fs.readFileSync(config.reportFile));r.scripts.find(s=>s.path.endsWith('BirdType.cs')).assembly='OtherAssembly';fs.writeFileSync(config.reportFile,JSON.stringify(r));return result;};
 const b=await f.call('capture',{assetIds:f.scope}),{loadDataContract}=await import('../src/data/provenance.js'),{qualifyDataBaseline}=await api(),q=qualifyDataBaseline(f.toolkit,'Game',loadDataContract(f.toolkit,'Game',b.operationId)),qFile=path.join(f.workspace,q.storedQualification),original=fs.readFileSync(qFile);fs.appendFileSync(qFile,'corrupted');await assert.rejects(f.call('verify',{baselineId:b.operationId}));assert.equal(f.calls(),1);fs.writeFileSync(qFile,original);
 f.dependencies.validation.runEditor=run;fs.unlinkSync(path.join(f.project,'Assets/BirdType.cs'));f.edit(d=>{d.objects[0].properties[2].value='99';});const changed=await f.call('verify',{baselineId:b.operationId});assert.equal(changed.dataPreserved,false);assert.equal(changed.state,'changed');assert.equal(changed.baselineId,b.operationId);
});
test('the exact retained data-v1 helper can qualify for the reflected-type helper without resetting values',async t=>{
 const f=await dataFixture(t),helper=path.join(f.root,'templates/Unity/REToolkitValidation.cs'),current=fs.readFileSync(helper),legacy=fs.readFileSync(path.resolve('test/fixtures/unity-helper/LegacyDataValidationV1.cs.txt'));fs.writeFileSync(helper,legacy);const b=await f.call('capture',{assetIds:f.scope});fs.writeFileSync(helper,current);
 const qualified=await f.call('qualify',{baselineId:b.baselineId});assert.equal(qualified.state,'qualified');const verified=await f.call('verify',{baselineId:b.baselineId});assert.equal(verified.dataPreserved,true);assert.equal(verified.baselineQualificationId,qualified.operationId);assert.equal((await f.call('report',{operationId:verified.operationId})).dataPreserved,true);
});
test('reviewed helper compatibility survives Windows CRLF checkouts without trusting edited source',async t=>{
 const f=await dataFixture(t),helper=path.join(f.root,'templates/Unity/REToolkitValidation.cs'),current=fs.readFileSync(helper),legacy=fs.readFileSync(path.resolve('test/fixtures/unity-helper/LegacyDataValidationV1.cs.txt'),'utf8').replace(/\r?\n/g,'\r\n');fs.writeFileSync(helper,legacy);const b=await f.call('capture',{assetIds:f.scope});fs.writeFileSync(helper,current);const result=await f.call('qualify',{baselineId:b.baselineId});assert.equal(result.state,'qualified');
});
test('explicit requalification appends new evidence when only its prior policy attestation is stale',async t=>{
 const f=await dataFixture(t),b=await f.call('capture',{assetIds:f.scope}),old=await f.call('qualify',{baselineId:b.operationId}),recordFile=path.join(f.workspace,old.storedQualification),record=JSON.parse(fs.readFileSync(recordFile));delete record.payloadSha256;record.policySha256='0'.repeat(64);record.payloadSha256=fingerprint(record);fs.writeFileSync(recordFile,JSON.stringify(record));const pointer=path.join(path.dirname(path.dirname(recordFile)),'qualification.json'),reference=JSON.parse(fs.readFileSync(pointer));delete reference.payloadSha256;const {payloadSha256,...payload}=record;reference.receiptSha256=fingerprint(payload);reference.payloadSha256=fingerprint(reference);fs.writeFileSync(pointer,JSON.stringify(reference));const retained=fs.readFileSync(recordFile),next=await f.call('qualify',{baselineId:b.operationId});assert.notEqual(next.operationId,old.operationId);assert.deepEqual(fs.readFileSync(recordFile),retained);assert.equal(f.calls(),1);
});
test('verification data provenance rejects a resealed current validation helper mismatch',async t=>{
 const f=await dataFixture(t),b=await f.call('capture',{assetIds:f.scope}),v=await f.call('verify',{baselineId:b.baselineId}),file=path.join(f.workspace,'04_Notes/assets/unity-validation',v.validationOperationId,'receipt.json'),validation=JSON.parse(fs.readFileSync(file));delete validation.receiptSha256;validation.helperSha256='0'.repeat(64);validation.receiptSha256=fingerprint(validation);fs.writeFileSync(file,JSON.stringify(validation));const dataFile=path.join(f.workspace,v.storedReceipt),data=JSON.parse(fs.readFileSync(dataFile));delete data.payloadSha256;data.validationReceiptSha256=fingerprint(validation);data.payloadSha256=fingerprint(data);fs.writeFileSync(dataFile,JSON.stringify(data));await assert.rejects(f.call('report',{operationId:v.operationId}),/helper|provenance/i);
});
