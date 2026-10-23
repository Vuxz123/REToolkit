import test from 'node:test';
import assert from 'node:assert/strict';

test('initialization preview preserves reviewable selectors without repeating baseline and native captures',async()=>{
 const {reconstructionPreview}=await import('../src/reconstruction/preview.js').catch(()=>({}));assert.equal(typeof reconstructionPreview,'function');
 const proof={kind:'retoolkit-initialization-proof',schemaVersion:1,originalSource:'x'.repeat(800000),originalTokenSha256:'a'.repeat(64),dump:{sha256:'b'.repeat(64)},constructors:[{fullName:'Game+Events',kind:'static',evidenceId:'c'.repeat(64),metadata:{rva:'0x100'},evidence:{result:{items:[{text:'y'.repeat(800000)}]}}}]};
 const plan={kind:'retoolkit-reconstruction-plan',operationId:'fixture',inventory:[{}],changes:[{scriptId:'source',source:'z'.repeat(800000),mode:'initialization',initializationProof:proof}]};
 const result=reconstructionPreview(plan,'plans/fixture.json');assert(Buffer.byteLength(JSON.stringify(result))<=1024**2);
 assert.equal(result.changes[0].initializationProof.proofInSavedPlan,true);assert.equal(result.changes[0].initializationProof.constructors[0].fullName,'Game+Events');assert.equal(result.changes[0].initializationProof.originalSource,undefined);assert.equal(result.changes[0].initializationProof.constructors[0].evidence,undefined);assert.equal(proof.originalSource.length,800000);assert.equal(result.storedPlan,'plans/fixture.json');
});

test('oversized preview falls back to bounded saved-plan references without losing operation identity',async()=>{
 const {reconstructionPreview}=await import('../src/reconstruction/preview.js').catch(()=>({}));assert.equal(typeof reconstructionPreview,'function');
 const result=reconstructionPreview({kind:'retoolkit-reconstruction-plan',operationId:'fixture',payloadSha256:'a'.repeat(64),inventory:[],changes:[{scriptId:'id',path:'Assets/Game.cs',source:'x'.repeat(900000),identity:{large:'y'.repeat(900000)}}]},'plans/fixture.json');
 assert(Buffer.byteLength(JSON.stringify(result))<=1024**2);assert.equal(result.operationId,'fixture');assert.equal(result.storedPlan,'plans/fixture.json');assert.equal(result.changes[0].source,undefined);
});
