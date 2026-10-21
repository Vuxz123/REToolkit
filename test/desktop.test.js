import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {buildDesktopCommand,desktopOperations,validateDesktopSender} from '../src/desktop/operations.js';
import {createDesktopBroker} from '../src/desktop/jobs.js';
import {parseDesktopArgs,desktopLaunchSpec} from '../src/desktop/cli.js';
import {EventEmitter} from 'node:events';

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

test('desktop only passes Jev credential namespace to explicit Jev send jobs',()=>{
 const previous=process.env.JEV_DESKTOP_TEST_KEY;process.env.JEV_DESKTOP_TEST_KEY='synthetic-fixture-key';let child,received;
 try{const broker=createDesktopBroker('.',{spawnImpl:(_file,_args,options)=>{received=options.env;child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;}});broker.submit('doctor');assert.equal(received.JEV_DESKTOP_TEST_KEY,undefined);child.emit('close',0);broker.submit('jev.run',{request:'fixture.json',out:'new-result.json'});assert.equal(received.JEV_DESKTOP_TEST_KEY,'synthetic-fixture-key');child.emit('close',0);}finally{if(previous===undefined)delete process.env.JEV_DESKTOP_TEST_KEY;else process.env.JEV_DESKTOP_TEST_KEY=previous;}
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

test('desktop broker decodes split UTF-8 and bounds diagnostics by bytes',async()=>{
 let child;let complete;const completed=new Promise(resolve=>complete=resolve);
 const broker=createDesktopBroker('.', {spawnImpl:()=>{child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;},onChange:job=>{if(job.state==='succeeded')complete(job);}});
 broker.submit('doctor');const bytes=Buffer.from(JSON.stringify({message:'Tiếng Việt 😀'}));
 for(const byte of bytes)child.stdout.emit('data',Buffer.from([byte]));
 const diagnostics=Buffer.from('đ'.repeat(300000));for(let i=0;i<diagnostics.length;i+=1001)child.stderr.emit('data',diagnostics.subarray(i,i+1001));
 child.emit('close',0);const preview=await completed,job=preview.storedResult?JSON.parse(fs.readFileSync(preview.storedResult,'utf8')):preview;assert.equal(job.result.message,'Tiếng Việt 😀');assert.ok(Buffer.byteLength(job.diagnostics)<=512*1024);assert.ok(!job.diagnostics.includes('�'));
});
