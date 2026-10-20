import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimePaths, secureDirectory, atomicJson, readSession, publicSession, assertNoSession } from '../src/ghidra/runtime.js';
import { createToolkit } from '../src/toolkit.js';
test('private runtime descriptor is separate from workspace and redacts secrets',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-runtime-'));
  try {
    const toolkit=createToolkit(root); await toolkit.init('Fixture');
    const paths=runtimePaths(toolkit,'Fixture','11111111-1111-4111-8111-111111111111');
    secureDirectory(paths.base); secureDirectory(paths.run);
    const record={runId:'11111111-1111-4111-8111-111111111111',phase:'ready',mode:'read',token:'SECRET',configPath:paths.config};
    atomicJson(paths.current,record);
    assert.equal(readSession(toolkit,'Fixture').phase,'ready');
    assert.ok(!JSON.stringify(publicSession(record)).includes('SECRET'));
    assert.ok(!paths.base.startsWith(toolkit.workspace('Fixture')));
    assert.throws(()=>assertNoSession(toolkit,'Fixture'),error=>error.code==='session_conflict');
    atomicJson(paths.current,{...record,phase:'stopped'}); assert.doesNotThrow(()=>assertNoSession(toolkit,'Fixture'));
    assert.throws(()=>runtimePaths(toolkit,'Fixture','../bad'),/run ID/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('runtime refuses directory junctions before publishing secrets',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-link-'));
  try {fs.mkdirSync(path.join(root,'real'));fs.symlinkSync(path.join(root,'real'),path.join(root,'link'),'junction');
    assert.throws(()=>secureDirectory(path.join(root,'link','child')),/link|junction/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('Windows atomic runtime replacement waits briefly for an actual sharing violation',async t=>{
  if(process.platform!=='win32'){t.skip('Windows file sharing semantics');return;}
  const {spawn}=await import('node:child_process');const {atomicJson}=await import('../src/ghidra/runtime.js');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-runtime-sharing-')),file=path.join(root,'current.json'),ready=path.join(root,'ready');atomicJson(file,{before:true});
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$h=[IO.File]::Open($env:RETK_SHARED_FILE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);try{[IO.File]::WriteAllText($env:RETK_READY_FILE,'ready');Start-Sleep -Milliseconds 250}finally{$h.Dispose()}"],{windowsHide:true,stdio:'ignore',env:{...process.env,RETK_SHARED_FILE:file,RETK_READY_FILE:ready}});
  try{const deadline=Date.now()+5000;while(!fs.existsSync(ready)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(fs.existsSync(ready));atomicJson(file,{after:true});assert.deepEqual(JSON.parse(fs.readFileSync(file)),{after:true});}
  finally{if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));fs.rmSync(root,{recursive:true,force:true});}
});
test('persistent Windows sharing failures preserve original JSON and clean temporary files',async t=>{
  if(process.platform!=='win32'){t.skip('Windows file sharing semantics');return;}
  const {spawn}=await import('node:child_process');const {atomicJson}=await import('../src/ghidra/runtime.js');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-runtime-persistent-')),file=path.join(root,'current.json'),ready=path.join(root,'ready');atomicJson(file,{before:true});const before=fs.readFileSync(file);
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$h=[IO.File]::Open($env:RETK_SHARED_FILE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite);try{[IO.File]::WriteAllText($env:RETK_READY_FILE,'ready');Start-Sleep -Milliseconds 1800}finally{$h.Dispose()}"],{windowsHide:true,stdio:'ignore',env:{...process.env,RETK_SHARED_FILE:file,RETK_READY_FILE:ready}});
  try{const deadline=Date.now()+5000;while(!fs.existsSync(ready)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(fs.existsSync(ready));const started=performance.now();assert.throws(()=>atomicJson(file,{after:true}),error=>['EPERM','EACCES','EBUSY'].includes(error.code));assert.ok(performance.now()-started<1600);assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readdirSync(root).sort(),['current.json','ready']);}
  finally{if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));fs.rmSync(root,{recursive:true,force:true});}
});
