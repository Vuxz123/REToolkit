import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {createDesktopBroker} from '../src/desktop/jobs.js';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-desktop-history-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let child;const spawnImpl=()=>{child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;};return {root,spawnImpl,get child(){return child;}};}
test('desktop restart recovers completed history without replay and marks interrupted jobs unknown',t=>{
 const f=fixture(t),broker=createDesktopBroker(f.root,{spawnImpl:f.spawnImpl});
 const first=broker.submit('workspace.status',{name:'Game'});f.child.stdout.emit('data',Buffer.from('{"name":"Game","state":"partial"}'));f.child.emit('close',0);
 const running=broker.submit('workspace.status',{name:'Game'}),queued=broker.submit('workspace.status',{name:'Other'});
 let spawns=0;const reopened=createDesktopBroker(f.root,{spawnImpl:()=>{spawns++;throw Error('No replay');}}),snapshot=reopened.snapshot();
 assert.equal(spawns,0);assert.equal(snapshot.jobs.find(j=>j.id===first.id).state,'succeeded');assert.equal(snapshot.jobs.find(j=>j.id===first.id).result.name,'Game');
 for(const jobId of [running.id,queued.id]){const job=snapshot.jobs.find(j=>j.id===jobId);assert.equal(job.state,'unknown');assert.equal(job.error.code,'DESKTOP_INTERRUPTED');}
 assert.equal(reopened.canQuit(),true);assert.equal(snapshot.history.state,'available');
});
test('missing, corrupt and linked history report explicit limits without claiming success',t=>{
 const f=fixture(t),broker=createDesktopBroker(f.root,{spawnImpl:f.spawnImpl});assert.equal(broker.snapshot().history.state,'missing');
 broker.submit('doctor');f.child.emit('close',0);const file=path.join(f.root,'.cache/desktop-jobs/history.json');assert.ok(fs.statSync(file).size<1024*1024);
 fs.writeFileSync(file,'{broken');const corrupt=createDesktopBroker(f.root,{spawnImpl:f.spawnImpl});assert.equal(corrupt.snapshot().history.state,'unavailable');assert.equal(corrupt.snapshot().jobs.length,0);assert.ok(corrupt.snapshot().history.warnings.length);
 corrupt.submit('doctor');f.child.emit('close',0);assert.equal(fs.readFileSync(file,'utf8'),'{broken');
 fs.unlinkSync(file);fs.writeFileSync(file,'{"kind":"retoolkit-desktop-history","schemaVersion":1,"jobs":[]}');fs.linkSync(file,path.join(f.root,'linked.json'));
 assert.equal(createDesktopBroker(f.root).snapshot().history.state,'unavailable');
});
test('history false retains the original short queue without creating history files',t=>{
 const f=fixture(t),broker=createDesktopBroker(f.root,{history:false,spawnImpl:f.spawnImpl});for(let i=0;i<35;i++){broker.submit('doctor');f.child.emit('close',0);}
 assert.equal(broker.snapshot().jobs.length,30);assert.equal(broker.snapshot().history.state,'disabled');assert.equal(fs.existsSync(path.join(f.root,'.cache/desktop-jobs/history.json')),false);
});
test('live diagnostics remain observable without rewriting the journal for every output chunk',t=>{
 const f=fixture(t),updates=[],broker=createDesktopBroker(f.root,{spawnImpl:f.spawnImpl,onChange:job=>updates.push(job)});broker.submit('doctor');
 const file=path.join(f.root,'.cache/desktop-jobs/history.json'),before=fs.readFileSync(file,'utf8');
 f.child.stderr.emit('data',Buffer.from('a live diagnostic'));
 assert.equal(updates.at(-1).progress,'a live diagnostic');assert.equal(broker.snapshot().jobs[0].progress,'a live diagnostic');assert.equal(fs.readFileSync(file,'utf8'),before);
 f.child.emit('close',0);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).jobs[0].state,'succeeded');
});
test('oversized or conflicting history identities are rejected before any worker can run',t=>{
 const f=fixture(t),directory=path.join(f.root,'.cache/desktop-jobs');fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'history.json');
 fs.writeFileSync(file,'x'.repeat(1024*1024+1));assert.equal(createDesktopBroker(f.root).snapshot().history.state,'unavailable');
 const job={id:'11111111-1111-4111-8111-111111111111',operation:'doctor',state:'queued',payload:{},createdAt:new Date().toISOString()};
 fs.writeFileSync(file,JSON.stringify({kind:'retoolkit-desktop-history',schemaVersion:1,jobs:[job,job]}));let spawned=false;
 const broker=createDesktopBroker(f.root,{spawnImpl:()=>{spawned=true;throw Error('No replay');}});assert.equal(broker.snapshot().history.state,'unavailable');assert.equal(broker.snapshot().jobs.length,0);assert.equal(spawned,false);
});
