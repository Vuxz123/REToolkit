import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDesktopCommand} from '../src/desktop/operations.js';
import fs from 'node:fs';import vm from 'node:vm';

test('desktop preparation arguments are bounded policies, not shell commands',()=>{
 const run='12345678-1234-4123-8123-123456789abc';
 assert.deepEqual(buildDesktopCommand('workspace.prepare',{name:'Game',profile:'native',symbols:'plan',addressMode:'rva',serial:'emulator-5554',packageName:'com.example.game',autoPull:'false',includeData:'false',baselineValidation:'true',resumeRunId:run}),['prepare','Game','--profile','native','--symbols','plan','--address-mode','rva','--serial','emulator-5554','--package','com.example.game','--no-auto-pull','--no-include-data','--baseline-validation','--resume-run',run]);
 assert.deepEqual(buildDesktopCommand('workspace.preparation',{name:'Game',runId:run}),['preparation','Game','--run',run]);
 for(const payload of [{name:'Game',symbols:'all'},{name:'Game',addressMode:'guess'},{name:'Game',autoPull:true},{name:'Game',serial:'$(attack)'},{name:'Game',resumeRunId:'../escape'},{name:'Game',shell:'anything'}])assert.throws(()=>buildDesktopCommand('workspace.prepare',payload));
});
test('preload transports explicit freshness choice and defaults to cheap observation',async()=>{
 let bridge;const calls=[];vm.runInNewContext(fs.readFileSync(new URL('../src/desktop/preload.cjs',import.meta.url),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_name,api)=>bridge=api},ipcRenderer:{invoke:(...args)=>calls.push(args)}})});
 bridge.preparation.inspect('Game');bridge.preparation.inspect('Game',undefined,true);bridge.preparation.inspect('Game','12345678-1234-4123-8123-123456789abc',false);
 assert.deepEqual(calls,[['desktop:preparation:inspect','Game',undefined,false],['desktop:preparation:inspect','Game',undefined,true],['desktop:preparation:inspect','Game','12345678-1234-4123-8123-123456789abc',false]]);
});

test('desktop transports the explicit preparation analysis mode',()=>{
 for(const analysisMode of ['full','on-demand'])assert.deepEqual(buildDesktopCommand('workspace.prepare',{name:'Game',analysisMode}),['prepare','Game','--analysis-mode',analysisMode]);
 assert.throws(()=>buildDesktopCommand('workspace.prepare',{name:'Game',analysisMode:'all'}));
});
