import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {createToolkit} from '../src/toolkit.js';
import {invokeAssetApi,validateAssetParams,definitions,registeredJobOperations} from '../src/assets/api.js';
import {serveAssetsMcp} from '../src/assets/mcp.js';
import {spawn as nodeSpawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setStep,outputManifest} from '../src/state.js';
import {stepFingerprint} from '../src/inputs.js';
import {startSession,stopSession} from '../src/ghidra/provider.js';
import {runtimePaths,readSession} from '../src/ghidra/runtime.js';
import {once} from 'node:events';
import yazl from 'yazl';
import {createApkProject} from '../src/desktop/projects.js';
import {EventEmitter} from 'node:events';
import {atomicJson} from '../src/ghidra/runtime.js';

test('job reads remain whole when an atomic heartbeat replaces the record between stat and open',async t=>{
 const {toolkit}=await fixture(t),{startJob,getJob}=await services();
 const job=await startJob(toolkit,'Game',{operation:'workspace.status',params:{}},{spawn:()=>Object.assign(new EventEmitter(),{pid:process.pid,unref(){}})});
 const file=path.join(toolkit.workspace('Game'),'04_Notes/jobs',job.jobId,'record.json'),updated=JSON.parse(fs.readFileSync(file,'utf8'));updated.stage='operation.running';updated.diagnosticTail.push({timestamp:new Date().toISOString(),stage:'operation.running',message:'x'.repeat(2048)});
 const open=fs.openSync;let replaced=false;fs.openSync=(target,...args)=>{if(target===file&&!replaced){replaced=true;atomicJson(file,updated);}return open(target,...args);};
 try{const observed=await getJob(toolkit,'Game',{jobId:job.jobId});assert.equal(observed.stage,'operation.running');assert.equal(observed.diagnosticTail.at(-1).message.length,2048);}finally{fs.openSync=open;}
});

async function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-jobs-'));t.after(()=>fs.promises.rm(root,{recursive:true,force:true,maxRetries:30,retryDelay:50}));const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Game');return {root,toolkit};}
async function services(){return import('../src/jobs/service.js');}
async function terminal(toolkit,id,name='Game'){for(let i=0;i<200;i++){const j=await invokeAssetApi(toolkit,name,'jobs.get',{jobId:id});if(!['queued','running'].includes(j.state)){if(j.pid&&j.pid!==process.pid)for(let attempt=0;attempt<200;attempt++){try{process.kill(j.pid,0);}catch(error){if(error.code==='ESRCH')break;throw error;}await delay(10);}return j;}await delay(20);}throw Error('Job did not finish');}

test('typed jobs are registered and reject unknown nested input before spawning',async t=>{
 assert(definitions['jobs.start'],'jobs.start schema must be registered');
 const {toolkit}=await fixture(t),{startJob}=await services();let spawns=0;
 const spawn=()=>{spawns++;throw Error('should not spawn');};
 for(const params of [{operation:'shell',params:{command:'whoami'}},{operation:'workspace.dump',params:{exe:'anything'}},{operation:'assets.list',params:{limit:'3'}},{operation:'reconstruct.plan',params:{request:{kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:'a'.repeat(64),changes:[{scriptId:'x',source:'x',shell:'x'}]}}}])await assert.rejects(startJob(toolkit,'Game',params,{spawn}));
 await assert.rejects(startJob(toolkit,'../escape',{operation:'workspace.status',params:{}},{spawn}));
 await assert.rejects(startJob(toolkit,'Absent',{operation:'workspace.status',params:{}},{spawn}));
 assert.equal(spawns,0);
 assert.throws(()=>validateAssetParams('jobs.start',{operation:'visual.compare',params:{request:{ffmpegPath:'evil'}}}));
});

