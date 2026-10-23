import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileIdentity,fingerprint,outputManifest,setStep} from '../src/state.js';
import {stepFingerprint} from '../src/inputs.js';
import {selectedAssetBinding} from '../src/assets/context.js';
import {runtimePaths as ghidraPaths} from '../src/ghidra/runtime.js';

async function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-preparation-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const workspace=path.join(root,'workspaces','Game');fs.mkdirSync(workspace,{recursive:true});
 const input=path.join(workspace,'01_Extracted');fs.mkdirSync(input);
 const nativeBinary=path.join(input,'GameAssembly.dll'),metadata=path.join(input,'global-metadata.dat');
 fs.writeFileSync(nativeBinary,'native');fs.writeFileSync(metadata,'metadata');
 const project={name:'Game',nativeBinary,metadata,extractedPath:input,identities:{native:fileIdentity(nativeBinary),metadata:fileIdentity(metadata)},steps:{},ghidraProjectName:'Game',ghidraProgramName:'GameAssembly.dll',ghidraProjectDir:path.join(workspace,'03_GhidraProject'),il2cppDumperOutput:path.join(workspace,'02_Il2CppDumperOutput'),reconstructedSourceDir:path.join(workspace,'05_ReconstructedSource')};
 const toolkit={root,tools:{},workspace:()=>workspace,read:()=>structuredClone(project)};
 const calls=[],events=[];
 const invokeStage=async(id,context)=>{
  calls.push(id);
  const saved=JSON.parse(fs.readFileSync(context.reportPath,'utf8'));
  assert.equal(saved.stages.find(s=>s.id===id).state,'running');
  assert.equal(fs.existsSync(path.join(workspace,'.retk-lock')),false,'pipeline never holds workspace lease');
  const file=path.join(context.runDirectory,id+'.receipt');fs.writeFileSync(file,id);
  return {state:'ready',outputs:outputManifest([file]),...(id==='prerequisites'?{native:true,assets:true}:{}),...(id==='inputs'?{selected:true}:{}),...(id==='symbols'?{coverage:'complete',symbolsApplied:true}:{}),...(id==='index'?{storage:'sqlite'}:{})};
 };
 const dependencies={invokeStage,onProgress:event=>events.push(event),getResources:()=>({availableBytes:12*1024**3,totalBytes:32*1024**3})};
 return {root,workspace,project,toolkit,calls,events,dependencies,invokeStage};
}
const service=()=>import('../src/preparation/service.js');

test('preparation persists stages before launch, serializes work and publishes compact independent readiness',async t=>{
 const f=await fixture(t),{runPreparation,inspectPreparation}=await service();
 const result=await runPreparation(f.toolkit,'Game',{addressMode:'rva'},f.dependencies);
 assert.equal(result.state,'succeeded');assert.equal(result.readiness.nativeAnalysis.state,'ready');
 assert.equal(result.readiness.symbols.state,'planned');assert.equal(result.readiness.assetsIndex.state,'ready');
 assert.equal(result.readiness.compilation.state,'unverified');assert.equal(result.readiness.bindings.state,'unverified');assert.equal(result.readiness.gameplay.state,'unverified');
 assert.deepEqual(f.calls,['prerequisites','android','inputs','dump','import','analyze','symbols','assets','index','scripts']);
 assert.equal(f.events.some(e=>e.stage==='analyze'&&e.state==='running'),true);
 const inspected=await inspectPreparation(f.toolkit,'Game');assert.equal(inspected.runId,result.runId);
 assert.ok(fs.statSync(result.handoffPath).size<32768);assert.equal(fs.existsSync(path.join(f.workspace,'04_Notes/preparation/.gate')),false);
});

