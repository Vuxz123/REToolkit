import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {createToolkit} from '../src/toolkit.js';
import {validateAssetParams,validateAssetParamsForJob} from '../src/assets/api.js';
import {startJob,executeJob,getJob} from '../src/jobs/service.js';

const jobId='11111111-1111-4111-8111-111111111111',threadId='019b1111-1111-7111-8111-111111111111';
test('wake and wait schemas require exact identities, bounded waits and explicit scoped validation',()=>{
 assert.doesNotThrow(()=>validateAssetParams('jobs.wait',{jobId,timeoutSeconds:1}));
 assert.doesNotThrow(()=>validateAssetParamsForJob('agent.wake_after',{jobId,threadId,task:'observe-job'}));
 assert.doesNotThrow(()=>validateAssetParamsForJob('agent.wake_after',{jobId,threadId,task:'verify-source-and-scoped-unity',operationId:jobId,assetIds:['asset:scene']}));
 for(const params of [{jobId,timeoutSeconds:31},{jobId,timeoutSeconds:'5'},{jobId,command:'cmd.exe'}])assert.throws(()=>validateAssetParams('jobs.wait',params));
 for(const params of [{jobId,threadId:'--last',task:'observe-job'},{jobId,threadId,task:'verify-source-and-scoped-unity'},{jobId,threadId,task:'anything'},{jobId,threadId,task:'observe-job',prompt:'do arbitrary work'}])assert.throws(()=>validateAssetParamsForJob('agent.wake_after',params));
});

test('wake uncertainty stays unknown while its saved report and progress remain readable',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-wake-job-'));try{const toolkit=createToolkit(root);await toolkit.init('Game');
  const job=await startJob(toolkit,'Game',{operation:'agent.wake_after',params:{jobId,threadId,task:'observe-job'}},{spawn:()=>Object.assign(new EventEmitter(),{pid:process.pid,unref(){}})});
  await executeJob(toolkit,'Game',job.jobId,{invoke:async(_t,_n,_op,_p,progress)=>{progress('agent.wake.dispatching',{wakeProgress:{jobId,threadId,state:'dispatching'}});return {kind:'retoolkit-agent-wake',state:'unknown'};}});
  const report=await getJob(toolkit,'Game',{jobId:job.jobId});assert.equal(report.state,'unknown');assert.equal(report.outcomeVerified,false);assert.equal(report.result.state,'unknown');assert.equal(report.wakeProgress.state,'dispatching');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('CLI wake requires explicit thread and parses JSON asset scope without shell shortcuts',async()=>{
 const api=await import('../src/agents/wake-cli.js').catch(()=>({}));assert.equal(typeof api.parseWakeArgs,'function');
 const parsed=api.parseWakeArgs(['agents','wake-after','Game','--job-id',jobId,'--thread-id',threadId,'--task','verify-source-and-scoped-unity','--operation',jobId,'--asset-ids','["asset:scene"]','--json']);
 assert.equal(parsed.params.threadId,threadId);assert.deepEqual(parsed.params.assetIds,['asset:scene']);
 for(const args of [['agents','wake-after','Game','--last'],['jobs','wait','Game','--job-id',jobId,'--timeout-seconds','31'],['agents','wake-after','Game','--job-id',jobId,'--thread-id',threadId,'--prompt','arbitrary']])assert.throws(()=>api.parseWakeArgs(args));
});

test('dead watcher cannot retain transport-ready arming evidence in jobs_get',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-wake-dead-'));
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
 const closed=new Promise(resolve=>child.once('close',resolve));let release,worker;
 try{
  const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Game');
  const job=await startJob(toolkit,'Game',{operation:'agent.wake_after',params:{jobId,threadId,task:'observe-job'}},{spawn:()=>Object.assign(new EventEmitter(),{pid:process.pid,unref(){}})});
  const gate=new Promise(resolve=>release=resolve);
  worker=executeJob(toolkit,'Game',job.jobId,{invoke:async(_t,_n,_op,_p,progress)=>{progress('agent.wake.waiting',{pid:child.pid,wakeProgress:{jobId,threadId,state:'waiting',transportReady:true}});await gate;return {state:'unknown'};}});
  // The invoke callback runs after executeJob validates the saved request.
  for(let i=0;i<100;i++){const active=await getJob(toolkit,'Game',{jobId:job.jobId});if(active.wakeProgress?.transportReady)break;await new Promise(resolve=>setTimeout(resolve,5));}
  child.kill();await closed;
  const report=await getJob(toolkit,'Game',{jobId:job.jobId});assert.equal(report.state,'unknown');assert.equal(report.stage,'worker.interrupted');
  assert.equal(report.wakeProgress.transportReady,false);assert.equal(report.wakeProgress.state,'unknown');
 }finally{release?.();await worker;if(child.exitCode===null&&child.signalCode===null)child.kill();await closed;await fs.rm(root,{recursive:true,force:true});}
});
