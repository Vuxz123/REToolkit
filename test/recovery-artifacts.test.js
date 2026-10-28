import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,replacement} from './reconstruction-fixture.js';
import {createToolkit} from '../src/toolkit.js';
import {runRecoveryOperation} from '../src/recovery/service.js';
import {fingerprint} from '../src/state.js';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import yazl from 'yazl';
import {addLibraryRoot,runLibraryOperation} from '../src/libraries/service.js';

export async function recoveryFixture(t){
 const f=await fixture(t),toolkit=createToolkit(f.root,{log:()=>{}});await toolkit.init('Game');
 const workspace=toolkit.workspace('Game'),input=path.join(workspace,'01_Extracted');
 fs.writeFileSync(path.join(input,'libil2cpp.so'),'owned native');fs.writeFileSync(path.join(input,'global-metadata.dat'),'owned metadata');await toolkit.scan('Game',input);
 const original=path.join(workspace,'05_ReconstructedSource');fs.cpSync(f.projectDir,original,{recursive:true});
 return {...f,toolkit,workspace,original};
}
const call=(f,command,params={})=>runRecoveryOperation(f.toolkit,'Game',command,params);
test('artifact snapshots the export, isolates graph state and preserves project configuration',async t=>{
 const f=await recoveryFixture(t),before=fs.readFileSync(path.join(f.workspace,'project.re.json'));
 const created=await call(f,'create');assert.equal(created.state,'created');assert.equal(created.compileReady,false);assert.equal(created.gameplay,'unverified');
 const status=await call(f,'status',{artifactId:created.artifactId});assert.equal(status.freshness,'current');
 assert.equal(fs.readFileSync(path.join(f.workspace,status.project,'Assets/Player.cs'),'utf8'),f.files['Assets/Player.cs']);
 await call(f,'run',{artifactId:created.artifactId,revision:created.revision,operation:'assets.index',params:{storage:'sqlite'}});
 assert.deepEqual(fs.readFileSync(path.join(f.workspace,'project.re.json')),before);
 assert.equal(fs.existsSync(path.join(f.workspace,'04_Notes/assets/graph.json')),false);
});
test('source apply forks a generation and the next operation sees recovered source',async t=>{
 const f=await recoveryFixture(t),created=await call(f,'create'),args={artifactId:created.artifactId,revision:created.revision};
 const run=(operation,params={})=>call(f,'run',{...args,operation,params});
 const index=await run('assets.index',{storage:'sqlite'}),scripts=await run('assets.scripts',{limit:10});
 const request={kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:index.result.revision,changes:[{scriptId:scripts.result.items[0].scriptId,source:replacement}]};
 const plan=await run('reconstruct.plan',{request}),applied=await run('reconstruct.apply',{operationId:plan.result.operationId});
 assert.notEqual(applied.revision,args.revision);assert.equal(applied.result.compileReady,false);
 assert.equal(fs.readFileSync(path.join(f.workspace,created.project,'Assets/Player.cs'),'utf8'),f.files['Assets/Player.cs']);
 assert.equal(fs.readFileSync(path.join(f.original,'Assets/Player.cs'),'utf8'),f.files['Assets/Player.cs']);
 const source=await call(f,'run',{artifactId:created.artifactId,revision:applied.revision,operation:'assets.source',params:{id:scripts.result.items[0].scriptId}});
 assert.equal(source.result.source,replacement);
 const verify=await call(f,'run',{artifactId:created.artifactId,revision:applied.revision,operation:'reconstruct.verify',params:{operationId:plan.result.operationId}});assert.equal(verify.result.valid,true);
 await assert.rejects(run('reconstruct.apply',{operationId:plan.result.operationId}),{code:'recovery_revision_stale'});
 const history=await call(f,'history',{artifactId:created.artifactId,limit:1});assert.equal(history.items.length,1);assert.ok(history.nextCursor);
});
test('artifact detects current-file edits and input changes before operations',async t=>{
 const f=await recoveryFixture(t),created=await call(f,'create');
 fs.appendFileSync(path.join(f.workspace,created.project,'Assets/Player.cs'),'// external change');
 assert.equal((await call(f,'status',{artifactId:created.artifactId})).freshness,'stale');
 await assert.rejects(call(f,'run',{artifactId:created.artifactId,revision:created.revision,operation:'assets.index',params:{}}),{code:'stale_graph'});
 assert.equal(fs.readFileSync(path.join(f.original,'Assets/Player.cs'),'utf8'),f.files['Assets/Player.cs']);
});
test('two artifacts cannot reuse each other source plans',async t=>{
 const f=await recoveryFixture(t),a=await call(f,'create'),b=await call(f,'create');
 const run=(artifact,operation,params={})=>call(f,'run',{artifactId:artifact.artifactId,revision:artifact.revision,operation,params});
 const index=await run(a,'assets.index'),scripts=await run(a,'assets.scripts');
 const plan=await run(a,'reconstruct.plan',{request:{kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:index.result.revision,changes:[{scriptId:scripts.result.items[0].scriptId,source:replacement}]}});
 await assert.rejects(run(b,'reconstruct.apply',{operationId:plan.result.operationId}));
 const status=await call(f,'status',{artifactId:b.artifactId});assert.equal(status.state,'needs-inspection');assert.equal(status.revision,b.revision);assert.ok(status.pending);
 await assert.rejects(run(b,'assets.index'),{code:'recovery_inspection_required'});
});
test('diagnosis pages bind the snapshot and keep runtime and gameplay unknown',async t=>{
 const f=await recoveryFixture(t);fs.writeFileSync(path.join(f.original,'Assets/Vendor.dll'),'not inspected managed bytes');
 fs.mkdirSync(path.join(f.original,'Packages/com.retk.fixture'),{recursive:true});fs.writeFileSync(path.join(f.original,'Packages/com.retk.fixture/PackageRuntime.dll'),'also uninspected');
 fs.appendFileSync(path.join(f.original,'Assets/Main.unity'),'  missing: {fileID: 11500000, guid: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb, type: 3}\n');
 const a=await call(f,'create'),p={artifactId:a.artifactId,limit:1};let page=await call(f,'diagnose',p),rows=[...page.items];
 while(page.nextCursor){page=await call(f,'diagnose',{...p,cursor:page.nextCursor});rows.push(...page.items);}
 assert.ok(rows.some(r=>r.code==='runtime_implementation_unverified'));assert.ok(rows.some(r=>r.code==='serialized_references_missing'));
 assert.ok(rows.some(r=>r.path==='Packages/com.retk.fixture/PackageRuntime.dll'));
 assert.ok(rows.find(r=>r.code==='serialized_references_missing').examples.some(r=>r.field==='missing'));
 assert.ok(rows.some(r=>r.code==='source_logic_unverified'));assert.equal(page.gameplay,'unverified');assert.equal(page.compileReady,false);
 assert.ok(rows.every(r=>r.nextAction));assert.ok(!rows.some(r=>r.state==='stub-confirmed'));
 const source=rows.find(r=>r.code==='source_logic_unverified');assert.equal(source.bindingTraversalComplete,true);assert.ok(source.sourceCapabilities.bodyReplacement);
 await assert.rejects(call(f,'diagnose',{...p,cursor:'forged'}),{code:'recovery_cursor_invalid'});
});
test('changed native inputs cannot be silently reused by an existing artifact',async t=>{
 const f=await recoveryFixture(t),a=await call(f,'create');fs.appendFileSync(path.join(f.workspace,'01_Extracted/libil2cpp.so'),' changed');
 assert.equal((await call(f,'status',{artifactId:a.artifactId})).freshness,'stale');
 await assert.rejects(call(f,'run',{artifactId:a.artifactId,revision:a.revision,operation:'assets.index',params:{}}),{code:'asset_input_stale'});
});
test('unknown intent can only be abandoned after verifying the unchanged published revision',async t=>{
 const f=await recoveryFixture(t),a=await call(f,'create'),args={artifactId:a.artifactId,revision:a.revision,operation:'reconstruct.apply',params:{operationId:'33333333-3333-4333-8333-333333333333'}};
 await assert.rejects(call(f,'run',args));const status=await call(f,'status',{artifactId:a.artifactId});assert.equal(status.state,'needs-inspection');
 await assert.rejects(call(f,'abandon',{artifactId:a.artifactId,revision:a.revision,intentId:'44444444-4444-4444-8444-444444444444'}));
 const abandoned=await call(f,'abandon',{artifactId:a.artifactId,revision:a.revision,intentId:status.pending.invocationId});assert.equal(abandoned.state,'available');assert.equal(abandoned.revision,a.revision);
 const indexed=await call(f,'run',{artifactId:a.artifactId,revision:a.revision,operation:'assets.index',params:{storage:'sqlite'}});assert.equal(indexed.result.state,'indexed');
 const pending=path.join(f.workspace,'04_Notes/recovery/artifacts',a.artifactId,'intents',status.pending.invocationId+'.json');assert.ok(fs.existsSync(pending));
});
test('unsupported nested operations and arbitrary artifact paths are rejected',async t=>{
 const f=await recoveryFixture(t),a=await call(f,'create');
 await assert.rejects(call(f,'run',{artifactId:a.artifactId,revision:a.revision,operation:'shell.exec',params:{}}));
 await assert.rejects(call(f,'status',{artifactId:'../outside'}));
 await assert.rejects(call(f,'create',{projectDir:f.original}));
});
test('migration adoption composes with subsequent source edits on the same artifact',async t=>{
 const f=await recoveryFixture(t);
 fs.writeFileSync(path.join(f.original,'Assets/Other.cs'),'namespace Game { public class Other : UnityEngine.MonoBehaviour { public int score; public void Run() {} } }');
 fs.writeFileSync(path.join(f.original,'Assets/Other.cs.meta'),'guid: '+ 'b'.repeat(32)+'\n');fs.writeFileSync(path.join(f.original,'Assets/Main.unity.meta'),'guid: '+ 'c'.repeat(32)+'\n');
 const a=await call(f,'create');let revision=a.revision;const run=async(operation,params={})=>{const r=await call(f,'run',{artifactId:a.artifactId,revision,operation,params});revision=r.revision;return r;};
 const indexed=await run('assets.index'),graph=JSON.parse(fs.readFileSync(path.join(f.workspace,'04_Notes/recovery/artifacts',a.artifactId,'assets/graph.json'))),componentId=graph.nodes[0].id;
 const from={assembly:'Assembly-CSharp',fullName:'Game.Player',guid:'a'.repeat(32),fileID:'11500000'},to={assembly:'Assembly-CSharp',fullName:'Game.Other',guid:'b'.repeat(32),fileID:'11500000'};
 const observation={kind:'retoolkit-migration-observation',schemaVersion:1,graphRevision:indexed.result.revision,inventorySha256:fingerprint(graph.files),unityVersion:graph.unityVersion,complete:true,compilation:{state:'succeeded'},scripts:[{...from,path:'Assets/Player.cs',fields:[{name:'health',type:'System.Int32',propertyType:'Integer'}]},{...to,path:'Assets/Other.cs',fields:[{name:'score',type:'System.Int32',propertyType:'Integer'}]}],components:[{componentId,script:from,fields:[{name:'health',type:'System.Int32',propertyType:'Integer',valueJson:'42'}]}]};
 const request={kind:'retoolkit-migration-request',schemaVersion:1,graphRevision:graph.revision,rebindings:[{componentId,from,to}],fieldRenames:[{componentId,from:'health',to:'score',type:'System.Int32',expectedValue:42}]};
 const requestFile=path.join(f.root,'migration-request.json'),observations=path.join(f.root,'observations.json');fs.writeFileSync(requestFile,JSON.stringify(request));fs.writeFileSync(observations,JSON.stringify(observation));
 const plan=await run('migration.plan',{request:requestFile,observations});const applied=await run('migration.apply',{plan:path.join(f.workspace,plan.result.storedPlan),observations});
 assert.notEqual(revision,a.revision);const scene=fs.readFileSync(path.join(f.workspace,applied.project,'Assets/Main.unity'),'utf8');assert.match(scene,/score: 42/);assert.ok(scene.includes('b'.repeat(32)));
 assert.match(fs.readFileSync(path.join(f.original,'Assets/Main.unity'),'utf8'),/health: 42/);
 const scripts=await run('assets.scripts',{query:'Other.cs'});assert.equal(scripts.result.items[0].componentCount,1);
 const source=await run('assets.source',{id:scripts.result.items[0].scriptId});
 const next=await run('reconstruct.plan',{request:{kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:scripts.result.revision,changes:[{scriptId:scripts.result.items[0].scriptId,source:source.result.source.replace('Run() {}','Run() { score++; }')}]}});
 const changed=await run('reconstruct.apply',{operationId:next.result.operationId});assert.match(fs.readFileSync(path.join(f.workspace,changed.project,'Assets/Other.cs'),'utf8'),/score\+\+/);
 assert.equal(fs.readFileSync(path.join(f.workspace,applied.project,'Assets/Main.unity'),'utf8'),scene);
 await assert.rejects(run('migration.verify',{receipt:path.join(f.workspace,applied.result.storedReceipt)}),{code:'recovery_receipt_stale'});
});
test('library import adopts only verified stage bytes and retains previous source work',async t=>{
 const f=await recoveryFixture(t),root=path.join(f.root,'library-zips');fs.mkdirSync(root);const zip=new yazl.ZipFile();
 zip.addBuffer(Buffer.from('{"name":"com.retk.owned","version":"1.0.0"}'),'package.json');zip.end();await pipeline(zip.outputStream,fs.createWriteStream(path.join(root,'owned.zip')));
 addLibraryRoot(f.toolkit,root);await runLibraryOperation(f.toolkit,null,'libraries.scan');
 const templates=path.join(f.root,'templates/Unity');fs.mkdirSync(templates,{recursive:true});fs.copyFileSync(fileURLToPath(new URL('../templates/Unity/REToolkitLibraryImport.cs',import.meta.url)),path.join(templates,'REToolkitLibraryImport.cs'));
 const editor=path.join(f.root,'owned-fixture-editor.exe');fs.writeFileSync(editor,'never executed');
 const a=await call(f,'create');let revision=a.revision;
 const run=async(operation,params={},deps={})=>{const r=await runRecoveryOperation(f.toolkit,'Game','run',{artifactId:a.artifactId,revision,operation,params},deps);revision=r.revision;return r;};
 const index=await run('assets.index'),scripts=await run('assets.scripts');
 const sourcePlan=await run('reconstruct.plan',{request:{kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:index.result.revision,changes:[{scriptId:scripts.result.items[0].scriptId,source:replacement}]}});const sourceApplied=await run('reconstruct.apply',{operationId:sourcePlan.result.operationId});
 const plan=await run('libraries.plan',{requirements:{kind:'retoolkit-library-requirements',schemaVersion:1,packages:[{id:'com.retk.owned',version:'1.0.0'}]}});assert.equal(plan.result.state,'ready');
 let calls=0;const library={editor,runEditor:async args=>{calls++;assert.equal(fs.readFileSync(path.join(args.projectDir,'Assets/Player.cs'),'utf8'),replacement);const request=JSON.parse(fs.readFileSync(args.requestFile));fs.writeFileSync(args.reportFile,JSON.stringify({kind:'retoolkit-library-import-observation',schemaVersion:1,operationId:request.operationId,complete:true,success:true,packages:request.packages,diagnostics:[]}));return {closed:true,exitCode:0,timedOut:false};}};
 const imported=await run('libraries.import',{operationId:plan.result.operationId},{library});assert.equal(calls,1);assert.equal(imported.result.state,'imported');assert.notEqual(imported.revision,sourceApplied.revision);
 assert.equal(fs.readFileSync(path.join(f.workspace,imported.project,'Assets/Player.cs'),'utf8'),replacement);assert.ok(fs.existsSync(path.join(f.workspace,imported.project,'Packages/com.retk.owned/package.json')));
 assert.equal(fs.existsSync(path.join(f.original,'Packages/com.retk.owned/package.json')),false);assert.equal(fs.existsSync(path.join(f.workspace,sourceApplied.project,'Packages/com.retk.owned/package.json')),false);
 assert.equal((await run('libraries.identify',{section:'installed'})).result.items.length,1);
});