test('resume verifies receipts and unchanged input bytes without replaying completed writes',async t=>{
 const f=await fixture(t),{runPreparation}=await service();
 const first=await runPreparation(f.toolkit,'Game',{addressMode:'rva'},f.dependencies);f.calls.length=0;
 const resumed=await runPreparation(f.toolkit,'Game',{resumeRunId:first.runId},f.dependencies);
 assert.equal(resumed.state,'succeeded');assert.deepEqual(f.calls,['prerequisites','android','inputs']);
 fs.writeFileSync(f.project.nativeBinary,'changed');f.calls.length=0;
 const changed=await runPreparation(f.toolkit,'Game',{resumeRunId:first.runId},f.dependencies);
 assert.equal(changed.state,'blocked');assert.equal(changed.blockers[0].code,'PREPARATION_BINDING_CHANGED');assert.deepEqual(f.calls,[]);
 assert.equal(changed.readiness.nativeAnalysis.state,'unverified');assert.equal(changed.recordedReadiness.nativeAnalysis.state,'ready');assert.equal(changed.freshness,'not-rechecked');
});

test('resume rejects changed options and missing receipt rather than replaying writes',async t=>{
 const f=await fixture(t),{runPreparation}=await service();
 const first=await runPreparation(f.toolkit,'Game',{addressMode:'rva'},f.dependencies);f.calls.length=0;
 const changed=await runPreparation(f.toolkit,'Game',{resumeRunId:first.runId,symbols:'apply'},f.dependencies);
 assert.equal(changed.state,'blocked');assert.equal(changed.blockers[0].code,'PREPARATION_OPTIONS_CHANGED');assert.equal(f.calls.length,0);
 const saved=JSON.parse(fs.readFileSync(first.reportPath,'utf8'));fs.unlinkSync(saved.stages.find(s=>s.id==='dump').outputs[0].path);
 const invalid=await runPreparation(f.toolkit,'Game',{resumeRunId:first.runId},f.dependencies);
 assert.equal(invalid.state,'partial');assert.equal(invalid.stages.find(s=>s.id==='dump').state,'blocked');assert.equal(f.calls.includes('dump'),false);
 f.calls.length=0;
 await runPreparation(f.toolkit,'Game',{resumeRunId:first.runId},f.dependencies);
 assert.equal(f.calls.includes('dump'),false,'another resume cannot downgrade a receipt-review requirement into a fresh write');
});

test('native blocker permits independent assets, and explicit address mode is required for symbols',async t=>{
 const f=await fixture(t),{runPreparation}=await service();
 const result=await runPreparation(f.toolkit,'Game',{}, {...f.dependencies,invokeStage:async(id,c)=>id==='dump'?{state:'blocked',code:'SDK_MISSING',message:'Install exact .NET runtime'}:f.invokeStage(id,c)});
 assert.equal(result.state,'partial');assert.equal(f.calls.includes('assets'),true);assert.equal(f.calls.includes('analyze'),false);assert.equal(result.readiness.assetsIndex.state,'ready');
 const second=await runPreparation(f.toolkit,'Game',{},f.dependencies);
 assert.equal(second.state,'partial');assert.equal(second.stages.find(s=>s.id==='symbols').error.code,'SYMBOL_ADDRESS_MODE_REQUIRED');
 assert.equal(f.calls.includes('symbols'),false);
});

test('active preparation gate gives a bounded actionable blocker and inspect never acquires it',async t=>{
 const f=await fixture(t),{runPreparation,inspectPreparation}=await service();let release;
 const pending=new Promise(resolve=>{release=resolve;});let entered;
 const seen=new Promise(resolve=>{entered=resolve;});
 const worker=runPreparation(f.toolkit,'Game',{symbols:'skip'}, {...f.dependencies,invokeStage:async(id,c)=>{if(id==='dump'){entered();await pending;}return f.invokeStage(id,c);}});
 await seen;
 const before=Date.now(),second=await runPreparation(f.toolkit,'Game',{},f.dependencies);
 assert.equal(second.state,'blocked');assert.equal(second.blockers[0].code,'PREPARATION_BUSY');assert.ok(Date.now()-before<1000);
 const current=await inspectPreparation(f.toolkit,'Game');assert.equal(current.state,'running');assert.equal(current.stages.find(s=>s.id==='dump').state,'running');
 const same=await runPreparation(f.toolkit,'Game',{resumeRunId:current.runId},f.dependencies);assert.equal(same.state,'blocked');assert.equal(same.blockers[0].code,'PREPARATION_BUSY');
 release();await worker;
});

