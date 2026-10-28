import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture,replacement} from './reconstruction-fixture.js';
import {createToolkit} from '../src/toolkit.js';

test('real Node CLI carries artifact revisions through params-file plan and source apply',async t=>{
 const f=await fixture(t),toolkit=createToolkit(f.root,{log:()=>{}});await toolkit.init('Game');const workspace=toolkit.workspace('Game'),input=path.join(workspace,'01_Extracted');
 fs.writeFileSync(path.join(input,'libil2cpp.so'),'owned native');fs.writeFileSync(path.join(input,'global-metadata.dat'),'owned metadata');await toolkit.scan('Game',input);fs.cpSync(f.projectDir,path.join(workspace,'05_ReconstructedSource'),{recursive:true});
 const entry=fileURLToPath(new URL('../re.js',import.meta.url));
 const run=(args,expected=0)=>{const child=spawnSync(process.execPath,[entry,'recovery',...args,'--root',f.root,'--json'],{encoding:'utf8',windowsHide:true,shell:false,timeout:30000});assert.equal(child.status,expected,child.stderr);return JSON.parse(expected===0?child.stdout:child.stderr.trim().split(/\r?\n/).at(-1));};
 const a=run(['create','Game']),prefix=['run','Game','--artifact',a.artifactId,'--revision',a.revision];
 const indexed=run([...prefix,'--operation','assets.index','--params','{"storage":"sqlite"}']);
 const scripts=run([...prefix,'--operation','assets.scripts']);
 const paramsFile=path.join(f.root,'source-params.json');fs.writeFileSync(paramsFile,JSON.stringify({request:{kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:indexed.result.revision,changes:[{scriptId:scripts.result.items[0].scriptId,source:replacement}]}}));
 const plan=run([...prefix,'--operation','reconstruct.plan','--params-file',paramsFile]);
 const applied=run([...prefix,'--operation','reconstruct.apply','--params',JSON.stringify({operationId:plan.result.operationId})]);assert.notEqual(applied.revision,a.revision);
 assert.equal(fs.readFileSync(path.join(workspace,applied.project,'Assets/Player.cs'),'utf8'),replacement);
 const stale=run([...prefix,'--operation','assets.list'],1);assert.equal(stale.error.code,'recovery_revision_stale');
 assert.equal(run(['status','Game','--artifact',a.artifactId]).freshness,'current');
 assert.equal(fs.readFileSync(path.join(workspace,'05_ReconstructedSource/Assets/Player.cs'),'utf8'),f.files['Assets/Player.cs']);
});
