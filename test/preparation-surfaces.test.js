import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createToolkit} from '../src/toolkit.js';
import {validateAssetParamsForJob,invokeAssetApi} from '../src/assets/api.js';
import {EventEmitter} from 'node:events';
import {startJob,executeJob,getJob} from '../src/jobs/service.js';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

test('detached preparation worker resolves owned fixture inputs and reports missing engines without running any',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-preparation-worker-'));let child,closed;
 t.after(async()=>{if(closed)await closed;await fs.rm(root,{recursive:true,force:true,maxRetries:30,retryDelay:50});});
 const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Game');const directory=path.join(toolkit.workspace('Game'),'01_Extracted');
 const native=Buffer.alloc(64);native.set([127,69,76,70,2,1]);native.writeUInt16LE(183,18);await fs.mkdir(path.join(directory,'lib/arm64-v8a'),{recursive:true});await fs.writeFile(path.join(directory,'lib/arm64-v8a/libil2cpp.so'),native);await fs.writeFile(path.join(directory,'global-metadata.dat'),'fixture metadata');
 const job=await startJob(toolkit,'Game',{operation:'workspace.prepare',params:{profile:'native',symbols:'skip'}},{spawn:(...args)=>{child=spawn(...args);closed=new Promise(resolve=>child.once('close',resolve));return child;}});child.ref();
 let report;for(let i=0;i<400;i++){report=await getJob(toolkit,'Game',{jobId:job.jobId});if(!['queued','running'].includes(report.state))break;await delay(25);}
 assert.equal(report.state,'succeeded',JSON.stringify(report));assert.equal(report.result.state,'blocked');assert.equal(report.result.stages.find(stage=>stage.id==='inputs').state,'succeeded');assert.equal(report.result.readiness.nativeAnalysis.state,'blocked');
 assert.equal(toolkit.read('Game').selection.abi,'arm64-v8a');await closed;
});

test('uncertain preparation result stays unknown and its durable report remains readable',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-preparation-unknown-'));
 try{const toolkit=createToolkit(root);await toolkit.init('Game');
  const queued=await startJob(toolkit,'Game',{operation:'workspace.prepare',params:{}},{spawn:()=>Object.assign(new EventEmitter(),{pid:process.pid,unref(){}})});
  await executeJob(toolkit,'Game',queued.jobId,{invoke:async()=>({state:'unknown',reason:'Owned engine cleanup is pending',runId:'fixture'})});
  const report=await getJob(toolkit,'Game',{jobId:queued.jobId});
  assert.equal(report.state,'unknown');assert.equal(report.outcomeVerified,false);assert.equal(report.result.state,'unknown');assert(report.resultReference);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('preparation exposes a typed job and read-only status without arbitrary operations',async()=>{
 assert.doesNotThrow(()=>validateAssetParamsForJob('workspace.prepare',{profile:'reconstruction',symbols:'apply',addressMode:'rva',serial:'emulator-5554',packageName:'com.example.game'}));
 for(const params of [{command:'cmd.exe'},{profile:'all'},{symbols:'force'},{serial:'bad serial'},{packageName:'bad;cmd'}])assert.throws(()=>validateAssetParamsForJob('workspace.prepare',params));
 await assert.rejects(invokeAssetApi(null,'Game','preparation.status',{verifyFreshness:'false'}));
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-preparation-api-'));try{const toolkit=createToolkit(root);await toolkit.init('Game');const report=await invokeAssetApi(toolkit,'Game','preparation.status',{});assert.equal(report.state,'not-started');}finally{await fs.rm(root,{recursive:true,force:true});}
});
test('preparation CLI parses explicit policies and rejects conflicting or unsupported flags',async()=>{
 const api=await import('../src/preparation/cli.js').catch(()=>({}));assert.equal(typeof api.parsePreparationArgs,'function');
 const parsed=api.parsePreparationArgs(['prepare','Game','--profile','native','--symbols','apply','--address-mode','rva','--serial','emulator-5554','--package','com.example.game','--no-auto-pull','--json']);
 assert.equal(parsed.params.profile,'native');assert.equal(parsed.params.autoPull,false);assert.equal(parsed.params.packageName,'com.example.game');
 for(const args of [['prepare','Game','--shell','cmd'],['preparation','Game','--symbols','apply'],['prepare','Game','--profile','native','--profile','reconstruction'],['prepare','Game','--symbols','unsafe']])assert.throws(()=>api.parsePreparationArgs(args));
});
test('owned Ghidra session receives the preparation heap policy',async()=>{
 const {engineEnvironment}=await import('../src/ghidra/environment.js'),root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-preparation-heap-'));
 try{const env=engineEnvironment({tools:{jdk:'jdk',ghidra:'ghidra'},env:{PATH:'path',GHIDRA_HEADLESS_MAXMEM:'5G'}},root);assert.equal(env.GHIDRA_HEADLESS_MAXMEM,'5G');}finally{await fs.rm(root,{recursive:true,force:true});}
});

test('preparation CLI and job schema accept only full or on-demand analysis modes',async()=>{
 const {parsePreparationArgs}=await import('../src/preparation/cli.js');
 for(const analysisMode of ['full','on-demand']){
  assert.doesNotThrow(()=>validateAssetParamsForJob('workspace.prepare',{analysisMode}));
  assert.equal(parsePreparationArgs(['prepare','Game','--analysis-mode',analysisMode]).params.analysisMode,analysisMode);
 }
 assert.deepEqual(parsePreparationArgs(['prepare','Game']).params,{});
 assert.throws(()=>validateAssetParamsForJob('workspace.prepare',{analysisMode:'all'}));
 assert.throws(()=>parsePreparationArgs(['prepare','Game','--analysis-mode','all']));
 assert.throws(()=>parsePreparationArgs(['preparation','Game','--analysis-mode','full']));
});
