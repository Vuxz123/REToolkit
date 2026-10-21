import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {electronExecutable,desktopLaunchSpec} from '../src/desktop/cli.js';
const repository=path.resolve(import.meta.dirname,'..'),directory=path.join(repository,'.cache/desktop-acceptance',randomUUID()),root=path.join(directory,'toolkit');fs.mkdirSync(root,{recursive:true});
const spec=desktopLaunchSpec(root,process.execPath,electronExecutable());
const result=spawnSync(spec.file,['--disable-gpu',...spec.args],{cwd:repository,windowsHide:true,encoding:'utf8',timeout:45000,env:{...spec.env,RETK_DESKTOP_SMOKE:directory,JEV_DESKTOP_FIXTURE_KEY:undefined}});assert.equal(result.status,0,result.stderr||result.error?.message);
const observation=JSON.parse(fs.readFileSync(path.join(directory,'observation.json'),'utf8'));assert.equal(observation.ready,'true');assert.equal(observation.hasNode,'undefined');assert.equal(observation.hasBridge,'function');assert(observation.panels>=8);assert.equal(observation.electron,'44.9.1');assert(fs.statSync(path.join(directory,'desktop.png')).size>10000);
assert.equal(observation.ipc.rejected,true);assert.equal(observation.ipc.job.state,'succeeded');assert.equal(observation.ipc.workspace.name,'DesktopFixture');
assert.equal(observation.settings.configured,true);assert.equal(observation.settings.keyPresent,false);assert.equal(observation.settings.test.network,'not-sent');
console.log(JSON.stringify({passed:true,electron:observation.electron,fixture:'offscreen actual Electron desktop with sandbox IPC and real Node workspace creation',nodeIntegration:false,typedBridge:true,panels:observation.panels,screenshot:path.join(directory,'desktop.png'),gameExecution:false}));
