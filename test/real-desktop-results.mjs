import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {electronExecutable,desktopLaunchSpec} from '../src/desktop/cli.js';

const repository=path.resolve(import.meta.dirname,'..'),directory=path.join(repository,'.cache/desktop-results-acceptance',randomUUID()),root=path.join(directory,'toolkit');fs.mkdirSync(root,{recursive:true});
const spec=desktopLaunchSpec(root,process.execPath,electronExecutable());
const result=spawnSync(spec.file,['--disable-gpu',...spec.args],{cwd:repository,windowsHide:true,encoding:'utf8',timeout:45000,env:{...spec.env,RETK_DESKTOP_RESULT_SMOKE:directory,RETK_DESKTOP_SMOKE:undefined,RETK_DESKTOP_VISIBLE_SMOKE:undefined,JEV_RESULT_FIXTURE_KEY:undefined}});
assert.equal(result.status,0,result.stderr||result.error?.message);
const observation=JSON.parse(fs.readFileSync(path.join(directory,'observation.json'),'utf8'));
assert.equal(observation.actualJob,true);assert.equal(observation.table,true);assert.equal(observation.rawCollapsed,true);assert.equal(observation.hostileTextSafe,true);assert.equal(observation.blocked,true);assert.equal(observation.failed,true);assert.equal(observation.copy,true);assert.equal(observation.running,true);assert.equal(observation.jevSettingsUI,true);
for(const file of ['graph.png','blocked.png','ldplayer.png'])assert(fs.statSync(path.join(directory,file)).size>10000);
console.log(JSON.stringify({passed:true,...observation,directory,gameExecution:false}));