test('lost run owner and uncertain stage errors are unknown and never automatically retried',async t=>{
 const f=await fixture(t),{runPreparation,inspectPreparation}=await service();
 const first=await runPreparation(f.toolkit,'Game',{symbols:'skip'},f.dependencies);
 const saved=JSON.parse(fs.readFileSync(first.reportPath,'utf8'));saved.state='running';saved.owner={pid:2147483647,token:'lost'};saved.stages.find(s=>s.id==='import').state='running';fs.writeFileSync(first.reportPath,JSON.stringify(saved));f.calls.length=0;
 assert.equal((await inspectPreparation(f.toolkit,'Game')).state,'unknown');
 const resumed=await runPreparation(f.toolkit,'Game',{resumeRunId:first.runId},f.dependencies);
 assert.equal(resumed.state,'unknown');assert.equal(f.calls.length,0);
 assert.notEqual(resumed.readiness.nativeAnalysis.state,'ready');assert.equal(resumed.freshness,'not-rechecked');
 const uncertain=await runPreparation(f.toolkit,'Game',{symbols:'skip'},{...f.dependencies,invokeStage:async(id,c)=>{if(id==='assets')throw Object.assign(new Error('engine close not confirmed'),{code:'cleanup_pending'});return f.invokeStage(id,c);}});
 assert.equal(uncertain.state,'unknown');assert.equal(f.calls.includes('index'),false);
});

test('owned Ghidra session is stopped after a symbol failure, external session is never stopped',async t=>{
 const f=await fixture(t),{runPreparation}=await service();const calls=[];
 const provider={startSession:async()=>{calls.push('start');return {runId:'owned',state:'ready'};},stopSession:async()=>{calls.push('stop');return {state:'stopped'};},querySession:async()=>{calls.push('plan');throw Object.assign(new Error('invalid plan'),{code:'plan_invalid'});}};
 const result=await runPreparation(f.toolkit,'Game',{addressMode:'rva'},{...f.dependencies,ghidraProvider:provider,invokeStage:(id,c)=>id==='symbols'?c.runDefault():f.invokeStage(id,c)});
 assert.deepEqual(calls,['start','plan','stop']);assert.equal(result.readiness.assetsIndex.state,'ready');
});

test('Android readiness is separate and explicitly selected device controls pull default',async t=>{
 const f=await fixture(t),{runPreparation}=await service();const observed=[];
 const androidPreflight=async(_t,_n,options)=>{observed.push(options);return {state:'partial',downloadedData:{state:'unverified',denied:['private']}};};
 const deps={...f.dependencies,androidPreflight,invokeStage:(id,c)=>id==='android'?c.runDefault():f.invokeStage(id,c)};
 const result=await runPreparation(f.toolkit,'Game',{symbols:'skip',serial:'emulator-5554',packageName:'com.example.game'},deps);
 assert.equal(observed[0].autoPull,true);assert.equal(result.readiness.nativeAnalysis.state,'ready');assert.equal(result.readiness.downloadedData.state,'unverified');
 await runPreparation(f.toolkit,'Game',{symbols:'skip'},deps);assert.equal(observed[1].autoPull,false);
});

test('an active external engine blocks all writes and retains every ownership marker',async t=>{
 const f=await fixture(t),{runPreparation}=await service();
 const runtime=ghidraPaths(f.toolkit,'Game');fs.mkdirSync(runtime.base,{recursive:true});
 fs.writeFileSync(runtime.current,JSON.stringify({runId:randomUUID(),phase:'ready'}));
 const result=await runPreparation(f.toolkit,'Game',{},f.dependencies);
 assert.equal(result.state,'unknown');assert.equal(f.calls.length,0);assert.equal(fs.existsSync(runtime.current),true);
});

test('an ownership refusal during resume exposes earlier readiness only as recorded evidence',async t=>{
 const f=await fixture(t),{runPreparation}=await service(),first=await runPreparation(f.toolkit,'Game',{symbols:'skip'},f.dependencies);
 fs.mkdirSync(path.join(f.workspace,'.retk-lock'));f.calls.length=0;
 const result=await runPreparation(f.toolkit,'Game',{resumeRunId:first.runId},f.dependencies);
 assert.equal(result.state,'unknown');assert.equal(result.readiness.nativeAnalysis.state,'unverified');assert.equal(result.recordedReadiness.nativeAnalysis.state,'ready');assert.equal(result.freshness,'not-rechecked');assert.equal(f.calls.length,0);
});