test('start returns while detached Node worker runs and result survives a fresh toolkit',async t=>{
 const {toolkit,root}=await fixture(t);
 const started=await invokeAssetApi(toolkit,'Game','jobs.start',{operation:'workspace.status',params:{}});
 assert.match(started.jobId,/^[a-f0-9-]{36}$/);assert(['queued','running'].includes(started.state));
 const finished=await terminal(createToolkit(root,{log:()=>{}}),started.jobId);
 assert.equal(finished.state,'succeeded');assert.equal(finished.exitCode,0);assert.equal(finished.result.name,'Game');assert.equal(finished.result.steps.dump.state,'pending');
 assert(finished.sequence>started.sequence);assert(finished.completedAt);assert(finished.diagnosticTail.every(e=>e.timestamp&&e.stage));
 const listed=await invokeAssetApi(toolkit,'Game','jobs.list',{});assert.equal(listed.jobs[0].jobId,started.jobId);
});

test('worker failure reports controlled diagnostics and a saved private diagnostic reference',async t=>{
 const {toolkit}=await fixture(t);const started=await invokeAssetApi(toolkit,'Game','jobs.start',{operation:'workspace.dump',params:{}});
 const failed=await terminal(toolkit,started.jobId);assert.equal(failed.state,'failed');assert.notEqual(failed.exitCode,0);assert(failed.error.code);assert(failed.diagnosticReference);assert.equal(failed.result,undefined);
});

test('job records bound result reads, diagnostics and interrupted state without retry',async t=>{
 const {toolkit}=await fixture(t),{startJob,getJob,executeJob}=await services();
 const child={pid:process.pid,once(){return this;},unref(){}};
 const started=await startJob(toolkit,'Game',{operation:'assets.list',params:{}},{spawn:()=>child});
 await executeJob(toolkit,'Game',started.jobId,{invoke:async(_tk,_name,_method,_params,progress)=>{for(let i=0;i<100;i++)progress('operation.running');return {state:'partial',coverage:'partial',data:'secret'.repeat(100000)};}});
 const job=await getJob(toolkit,'Game',{jobId:started.jobId,resultLimit:64});assert.equal(job.state,'succeeded');assert.equal(job.result,undefined);assert(job.resultReference.bytes>256*1024);assert(Buffer.byteLength(job.resultChunk.text)<=64);assert(job.diagnosticTail.length<=32);assert.equal(job.diagnosticTail[0].stage,'queued','repeated heartbeat must retain lifecycle stages');assert.equal(job.domainState,'partial');
 const file=path.join(toolkit.workspace('Game'),'04_Notes/jobs',started.jobId,'record.json'),record=JSON.parse(fs.readFileSync(file));record.state='running';record.pid=2147483647;record.completedAt=null;fs.writeFileSync(file,JSON.stringify(record));
 assert.equal((await getJob(toolkit,'Game',{jobId:started.jobId})).state,'unknown');
 assert.equal(JSON.parse(fs.readFileSync(file)).state,'running','observation does not overwrite worker ownership');
});

test('symbol plans are workspace confined and bound to an exact saved hash before spawn',async t=>{
 const {toolkit,root}=await fixture(t),{startJob}=await services();let spawned=0;const spawn=()=>{spawned++;return {pid:process.pid,once(){return this;},unref(){}};};
 const plan=path.join(toolkit.workspace('Game'),'04_Notes','plan.json');fs.writeFileSync(plan,'{}');const {createHash}=await import('node:crypto');const planHash=createHash('sha256').update('{}').digest('hex');
 for(const params of [{plan:path.join(root,'foreign.json'),planHash},{plan,planHash:'0'.repeat(64)},{plan,planHash,exec:'evil'}])await assert.rejects(startJob(toolkit,'Game',{operation:'ghidra.symbols.apply',params},{spawn}));
 await startJob(toolkit,'Game',{operation:'ghidra.symbols.apply',params:{plan,planHash,dryRun:true}},{spawn});assert.equal(spawned,1);
});

