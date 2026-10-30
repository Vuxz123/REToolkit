import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {inspectResidentProcess} from '../src/unity/resident-process.js';

test('resident process reports are bounded and omit arbitrary subprocess fields',async()=>{
 const result=await inspectResidentProcess(process.cwd(),{platform:'win32',spawnImpl:()=>({status:0,stdout:JSON.stringify({state:'running',pids:[123],CommandLine:'secret'})})});
 assert.deepEqual(result,{state:'running',pids:[123]});
 for(const value of [{state:'idle',pids:[123]},{state:'running',pids:[]},{state:'running',pids:[-1]},{state:'running',pids:[123,123]}])assert.deepEqual(await inspectResidentProcess(process.cwd(),{platform:'win32',spawnImpl:()=>({status:0,stdout:JSON.stringify(value)})}),{state:'unknown',pids:[]});
 assert.deepEqual(await inspectResidentProcess(process.cwd(),{platform:'win32',spawnImpl:()=>{throw Error('secret');}}),{state:'unknown',pids:[]});
});

test('actual Windows argv parsing finds only exact resident projects and reports inaccessible processes', {skip:process.platform!=='win32'},async()=>{
 const project='C:\\owned project\\resident';
 const cases=[
  [{ProcessId:123,ExecutablePath:'C:\\Unity\\Unity.exe',CommandLine:'"C:\\Unity\\Unity.exe" -batchmode -projectPath "C:/owned project/resident" -logFile "C:/logs/editor.log"'},{state:'running',pids:[123]}],
  [{ProcessId:124,ExecutablePath:'C:\\Unity\\Unity.exe',CommandLine:'"C:\\Unity\\Unity.exe" -projectPath "C:\\owned project\\resident-other"'},{state:'idle',pids:[]}],
  [{ProcessId:125,ExecutablePath:null,CommandLine:null},{state:'unknown',pids:[]}],
  [{ProcessId:126,ExecutablePath:'C:\\Unity\\Unity.exe',CommandLine:'Unity.exe -projectPath relative'},{state:'unknown',pids:[]}],
 ];
 for(const [row,expected] of cases){
  const report=await inspectResidentProcess(project,{spawnImpl:(file,args,options)=>{
   const mock=`function Get-CimInstance { @'\n${JSON.stringify(row)}\n'@ | ConvertFrom-Json }\n`;
   return spawnSync(file,[...args.slice(0,-1),mock+args.at(-1)],options);
  }});assert.deepEqual(report,expected);
 }
});