test('owned asset export closes its session before indexing and binds generated export location',async t=>{
 const f=await fixture(t),{runPreparation}=await service();const calls=[];
 const assetApi=async(_t,_n,method)=>{
  calls.push(method);
  if(method==='assets.session.start')return {runId:randomUUID(),state:'ready'};
  if(method==='assets.export'){
   f.project.reconstructedSourceDir=path.join(f.project.reconstructedSourceDir,'UnityProject');fs.mkdirSync(f.project.reconstructedSourceDir,{recursive:true});
   fs.writeFileSync(path.join(f.project.reconstructedSourceDir,'receipt.txt'),'exported');
   return {state:'export_ready'};
  }
  return {state:'stopped'};
 };
 const result=await runPreparation(f.toolkit,'Game',{symbols:'skip'},{...f.dependencies,assetApi,invokeStage:(id,c)=>id==='assets'?c.runDefault():f.invokeStage(id,c)});
 assert.equal(result.state,'succeeded');assert.deepEqual(calls,['assets.session.start','assets.export','assets.session.stop']);assert.equal(result.readiness.assetsIndex.state,'ready');
});

test('default current native analysis is reused without launching a second analysis',async t=>{
 const f=await fixture(t),{runPreparation}=await service();
 const toolsDir=path.join(f.root,'tools');fs.mkdirSync(toolsDir);for(const name of ['dumper.exe','headless.bat','java.exe'])fs.writeFileSync(path.join(toolsDir,name),name);
 f.toolkit.tools={dumper:path.join(toolsDir,'dumper.exe'),headless:path.join(toolsDir,'headless.bat'),java:path.join(toolsDir,'java.exe'),ghidra:toolsDir};
 const receipt=path.join(f.workspace,'analysis.txt');fs.writeFileSync(receipt,'analyzed');
 setStep(f.project,'analyze','succeeded',stepFingerprint(f.project,'analyze',f.toolkit.tools,f.root),outputManifest([receipt]));
 f.toolkit.analyze=()=>{throw new Error('must not execute a repeated analysis');};
 const result=await runPreparation(f.toolkit,'Game',{profile:'native',symbols:'skip'},{...f.dependencies,invokeStage:(id,c)=>id==='analyze'?c.runDefault():f.invokeStage(id,c)});
 assert.equal(result.state,'succeeded');assert.equal(result.stages.find(s=>s.id==='analyze').result.reused,true);
});

test('completed stage evidence stays outside compact report and mutation during a stage aborts later work',async t=>{
 const f=await fixture(t),{runPreparation}=await service();
 const result=await runPreparation(f.toolkit,'Game',{symbols:'skip'},{...f.dependencies,invokeStage:async(id,c)=>{
  const value=await f.invokeStage(id,c);
  if(id==='assets')value.outputs=[{path:f.workspace,type:'directory',files:Array.from({length:1000},(_,i)=>({path:i+'.cs',sha256:'a'.repeat(64),size:100})),directories:[]}];
  return value;
 }});
 assert.ok(fs.statSync(result.reportPath).size<65536,'full output inventories belong in separate evidence receipts');
 f.calls.length=0;
 const changed=await runPreparation(f.toolkit,'Game',{symbols:'skip'},{...f.dependencies,invokeStage:async(id,c)=>{const result=await f.invokeStage(id,c);if(id==='analyze')fs.writeFileSync(f.project.metadata,'changed-during-analysis');return result;}});
 assert.equal(changed.state,'unknown');assert.equal(f.calls.includes('assets'),false);
});

