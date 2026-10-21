import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './reconstruction-fixture.js';
import {fingerprint,withWorkspaceLock} from '../src/state.js';
import {indexUnityProject} from '../src/assets/graph.js';
const api=async()=>{try{return await import('../src/reconstruction/migration-observation.js');}catch(e){assert.fail(`Migration observer unavailable: ${e.message}`);}};
test('fixed migration helper stages DLL and component observation selectors without modifying the source project',async t=>{
 const f=await fixture(t),m=await api(),runDir=path.join(f.root,'observe');await fs.writeFile(path.join(f.projectDir,'Assets/Main.unity.meta'),'fileFormatVersion: 2\nguid: '+ 'c'.repeat(32)+'\n');f.graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding});const staged=await m.stageMigrationObservation({...f,runDir,templateRoot:path.resolve('templates')});
 assert.equal(staged.request.kind,'retoolkit-migration-observation-request');assert.equal(staged.request.inventorySha256,fingerprint(f.graph.files));assert.equal(staged.request.components[0].fileID,'9007199254740993');
 assert.match(await fs.readFile(path.join(staged.projectDir,'Assets/REToolkitValidation/Editor/REToolkitValidation.cs'),'utf8'),/LoadAllAssetsAtPath/);assert.equal(await fs.readFile(path.join(f.projectDir,'Assets/Player.cs'),'utf8'),f.files['Assets/Player.cs']);
 await assert.rejects(m.stageMigrationObservation({...f,runDir,templateRoot:path.resolve('templates')}),/fresh/i);
});
test('failed Editor observations retain actual process diagnostics and cannot become a successful manifest',async t=>{
 const f=await fixture(t),m=await api(),runDir=path.join(f.root,'failed-observe');await withWorkspaceLock(f.root,async()=>{
  await assert.rejects(m.observeMigration({...f,runDir,templateRoot:path.resolve('templates'),editor:path.join(f.root,'Unity.exe'),lockDirectory:path.join(f.root,'.retk-lock'),toolkitRoot:f.root},{runEditor:async()=>({closed:true,exitCode:1,timedOut:false,logTail:'error CS9999: fixture compile failure'})}),/failed/i);
 });assert.match(await fs.readFile(path.join(runDir,'editor-output.txt'),'utf8'),/CS9999/);
});
test('fixed helper allows source-owned Assets and embedded Packages paths with the same path guards',async()=>{const helper=await fs.readFile(path.resolve('templates/Unity/REToolkitMigrationObservation.cs'),'utf8');assert.match(helper,/value\.StartsWith\("Assets\/", StringComparison\.Ordinal\)/);assert.match(helper,/value\.StartsWith\("Packages\/", StringComparison\.Ordinal\)/);assert.match(helper,/p == "\.\."/);assert.match(helper,/GetInvalidFileNameChars/);});
