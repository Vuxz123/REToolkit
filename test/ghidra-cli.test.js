import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseBridgeArgs } from '../src/ghidra/cli.js';
import { createToolkit } from '../src/toolkit.js';
import { runtimePaths,atomicJson } from '../src/ghidra/runtime.js';
const entry=fileURLToPath(new URL('../re.js',import.meta.url));
test('bridge CLI parses write/symbol policies and rejects ambiguous or malformed arguments',()=>{
  const parsed=parseBridgeArgs(['symbols','plan','Game','--address-mode','rva','--create-functions','--json']);
  assert.equal(parsed.name,'Game');assert.equal(parsed.options.addressMode,'rva');assert.equal(parsed.options.createFunctions,true);
  for(const args of [ ['session','start','Game','extra'],['function','rename','Game','0x1'],
    ['bytes','read','Game','0x1','--length','1e20'],['session','start','Game','--text','bad'],
    ['comment','set','Game','0x1','--type','wrong','--text','x'],['symbols','apply','Game'],
    ['function','get','Game','123'],['decompile','Game','Name','--limit','0'] ]) assert.throws(()=>parseBridgeArgs(args));
});
test('existing status reads snapshot during active session and GUI/mutators fail with stop guidance',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-session-cli-'));
  try {
    const toolkit=createToolkit(root);await toolkit.init('Game');
    const paths=runtimePaths(toolkit,'Game');fs.mkdirSync(paths.base,{recursive:true});
    atomicJson(paths.current,{runId:'11111111-1111-4111-8111-111111111111',phase:'starting',mode:'read'});
    const before=fs.readFileSync(toolkit.projectPath('Game'));
    const run=(...args)=>spawnSync(process.execPath,[entry,...args,'--root',root,'--json'],{encoding:'utf8'});
    const status=run('status','Game');assert.equal(status.status,0,status.stderr);assert.equal(JSON.parse(status.stdout).session.state,'starting');
    assert.deepEqual(fs.readFileSync(toolkit.projectPath('Game')),before);
    const opened=run('open','Game');assert.equal(opened.status,1);assert.match(opened.stderr,/session_conflict|session stop/);
    await assert.rejects(toolkit.dump('Game'),error=>error.code==='session_conflict');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