test('resume cannot reuse import receipt after the Ghidra database disappears',async t=>{
 const f=await fixture(t),{runPreparation}=await service();
 const toolDir=path.join(f.root,'tools');fs.mkdirSync(toolDir);f.toolkit.tools={dumper:path.join(toolDir,'dumper.exe'),ghidra:toolDir,headless:path.join(toolDir,'headless.bat'),java:path.join(toolDir,'java.exe')};
 const notes=path.join(f.workspace,'04_Notes');fs.mkdirSync(notes);fs.mkdirSync(f.project.ghidraProjectDir);
 for(const ext of ['.gpr','.rep'])fs.writeFileSync(path.join(f.project.ghidraProjectDir,'Game'+ext),'database');
 const receipt=path.join(notes,'import-receipt.json'),fp=stepFingerprint(f.project,'import',f.toolkit.tools,f.root);
 fs.writeFileSync(receipt,JSON.stringify({fingerprint:fp,project:'Game',program:f.project.ghidraProgramName,native:f.project.identities.native,attestation:{program:f.project.ghidraProgramName,sha256:f.project.identities.native.sha256}}));
 setStep(f.project,'import','succeeded',fp,outputManifest([receipt]));
 const deps={...f.dependencies,invokeStage:(id,c)=>id==='import'?c.runDefault():f.invokeStage(id,c)};
 const first=await runPreparation(f.toolkit,'Game',{profile:'native',symbols:'skip'},deps);assert.equal(first.state,'succeeded');
 fs.unlinkSync(path.join(f.project.ghidraProjectDir,'Game.gpr'));
 const resumed=await runPreparation(f.toolkit,'Game',{resumeRunId:first.runId},deps);
 assert.equal(resumed.stages.find(s=>s.id==='import').state,'blocked');
});

test('unobserved running toolkit stage requires owner review before a new pipeline',async t=>{
 const f=await fixture(t),{runPreparation}=await service();
 f.project.steps.import={state:'running',owner:{pid:2147483647}};
 const result=await runPreparation(f.toolkit,'Game',{},f.dependencies);
 assert.equal(result.state,'unknown');assert.equal(f.calls.length,0);
});

test('a current export with verified source and engine fingerprint is reused without exporting twice',async t=>{
 const f=await fixture(t),{runPreparation}=await service();
 const dir=path.join(f.root,'AssetRipper');fs.mkdirSync(dir);f.toolkit.tools.assetripper=path.join(dir,'AssetRipper.exe');fs.writeFileSync(f.toolkit.tools.assetripper,'engine');fs.writeFileSync(path.join(dir,'.retk-version'),'1.3.14');
 const binding=selectedAssetBinding(f.toolkit,'Game').binding;
 fs.mkdirSync(f.project.reconstructedSourceDir);fs.writeFileSync(path.join(f.project.reconstructedSourceDir,'Export.txt'),'export');
 const engine=[{path:'AssetRipper.exe',sha256:fileIdentity(f.toolkit.tools.assetripper).sha256,size:6}];
 setStep(f.project,'assetripper','succeeded',fingerprint({binding,engine,settings:{version:'1.3.14',source:'upstream-defaults',defaultFile:'AssetRipper.Settings.json'}}),outputManifest([f.project.reconstructedSourceDir]));
 f.project.assetReconstruction={binding};
 let starts=0;const deps={...f.dependencies,assetApi:()=>{starts++;throw new Error('must reuse export');},invokeStage:(id,c)=>id==='assets'?c.runDefault():f.invokeStage(id,c)};
 const first=await runPreparation(f.toolkit,'Game',{symbols:'skip'},deps);assert.equal(first.state,'succeeded');assert.equal(starts,0);
 fs.writeFileSync(f.toolkit.tools.assetripper,'changed engine');
 const changed=await runPreparation(f.toolkit,'Game',{symbols:'skip'},deps);
 assert.equal(changed.stages.find(s=>s.id==='assets').state,'blocked');assert.equal(starts,0);
});

