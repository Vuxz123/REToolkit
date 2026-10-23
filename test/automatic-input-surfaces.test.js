import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDesktopCommand} from '../src/desktop/operations.js';
import {registeredJobOperations,validateAssetParams} from '../src/assets/api.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createToolkit} from '../src/toolkit.js';
import {invokeAssetApi} from '../src/assets/api.js';
import {spawn as nodeSpawn} from 'node:child_process';
import {startJob} from '../src/jobs/service.js';

test('desktop offers one bounded Node input resolution action with a typed policy',()=>{
 assert.deepEqual(buildDesktopCommand('project.inputs.resolve',{name:'Game'}),['inputs','resolve','Game']);
 assert.deepEqual(buildDesktopCommand('project.inputs.resolve',{name:'Game',policy:'manual'}),['inputs','resolve','Game','--policy','manual']);
 for(const payload of [{name:'Game',policy:'first'},{name:'../Game'},{name:'Game',command:'calc'}])assert.throws(()=>buildDesktopCommand('project.inputs.resolve',payload));
});

test('observable jobs expose exact input resolution policy without shell parameters',()=>{
 assert(registeredJobOperations['workspace.inputs.resolve']);
 for(const params of [{},{policy:'manual'},{policy:'prefer-arm64'}])assert.doesNotThrow(()=>validateAssetParams('jobs.start',{operation:'workspace.inputs.resolve',params}));
 for(const params of [{policy:'first'},{binary:'arbitrary'},{command:'calc'}])assert.throws(()=>validateAssetParams('jobs.start',{operation:'workspace.inputs.resolve',params}));
});

test('a detached input resolution returns compact persisted ABI provenance without engine work',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-resolve-job-'));let child,closed;
 t.after(async()=>{if(closed)await closed;await fs.promises.rm(root,{recursive:true,force:true,maxRetries:30,retryDelay:50});});
 const toolkit=createToolkit(root,{inputPolicy:'manual',log:()=>{},run:()=>{throw Error('No engine work');}});await toolkit.init('Game');
 const input=path.join(toolkit.workspace('Game'),'01_Extracted');
 for(const [abi,machine]of [['arm64-v8a',183],['armeabi-v7a',40]]){const file=path.join(input,'lib',abi,'libil2cpp.so'),bytes=Buffer.alloc(64);bytes.set([127,69,76,70,machine===183?2:1,1]);bytes.writeUInt16LE(machine,18);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
 fs.writeFileSync(path.join(input,'global-metadata.dat'),'metadata');
 const job=await startJob(toolkit,'Game',{operation:'workspace.inputs.resolve',params:{policy:'prefer-arm64'}},{spawn:(...args)=>{child=nodeSpawn(...args);closed=new Promise(resolve=>child.once('close',resolve));return child;}});child.ref();
 let final;for(let attempt=0;attempt<150;attempt++){final=await invokeAssetApi(toolkit,'Game','jobs.get',{jobId:job.jobId});if(!['queued','running'].includes(final.state))break;await delay(20);}
 assert.equal(final.state,'succeeded');assert.equal(final.result.kind,'retoolkit-input-resolution');assert.equal(final.result.state,'selected');assert.equal(final.result.selection.abi,'arm64-v8a');assert.equal(final.result.selection.reason,'abi-preference');assert(Buffer.byteLength(JSON.stringify(final.result))<8192);
 const project=toolkit.read('Game');assert.equal(project.steps.scan.state,'succeeded');assert.equal(project.steps.dump.state,'stale');assert.equal(project.selection.abi,'arm64-v8a');assert(!Object.hasOwn(final.result,'steps'));
 await closed;
});
