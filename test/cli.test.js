import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const entry=path.resolve('re.js');
const invoke=(...args)=>spawnSync(process.execPath,[entry,...args],{encoding:'utf8'});
test('CLI help and doctor JSON are readable and report task readiness',()=>{
  assert.match(invoke('help').stdout,/JavaScript CLI/);
  const doctor=invoke('doctor','--json'); const report=JSON.parse(doctor.stdout);
  assert.ok([0,1].includes(doctor.status));if(doctor.status===1)assert.equal(report.readiness,'blocked');
  assert.equal(report.checks.dumper.exists,fs.existsSync(report.checks.dumper.path));
});
test('CLI exposes package version and documents the installed command',()=>{
  const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
  for(const flag of ['--version','-v']){const result=invoke(flag);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),version);}
  assert.notEqual(invoke('--version','extra').status,0);
  assert.match(invoke('--help').stdout,/retk doctor/);
  assert.match(JSON.parse(fs.readFileSync('package.json','utf8')).scripts['cli:install'],/^npm link --offline --ignore-scripts --no-audit --no-fund$/);
});
test('CLI rejects unknown/missing/extra arguments before creating a workspace',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-cli-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const args of [['flow','Game'],['scan','Game','missing','--binary'],['init','Game','extra'],['doctor','extra'],['init','Game','--typo']]) {
    const result=invoke(...args,'--root',root); assert.notEqual(result.status,0,JSON.stringify(args));
  }
  assert.equal(fs.existsSync(path.join(root,'workspaces')),false);
});
test('CLI init and status work with an explicit root and space/Unicode paths',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk cli café-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const result=invoke('--root',root,'init','Game','--json'); assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).schemaVersion,2);
  assert.equal(invoke('status','Game','--root',root).status,0);
});
