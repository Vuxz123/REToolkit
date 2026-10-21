import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import yazl from 'yazl';
import {fixture} from './reconstruction-fixture.js';
import {createToolkit} from '../src/toolkit.js';
import {fileIdentity,withWorkspaceLock} from '../src/state.js';
import {indexUnityProject} from '../src/assets/graph.js';
import {selectedAssetBinding} from '../src/assets/context.js';

async function setup(t,format='upm',extras={},storage='json'){
 const f=await fixture(t),toolkit=createToolkit(f.root,{log:()=>{}});await toolkit.init('Game');
 const source=path.join(toolkit.workspace('Game'),'01_Extracted');
 fs.writeFileSync(path.join(source,'GameAssembly.dll'),'native');fs.writeFileSync(path.join(source,'global-metadata.dat'),'metadata');await toolkit.scan('Game',source);
 const binding=selectedAssetBinding(toolkit,'Game').binding,graph=storage==='sqlite'?await (await import('../src/assets/sqlite-index.js')).indexUnityProjectSqlite(f.projectDir,{binding,databaseFile:path.join(f.root,'graph.sqlite'),storageRelativePath:'graph.sqlite'}):await indexUnityProject(f.projectDir,{binding});
 const roots=path.join(f.root,'libraries');fs.mkdirSync(roots);
 const payload=format==='upm'?{'bundle/package.json':JSON.stringify({name:'com.retk.fixture',version:'1.2.3'}),'bundle/Runtime/Fixture.cs':'namespace LocalFixture { public class Token {} }','bundle/Runtime/Fixture.asmdef':JSON.stringify({name:'LocalFixture'})}:{'Assets/package.json':JSON.stringify({name:'com.retk.fixture',version:'1.2.3'}),'Assets/LocalFixture/Fixture.cs':'namespace LocalFixture { public class Token {} }','Assets/LocalFixture/Fixture.cs.meta':'fileFormatVersion: 2\nguid: cccccccccccccccccccccccccccccccc\n','Assets/LocalFixture/Fixture.asmdef':JSON.stringify({name:'LocalFixture'})};
 Object.assign(payload,extras);
 const archive=path.join(roots,'fixture.zip'),zip=new yazl.ZipFile();for(const [name,bytes]of Object.entries(payload))zip.addBuffer(Buffer.from(bytes),name);zip.end();await pipeline(zip.outputStream,fs.createWriteStream(archive));
 const {scanLibraries}=await import('../src/libraries/catalog.js');const catalog=await scanLibraries({roots:[roots],cacheDir:path.join(f.root,'.cache/libraries')});
 const {createLibraryPlan}=await import('../src/libraries/resolver.js');const plan=createLibraryPlan({graph,catalog,requirements:[{id:'com.retk.fixture',version:'1.2.3'}]});
 const editor=path.join(f.root,'Unity.exe');fs.writeFileSync(editor,'fixture editor');
 fs.mkdirSync(path.join(f.root,'templates/Unity'),{recursive:true});fs.copyFileSync(path.resolve(import.meta.dirname,'../templates/Unity/REToolkitLibraryImport.cs'),path.join(f.root,'templates/Unity/REToolkitLibraryImport.cs'));
 return {...f,toolkit,graph,catalog,plan,editor,archive,payload,args:{toolkit,name:'Game',projectDir:f.projectDir,graph,catalog,plan}};
}
async function editorSuccess(config){
 const request=JSON.parse(fs.readFileSync(config.requestFile));
 fs.writeFileSync(config.reportFile,JSON.stringify({kind:'retoolkit-library-import-observation',schemaVersion:1,operationId:request.operationId,complete:true,success:true,packages:request.packages,diagnostics:[]}));
 return {closed:true,exitCode:0,timedOut:false,logTail:''};
}
test('importer requires a workspace lease before producing artifacts',async()=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');
 await assert.rejects(importLibraryPlan({toolkit:{workspace:()=>path.resolve('absent')},name:'Game'}),{code:'asset_lease_required'});
});
test('fixed Unity helper resolves asynchronously and writes the bound observation before exit',()=>{
 const source=fs.readFileSync(path.resolve(import.meta.dirname,'../templates/Unity/REToolkitLibraryImport.cs'),'utf8');
 assert.match(source,/Client\.Resolve\(\)/);assert.match(source,/EditorApplication\.update/);assert.match(source,/Client\.List\(true, true\)/);assert.match(source,/SessionState/);
 assert.match(source,/retoolkit-library-import-observation/);assert.match(source,/EditorApplication\.Exit/);assert.doesNotMatch(source,/Assembly\.Load|Process\.Start/);
});
test('UPM import stages exact ZIP payload and source, uses fixed helper, and is idempotent',async t=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');const f=await setup(t);assert.equal(f.plan.state,'ready');
 const original=fileIdentity(f.archive),calls=[];
 const deps={editor:f.editor,runEditor:async config=>{calls.push(config);assert.equal(config.purpose,'library-import');assert.equal(fs.existsSync(path.join(config.projectDir,'Packages/com.retk.fixture/package.json')),true);return editorSuccess(config);}};
 const receipt=await withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,deps));
 assert.equal(receipt.state,'imported');assert.equal(receipt.compileReady,false);assert.equal(receipt.uiVerified,false);assert.deepEqual(receipt.imported,['com.retk.fixture']);
 assert.equal(fileIdentity(f.archive).sha256,original.sha256);for(const file of f.graph.files)assert.equal(fileIdentity(path.join(f.projectDir,file.path)).sha256,file.sha256);
 assert.equal(fs.existsSync(path.join(receipt.stagingProject,'Assets/REToolkitLibraryImport')),false);
 const lock=JSON.parse(fs.readFileSync(path.join(receipt.stagingProject,'Packages/retk-libraries.lock.json')));assert.equal(lock.packages[0].id,'com.retk.fixture');assert.equal(lock.packages[0].files.length,3);
 const again=await withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,deps));assert.equal(again.operationId,receipt.operationId);assert.equal(calls.length,1);
 fs.appendFileSync(path.join(receipt.stagingProject,'Packages/com.retk.fixture/Runtime/Fixture.cs'),'changed');
 await assert.rejects(withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,deps)),{code:'library_import_stale'});
});
test('missing exact Editor produces a blocked receipt without publishing a project',async t=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');const f=await setup(t);
 const receipt=await withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:null,runEditor:()=>assert.fail('must not launch')}));
 assert.equal(receipt.code,'unity_editor_missing');assert.equal(receipt.state,'blocked');assert.equal(receipt.stagingProject,null);
 assert.equal(fs.existsSync(path.join(path.dirname(path.join(f.toolkit.workspace('Game'),receipt.storedReceipt)),'project')),false);
});
test('stale source ZIP and semantically rehashed plans are rejected before operation writes',async t=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');
 for(const mode of ['zip','semantic']){
  const f=await setup(t);if(mode==='zip')fs.appendFileSync(f.archive,'changed');
  else {f.plan.selected=[];const {fingerprint}=await import('../src/state.js');const {payloadSha256,...payload}=f.plan;f.plan.payloadSha256=fingerprint(payload);}
  await assert.rejects(withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor:editorSuccess})),mode==='zip'?{code:'library_import_stale'}:{code:'library_plan_invalid'});
  assert.equal(fs.existsSync(path.join(f.toolkit.workspace('Game'),'04_Notes/assets/library-imports',f.plan.operationId)),false);
 }
});
test('missing, wrong-operation and unsuccessful reports cannot establish integration',async t=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');
 for(const mode of ['missing','wrong-operation','failed']){
  const f=await setup(t);
  const receipt=await withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor:async config=>{
   if(mode==='missing')return {closed:true,exitCode:0,timedOut:false,logTail:''};
   const result=await editorSuccess(config),value=JSON.parse(fs.readFileSync(config.reportFile));if(mode==='wrong-operation')value.operationId='bad';else value.success=false;
   fs.writeFileSync(config.reportFile,JSON.stringify(value));return result;
  }}));
  assert.equal(receipt.state,'import_failed');assert.equal(receipt.compileReady,false);assert.deepEqual(receipt.imported,[]);
 }
});
test('unconfirmed child closure keeps recovery ownership and does not publish a success receipt',async t=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');const f=await setup(t);
 await assert.rejects(withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor:async()=>({closed:false})})),error=>error.code==='unity_recovery_required'&&error.preserveToolchainGate===true);
 assert.equal(fs.existsSync(path.join(f.toolkit.workspace('Game'),'04_Notes/assets/library-imports',f.plan.operationId,'receipt.json')),false);
});
test('verification uses the staged graph and requires fresh closed-Editor evidence',async t=>{
 const {importLibraryPlan,verifyLibraryImport}=await import('../src/libraries/importer.js');const f=await setup(t);
 const imported=await withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor:editorSuccess}));
 let calls=0;const deps={validateEditor:async request=>{calls++;assert.equal(request.projectDir,imported.stagingProject);assert.notEqual(request.graph.revision,f.graph.revision);return {state:'validated',compileReady:true,bindingsVerified:true,operationId:'fresh-'+calls};}};
 const verified=await withWorkspaceLock(f.toolkit.workspace('Game'),()=>verifyLibraryImport(f.args,deps));
 assert.equal(verified.compileReady,true);assert.equal(verified.bindingsVerified,true);assert.equal(verified.uiVerified,false);assert.equal(calls,1);
 const again=await withWorkspaceLock(f.toolkit.workspace('Game'),()=>verifyLibraryImport(f.args,deps));assert.equal(calls,2);assert.notEqual(again.verificationId,verified.verificationId);
 fs.appendFileSync(f.archive,'stale');await assert.rejects(withWorkspaceLock(f.toolkit.workspace('Game'),()=>verifyLibraryImport(f.args,deps)),{code:'library_import_stale'});assert.equal(calls,2);
});
test('Assets import preserves original metadata and keeps the original export untouched',async t=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');const f=await setup(t,'assets');assert.equal(f.plan.state,'ready');assert.equal(f.plan.selected[0].format,'assets');
 const result=await withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor:editorSuccess}));
 for(const [name,bytes]of Object.entries(f.payload))assert.equal(fs.readFileSync(path.join(result.stagingProject,name),'utf8'),bytes);
 assert.equal(fs.existsSync(path.join(f.projectDir,'Assets/LocalFixture/Fixture.cs')),false);
});
test('a catalog payload omitting source archive files cannot publish a project',async t=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');const f=await setup(t),pkg=f.catalog.packages[0];
 pkg.payloadFiles=pkg.payloadFiles.filter(file=>!file.path.endsWith('Fixture.cs'));
 pkg.id=createHash('sha256').update(JSON.stringify({archiveSha256:pkg.archiveSha256,root:pkg.root,payloadFiles:pkg.payloadFiles})).digest('hex');
 const {createLibraryPlan}=await import('../src/libraries/resolver.js');f.args.plan=createLibraryPlan({graph:f.graph,catalog:f.catalog,requirements:[{id:'com.retk.fixture',version:'1.2.3'}]});
 await assert.rejects(withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor:()=>assert.fail('incomplete archive payload must not launch')})),{code:'library_import_invalid'});
 const operation=path.join(f.toolkit.workspace('Game'),'04_Notes/assets/library-imports',f.args.plan.operationId);assert.equal(fs.existsSync(path.join(operation,'project')),false);
});
test('managed package payload mutations by the Editor are rejected',async t=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');const f=await setup(t);
 await assert.rejects(withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor:async config=>{
  const result=await editorSuccess(config);fs.appendFileSync(path.join(config.projectDir,'Packages/com.retk.fixture/Runtime/Fixture.cs'),'changed');return result;
 }})),{code:'library_import_stale'});
});
test('an exact existing dependency is retained while another package is staged',async t=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');const f=await setup(t);
 for(const [name,bytes]of Object.entries(f.payload)){const target=path.join(f.projectDir,'Packages/com.retk.fixture',name.slice('bundle/'.length));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);}
 const zip=new yazl.ZipFile();zip.addBuffer(Buffer.from(JSON.stringify({name:'com.retk.consumer',version:'2.0.0',dependencies:{'com.retk.fixture':'1.2.3'}})),'package.json');zip.addBuffer(Buffer.from('namespace Consumer { public class Token {} }'),'Token.cs');zip.addBuffer(Buffer.from(JSON.stringify({name:'Consumer'})),'Consumer.asmdef');zip.end();await pipeline(zip.outputStream,fs.createWriteStream(path.join(path.dirname(f.archive),'consumer.zip')));
 const {scanLibraries}=await import('../src/libraries/catalog.js'),{createLibraryPlan}=await import('../src/libraries/resolver.js');
 f.args.graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding});f.args.catalog=await scanLibraries({roots:[path.dirname(f.archive)],cacheDir:path.join(f.root,'.cache/libraries')});f.args.plan=createLibraryPlan({graph:f.args.graph,catalog:f.args.catalog,requirements:[{id:'com.retk.consumer',version:'2.0.0'}]});assert.equal(f.args.plan.state,'ready',JSON.stringify(f.args.plan.issues));
 const result=await withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor:editorSuccess}));assert.equal(result.state,'imported');
 for(const [name,bytes]of Object.entries(f.payload))assert.equal(fs.readFileSync(path.join(result.stagingProject,'Packages/com.retk.fixture',name.slice('bundle/'.length)),'utf8'),bytes);
});
test('generated managed-package metadata is recorded only after original payload hashes pass',async t=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');const f=await setup(t);
 const result=await withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor:async config=>{
  const returned=await editorSuccess(config);fs.writeFileSync(path.join(config.projectDir,'Packages/com.retk.fixture/Runtime/Fixture.cs.meta'),'fileFormatVersion: 2\nguid: dddddddddddddddddddddddddddddddd\n');return returned;
 }}));
 const lock=JSON.parse(fs.readFileSync(path.join(result.stagingProject,'Packages/retk-libraries.lock.json')));assert.equal(lock.packages[0].files.length,4);assert(lock.packages[0].files.some(f=>f.path==='Runtime/Fixture.cs.meta'));
});
test('Editor mutations of the fixed request or helper are rejected',async t=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');
 for(const mode of ['request','helper']){
  const f=await setup(t);
  await assert.rejects(withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor:async config=>{
   const returned=await editorSuccess(config),file=mode==='request'?config.requestFile:path.join(config.projectDir,'Assets/REToolkitLibraryImport/Editor/REToolkitLibraryImport.cs');fs.appendFileSync(file,' ');return returned;
  }})),{code:'library_import_stale'});
 }
});
test('an inner unitypackage is blocked even inside an otherwise recognized package',async t=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');const f=await setup(t,'upm',{'bundle/unsupported.unitypackage':'uninspected inner tar'});assert.equal(f.plan.state,'ready');
 await assert.rejects(withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor:()=>assert.fail('must not launch inner unitypackage')})),{code:'library_import_unsupported'});
 assert.equal(fs.existsSync(path.join(f.toolkit.workspace('Game'),'04_Notes/assets/library-imports',f.plan.operationId,'project')),false);
});
test('source project local package dependencies are rejected before Editor launch',async t=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');const f=await setup(t);
 fs.mkdirSync(path.join(f.projectDir,'Packages'));fs.writeFileSync(path.join(f.projectDir,'Packages/manifest.json'),JSON.stringify({dependencies:{'com.private.source':'file:../../private'}}));
 const {createLibraryPlan}=await import('../src/libraries/resolver.js');f.args.graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding});f.args.plan=createLibraryPlan({graph:f.args.graph,catalog:f.catalog,requirements:[{id:'com.retk.fixture',version:'1.2.3'}]});
 await assert.rejects(withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor:()=>assert.fail('must not launch local dependency')})),{code:'unity_package_unsupported'});
});
test('the managed lock must remain a regular staging file after the Editor closes',async t=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');const f=await setup(t);
 await assert.rejects(withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor:async config=>{
  const result=await editorSuccess(config),lock=path.join(config.projectDir,'Packages/retk-libraries.lock.json');fs.unlinkSync(lock);fs.mkdirSync(lock);return result;
 }})),{code:'library_import_stale'});
});
test('import observation rejects unknown report and diagnostic fields',async t=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');
 for(const mode of ['report','diagnostic']){
  const f=await setup(t);const receipt=await withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor:async config=>{
   const returned=await editorSuccess(config),report=JSON.parse(fs.readFileSync(config.reportFile));if(mode==='report')report.extra='unknown';else report.diagnostics=[{severity:'info',message:'bounded',extra:'unknown'}];fs.writeFileSync(config.reportFile,JSON.stringify(report));return returned;
  }}));assert.equal(receipt.state,'import_failed');
 }
});
test('Unity may append only its matching Editor build revision to staged ProjectVersion.txt',async t=>{
 const {importLibraryPlan}=await import('../src/libraries/importer.js');
 for(const mode of ['valid','changed-version','extra-content']){
  const f=await setup(t),source=fs.readFileSync(path.join(f.projectDir,'ProjectSettings/ProjectVersion.txt'),'utf8');
  const runEditor=async config=>{const result=await editorSuccess(config);fs.writeFileSync(path.join(config.projectDir,'ProjectSettings/ProjectVersion.txt'),mode==='changed-version'?'m_EditorVersion: 2022.3.2f1\n':source+'m_EditorVersionWithRevision: 2022.3.1f1 (7670c08855a9)\n'+(mode==='extra-content'?'unexpected: value\n':''));return result;};
  if(mode==='valid'){
   const receipt=await withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor}));assert.equal(receipt.state,'imported');assert.equal(receipt.normalizations[0].path,'ProjectSettings/ProjectVersion.txt');assert.equal(receipt.normalizations[0].reason,'unity-editor-version-revision');
  }else await assert.rejects(withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor})),{code:'library_import_stale'});
  assert.equal(fs.readFileSync(path.join(f.projectDir,'ProjectSettings/ProjectVersion.txt'),'utf8'),source);
 }
});

test('SQLite source graphs import and verify libraries using explicit source-facts staging snapshots',async t=>{const {importLibraryPlan,verifyLibraryImport}=await import('../src/libraries/importer.js'),f=await setup(t,'upm',{},'sqlite');const receipt=await withWorkspaceLock(f.toolkit.workspace('Game'),()=>importLibraryPlan(f.args,{editor:f.editor,runEditor:editorSuccess}));assert.equal(receipt.state,'imported');const result=await withWorkspaceLock(f.toolkit.workspace('Game'),()=>verifyLibraryImport(f.args,{validateEditor:async args=>{assert.equal(args.graph.kind,'retoolkit-unity-source-facts');assert.equal(args.graph.nodes,undefined);assert.equal(args.graph.coverage.serializedReferences,'unverified');return {state:'validated',compileReady:true,bindingsVerified:true};}}));assert.equal(result.compileReady,true);assert.equal(result.bindingsVerified,true);for(const file of f.graph.files)assert.equal(fileIdentity(path.join(f.projectDir,file.path)).sha256,file.sha256);});