test('MCP start and get are responsive while a job is still running',async t=>{
 const {toolkit}=await fixture(t),{startJob,executeJob}=await services();
 const started=await startJob(toolkit,'Game',{operation:'assets.list',params:{}},{spawn:()=>({pid:process.pid,once(){return this;},unref(){}})});
 let release;const gate=new Promise(resolve=>release=resolve);const running=executeJob(toolkit,'Game',started.jobId,{invoke:async(_tk,_name,_op,_params,progress)=>{progress('operation.waiting');await gate;return {done:true};}});
 await delay(20);const input=new PassThrough(),output=new PassThrough();let wire='';output.on('data',x=>wire+=x);const done=serveAssetsMcp(toolkit,'Game',{input,output});
 input.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'jobs-test',version:'1'}}})+'\n');input.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 input.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'jobs_get',arguments:{jobId:started.jobId}}})+'\n');
 for(let i=0;i<50&&!wire.includes('"id":2');i++)await delay(10);
 assert(wire.includes('"id":2'));const response=wire.trim().split('\n').map(JSON.parse).find(x=>x.id===2);assert.equal(JSON.parse(response.result.content[0].text).state,'running');
 release();await running;input.end();await done;
});

test('a detached synthetic worker continues across reconnect and exposes during-run stages',async t=>{
 const {toolkit,root}=await fixture(t),{startJob}=await services(),script=path.join(root,'fixture-worker.mjs');
 fs.writeFileSync(script,`import {createToolkit} from ${JSON.stringify(new URL('../src/toolkit.js',import.meta.url).href)};import {executeJob} from ${JSON.stringify(new URL('../src/jobs/service.js',import.meta.url).href)};const [root,name,id]=process.argv.slice(2);await executeJob(createToolkit(root,{log:()=>{}}),name,id,{invoke:async(_t,_n,_op,_params,progress)=>{progress('fixture.waiting');await new Promise(resolve=>setTimeout(resolve,500));return {state:'partial',done:true};}});`);
 const start=Date.now(),job=await startJob(toolkit,'Game',{operation:'workspace.status',params:{}},{spawn:(file,args,options)=>nodeSpawn(file,[script,...args.slice(1)],options)});assert(Date.now()-start<1500);
 let running;for(let i=0;i<100;i++){running=await invokeAssetApi(createToolkit(root,{log:()=>{}}),'Game','jobs.get',{jobId:job.jobId});if(running.stage==='fixture.waiting')break;await delay(20);}
 assert.equal(running.state,'running');assert.equal(running.stage,'fixture.waiting');assert.equal(running.exitCode,null);assert.equal(running.result,undefined);
 const finished=await terminal(createToolkit(root,{log:()=>{}}),job.jobId);assert.equal(finished.state,'succeeded');assert.equal(finished.result.state,'partial');
});

test('observed engines retain supervision options and never forward private process chunks',async t=>{
 const {toolkit}=await fixture(t),{startJob,executeJob,observedRun,getJob}=await services();const job=await startJob(toolkit,'Game',{operation:'assets.list',params:{}},{spawn:()=>({pid:process.pid,once(){return this;},unref(){}})});
 const secret='PRIVATE_USERDATA_PAYLOAD';let seen;const options={leaseDirectory:path.join(toolkit.workspace('Game'),'.retk-lock'),toolchainRoot:toolkit.root,logFile:path.join(toolkit.workspace('Game'),'04_Notes','owned.log')};
 await executeJob(toolkit,'Game',job.jobId,{invoke:async(_tk,_name,_operation,_params,progress)=>{const run=observedRun(async(_file,_args,runOptions)=>{seen=runOptions;throw Object.assign(Error(secret),{code:'ERR_TEST_FAILURE',exitCode:7});},progress);await run('fake-engine.exe',[secret],options);}});
 const failed=await getJob(toolkit,'Game',{jobId:job.jobId});assert.equal(seen,options);assert.equal(failed.exitCode,7);assert(!JSON.stringify(failed).includes(secret));assert(failed.engine==='fake-engine.exe');assert(failed.logReference,'Owned engine logs must be discoverable without forwarding content');assert(failed.currentSteps.dump);
 assert(fs.readFileSync(path.join(toolkit.workspace('Game'),failed.diagnosticReference),'utf8').includes(secret));
});

