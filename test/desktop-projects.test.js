import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import yazl from 'yazl';
import {createToolkit} from '../src/toolkit.js';
import {createApkProject} from '../src/desktop/projects.js';
import {buildDesktopCommand} from '../src/desktop/operations.js';

async function setup(t,entries){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-project-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const input=path.join(root,'source.apk'),zip=new yazl.ZipFile();for(const [name,bytes]of Object.entries(entries))zip.addBuffer(Buffer.from(bytes),name);zip.end();const stream=fs.createWriteStream(input);zip.outputStream.pipe(stream);await once(stream,'close');
 const toolkit=createToolkit(root,{log:()=>{},run:()=>{throw Error('No native execution permitted');}});return {root,input,toolkit};
}
test('new APK project preserves original, selects inputs and never starts an engine',async t=>{
 const {root,input,toolkit}=await setup(t,{'lib/arm64-v8a/libil2cpp.so':'fixture','assets/bin/Data/Managed/Metadata/global-metadata.dat':'metadata'});
 const result=await createApkProject(toolkit,'NewGame',input);assert.equal(result.state,'created');assert.equal(result.name,'NewGame');assert.equal(result.analysisReady,false);
 const original=path.join(root,'workspaces/NewGame/00_OriginalBuild/source.apk');assert.deepEqual(fs.readFileSync(original),fs.readFileSync(input));assert.equal(toolkit.read('NewGame').steps.scan.state,'succeeded');assert.ok(fs.existsSync(result.receipt));
});
test('missing split inputs preserve a selectable project and explicit intake gap',async t=>{
 const {input,toolkit}=await setup(t,{'assets/bin/Data/boot.config':'fixture'});const result=await createApkProject(toolkit,'Incomplete',input);
 assert.equal(result.state,'needs-input');assert.equal(result.issue.code,'input_selection_required');assert.ok(result.nextSteps.some(step=>step.includes('split')));assert.equal(toolkit.read('Incomplete').steps.extract.state,'succeeded');assert.equal(toolkit.read('Incomplete').steps.scan.state,'awaiting-user');assert.ok(fs.existsSync(result.receipt));
});
test('new project refuses duplicates without changing original workspace',async t=>{
 const {input,toolkit}=await setup(t,{'manifest.txt':'fixture'});await createApkProject(toolkit,'Duplicate',input);const before=fs.readFileSync(path.join(toolkit.workspace('Duplicate'),'project.re.json'));
 await assert.rejects(createApkProject(toolkit,'Duplicate',input),{code:'PROJECT_EXISTS'});assert.deepEqual(fs.readFileSync(path.join(toolkit.workspace('Duplicate'),'project.re.json')),before);
});
test('concurrent create reserves the project name once',async t=>{
 const {input,toolkit}=await setup(t,{'manifest.txt':'fixture'});const results=await Promise.allSettled([createApkProject(toolkit,'Same',input),createApkProject(toolkit,'Same',input)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'PROJECT_EXISTS');
});
test('invalid archive fails explicitly and preserves an inspectable project',async t=>{
 const {input,toolkit}=await setup(t,{});fs.writeFileSync(input,'bad zip');const result=await createApkProject(toolkit,'Broken',input);assert.equal(result.state,'failed');assert.equal(result.issue.code,'PROJECT_IMPORT_FAILED');assert.ok(toolkit.read('Broken'));
});
test('project validation refuses unsupported inputs before creating any project',async t=>{
 const {root,input,toolkit}=await setup(t,{});await assert.rejects(createApkProject(toolkit,'../bad',input));await assert.rejects(createApkProject(toolkit,'NoFile',path.join(root,'missing.apk')));const wrong=path.join(root,'script.js');fs.writeFileSync(wrong,'');await assert.rejects(createApkProject(toolkit,'Wrong',wrong));assert.equal(fs.existsSync(path.join(root,'workspaces/Wrong')),false);
});
test('desktop project create command is typed and does not start flow',()=>{
 assert.deepEqual(buildDesktopCommand('project.create',{name:'NewGame',input:'C:/build.apk'}),['create-project','NewGame','C:/build.apk']);assert.throws(()=>buildDesktopCommand('project.create',{name:'Game',input:'x.apk',force:true}));
});
test('Windows project state publication tolerates a transient reader sharing handle',{skip:process.platform!=='win32'},async t=>{
 const {toolkit}=await setup(t,{}),rename=fs.renameSync;let rejected=false;
 fs.renameSync=(source,target)=>{if(!rejected&&target.endsWith('project.re.json')){rejected=true;throw Object.assign(Error('synthetic sharing violation'),{code:'EPERM'});}return rename(source,target);};
 try{await toolkit.init('SharingFixture');assert.equal(rejected,true);assert.equal(toolkit.read('SharingFixture').name,'SharingFixture');}finally{fs.renameSync=rename;}
});
