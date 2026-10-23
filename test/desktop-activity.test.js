import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createDesktopActivityReader} from '../src/desktop/activity.js';

const id='11111111-1111-4111-8111-111111111111';
const otherId='22222222-2222-4222-8222-222222222222';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-desktop-activity-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const workspace=path.join(root,'workspaces/Game');fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(path.join(workspace,'project.re.json'),'{}');
 const toolkit={workspace:name=>path.join(root,'workspaces',name)};
 const write=(relative,value)=>{const file=path.join(workspace,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value));return file;};
 const job=(jobId=id,extra={})=>{const record={kind:'retoolkit-job',schemaVersion:1,jobId,workspace,operation:'workspace.prepare',state:'running',stage:'engine.running',pid:123,createdAt:'2026-10-23T00:00:00.000Z',updatedAt:'2026-10-23T00:01:00.000Z',...extra};write(`04_Notes/jobs/${jobId}/record.json`,record);return record;};
 return {root,workspace,toolkit,write,job};
}

test('project activity reads bounded durable summaries and retains exact source provenance',async t=>{
 const f=fixture(t);f.job();f.job(otherId,{workspace:path.join(f.root,'workspaces/Other')});
 const ghidraActivity=()=>({state:'observed',workspaceBusy:false,lock:{ownerPid:null},tasks:[{id,source:'mcp',operation:'workspace.prepare',state:'running'},{id:otherId,source:'workspace',operation:'workspace.analyze',state:'running'}]});
 const reader=createDesktopActivityReader(f.root,{toolkit:f.toolkit,ghidraActivity,isAlive:()=>false});
 const snapshot=await reader.inspect('Game');
 assert.equal(snapshot.jobs.length,2);assert.equal(snapshot.jobs[0].key,`durable:${id}`);assert.equal(snapshot.jobs[0].state,'unknown');
 assert.equal(snapshot.jobs[1].key,`ghidra:${otherId}`);assert.equal(snapshot.jobs[1].observationSource,'workspace');assert.equal(snapshot.lock.state,'available');
 assert.ok(snapshot.warnings.some(w=>w.code==='activity_record_unavailable'));
 await assert.rejects(reader.inspect('../Game'));await assert.rejects(reader.inspect('Other'));
});

test('session observations expose launch and process evidence without context, environment or connectivity claims',async t=>{
 const f=fixture(t);f.write(`04_Notes/agent-sessions/${id}/launch.json`,{harness:'codex',env:{SECRET:'PRIVATE_SENTINEL'},args:['PRIVATE_SENTINEL'],prompt:'PRIVATE_SENTINEL'});
 f.write(`04_Notes/agent-sessions/${id}/launch-status.json`,{state:'terminal-opened',pid:9,createdAt:'2026-10-23T00:00:00Z'});
 f.write(`04_Notes/agent-sessions/${id}/terminal-status.json`,{state:'running',pid:123,at:'2026-10-23T00:00:01Z'});
 const reader=createDesktopActivityReader(f.root,{toolkit:f.toolkit,isAlive:()=>false});
 const result=await reader.inspect('Game'),session=result.sessions[0];
 assert.equal(session.state,'unknown');assert.equal(session.launchState,'terminal-opened');assert.equal(session.terminalState,'running');assert.equal(session.harness,'codex');
 assert.equal(session.mcpState,'unverified');assert.equal(session.resumed,false);assert.equal(session.ownerAlive,false);assert.ok(!JSON.stringify(result).includes('PRIVATE_SENTINEL'));
 f.write(`04_Notes/agent-sessions/${id}/terminal-status.json`,{state:'exited',exitCode:0,at:'2026-10-23T00:00:02Z'});
 assert.equal((await reader.inspect('Game')).sessions[0].state,'exited');
});