test('job store and symbol plan reject links before any worker spawn',async t=>{
 const {toolkit,root}=await fixture(t),{startJob}=await services();let spawns=0;const spawn=()=>{spawns++;throw Error('must not spawn');};
 const outside=path.join(root,'outside');fs.mkdirSync(outside);const base=path.join(toolkit.workspace('Game'),'04_Notes/jobs');fs.symlinkSync(outside,base,process.platform==='win32'?'junction':'dir');
 await assert.rejects(startJob(toolkit,'Game',{operation:'workspace.status',params:{}},{spawn}),/Linked/);fs.unlinkSync(base);
 const plan=path.join(toolkit.workspace('Game'),'04_Notes','plan.json');fs.symlinkSync(outside,plan,process.platform==='win32'?'junction':'dir');
 await assert.rejects(startJob(toolkit,'Game',{operation:'ghidra.symbols.apply',params:{plan,planHash:'a'.repeat(64)}},{spawn}),/Linked/);assert.equal(spawns,0);
});

test('worker revalidates a changed saved symbols plan and never invokes the mutation',async t=>{
 const {toolkit}=await fixture(t),{startJob,executeJob,getJob}=await services(),{createHash}=await import('node:crypto');
 const plan=path.join(toolkit.workspace('Game'),'04_Notes','symbols.json');fs.writeFileSync(plan,'{}');const planHash=createHash('sha256').update('{}').digest('hex');
 const job=await startJob(toolkit,'Game',{operation:'ghidra.symbols.apply',params:{plan,planHash}},{spawn:()=>({pid:process.pid,once(){return this;},unref(){}})});fs.writeFileSync(plan,'{"changed":true}');let calls=0;
 await executeJob(toolkit,'Game',job.jobId,{invoke:async()=>{calls++;}});const result=await getJob(toolkit,'Game',{jobId:job.jobId});assert.equal(calls,0);assert.equal(result.state,'failed');assert.equal(result.error.code,'job_plan_changed');
 await assert.rejects(executeJob(toolkit,'Game',job.jobId,{invoke:async()=>{calls++;}}));assert.equal(calls,0);
});

test('hard-linked symbols plans and result artifacts are rejected',async t=>{
 const {toolkit,root}=await fixture(t),{startJob,executeJob,getJob}=await services();const outside=path.join(root,'outside.json');fs.writeFileSync(outside,'{}');const plan=path.join(toolkit.workspace('Game'),'04_Notes','symbols.json');fs.linkSync(outside,plan);
 const {createHash}=await import('node:crypto'),planHash=createHash('sha256').update('{}').digest('hex');let spawned=0;
 await assert.rejects(startJob(toolkit,'Game',{operation:'ghidra.symbols.apply',params:{plan,planHash}},{spawn:()=>{spawned++;return {pid:process.pid,once(){return this;},unref(){}};}}));assert.equal(spawned,0);
 const job=await startJob(toolkit,'Game',{operation:'assets.list',params:{}},{spawn:()=>({pid:process.pid,once(){return this;},unref(){}})});await executeJob(toolkit,'Game',job.jobId,{invoke:async()=>({state:'partial'})});
 const result=path.join(toolkit.workspace('Game'),'04_Notes/jobs',job.jobId,'result.json');fs.linkSync(result,path.join(root,'linked-result.json'));await assert.rejects(getJob(toolkit,'Game',{jobId:job.jobId}));
});

test('jobs preserve every existing typed operation including explicitly selected visual and migration engines',()=>{
 for(const [operation,schema]of Object.entries(definitions))if(!operation.startsWith('jobs.'))assert.deepEqual(registeredJobOperations[operation],schema,operation);
});

