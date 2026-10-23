import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGhidraActivityReader} from '../src/desktop/ghidra-activity.js';
import {createDesktopBroker} from '../src/desktop/jobs.js';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-ghidra-monitor-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const workspace=path.join(root,'workspaces/Game');fs.mkdirSync(path.join(workspace,'04_Notes'),{recursive:true});
 const runId='11111111-1111-4111-8111-111111111111',now=Date.now();
 const project={steps:{analyze:{state:'running',runId,owner:{pid:123},startedAt:new Date(now-600000).toISOString()}}};
 fs.writeFileSync(path.join(workspace,'project.re.json'),JSON.stringify(project));
 return {root,workspace,project,runId,now,save:()=>fs.writeFileSync(path.join(workspace,'project.re.json'),JSON.stringify(project))};
}

test('read-only monitor discovers external analysis, owner and bounded tail without acquiring a lock',t=>{
 const f=fixture(t),lock=path.join(f.workspace,'.retk-lock');fs.mkdirSync(lock);
 fs.writeFileSync(path.join(lock,'owner-123-abc.json'),JSON.stringify({pid:123}));
 fs.writeFileSync(path.join(lock,'engine-124-abc.json'),JSON.stringify({phase:'running',owner:{pid:124},file:'analyzeHeadless.bat',args:['DO_NOT_FORWARD']}));
 const log=path.join(f.workspace,'04_Notes',`analyze-${f.runId}.log`);fs.writeFileSync(log,'x'.repeat(1024*1024)+'\nERROR Failed to disassemble (GccExceptionAnalyzer)\n');fs.utimesSync(log,new Date(f.now-400000),new Date(f.now-400000));
 const before=fs.readFileSync(path.join(f.workspace,'project.re.json'),'utf8'),result=createGhidraActivityReader(f.root,{isAlive:()=>true,now:()=>f.now})('Game');
 assert.equal(result.workspaceBusy,true);assert.equal(result.lock.ownerPid,123);assert.equal(result.lock.engines[0].pid,124);
 assert.equal(result.tasks[0].state,'running');assert.equal(result.tasks[0].elapsedSeconds,600);assert.equal(result.tasks[0].log.quiet,true);assert.equal(result.tasks[0].log.lastObservedAnalyzer,'GccExceptionAnalyzer');
 assert(Buffer.byteLength(result.tasks[0].log.tail)<=16384);assert(!JSON.stringify(result).includes('DO_NOT_FORWARD'));
 assert.equal(fs.readFileSync(path.join(f.workspace,'project.re.json'),'utf8'),before);assert.equal(fs.readdirSync(lock).length,2);
});

test('dead or unverifiable ownership stays unknown and final state is refreshed',t=>{
 const f=fixture(t),reader=createGhidraActivityReader(f.root,{isAlive:()=>false});assert.equal(reader('Game').tasks[0].state,'unknown');
 f.project.steps.analyze.state='succeeded';f.project.steps.analyze.completedAt=new Date().toISOString();f.save();
 assert.equal(reader('Game').tasks[0].state,'succeeded');assert.equal(fs.existsSync(path.join(f.workspace,'.retk-lock')),false);
});

test('saved MCP symbols jobs appear with bounded results and reject outside log references',t=>{
 const f=fixture(t),id='22222222-2222-4222-8222-222222222222',dir=path.join(f.workspace,'04_Notes/jobs',id);fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'record.json'),JSON.stringify({kind:'retoolkit-job',schemaVersion:1,workspace:f.workspace,jobId:id,operation:'ghidra.symbols.apply',state:'running',pid:321,stage:'engine.running',createdAt:new Date().toISOString(),logReference:'../../private.log',params:{secret:'DO_NOT_FORWARD'}}));
 const result=createGhidraActivityReader(f.root,{isAlive:()=>true})('Game'),job=result.tasks.find(task=>task.id===id);
 assert(job);assert.equal(job.source,'mcp');assert.equal(job.log,undefined);assert(!JSON.stringify(result).includes('DO_NOT_FORWARD'));
});

test('monitor rejects traversal, linked logs and malformed state without leaking file content',t=>{
 const f=fixture(t),reader=createGhidraActivityReader(f.root,{isAlive:()=>true});assert.throws(()=>reader('../Game'));
 const outside=path.join(f.root,'secret.log');fs.writeFileSync(outside,'SECRET_CONTENT');fs.linkSync(outside,path.join(f.workspace,'04_Notes',`analyze-${f.runId}.log`));
 assert.equal(reader('Game').tasks[0].log,undefined);assert(!JSON.stringify(reader('Game')).includes('SECRET_CONTENT'));
 fs.writeFileSync(path.join(f.workspace,'project.re.json'),'invalid');assert.equal(reader('Game').state,'unavailable');
});

test('large saved inventories do not hide the project or block its Ghidra monitor',t=>{
 const f=fixture(t);f.project.outputs='x'.repeat(3*1024**2);f.save();fs.writeFileSync(path.join(f.root,'package.json'),'{"version":"0.0.0"}');
 assert.equal(createGhidraActivityReader(f.root,{isAlive:()=>true})('Game').tasks[0]?.state,'running');
 assert.equal(createDesktopBroker(f.root).snapshot().workspaces[0].state,'available');
});

test('a project step and MCP job sharing the exact log appear only once',t=>{
 const f=fixture(t),id='44444444-4444-4444-8444-444444444444',dir=path.join(f.workspace,'04_Notes/jobs',id);fs.mkdirSync(dir,{recursive:true});
 const logReference=`04_Notes/analyze-${f.runId}.log`;fs.writeFileSync(path.join(f.workspace,logReference),'analyzing');
 fs.writeFileSync(path.join(dir,'record.json'),JSON.stringify({kind:'retoolkit-job',schemaVersion:1,workspace:f.workspace,jobId:id,operation:'workspace.analyze',state:'running',pid:123,logReference,createdAt:new Date(f.now).toISOString()}));
 const result=createGhidraActivityReader(f.root,{isAlive:()=>true})('Game');assert.equal(result.tasks.length,1);assert.equal(result.tasks[0].id,id);assert.equal(result.tasks[0].source,'mcp');
});
