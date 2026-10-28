import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBridgeArgs} from '../src/ghidra/cli.js';
import {requestFrame} from '../src/ghidra/protocol.js';
import {validateAssetParams} from '../src/assets/api.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createToolkit} from '../src/toolkit.js';
import {startJob,executeJob,getJob} from '../src/jobs/service.js';

test('bounded analysis CLI and typed jobs require exact scope, reason and supported kind',()=>{
 const p=parseBridgeArgs(['analysis','ensure','Game','0x1000','--end','0x10ff','--kind','function','--reason','Recover board movement','--timeout','30','--dry-run']);
 assert.equal(p.command,'analysis.ensure');assert.equal(p.options.end,'0x10ff');
 const params={address:'ram:0x1000',endAddress:'ram:0x10ff',kind:'function',reason:'Recover board movement',timeoutSeconds:30};
 assert.doesNotThrow(()=>validateAssetParams('jobs.start',{operation:'ghidra.analysis.ensure',params}));
 assert.equal(JSON.parse(requestFrame({runId:'r',token:'t'},'id','analysis.ensure',params)).method,'analysis.ensure');
 for(const change of [{endAddress:'0x20000'},{kind:'all'},{reason:''},{timeoutSeconds:301},{script:'anything'}])assert.throws(()=>validateAssetParams('jobs.start',{operation:'ghidra.analysis.ensure',params:{...params,...change}}));
 for(const args of [[],['--end','bad'],['--end','0x1100','--kind','all','--reason','x'],['--end','0x1100','--reason',''],['--end','0x20000','--reason','x']])assert.throws(()=>parseBridgeArgs(['analysis','ensure','Game','0x1000',...args]));
});
test('analysis jobs bind an operation UUID before spawn and preserve it through dispatch',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-analysis-job-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Game');let calls=0;
 const spawn=()=>{calls++;return {pid:process.pid,once(){},unref(){}};};
 const params={address:'0x1000',endAddress:'0x100f',kind:'function',reason:'Board controller'};
 await assert.rejects(startJob(toolkit,'Game',{operation:'ghidra.analysis.ensure',params:{...params,endAddress:'0x20000'}},{spawn}));assert.equal(calls,0);
 const job=await startJob(toolkit,'Game',{operation:'ghidra.analysis.ensure',params},{spawn});assert.equal(job.operationId,job.jobId);
 await executeJob(toolkit,'Game',job.jobId,{invoke:async(_tk,_name,op,scope)=>{assert.equal(op,'ghidra.analysis.ensure');assert.equal(scope.operationId,job.jobId);return {coverage:'scoped',globalAnalysisComplete:false};}});
 const result=await getJob(toolkit,'Game',{jobId:job.jobId});assert.equal(result.state,'succeeded');assert.equal(result.result.globalAnalysisComplete,false);
});