test('transport failures persist unknown mutation outcome and its exact operation identity',async t=>{
 const {toolkit}=await fixture(t),{startJob,executeJob,getJob}=await services(),{createHash}=await import('node:crypto');
 const plan=path.join(toolkit.workspace('Game'),'04_Notes','plan.json');fs.writeFileSync(plan,'{}');const planHash=createHash('sha256').update('{}').digest('hex');
 for(const code of ['request_timeout','connection_lost','protocol_mismatch','connection_closed','response_limit']){
  const started=await startJob(toolkit,'Game',{operation:'ghidra.symbols.apply',params:{plan,planHash}},{spawn:()=>({pid:process.pid,once(){return this;},unref(){}})});assert.match(started.operationId,/^[a-f0-9-]{36}$/);
  await executeJob(toolkit,'Game',started.jobId,{invoke:async(_t,_n,_op,params)=>{assert.equal(params.operationId,started.operationId);throw Object.assign(Error('private detail'),{code,operationId:params.operationId});}});
  const result=await getJob(toolkit,'Game',{jobId:started.jobId});assert.equal(result.state,'unknown',code);assert.equal(result.outcomeVerified,false);assert.equal(result.operationId,started.operationId);assert.equal(result.error.code,code);
 }
});

test('detached symbol jobs reuse the owned provider and persist exact mutation identity',async t=>{
 const {toolkit,root}=await fixture(t),input=path.join(root,'input');fs.mkdirSync(input);fs.writeFileSync(path.join(input,'GameAssembly.dll'),'MZfixture');fs.writeFileSync(path.join(input,'global-metadata.dat'),'metadata');await toolkit.scan('Game',input);
 const project=toolkit.read('Game');project.ghidraProgramName='GameAssembly.dll';fs.writeFileSync(path.join(project.ghidraProjectDir,'Game.gpr'),'project');fs.mkdirSync(path.join(project.ghidraProjectDir,'Game.rep'));fs.writeFileSync(path.join(project.il2cppDumperOutput,'script.json'),'{}');setStep(project,'dump','succeeded',stepFingerprint(project,'dump',toolkit.tools,root),outputManifest([project.il2cppDumperOutput]));await toolkit.save('Game',project);
 const fake=fileURLToPath(new URL('./fixtures/ghidra-engine.mjs',import.meta.url));
 try {
  await startSession(toolkit,'Game',{write:true,timeoutMs:10000},{engine:config=>({file:process.execPath,args:[fake,config]})});
  const plan=path.join(toolkit.workspace('Game'),'04_Notes','symbols-plan.json');fs.writeFileSync(plan,'{"entries":[]}');const {createHash}=await import('node:crypto'),planHash=createHash('sha256').update(fs.readFileSync(plan)).digest('hex');
  const job=await invokeAssetApi(toolkit,'Game','jobs.start',{operation:'ghidra.symbols.apply',params:{plan,planHash}});const done=await terminal(toolkit,job.jobId);assert.equal(done.state,'succeeded');assert.equal(done.result.result.status,'saved');assert.equal(done.result.result.planHash,planHash);
  const session=readSession(toolkit,'Game'),cached=JSON.parse(fs.readFileSync(path.join(runtimePaths(toolkit,'Game',session.runId).base,'requests',job.operationId+'.json')));assert.equal(cached.method,'symbols.apply');assert.equal(cached.params.operationId,job.operationId);assert.equal(cached.params.planHash,planHash);assert.equal(cached.params.dryRun,false);
  const status=await invokeAssetApi(toolkit,'Game','jobs.start',{operation:'ghidra.session.status',params:{}});assert.equal((await terminal(toolkit,status.jobId)).result.state,'ready');
  const stop=await invokeAssetApi(toolkit,'Game','jobs.start',{operation:'ghidra.session.stop',params:{timeoutMs:10000}});assert.equal((await terminal(toolkit,stop.jobId)).result.state,'stopped');
 }finally{await stopSession(toolkit,'Game',{timeoutMs:10000}).catch(()=>{});}
});

