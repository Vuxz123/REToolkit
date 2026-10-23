import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {buildDesktopCommand,desktopOperations,validateDesktopSender} from '../src/desktop/operations.js';
import {createDesktopBroker} from '../src/desktop/jobs.js';
import {parseDesktopArgs,desktopLaunchSpec} from '../src/desktop/cli.js';
import {EventEmitter} from 'node:events';

test('desktop library trial requirements remain explicit file arguments',()=>{
 assert.deepEqual(buildDesktopCommand('libraries.plan',{name:'Game',requirements:'D:/Requests/trial.json'}),['libraries','plan','Game','--requirements','D:/Requests/trial.json']);
 assert.throws(()=>buildDesktopCommand('libraries.import',{name:'Game',operation:'11111111-1111-4111-8111-111111111111',requirements:'D:/Requests/trial.json'}));
});

test('desktop snapshot identifies the configured candidate without asserting it exists',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-candidate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const workspace=path.join(root,'workspaces/Game');fs.mkdirSync(workspace,{recursive:true});
 fs.writeFileSync(path.join(workspace,'project.re.json'),JSON.stringify({name:'Game',reconstructedSourceDir:'C:/candidate/not-yet-exported'}));
 let project=createDesktopBroker(root).snapshot().workspaces[0];assert.equal(project.candidatePath,'C:/candidate/not-yet-exported');assert.equal(project.steps.assetripper,undefined);
 fs.writeFileSync(path.join(workspace,'project.re.json'),'{}');project=createDesktopBroker(root).snapshot().workspaces[0];assert.equal(project.candidatePath,path.join(workspace,'05_ReconstructedSource'));
});
test('workspace semantic previews stay bounded with long Unicode candidates and disclose omissions',async()=>{
 const {workspaceResultPreview}=await import('../src/desktop/workspace-preview.js');
 const path='lib/'+ '漢'.repeat(100)+'/libil2cpp.so',result={name:'Game',schemaVersion:2,steps:{extract:{state:'succeeded',outputs:[{files:['should not be copied']}]}},inputSelection:{state:'needs-selection',revision:'b'.repeat(64),source:{path:'C:/owned/Game/01_Extracted',location:'canonical'},binaries:Array.from({length:512},()=>({path,abi:'arm64-v8a'})),metadata:Array.from({length:512},()=>({path:'assets/'+ '漢'.repeat(100)+'/global-metadata.dat'})),selection:{},canSelect:true}};
 const preview=workspaceResultPreview({operation:'workspace.add',result});assert.ok(Buffer.byteLength(JSON.stringify(preview))<=8192);assert.equal(preview.inputSelection.binariesCount,512);assert.equal(preview.inputSelection.metadataCount,512);assert.equal(preview.inputSelection.omittedBinaries,512-preview.inputSelection.binaries.length);assert.equal(preview.inputSelection.omittedMetadata,512-preview.inputSelection.metadata.length);assert.ok(preview.inputSelection.binaries.every(item=>item.path===path));assert.equal(preview.steps.extract.outputs,undefined);assert.equal(workspaceResultPreview({operation:'assets.get',result}),null);
});
test('large workspace imports retain semantic status and ABI choices without file inventories',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-preview-inputs-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let child;
 const broker=createDesktopBroker(root,{spawnImpl:()=>{child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;}});
 for(const operation of ['workspace.add','workspace.status','project.inputs.select','project.inputs.recover']){
  const payload=operation==='workspace.add'?{name:'Game',input:'fixture.apk'}:operation==='project.inputs.select'?{name:'Game',binary:'lib/arm64-v8a/libil2cpp.so',metadata:'global-metadata.dat',revision:'a'.repeat(64)}:operation==='project.inputs.recover'?{name:'Game',revision:'a'.repeat(64)}:{name:'Game'};
  broker.submit(operation,payload);
  child.stdout.emit('data',Buffer.from(JSON.stringify({schemaVersion:2,name:'Game',platform:null,extractedPath:'C:/owned/Game/01_Extracted',nativeBinary:null,metadata:null,steps:{extract:{state:'succeeded',outputs:[{files:Array.from({length:3000},(_,i)=>({path:'file-'+i,sha256:'a'.repeat(64)}))}]},scan:{state:'awaiting-user',outputs:[]},dump:{state:'stale',outputs:[]}},inputSelection:{kind:'retoolkit-input-selection',schemaVersion:1,name:'Game',state:'needs-selection',source:{path:'C:/owned/Game/01_Extracted',location:'canonical'},revision:'b'.repeat(64),binaries:[{path:'lib/arm64-v8a/libil2cpp.so',abi:'arm64-v8a'},{path:'lib/armeabi-v7a/libil2cpp.so',abi:'armeabi-v7a'}],metadata:[{path:'assets/global-metadata.dat'}],selection:{},canSelect:true,canRecover:false}})));
  child.emit('close',0);const job=broker.snapshot().jobs.at(-1);
  assert.equal(job.state,'succeeded');assert.ok(job.storedResult);assert.equal(job.result.name,'Game',operation);assert.equal(job.result.steps.extract.state,'succeeded');assert.equal(job.result.steps.scan.state,'awaiting-user');assert.equal(job.result.steps.extract.outputs,undefined);assert.equal(job.result.inputSelection.state,'needs-selection');assert.deepEqual(job.result.inputSelection.binaries.map(x=>x.abi),['arm64-v8a','armeabi-v7a']);assert.equal(job.result.inputSelection.metadata.length,1);assert.equal(job.result.inputSelection.revision,'b'.repeat(64));assert.ok(job.result.nextSteps.length);assert.ok(Buffer.byteLength(JSON.stringify(job))<=16384);
 }
});
test('large project intake results retain project identity and input gap in preview',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-intake-preview-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let child;const broker=createDesktopBroker(root,{spawnImpl:()=>{child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;}});
 broker.submit('project.create',{name:'NewFixture',input:'fixture.apk'});child.stdout.emit('data',Buffer.from(JSON.stringify({kind:'retoolkit-project-intake',schemaVersion:1,name:'NewFixture',state:'needs-input',receipt:'fixture-receipt.json',issue:{code:'input_selection_required',message:'x'.repeat(20000)}})));child.emit('close',0);
 const job=broker.snapshot().jobs.at(-1);assert.equal(job.result.name,'NewFixture');assert.equal(job.result.state,'needs-input');assert.equal(job.result.receipt,'fixture-receipt.json');
});
test('large capture previews retain partial data coverage without exposing payload inventories',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-capture-preview-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let child,finish;
 const completed=new Promise(resolve=>finish=resolve),broker=createDesktopBroker(root,{spawnImpl:()=>{child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;},onChange:job=>{if(job.state==='succeeded')finish(job);}});
 broker.submit('adb.capture',{name:'Game',packageName:'com.example.game',serial:'emulator-5554'});
 child.stdout.emit('data',Buffer.from(JSON.stringify({kind:'retoolkit-adb-result',state:'partial',capture:{bundle:'C:/owned/package.xapk',applicationData:{coverage:'partial',files:2,bundle:'C:/owned/data.zip',scopes:[{id:'private',state:'denied',access:'none',files:0}]}},project:{inventory:'x'.repeat(20000)}})));child.emit('close',0);
 const job=await completed;assert.equal(job.result.state,'partial');assert.equal(job.result.capture.applicationData.coverage,'partial');assert.equal(job.result.capture.applicationData.scopes[0].state,'denied');assert.equal(job.result.project,undefined);assert.ok(Buffer.byteLength(JSON.stringify(job))<16384);
});