test('resource policy adapts heap to available memory, honors explicit policy and never polls for RAM',async t=>{
 const f=await fixture(t),{runPreparation}=await service(),GiB=1024**3;
 f.toolkit.env={};let samples=0;
 const dependencies={...f.dependencies,diagnose:async()=>({tasks:{prepare:{state:'available'},assetripper:{state:'available'}},diagnostics:[]}),getResources:()=>{samples++;return {availableBytes:12*GiB,totalBytes:32*GiB};},invokeStage:(id,c)=>id==='prerequisites'?c.runDefault():f.invokeStage(id,c)};
 const first=await runPreparation(f.toolkit,'Game',{symbols:'skip'},dependencies);
 assert.equal(first.resources.native.heapMiB,8192);assert.equal(first.resources.native.source,'adaptive');assert.equal(f.toolkit.env.GHIDRA_HEADLESS_MAXMEM,undefined);assert.equal(samples,1);
 f.toolkit.env.GHIDRA_HEADLESS_MAXMEM='6G';
 const explicit=await runPreparation(f.toolkit,'Game',{symbols:'skip'},dependencies);
 assert.equal(explicit.resources.native.heapMiB,6144);assert.equal(explicit.resources.native.source,'explicit');assert.equal(f.toolkit.env.GHIDRA_HEADLESS_MAXMEM,'6G');
 f.calls.length=0;
 const blocked=await runPreparation(f.toolkit,'Game',{symbols:'skip'},{...dependencies,getResources:()=>({availableBytes:4*GiB,totalBytes:16*GiB})});
 assert.equal(blocked.state,'partial');assert.equal(blocked.readiness.assetsIndex.state,'ready');assert.equal(f.calls.includes('dump'),false);
});

test('symbol write transport failure is unknown, retains operation UUID and stops owned session',async t=>{
 const f=await fixture(t),{runPreparation}=await service(),calls=[];
 const plan=path.join(f.workspace,'symbols-plan.json');fs.writeFileSync(plan,'{}');
 const provider={startSession:async(_t,_n,options)=>{assert.equal(options.reuse,false);calls.push('start');return {runId:randomUUID()};},querySession:async()=>({plan,planHash:fileIdentity(plan).sha256}),mutateSession:async()=>{calls.push('mutate');throw Object.assign(new Error('connection reset'),{code:'ECONNRESET'});},stopSession:async()=>{calls.push('stop');return {state:'stopped'};}};
 const result=await runPreparation(f.toolkit,'Game',{symbols:'apply',addressMode:'rva'},{...f.dependencies,ghidraProvider:provider,invokeStage:(id,c)=>id==='symbols'?c.runDefault():f.invokeStage(id,c)});
 assert.equal(result.state,'unknown');assert.deepEqual(calls,['start','mutate','stop']);assert.equal(f.calls.includes('assets'),false);
 const stage=result.stages.find(s=>s.id==='symbols');assert.match(stage.operationId,/^[a-f0-9-]{36}$/);assert.equal(stage.state,'unknown');
});

test('terminal inspection downgrades changed input readiness without writing reports or acquiring locks',async t=>{
 const f=await fixture(t),{runPreparation,inspectPreparation}=await service();
 const result=await runPreparation(f.toolkit,'Game',{symbols:'skip'},f.dependencies);
 const reportBytes=fs.readFileSync(result.reportPath),handoffBytes=fs.readFileSync(result.handoffPath);
 fs.writeFileSync(f.project.nativeBinary,'changed after completion');f.calls.length=0;
 const inspected=await inspectPreparation(f.toolkit,'Game');
 assert.equal(inspected.freshness,'stale');assert.equal(inspected.state,'stale');assert.equal(inspected.readiness.nativeAnalysis.state,'stale');assert.equal(inspected.readiness.assetsIndex.state,'stale');
 assert.equal(inspected.recordedReadiness.nativeAnalysis.state,'ready');
 assert.deepEqual(fs.readFileSync(result.reportPath),reportBytes);assert.deepEqual(fs.readFileSync(result.handoffPath),handoffBytes);assert.equal(f.calls.length,0);assert.equal(fs.existsSync(path.join(f.workspace,'.retk-lock')),false);
});

test('terminal inspection detects altered output receipt and preserves recorded coverage',async t=>{
 const f=await fixture(t),{runPreparation,inspectPreparation}=await service();
 const result=await runPreparation(f.toolkit,'Game',{symbols:'skip'},f.dependencies);
 const raw=JSON.parse(fs.readFileSync(result.reportPath));
 const analysis=raw.stages.find(s=>s.id==='analyze'),receipt=JSON.parse(fs.readFileSync(analysis.evidencePath));
 fs.writeFileSync(receipt.outputs[0].path,'tampered receipt');
 const inspected=await inspectPreparation(f.toolkit,'Game');
 assert.equal(inspected.freshness,'stale');assert.equal(inspected.readiness.nativeAnalysis.state,'stale');assert.equal(inspected.stages.find(s=>s.id==='analyze').state,'stale');
 assert.equal(inspected.recordedReadiness.assetsIndex.storage,'sqlite');assert.equal(inspected.readiness.assetsIndex.state,'ready','independent current asset evidence survives a stale native receipt');
});

