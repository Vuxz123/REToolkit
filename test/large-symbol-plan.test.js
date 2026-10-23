import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createToolkit} from '../src/toolkit.js';
import {startJob,executeJob,getJob} from '../src/jobs/service.js';

async function fixture(t){const root=await fs.promises.mkdtemp(path.join(os.tmpdir(),'retk-large-plan-'));t.after(()=>fs.promises.rm(root,{recursive:true,force:true,maxRetries:30,retryDelay:50}));const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Game');return {root,toolkit,workspace:toolkit.workspace('Game')};}
function largePlan(workspace,size=228064550){
 const file=path.join(workspace,'04_Notes/large-plan.json'),fd=fs.openSync(file,'wx'),hash=createHash('sha256'),header=Buffer.from('{"version":1,"entries":[]}'),chunk=Buffer.alloc(64*1024,32);let written=0;
 try{fs.writeSync(fd,header);hash.update(header);written=header.length;while(written<size){const part=chunk.subarray(0,Math.min(chunk.length,size-written));fs.writeSync(fd,part);hash.update(part);written+=part.length;}}finally{fs.closeSync(fd);}
 return {file,planHash:hash.digest('hex')};
}

test('jobs accept a 217.5 MiB plan through streamed verification and recheck before mutation',async t=>{
 const {toolkit,workspace}=await fixture(t),{file,planHash}=largePlan(workspace);let spawned=0,invoked=0;
 const original=fs.readSync;fs.readSync=(...args)=>{if(Buffer.isBuffer(args[1]))assert(args[1].length<=1024*1024,'plan guard must not allocate a whole-file read buffer');return original(...args);};
 let job;try{job=await startJob(toolkit,'Game',{operation:'ghidra.symbols.apply',params:{plan:file,planHash,dryRun:true}},{spawn:()=>{spawned++;return {pid:process.pid,once(){return this;},unref(){}};}});}finally{fs.readSync=original;}
 assert.equal(spawned,1);await executeJob(toolkit,'Game',job.jobId,{invoke:async()=>{invoked++;return {status:'preview',changeCount:1};}});assert.equal(invoked,1);assert.equal((await getJob(toolkit,'Game',{jobId:job.jobId})).result.status,'preview');
 const changed=await startJob(toolkit,'Game',{operation:'ghidra.symbols.apply',params:{plan:file,planHash,dryRun:true}},{spawn:()=>({pid:process.pid,once(){return this;},unref(){}})});const fd=fs.openSync(file,'r+');try{fs.writeSync(fd,Buffer.from('\t'),0,1,fs.statSync(file).size-1);}finally{fs.closeSync(fd);}
 await executeJob(toolkit,'Game',changed.jobId,{invoke:async()=>{throw Error('Changed plan must never reach engine');}});assert.equal((await getJob(toolkit,'Game',{jobId:changed.jobId})).error.code,'job_plan_changed');
});

test('symbol plan verifier bounds files and rejects changed source identity',async t=>{
 const {workspace}=await fixture(t),{verifySymbolPlan,SYMBOL_PLAN_LIMITS}=await import('../src/ghidra/symbol-plan.js');
 const file=path.join(workspace,'04_Notes/plan.json');fs.writeFileSync(file,'{}');const planHash=createHash('sha256').update('{}').digest('hex');
 assert.equal((await verifySymbolPlan({workspace,plan:file,planHash})).size,2);
 await assert.rejects(verifySymbolPlan({workspace,plan:file,planHash:'a'.repeat(64)}),{code:'job_plan_changed'});
 const huge=path.join(workspace,'04_Notes/huge.json');fs.closeSync(fs.openSync(huge,'wx'));fs.truncateSync(huge,SYMBOL_PLAN_LIMITS.maxBytes+1);await assert.rejects(verifySymbolPlan({workspace,plan:huge,planHash}),{code:'job_artifact_invalid'});
 const linked=path.join(workspace,'04_Notes/hard.json');fs.linkSync(file,linked);await assert.rejects(verifySymbolPlan({workspace,plan:linked,planHash}),{code:'job_artifact_invalid'});fs.unlinkSync(linked);
 await assert.rejects(verifySymbolPlan({workspace,plan:file,planHash,onProgress:()=>fs.appendFileSync(file,' ')}),{code:'job_plan_changed'});
});