test('activity rejects linked and oversized artifacts and reports bounded enumeration',async t=>{
 const f=fixture(t),record=f.job();const file=path.join(f.workspace,`04_Notes/jobs/${id}/record.json`);
 fs.linkSync(file,path.join(f.root,'linked-record.json'));
 f.write(`04_Notes/agent-sessions/${id}/launch-status.json`,{state:'failed',message:'x'.repeat(70000)});
 for(let i=0;i<140;i++)fs.mkdirSync(path.join(f.workspace,'04_Notes/jobs',`invalid-${i}`));
 const reader=createDesktopActivityReader(f.root,{toolkit:f.toolkit}),result=await reader.inspect('Game');
 assert.equal(result.jobs.length,0);assert.ok(result.warnings.some(w=>w.code==='activity_jobs_truncated'));assert.ok(result.warnings.some(w=>w.code==='activity_record_unavailable'));assert.ok(result.warnings.some(w=>w.code==='activity_session_unavailable'));assert.ok(Buffer.byteLength(JSON.stringify(result))<32768);
 await assert.rejects(reader.detail('Game',{source:'durable',id}),/artifact|record|linked/i);
});

test('detail uses exact attested job identity and bounds result data',async t=>{
 const f=fixture(t),value={state:'partial',privateInventory:'x'.repeat(20000)},bytes=Buffer.from(JSON.stringify(value));
 f.write(`04_Notes/jobs/${id}/result.json`,value);f.job(id,{state:'succeeded',completedAt:'2026-10-23T00:02:00Z',resultReference:{path:`04_Notes/jobs/${id}/result.json`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});
 const reader=createDesktopActivityReader(f.root,{toolkit:f.toolkit});const result=await reader.detail('Game',{source:'durable',id});
 assert.equal(result.id,id);assert.equal(result.payload.name,'Game');assert.equal(result.state,'succeeded');assert.ok(Buffer.byteLength(JSON.stringify(result))<=32768);assert.equal(result.result.truncated,true);
 await assert.rejects(reader.detail('Game',{source:'durable',id:'../secret'}));await assert.rejects(reader.detail('Game',{source:'desktop',id}));await assert.rejects(reader.detail('Game',{source:'durable',id:otherId}));
});

test('detail refuses a large result replaced with a linked artifact between stat and open',async t=>{
 const f=fixture(t),value={text:'x'.repeat(300000)},bytes=Buffer.from(JSON.stringify(value));
 const file=f.write(`04_Notes/jobs/${id}/result.json`,value),outside=path.join(f.root,'outside-result.json');fs.writeFileSync(outside,bytes);
 f.job(id,{state:'succeeded',resultReference:{path:`04_Notes/jobs/${id}/result.json`,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});
 const original=fs.openSync;let swapped=false;
 fs.openSync=function(target,...args){if(target===file&&!swapped){swapped=true;fs.unlinkSync(file);fs.linkSync(outside,file);}return original.call(this,target,...args);};
 try{await assert.rejects(createDesktopActivityReader(f.root,{toolkit:f.toolkit}).detail('Game',{source:'durable',id}),/linked|changed|artifact/i);}finally{fs.openSync=original;}
 assert.equal(swapped,true);
});

test('nested progress data is projected to public evidence fields only',async t=>{
 const f=fixture(t);f.job(id,{preparationProgress:{runId:id,state:'running',stage:'analyze',updatedAt:'2026-10-23T00:01:00Z',env:{secret:'PRIVATE_PROGRESS_SENTINEL'}},wakeProgress:{jobId:otherId,threadId:id,state:'notification_queued',transportReady:true,prompt:'PRIVATE_PROGRESS_SENTINEL'},validationProgress:{operationId:id,requestedAssets:10,completedAssets:2,pendingAssets:8,config:'PRIVATE_PROGRESS_SENTINEL'}});
 const result=await createDesktopActivityReader(f.root,{toolkit:f.toolkit,isAlive:()=>true}).inspect('Game');
 assert.equal(result.jobs[0].preparationProgress.runId,id);assert.equal(result.jobs[0].validationProgress.completedAssets,2);assert.equal(result.jobs[0].wakeProgress.state,'notification_queued');assert.ok(!JSON.stringify(result).includes('PRIVATE_PROGRESS_SENTINEL'));
});

test('directory junctions and linked session status never cross the selected workspace boundary',async t=>{
 const f=fixture(t),outside=path.join(f.root,'private');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'launch-status.json'),JSON.stringify({state:'failed',message:'JUNCTION_PRIVATE_SENTINEL'}));
 const sessions=path.join(f.workspace,'04_Notes/agent-sessions');fs.mkdirSync(sessions,{recursive:true});fs.symlinkSync(outside,path.join(sessions,id),process.platform==='win32'?'junction':'dir');
 fs.mkdirSync(path.join(sessions,otherId));fs.linkSync(path.join(outside,'launch-status.json'),path.join(sessions,otherId,'launch-status.json'));
 const reader=createDesktopActivityReader(f.root,{toolkit:f.toolkit}),result=await reader.inspect('Game');
 assert.equal(result.sessions.length,0);assert.ok(result.warnings.some(w=>w.code==='activity_session_unavailable'));assert.ok(!JSON.stringify(result).includes('JUNCTION_PRIVATE_SENTINEL'));
 fs.mkdirSync(path.join(f.root,'workspaces/Other'));fs.writeFileSync(path.join(f.root,'workspaces/Other/project.re.json'),'{}');
 fs.symlinkSync(path.join(f.root,'workspaces/Other'),path.join(f.root,'workspaces/Linked'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(reader.inspect('Linked'),/Linked|linked/);
});

test('Ghidra details require the exact current observation and keep source provenance',async t=>{
 const f=fixture(t),task={id,operation:'workspace.analyze',source:'workspace',state:'running',ownerPid:123,log:{path:`04_Notes/analyze-${id}.log`,tail:'bounded diagnostic'}};
 const reader=createDesktopActivityReader(f.root,{toolkit:f.toolkit,isAlive:()=>false,ghidraActivity:()=>({tasks:[task]})});
 const result=await reader.detail('Game',{source:'ghidra',id});assert.equal(result.source,'ghidra');assert.equal(result.observationSource,'workspace');assert.equal(result.state,'unknown');assert.equal(result.diagnostics,'bounded diagnostic');
 await assert.rejects(reader.detail('Game',{source:'ghidra',id:otherId}),{code:'DESKTOP_ACTIVITY_MISSING'});
});

test('dead or failed wake workers cannot retain waiting transport readiness',async t=>{
 const f=fixture(t),wakeProgress={jobId:otherId,threadId:id,state:'waiting',transportReady:true};
 f.job(id,{operation:'agent.wake_after',wakeProgress});
 const reader=createDesktopActivityReader(f.root,{toolkit:f.toolkit,isAlive:()=>false});
 let job=(await reader.inspect('Game')).jobs[0];assert.equal(job.state,'unknown');assert.equal(job.wakeProgress.state,'unknown');assert.equal(job.wakeProgress.transportReady,false);assert.equal(job.wakeProgress.resumed,false);
 job=await reader.detail('Game',{source:'durable',id});assert.equal(job.wakeProgress.transportReady,false);assert.equal(job.wakeProgress.state,'unknown');
 f.job(id,{operation:'agent.wake_after',state:'failed',wakeProgress});
 job=(await reader.inspect('Game')).jobs[0];assert.equal(job.state,'failed');assert.equal(job.wakeProgress.state,'unknown');assert.equal(job.wakeProgress.transportReady,false);
});

test('a live watcher and successful queued notification remain distinct from Agent resumption',async t=>{
 const f=fixture(t),wakeProgress={jobId:otherId,threadId:id,state:'waiting',transportReady:true};
 f.job(id,{operation:'agent.wake_after',wakeProgress});
 const live=(await createDesktopActivityReader(f.root,{toolkit:f.toolkit,isAlive:()=>true}).inspect('Game')).jobs[0];
 assert.equal(live.wakeProgress.state,'waiting');assert.equal(live.wakeProgress.transportReady,true);assert.equal(live.wakeProgress.resumed,false);
 for(const notification of ['queued','notification_queued']){
  f.job(id,{operation:'agent.wake_after',state:'succeeded',wakeProgress:{...wakeProgress,state:notification},resultReference:{path:`04_Notes/jobs/${id}/result.json`,bytes:2,sha256:'a'.repeat(64)}});
  const completed=(await createDesktopActivityReader(f.root,{toolkit:f.toolkit,isAlive:()=>false}).inspect('Game')).jobs[0];
  assert.equal(completed.state,'succeeded');assert.equal(completed.wakeProgress.state,notification);assert.equal(completed.wakeProgress.transportReady,false);assert.equal(completed.wakeProgress.resumed,false);
 }
});