test('desktop copy accepts only bounded text and rejects non-text before clipboard access',async()=>{
 const {validateDesktopCopyText}=await import('../src/desktop/operations.js');assert.equal(typeof validateDesktopCopyText,'function');
 assert.equal(validateDesktopCopyText('fixture\nJSON'), 'fixture\nJSON');assert.equal(validateDesktopCopyText('a'.repeat(65536)).length,65536);
 for(const value of [null,{},[],123,'a\0b','a'.repeat(65537),'😀'.repeat(20000)])assert.throws(()=>validateDesktopCopyText(value),{code:'DESKTOP_REQUEST_INVALID'});
});

test('desktop IPC exposes fixed typed operations and rejects arbitrary flags, paths and channels',()=>{
 assert.deepEqual(buildDesktopCommand('workspace.add',{name:'Game',input:'D:/Builds/game.xapk'}),['add','Game','D:/Builds/game.xapk']);
 assert.deepEqual(buildDesktopCommand('assets.start',{name:'Game'}),['assets','session','start','Game']);
 assert.deepEqual(buildDesktopCommand('setup.install',{lock:'config/native-windows-x64.lock.json'}),['setup','install','--lock','config/native-windows-x64.lock.json']);
 assert.ok(desktopOperations.some(item=>item.id==='visual.compare'));
 for(const [op,payload]of [['shell',{command:'cmd.exe'}],['workspace.init',{name:'../escape'}],['workspace.dump',{name:'Game',args:['--root','outside']}],['workspace.add',{name:'Game',input:'--root'}],['jev.run',{request:'x',out:'y',apiKey:'secret'}]])assert.throws(()=>buildDesktopCommand(op,payload));
 assert.equal(validateDesktopSender({sender:7,senderFrame:{url:'retk://app/index.html',parent:null}},7),true);
 for(const frame of [{url:'https://elsewhere/',parent:null},{url:'retk://app/index.html',parent:{}},{url:'retk://app/other',parent:null}])assert.equal(validateDesktopSender({sender:7,senderFrame:frame},7),false);
 assert.equal(validateDesktopSender({sender:8,senderFrame:{url:'retk://app/index.html',parent:null}},7),false);
});

