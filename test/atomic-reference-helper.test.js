import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// Executes the shipped collector with an owned iterator exposing pointer children.
// This verifies helper behavior, not Unity Editor or user-game acceptance.
test('ObjectReference capture is atomic while real fields, arrays and managed references remain traversable', async t=>{
 if(process.platform!=='win32')return t.skip('owned fixture requires Windows Framework compiler');
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'retk-atomic-reference-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const executable=path.join(directory,'fixture.exe');
 const compile=spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/out:'+executable,path.resolve('templates/Unity/REToolkitValidation.cs'),path.resolve('test/fixtures/unity-helper/Fixture.cs')],{encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(compile.status,0,compile.stdout+compile.stderr);
 async function run(scenario){
  const runDirectory=path.join(directory,scenario);await fs.mkdir(path.join(runDirectory,'project/Assets'),{recursive:true});
  const request=path.join(runDirectory,'request.json'),report=path.join(runDirectory,'report.json');await fs.writeFile(request,'{}');
  const result=spawnSync(executable,[scenario,runDirectory,'-retkRequest',request,'-retkReport',report],{encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(result.status,0,result.stdout+result.stderr);return JSON.parse(await fs.readFile(report,'utf8'));
 }
 const before=await run('data-capture-atomic-2672'),after=await run('data-capture-atomic-2676');
 const data=before.assets[0].data,properties=data.objects[0].properties,fields=new Map(properties.map(p=>[p.path,p.value]));
 assert.equal(fields.has('m_Script.m_FileID'),false,'internal pointer file ID must not become data');
 assert.equal(fields.has('m_Script.pointerMissing'),false,'pointer children must not create missing references');
 assert.equal(fields.has('nested.reference.m_PathID'),false);
 assert.equal(fields.has('optional.m_FileID'),false);
 assert.equal(fields.get('m_Script'),'0123456789abcdef0123456789abcdef:11500000');
 assert.equal(fields.get('nested.reference'),'0123456789abcdef0123456789abcdef:9007199254740999');
 assert.equal(fields.get('optional'),'null');
 for(const [key,value] of [['m_FileID','41'],['nested.m_FileID','43'],['nested.afterReference','47'],['managed.m_FileID','53'],['afterManaged','61']])assert.equal(fields.get(key),value,key);
 assert.equal(fields.get('managed'),'42:Fixture Table');assert.equal(fields.get('managed.self'),'42:Fixture Table');assert.equal(fields.has('managed.self.hidden'),false);
 assert.deepEqual(properties.filter(p=>/^scores\.Array\.data\[/.test(p.path)).map(p=>[p.path,p.value]),[['scores.Array.data[0]','7'],['scores.Array.data[1]','9']]);
 assert.equal(data.policy,'scriptable-data-v2');assert.equal(data.complete,true);assert.equal(before.assets[0].missingReferences,0);
 assert.deepEqual(data,after.assets[0].data,'changing only pointer representation children must not change data');
 const missing=await run('data-capture-atomic-missing');
 assert.equal(missing.assets[0].missingScripts,1);assert.equal(missing.assets[0].missingReferences,1);
 assert.equal(missing.assets[0].data.complete,false);assert.equal(missing.assets[0].data.unsupportedProperties,1);
 assert.equal(missing.assets[0].data.objects[0].properties.find(p=>p.path==='missing').value,null);
 const referenceOnly=await run('data-atomic-reference-scan');
 assert.equal(referenceOnly.assets[0].missingReferences,0,'reference-only scan also skips pointer children');
 assert.equal(Object.hasOwn(referenceOnly.assets[0],'data'),false);
});
