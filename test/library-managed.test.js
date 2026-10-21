import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fixture} from './reconstruction-fixture.js';
import {fileIdentity} from '../src/state.js';
import {indexUnityProject} from '../src/assets/graph.js';
import {stageUnityProject} from '../src/unity/validation.js';

async function managed(t,id='com.retk.fixture'){
 const f=await fixture(t),root='Packages/'+id;
 const payload={'package.json':JSON.stringify({name:id,version:'1.2.3'}),'Runtime/Token.cs':'public class Token {}'};
 for(const [name,bytes]of Object.entries(payload)){const file=path.join(f.projectDir,root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
 const files=Object.keys(payload).map(p=>{const {size,sha256}=fileIdentity(path.join(f.projectDir,root,p));return {path:p,size,sha256};});
 const lock={kind:'retoolkit-managed-libraries',schemaVersion:1,operationId:randomUUID(),catalogRevision:'a'.repeat(64),packages:[{id,version:'1.2.3',libraryId:id,catalogPackageId:'b'.repeat(64),archiveSha256:'c'.repeat(64),root,files}]};
 fs.writeFileSync(path.join(f.projectDir,'Packages/retk-libraries.lock.json'),JSON.stringify(lock));
 fs.writeFileSync(path.join(f.projectDir,'Packages/packages-lock.json'),JSON.stringify({dependencies:{[id]:{version:'file:'+id,source:'embedded',depth:0,dependencies:{}}}}));
 return {...f,packageRoot:root,lock};
}
async function stage(f){const graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding});return stageUnityProject({projectDir:f.projectDir,graph,runDir:path.join(f.root,'run'),templateRoot:path.resolve(import.meta.dirname,'../templates')});}
test('validation accepts exact managed package IDs including catalog-supported underscores',async t=>{for(const id of ['com.retk.fixture','com.retk.my_lib']){const f=await managed(t,id);const result=await stage(f);assert(fs.existsSync(path.join(result.projectDir,f.packageRoot,'Runtime/Token.cs')));}});
test('managed package missing, added, changed, forged paths and local dependencies fail staging',async t=>{
 for(const mode of ['missing','added','changed','unsafe','unmanaged','file-dependency']){
  const f=await managed(t),base=path.join(f.projectDir,f.packageRoot);
  if(mode==='missing')fs.unlinkSync(path.join(base,'Runtime/Token.cs'));
  if(mode==='added')fs.writeFileSync(path.join(base,'Extra.cs'),'extra');
  if(mode==='changed')fs.appendFileSync(path.join(base,'Runtime/Token.cs'),'changed');
  if(mode==='unsafe'){f.lock.packages[0].files[0].path='../other';fs.writeFileSync(path.join(f.projectDir,'Packages/retk-libraries.lock.json'),JSON.stringify(f.lock));}
  if(mode==='unmanaged')fs.unlinkSync(path.join(f.projectDir,'Packages/retk-libraries.lock.json'));
  if(mode==='file-dependency')fs.writeFileSync(path.join(f.projectDir,'Packages/manifest.json'),JSON.stringify({dependencies:{bad:'file:../../private'}}));
  await assert.rejects(stage(f),undefined,mode);
 }
});
