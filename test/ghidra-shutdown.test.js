import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';import {createToolkit} from '../src/toolkit.js';import {runtimePaths} from '../src/ghidra/runtime.js';import {stopSession} from '../src/ghidra/provider.js';
test('terminal session stop waits for lease release and the recorded supervisor exit',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-stop-proof-')),toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Fixture');
 const paths=runtimePaths(toolkit,'Fixture');fs.mkdirSync(paths.base,{recursive:true});const ready=path.join(root,'ready');
 const state=new URL('../src/state.js',import.meta.url).href,runId='11111111-1111-4111-8111-111111111111';
 const code=`import fs from 'node:fs';import {withWorkspaceLock} from ${JSON.stringify(state)};await withWorkspaceLock(process.argv[1],async()=>{fs.writeFileSync(process.argv[2],JSON.stringify({runId:${JSON.stringify(runId)},phase:'stopped',ownerPid:process.pid}));fs.writeFileSync(process.argv[3],'ready');await new Promise(r=>setTimeout(r,250));});await new Promise(r=>setTimeout(r,250));`;
 const child=spawn(process.execPath,['--input-type=module','-e',code,toolkit.workspace('Fixture'),paths.current,ready],{cwd:root,windowsHide:true,stdio:'ignore'});const closed=new Promise(resolve=>child.once('exit',resolve));
 try{const deadline=Date.now()+5000;while(!fs.existsSync(ready)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(fs.existsSync(ready));assert.equal((await stopSession(toolkit,'Fixture',{timeoutMs:5000})).state,'stopped');assert.throws(()=>process.kill(child.pid,0),error=>error.code==='ESRCH');assert.ok(!fs.existsSync(path.join(toolkit.workspace('Fixture'),'.retk-lock')));}
 finally{await closed;fs.rmSync(root,{recursive:true,force:true});}
});
test('terminal state and dead PID do not authorize deleting uncertain engine ownership',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-stop-uncertain-')),toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Fixture');const paths=runtimePaths(toolkit,'Fixture');fs.mkdirSync(paths.base,{recursive:true});fs.writeFileSync(paths.current,JSON.stringify({runId:'11111111-1111-4111-8111-111111111111',phase:'failed',ownerPid:99999999}));const lock=path.join(toolkit.workspace('Fixture'),'.retk-lock');fs.mkdirSync(lock);const marker=path.join(lock,'engine-uncertain.json');fs.writeFileSync(marker,'{}');
 try{await assert.rejects(stopSession(toolkit,'Fixture',{timeoutMs:75}),error=>error.code==='cleanup_pending');assert.ok(fs.existsSync(marker));}finally{fs.rmSync(root,{recursive:true,force:true});}
});
