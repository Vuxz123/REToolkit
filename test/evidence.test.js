import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createToolkit} from '../src/toolkit.js';
import {captureEvidence} from '../src/evidence.js';
import {publishJson} from '../src/artifacts.js';
async function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-evidence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Game');fs.mkdirSync(path.join(root,'input'));
 fs.writeFileSync(path.join(root,'input/GameAssembly.dll'),'MZowned');fs.writeFileSync(path.join(root,'input/global-metadata.dat'),'owned metadata');await toolkit.scan('Game',path.join(root,'input'));return toolkit;}
function observed(toolkit){const project=toolkit.read('Game');return {ok:true,runId:'11111111-1111-4111-8111-111111111111',revision:1,
 programIdentity:{program:project.ghidraProgramName,sha256:project.identities.native.sha256,projectName:'Game',imageBase:'ram:0x1000'},
 result:{address:'ram:0xffffffffffffffff',items:[{line:1,text:'untrusted target content'}],nextCursor:Buffer.from(JSON.stringify({runId:'11111111-1111-4111-8111-111111111111',method:'functions.decompile',revision:1,offset:1,binding:{selector:'Method'}})).toString('base64url')},limitations:['Observed loaded Program']};}
test('capture binds observed result and exports outside the workspace without touching project state',async t=>{
 const toolkit=await fixture(t);const before=fs.readFileSync(toolkit.projectPath('Game'));let calls=0;
 const result=await captureEvidence(toolkit,'Game',{kind:'decompile',selector:'Method',limit:1},{query:async(_tk,name,method,params)=>{
   calls++;assert.equal(name,'Game');assert.equal(method,'functions.decompile');assert.equal(params.selector,'Method');return observed(toolkit);}});
 assert.equal(calls,1);assert.ok(!result.path.startsWith(toolkit.workspace('Game')));assert.deepEqual(fs.readFileSync(toolkit.projectPath('Game')),before);
 const evidence=JSON.parse(fs.readFileSync(result.path));assert.equal(evidence.kind,'retoolkit-evidence');assert.equal(evidence.schemaVersion,1);
 assert.equal(evidence.coverage.state,'partial');assert.equal(evidence.result.address,'ram:0xffffffffffffffff');
 assert.equal(evidence.build.metadata.sha256,toolkit.read('Game').identities.metadata.sha256);assert.equal(evidence.dataTrust,'untrusted-target-content');
 assert.ok(!JSON.stringify(evidence.build).includes(toolkit.root));
});
test('capture rejects forged binding, changed input, in-workspace output and missing session without auto-start',async t=>{
 const toolkit=await fixture(t);let calls=0;const query=async()=>{calls++;return observed(toolkit);};
 await assert.rejects(captureEvidence(toolkit,'Game',{kind:'xrefs',selector:'0x1',out:toolkit.workspace('Game')},{query}),/workspace/);
 assert.equal(calls,0);
 await assert.rejects(captureEvidence(toolkit,'Game',{kind:'decompile',selector:'Name'},{query:async()=>({...observed(toolkit),programIdentity:{program:'Wrong',sha256:'a'.repeat(64)}})}),error=>error.code==='program_mismatch');
 await assert.rejects(captureEvidence(toolkit,'Game',{kind:'functions'}),error=>error.code==='session_not_running');
 await assert.rejects(captureEvidence(toolkit,'Game',{kind:'decompile',selector:'Name'},{query:async()=>{const reply=observed(toolkit);fs.appendFileSync(toolkit.read('Game').metadata,'changed');return reply;}}),error=>error.code==='input_changed');
});
test('JSON publication never clobbers an existing artifact and rejects output junctions',async t=>{
 const toolkit=await fixture(t);const file=path.join(toolkit.root,'artifact.json');publishJson(file,{one:1});
 assert.throws(()=>publishJson(file,{two:2}),error=>error.code==='output_exists');assert.deepEqual(JSON.parse(fs.readFileSync(file)),{one:1});
 fs.symlinkSync(toolkit.workspace('Game'),path.join(toolkit.root,'linked-output'),'junction');
 await assert.rejects(captureEvidence(toolkit,'Game',{kind:'functions',out:path.join(toolkit.root,'linked-output')},{query:async()=>observed(toolkit)}),/link|junction|workspace/);
});
