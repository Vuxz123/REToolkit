import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createToolkit} from '../src/toolkit.js';
import {startJob,executeJob,getJob} from '../src/jobs/service.js';
import {waitForJob} from '../src/jobs/wait.js';

test('detached worker arms, observes apply completion and queues once through an owned fake CLI',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-wake-worker-')),children=[];
 t.after(async()=>{for(const {child,closed} of children){if(child.exitCode===null&&child.signalCode===null)child.kill();await closed;}await fs.rm(root,{recursive:true,force:true});});
 const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Owned');
 const bin=path.join(root,'fake-bin'),script=path.join(bin,'node_modules','@openai','codex','bin','codex.js'),capture=path.join(root,'queue.jsonl');
 await fs.mkdir(path.dirname(script),{recursive:true});
 const source=`const fs=require('node:fs');const args=process.argv.slice(2);if(args[0]==='queue'&&args[1]==='--help'){console.log('queue --thread UUID --message TEXT');}else{fs.appendFileSync(process.env.RETK_OWNED_QUEUE_CAPTURE,JSON.stringify(args)+'\\n');}`;
 await fs.writeFile(script,source);
 if(process.platform==='win32')await fs.writeFile(path.join(bin,'codex.cmd'),'@"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n');
 else {const executable=path.join(bin,'codex');await fs.writeFile(executable,'#!'+process.execPath+'\n'+source);await fs.chmod(executable,0o700);}
 const threadId='019b1111-1111-7111-8111-111111111111',operationId=randomUUID();
 const upstream=await startJob(toolkit,'Owned',{operation:'reconstruct.apply',params:{operationId}},{spawn:()=>({pid:process.pid,once(){return this;},unref(){}})});
 let release;const gate=new Promise(resolve=>release=resolve);
 const apply=executeJob(toolkit,'Owned',upstream.jobId,{invoke:async()=>{await gate;return {operationId,fixture:true};}});
 t.after(()=>release());
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='path'));
 Object.assign(env,{PATH:bin,CODEX_THREAD_ID:threadId,RETK_OWNED_QUEUE_CAPTURE:capture});
 const ownedSpawn=(command,args,options)=>{const child=spawn(command,args,{...options,env});const closed=new Promise(resolve=>child.once('close',resolve));children.push({child,closed});return child;};
 const params={jobId:upstream.jobId,threadId,task:'verify-source-and-scoped-unity',operationId,assetIds:['asset:owned-scene'],waitTimeoutSeconds:15};
 const watcher=await startJob(toolkit,'Owned',{operation:'agent.wake_after',params},{spawn:ownedSpawn});
 let armed;
 try{
  for(let i=0;i<150;i++){armed=await getJob(toolkit,'Owned',{jobId:watcher.jobId});if(armed.wakeProgress?.transportReady||['failed','unknown','succeeded'].includes(armed.state))break;await delay(30);}
  assert.equal(armed.state,'running');assert.equal(armed.wakeProgress?.state,'waiting');
  assert.equal(armed.wakeProgress?.transportReady,true,'The agent must observe successful transport preflight before ending its turn');
 }finally{release();await apply;}
 const report=await waitForJob(toolkit,'Owned',{jobId:watcher.jobId,timeoutSeconds:10});
 assert.equal(report.state,'succeeded');assert.equal(report.result.state,'queued');assert.equal(report.result.agentResumed,false);
 const calls=(await fs.readFile(capture,'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(calls.length,1);assert.deepEqual(calls[0].slice(0,4),['queue','--thread',threadId,'--message']);assert.ok(calls[0][4].includes(upstream.jobId));assert.ok(calls[0][4].includes(operationId));
 const duplicate=await startJob(toolkit,'Owned',{operation:'agent.wake_after',params},{spawn:ownedSpawn});
 const repeated=await waitForJob(toolkit,'Owned',{jobId:duplicate.jobId,timeoutSeconds:10});assert.equal(repeated.result.duplicate,true);assert.equal(repeated.result.state,'queued');
 assert.equal((await fs.readFile(capture,'utf8')).trim().split('\n').length,1);
});