test('typed input repair jobs reject missing, oversized or unsupported selectors before spawning',async t=>{
 const {toolkit}=await fixture(t),{startJob}=await services();let spawns=0;const spawn=()=>{spawns++;throw Error('must not spawn');};
 for(const operation of ['workspace.add','workspace.scan']){
  validateAssetParams('jobs.start',{operation,params:{input:'C:/fixture.apk',binary:'lib/arm64-v8a/libil2cpp.so',metadata:'assets/global-metadata.dat'}});
  for(const params of [{},{input:''},{input:'x'.repeat(32768)},{input:'fixture.apk',binary:3},{input:'fixture.apk',metadata:''},{input:'fixture.apk',command:'dump'},{input:'fixture.apk',noOpen:true},{input:'fixture.apk',binary:'bad\u0000path'}])await assert.rejects(startJob(toolkit,'Game',{operation,params},{spawn}));
 }
 assert.equal(spawns,0);assert.equal(definitions['workspace.add'],undefined);assert.equal(definitions['workspace.scan'],undefined);
});

test('detached input repair jobs re-add an incomplete APK and rescan explicit multi-ABI inputs without engines',async t=>{
 const {toolkit,root}=await fixture(t);
 async function apk(file,entries){const archive=new yazl.ZipFile();for(const [name,data]of Object.entries(entries))archive.addBuffer(Buffer.from(data),name);archive.end();const stream=fs.createWriteStream(file);archive.outputStream.pipe(stream);await once(stream,'close');}
 const incomplete=path.join(root,'missing-split.apk');await apk(incomplete,{'assets/bin/Data/boot.config':'fixture'});
 const created=await createApkProject(toolkit,'Repair',incomplete);assert.equal(created.state,'needs-input');assert.equal(toolkit.read('Repair').steps.extract.state,'succeeded');assert.equal(toolkit.read('Repair').steps.scan.state,'awaiting-user');
 const complete=path.join(root,'complete.apk'),metadata='assets/bin/Data/Managed/Metadata/global-metadata.dat';await apk(complete,{'lib/arm64-v8a/libil2cpp.so':'arm64-fixture','lib/x86_64/libil2cpp.so':'x64-fixture',[metadata]:'metadata'});
 const added=await invokeAssetApi(toolkit,'Repair','jobs.start',{operation:'workspace.add',params:{input:complete,binary:'lib/arm64-v8a/libil2cpp.so',metadata}}),addResult=await terminal(toolkit,added.jobId,'Repair');
 assert.equal(addResult.state,'succeeded');assert.equal(addResult.stage,'operation.completed');assert.equal(addResult.result.steps.extract.state,'succeeded');assert.equal(addResult.result.steps.scan.state,'succeeded');assert.equal(addResult.result.selection.binary,path.join('lib','arm64-v8a','libil2cpp.so'));assert(addResult.sequence>added.sequence);
 const scanned=await invokeAssetApi(toolkit,'Repair','jobs.start',{operation:'workspace.scan',params:{input:addResult.result.extractedPath,binary:'lib/x86_64/libil2cpp.so',metadata}}),scanResult=await terminal(toolkit,scanned.jobId,'Repair');
 assert.equal(scanResult.state,'succeeded');assert.equal(scanResult.result.selection.binary,path.join('lib','x86_64','libil2cpp.so'));assert.equal(scanResult.currentSteps.scan.state,'succeeded');
 for(const result of [addResult,scanResult]){assert(['pending','stale'].includes(result.result.steps.dump.state));assert(['pending','stale'].includes(result.result.steps.import.state));assert(!result.diagnosticTail.some(event=>event.stage.startsWith('engine.')));assert.equal(result.engine,undefined);}
});