test('desktop retained history and IPC snapshots stay bounded after large results',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-desktop-cap-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let child;
 const broker=createDesktopBroker(root,{spawnImpl:()=>{child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;}});
 for(let i=0;i<100;i++){broker.submit('doctor');child.stdout.emit('data',Buffer.from(JSON.stringify({text:'large'.repeat(100000)})));child.emit('close',0);}
 const snapshot=broker.snapshot();assert.ok(Buffer.byteLength(JSON.stringify(snapshot))<1024**2);assert.ok(snapshot.jobs.length<=30);assert.ok(snapshot.jobs.every(j=>j.storedResult&&fs.existsSync(j.storedResult)));assert.equal(broker.canQuit(),true);
});

test('desktop only passes Jev credential namespace to explicit Jev send jobs',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-credential-preview-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const previous=process.env.JEV_DESKTOP_TEST_KEY;process.env.JEV_DESKTOP_TEST_KEY='synthetic-fixture-key';let child,received;
 try{const broker=createDesktopBroker(root,{spawnImpl:(_file,_args,options)=>{received=options.env;child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;}});broker.submit('doctor');assert.equal(received.JEV_DESKTOP_TEST_KEY,undefined);child.emit('close',0);broker.submit('jev.run',{request:'fixture.json',out:'new-result.json'});assert.equal(received.JEV_DESKTOP_TEST_KEY,'synthetic-fixture-key');child.emit('close',0);}finally{if(previous===undefined)delete process.env.JEV_DESKTOP_TEST_KEY;else process.env.JEV_DESKTOP_TEST_KEY=previous;}
});
test('desktop Jev send receives private Settings credentials without exposing them to other jobs',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-jev-private-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let received,child;
 const broker=createDesktopBroker(root,{jevEnvironment:()=>({...process.env,TYPESAFE_API_KEY:'private-settings-key'}),spawnImpl:(_file,_args,options)=>{received=options.env;child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;}});
 broker.submit('jev.run',{request:'fixture.json',out:'result.json'});assert.equal(received.TYPESAFE_API_KEY,'private-settings-key');child.emit('close',0);
 broker.submit('doctor');assert.equal(received.TYPESAFE_API_KEY,undefined);child.emit('close',0);assert(!JSON.stringify(broker.snapshot()).includes('private-settings-key'));
});
test('desktop launch parses only known flags and supplies original Node executable to Electron',()=>{
 assert.equal(parseDesktopArgs(['gui','--root','C:/Data']).root,'C:/Data');assert.throws(()=>parseDesktopArgs(['gui','--eval','anything']));
 const spec=desktopLaunchSpec('C:/Toolkit','C:/node.exe','C:/electron.exe');assert.equal(spec.file,'C:/electron.exe');assert.ok(spec.args.includes('C:/node.exe'));assert.equal(spec.env.ELECTRON_RUN_AS_NODE,undefined);
 assert.equal(spec.windowsHide,false,'An explicitly requested desktop must not inherit hidden background process startup');
});
test('desktop job broker runs actual Node CLI with leases/state shared with the CLI',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-desktop-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let done;const completed=new Promise(resolve=>done=resolve);const broker=createDesktopBroker(root,{onChange:job=>{if(['succeeded','failed','unverified'].includes(job.state))done(job);}});
 const job=broker.submit('workspace.init',{name:'OwnedFixture'});assert.equal(broker.canQuit(),false);const result=await completed;
 assert.equal(result.id,job.id);assert.equal(result.state,'succeeded');assert.equal(result.result.name,'OwnedFixture');assert.equal(broker.canQuit(),true);assert.equal(broker.snapshot().workspaces[0].name,'OwnedFixture');
 const before=broker.snapshot().jobs.length;assert.throws(()=>broker.submit('arbitrary.command',{}));assert.equal(broker.snapshot().jobs.length,before);
});
test('desktop snapshot treats corrupt projects as errors without hiding valid workspaces',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-desktop-snapshot-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const dir=path.join(root,'workspaces/Broken');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'project.re.json'),'{invalid');
 const snapshot=createDesktopBroker(root).snapshot();assert.equal(snapshot.workspaces[0].name,'Broken');assert.equal(snapshot.workspaces[0].state,'invalid');
});

test('desktop broker decodes split UTF-8 and bounds diagnostics by bytes',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-utf8-preview-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let child;let complete;const completed=new Promise(resolve=>complete=resolve);
 const broker=createDesktopBroker(root, {spawnImpl:()=>{child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;},onChange:job=>{if(job.state==='succeeded')complete(job);}});
 broker.submit('doctor');const bytes=Buffer.from(JSON.stringify({message:'Tiếng Việt 😀'}));
 for(const byte of bytes)child.stdout.emit('data',Buffer.from([byte]));
 const diagnostics=Buffer.from('đ'.repeat(300000));for(let i=0;i<diagnostics.length;i+=1001)child.stderr.emit('data',diagnostics.subarray(i,i+1001));
 child.emit('close',0);const preview=await completed,job=preview.storedResult?JSON.parse(fs.readFileSync(preview.storedResult,'utf8')):preview;assert.equal(job.result.message,'Tiếng Việt 😀');assert.ok(Buffer.byteLength(job.diagnostics)<=512*1024);assert.ok(!job.diagnostics.includes('�'));
});
