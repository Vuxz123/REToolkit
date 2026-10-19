import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseMilestoneArgs} from '../src/milestones-cli.js';
const entry=fileURLToPath(new URL('../re.js',import.meta.url));
test('milestone parser validates scoped flags and explicit Jev send command',()=>{
 assert.equal(parseMilestoneArgs(['--root','C:/tools','doctor','Game','--task','headless','--probe']).options.probe,true);
 assert.deepEqual(parseMilestoneArgs(['jev','request','bundle','--questions','q.json','--out','r.json','--file','notes/a.md','--file','notes/b.md']).options.files,['notes/a.md','notes/b.md']);
 assert.throws(()=>parseMilestoneArgs(['doctor','--probe','--timeout','31']));
 assert.equal(parseMilestoneArgs(['jev','run','request.json','--out','result.json','--timeout','300']).options.timeout,300);
 for(const args of [['doctor','--task','unknown'],['handoff','create'],['handoff','verify','a','extra'],['evidence','capture','Game','--kind','unknown'],
 ['jev','run','request.json'],['jev','request','bundle','--out','request.json'],['doctor','--include-assets'],['jev','run','a','--out','b','--api-key','secret']])assert.throws(()=>parseMilestoneArgs(args));
});
test('CLI doctor/status exposes structured readiness without optional tools blocking unrelated tasks',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-m34-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const run=(...args)=>spawnSync(process.execPath,[entry,...args,'--root',root,'--json'],{encoding:'utf8'});
 assert.equal(run('init','Game').status,0);
 const doctor=run('doctor','Game','--task','prepare');const facts=JSON.parse(doctor.stdout);assert.equal(facts.schemaVersion,1);assert.equal(facts.tasks.prepare.state,'blocked');assert.equal(doctor.status,1);
 assert.ok(facts.diagnostics.every(item=>item.code&&Object.hasOwn(item,'action')));
 const status=run('status','Game');assert.equal(status.status,0,status.stderr);const project=JSON.parse(status.stdout);assert.equal(project.name,'Game');assert.ok(project.tasks.prepare);assert.equal(project.diagnosticsSchemaVersion,1);
 const bad=run('jev','run','not-a-file','--out',path.join(root,'result.json'));assert.equal(bad.status,1);assert.ok(JSON.parse(bad.stderr).error.code);
});
