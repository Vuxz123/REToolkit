import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assetTools} from '../src/assets/mcp.js';
import {validateAssetParams} from '../src/assets/api.js';
import {buildDesktopCommand} from '../src/desktop/operations.js';
import {buildResultModel} from '../src/desktop/result-model.js';
import {createToolkit} from '../src/toolkit.js';
import {fixture} from './reconstruction-fixture.js';
import {publicRun} from '../src/workflow/store.js';

test('workflow has bounded typed MCP tools and desktop entrypoints',()=>{
 for(const name of ['workflow_create','workflow_status','workflow_claim','workflow_checkpoint','workflow_wait','workflow_next','workflow_pause','workflow_cancel'])assert(assetTools.some(t=>t.name===name));
 assert.throws(()=>validateAssetParams('workflow.create',{goal:'x',authorizedOperations:['shell'],steps:[]}));
 const runId=randomUUID();assert.deepEqual(buildDesktopCommand('workflow.status',{name:'Game',runId}),['workflow','status','Game','--run',runId]);
 assert.deepEqual(buildDesktopCommand('workflow.create',{name:'Game',request:'goal.json'}),['workflow','create','Game','--params-file','goal.json']);
});
test('actual CLI preserves the workflow goal across processes and rejects completion injection',async t=>{
 const f=await fixture(t),toolkit=createToolkit(f.root,{log:()=>{}});await toolkit.init('Game');const workspace=toolkit.workspace('Game'),input=path.join(workspace,'01_Extracted');
 fs.writeFileSync(path.join(input,'libil2cpp.so'),'native');fs.writeFileSync(path.join(input,'global-metadata.dat'),'metadata');await toolkit.scan('Game',input);fs.cpSync(f.projectDir,path.join(workspace,'05_ReconstructedSource'),{recursive:true});
 const cli=fileURLToPath(new URL('../re.js',import.meta.url)),invoke=args=>spawnSync(process.execPath,[cli,...args,'--root',f.root,'--json'],{encoding:'utf8',windowsHide:true,timeout:15000});
 const payload={goal:'Playable loop',authorizedOperations:['reconstruct.apply'],steps:[{id:'play',label:'Play one round',dimension:'gameplay',dependsOn:[],scenario:{entry:'menu',actions:['start'],expected:'interactive board'}}]};
 const params=path.join(f.root,'goal.json');fs.writeFileSync(params,JSON.stringify(payload));
 const created=invoke(['workflow','create','Game','--params-file',params]);assert.equal(created.status,0,created.stderr);const run=JSON.parse(created.stdout);assert.equal(run.complete,false);
 const status=invoke(['workflow','status','Game','--run',run.runId]);assert.equal(status.status,0,status.stderr);assert.equal(JSON.parse(status.stdout).goal,payload.goal);
 const invalid=invoke(['workflow','checkpoint','Game','--params','{"complete":true}']);assert.equal(invalid.status,1);assert.match(invalid.stderr,/error/);
});
test('GUI exposes unfinished task and measured phase costs as readable sections',()=>{
 const result={kind:'retoolkit-reconstruction-run',state:'waiting-agent',goal:'Playable loop',complete:false,steps:[{id:'play',state:'todo'}],continuation:{state:'queued',agentResumed:false},phaseMetrics:[{phase:'input.verify',calls:2,elapsedMs:12,bytes:1024}]};
 const model=buildResultModel({operation:'workflow.status',state:'succeeded',result});
 assert(model.sections.some(s=>s.title==='Tiến trình tái dựng gameplay'));assert(model.sections.some(s=>s.title==='Thời gian từng pha'));
 assert.notEqual(model.status.tone,'good');
});
test('workflow status keeps large internal file proofs behind receipt references',()=>{
 const proof={verified:true,jobId:randomUUID(),operationId:randomUUID(),reference:'reconstruction/journal/receipt.json',files:Array.from({length:16},()=>({path:'Assets/'+'x'.repeat(2000)+'.cs',sha256:'a'.repeat(64),size:1}))};
 const value=publicRun({state:'active',controller:null,steps:Array.from({length:256},(_,i)=>({id:'step'+i,label:'step',state:'verified',sourcePaths:['Assets/Player.cs'],evidence:proof,staleEvidence:proof}))});
 assert(Buffer.byteLength(JSON.stringify(value))<2*1024**2);assert.equal(value.steps.length,256);assert.equal(value.steps[0].evidence.operationId,proof.operationId);assert.equal(value.steps[0].evidence.files,undefined);assert.equal(value.steps[0].evidence.filesCount,16);
});
