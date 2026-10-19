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
