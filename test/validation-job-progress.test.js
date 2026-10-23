import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createToolkit} from '../src/toolkit.js';
import {startJob,executeJob,getJob} from '../src/jobs/service.js';

test('jobs expose bounded observed Unity coverage during work and retain final partial result',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-validation-progress-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Game');
 const job=await startJob(toolkit,'Game',{operation:'reconstruct.validate',params:{}},{spawn:()=>({pid:process.pid,once(){return this;},unref(){}})});
 let release;const gate=new Promise(resolve=>release=resolve),operationId='11111111-1111-4111-8111-111111111111';
 const running=executeJob(toolkit,'Game',job.jobId,{invoke:async tk=>{assert.equal(typeof tk.onValidationProgress,'function');tk.onValidationProgress({operationId,requestedAssets:408,completedAssets:4,pendingAssets:404,currentAsset:'Assets/One.prefab'});tk.onValidationProgress({operationId,requestedAssets:408,completedAssets:999999,pendingAssets:-1,currentAsset:'../outside',secret:'do-not-forward'});await gate;return {kind:'retoolkit-unity-validation',state:'partial',compileReady:true,bindingsVerified:false};}});
 try{await delay(10);const during=await getJob(toolkit,'Game',{jobId:job.jobId});assert.equal(during.stage,'unity.validation.running');assert.equal(during.engine,'Unity.exe');assert.deepEqual(during.validationProgress,{operationId,requestedAssets:408,completedAssets:4,pendingAssets:404,currentAsset:'Assets/One.prefab'});assert(!JSON.stringify(during).includes('do-not-forward'));}
 finally{release();await running;}
 const final=await getJob(toolkit,'Game',{jobId:job.jobId});assert.equal(final.state,'succeeded');assert.equal(final.domainState,'partial');assert.equal(final.result.compileReady,true);assert.equal(toolkit.onValidationProgress,undefined);
});