test('terminal freshness verification keeps current owned-fixture receipts ready',async t=>{
 const f=await fixture(t),{runPreparation,inspectPreparation}=await service();
 const result=await runPreparation(f.toolkit,'Game',{symbols:'skip'},f.dependencies);
 const inspected=await inspectPreparation(f.toolkit,'Game',{runId:result.runId});
 assert.equal(inspected.freshness,'current');assert.equal(inspected.state,'succeeded');assert.equal(inspected.readiness.nativeAnalysis.state,'ready');assert.equal(inspected.readiness.assetsIndex.state,'ready');
});

test('polling inspection skips content hashes and exposes recorded readiness separately',async t=>{
 const f=await fixture(t),{runPreparation,inspectPreparation}=await service();
 await runPreparation(f.toolkit,'Game',{symbols:'skip'},f.dependencies);
 fs.unlinkSync(f.project.nativeBinary);
 const inspected=await inspectPreparation(f.toolkit,'Game',{verifyFreshness:false});
 assert.equal(inspected.freshness,'not-rechecked');assert.equal(inspected.state,'succeeded');assert.equal(inspected.readiness.nativeAnalysis.state,'unverified');assert.equal(inspected.recordedReadiness.nativeAnalysis.state,'ready');
 assert.equal(inspected.readiness.assetsIndex.state,'unverified');assert.equal(inspected.recordedReadiness.assetsIndex.state,'ready');
 await assert.rejects(()=>inspectPreparation(f.toolkit,'Game',{verifyFreshness:'yes'}),{code:'PREPARATION_PARAMS_INVALID'});
});

test('unknown inspection does not reinterpret saved receipts as successful readiness',async t=>{
 const f=await fixture(t),{runPreparation,inspectPreparation}=await service();
 const result=await runPreparation(f.toolkit,'Game',{symbols:'skip'},{...f.dependencies,invokeStage:async(id,c)=>{if(id==='assets')return {state:'unknown',message:'engine outcome is uncertain'};return f.invokeStage(id,c);}});
 fs.unlinkSync(f.project.nativeBinary);
 const inspected=await inspectPreparation(f.toolkit,'Game',{runId:result.runId});
 assert.equal(inspected.state,'unknown');assert.equal(inspected.freshness,'not-rechecked');assert.equal(inspected.readiness.nativeAnalysis.state,'unverified');
});

test('failed validation receipt recovery cannot retain an earlier compile or binding ready claim',async t=>{
 const f=await fixture(t),{runPreparation}=await service();
 const dependencies={...f.dependencies,invokeStage:async(id,c)=>{const result=await f.invokeStage(id,c);return id==='validation'?{...result,compileReady:true,bindingsVerified:true,coverage:{kind:'all-exported'}}:result;}};
 const first=await runPreparation(f.toolkit,'Game',{symbols:'skip',baselineValidation:true},dependencies);
 assert.equal(first.readiness.compilation.state,'ready');assert.equal(first.readiness.bindings.state,'ready');
 const saved=JSON.parse(fs.readFileSync(first.reportPath)),stage=saved.stages.find(s=>s.id==='validation');fs.unlinkSync(stage.evidencePath);
 const resumed=await runPreparation(f.toolkit,'Game',{resumeRunId:first.runId},dependencies);
 assert.equal(resumed.stages.find(s=>s.id==='validation').state,'blocked');assert.equal(resumed.readiness.compilation.state,'unverified');assert.equal(resumed.readiness.bindings.state,'unverified');
 assert.equal(resumed.stages.find(s=>s.id==='validation').result,undefined);assert.equal(resumed.stages.find(s=>s.id==='validation').previousResult.compileReady,true);
});
