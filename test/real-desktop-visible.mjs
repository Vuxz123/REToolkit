// Explicit visible-window acceptance; uses only its own empty fixture toolkit.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const repository=path.resolve(import.meta.dirname,'..'),directory=path.join(repository,'.cache/desktop-visible-acceptance',randomUUID()),root=path.join(directory,'toolkit');
fs.mkdirSync(root,{recursive:true});
const result=spawnSync(process.execPath,[path.join(repository,'re.js'),'gui','--root',root],{cwd:repository,windowsHide:true,encoding:'utf8',timeout:30000,env:{...process.env,RETK_DESKTOP_VISIBLE_SMOKE:directory,RETK_DESKTOP_SMOKE:undefined}});
assert.equal(result.status,0,result.stderr||result.error?.message);
const observation=JSON.parse(fs.readFileSync(path.join(directory,'observation.json'),'utf8'));
assert.equal(observation.ready,'true');assert.equal(observation.visible,true,'retk gui created a hidden window');assert.equal(observation.minimized,false);assert.equal(observation.nodeIntegration,false);
console.log(JSON.stringify({passed:true,fixture:'visible Electron window through actual retk gui CLI',...observation,gameExecution:false}));
