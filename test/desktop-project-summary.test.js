import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createDesktopBroker} from '../src/desktop/jobs.js';
import {createDesktopActivityReader} from '../src/desktop/activity.js';
import {createGhidraActivityReader} from '../src/desktop/ghidra-activity.js';
import {readDesktopProjectSummary,desktopProjectByteLimit} from '../src/desktop/project-summary.js';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-large-project-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const workspace=path.join(root,'workspaces/Game');fs.mkdirSync(workspace,{recursive:true});
 return {root,workspace,file:path.join(workspace,'project.re.json')};
}
test('large valid project remains selectable and observable without exposing inventory',async t=>{
 const f=fixture(t);fs.writeFileSync(f.file,JSON.stringify({platform:'arm64-v8a',steps:{import:{state:'succeeded',outputs:[{payload:'x'.repeat(17*1024**2)}]}}}));
 const broker=createDesktopBroker(f.root,{history:false});
 assert.equal(broker.snapshot().workspaces[0].state,'available');
 const ghidra=createGhidraActivityReader(f.root)('Game');assert.equal(ghidra.state,'observed');
 assert.equal(ghidra.tasks[0].savedState,'succeeded');
 const activity=await createDesktopActivityReader(f.root).inspect('Game');assert.equal(activity.lock.state,'available');
 assert(JSON.stringify(broker.snapshot()).length<100000);
 fs.mkdirSync(path.join(f.workspace,'.retk-lock'));
 assert.equal(broker.snapshot().workspaces[0].state,'busy');
});

test('project cache retains only immutable summaries and invalidates replacement or corrupt records',t=>{
 const f=fixture(t);fs.writeFileSync(f.file,JSON.stringify({platform:'arm64',secret:'private',steps:{import:{state:'succeeded',outputs:['private']}}}));
 const first=readDesktopProjectSummary(f.workspace);
 assert.equal(readDesktopProjectSummary(f.workspace),first);
 assert(!JSON.stringify(first).includes('private'));
 assert(Object.isFrozen(first.steps.import.owner));
 const replacement=f.file+'.new';fs.writeFileSync(replacement,JSON.stringify({platform:'armv7'}));fs.renameSync(replacement,f.file);
 assert.equal(readDesktopProjectSummary(f.workspace).platform,'armv7');
 fs.writeFileSync(f.file,'{broken');assert.throws(()=>readDesktopProjectSummary(f.workspace));
 fs.writeFileSync(f.file,'null');assert.throws(()=>readDesktopProjectSummary(f.workspace),/object/);
 fs.writeFileSync(f.file,'{}');assert.equal(readDesktopProjectSummary(f.workspace).platform,undefined);
});

test('project cache cannot bypass link or byte limits',t=>{
 const f=fixture(t);fs.writeFileSync(f.file,'{}');readDesktopProjectSummary(f.workspace);
 fs.linkSync(f.file,f.file+'.linked');assert.throws(()=>readDesktopProjectSummary(f.workspace),/Unsupported/);
 fs.unlinkSync(f.file+'.linked');fs.truncateSync(f.file,desktopProjectByteLimit+1);
 assert.throws(()=>readDesktopProjectSummary(f.workspace),/128 MiB/);
 fs.unlinkSync(f.file);const target=path.join(f.root,'target.json');fs.writeFileSync(target,'{}');
 try{fs.symlinkSync(target,f.file);}catch(error){if(error.code==='EPERM')return;throw error;}
 assert.throws(()=>readDesktopProjectSummary(f.workspace),/Linked/);
});
