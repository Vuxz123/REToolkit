import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const api=()=>import('../src/bootstrap/cli.js');
test('quickstart parser accepts only declared values and rejects duplicate/ambiguous flags',async()=>{
 const {parseQuickstartArgs}=await api();assert.deepEqual(parseQuickstartArgs(['--profile','desktop','--no-path','--cache','C:/packages','--json']),{options:{profile:'desktop',noPath:true,cache:'C:/packages'},json:true});
 for(const args of [['--profile','bad'],['--plan','--plan'],['--unknown'],['--cache'],['--cache','--plan'],['install'],['--profile','cli','--profile','full']])assert.throws(()=>parseQuickstartArgs(args));
 assert.deepEqual(parseQuickstartArgs(['--root','C:/Toolkit','--plan','--json']),{options:{plan:true},json:true,root:'C:/Toolkit'});
});
test('real cold quickstart entry can plan without engine execution or runtime imports',()=>{
 const report=spawnSync(process.execPath,['scripts/quickstart.mjs','--profile','cli','--plan','--json'],{encoding:'utf8'});assert.equal(report.status,0,report.stderr);const value=JSON.parse(report.stdout);assert.equal(value.profile,'cli');assert.equal(value.state,'planned');assert.deepEqual(value.stages.map(s=>s.id),['dependencies','command']);
});
test('installed CLI exposes the same offline plan and desktop operation',async()=>{
 const report=spawnSync(process.execPath,['re.js','quickstart','--plan','--profile','desktop','--json'],{encoding:'utf8'});assert.equal(report.status,0,report.stderr);assert.deepEqual(JSON.parse(report.stdout).stages.map(s=>s.id),['dependencies','gui','command']);
 const {buildDesktopCommand}=await import('../src/desktop/operations.js');assert.deepEqual(buildDesktopCommand('quickstart.plan',{}),['quickstart','--plan','--profile','full']);
});
