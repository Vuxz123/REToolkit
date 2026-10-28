import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('..',import.meta.url));
const engines=process.env.RETK_TEST_ENGINES??root;
const java=path.join(engines,'runtime/java/jdk-21/bin',process.platform==='win32'?'java.exe':'java');
const javac=path.join(path.dirname(java),process.platform==='win32'?'javac.exe':'javac');
async function jars(directory){const result=[];for(const item of await fs.readdir(directory,{withFileTypes:true})){const file=path.join(directory,item.name);if(item.isDirectory())result.push(...await jars(file));else if(item.name.endsWith('.jar'))result.push(file);}return result;}
function run(file,args){const result=spawnSync(file,args,{encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});assert.equal(result.error,undefined,result.error?.message);assert.equal(result.status,0,result.stdout+result.stderr);return result.stdout;}

test('Java mutation digests preserve legacy bytes and compact large descriptors in 96 MiB',async t=>{
  try{await fs.access(javac);await fs.access(path.join(engines,'tools/ghidra/Ghidra'));}catch{t.skip('Installed JDK and Ghidra jars required (or RETK_TEST_ENGINES)');return;}
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'retk-mutation-digest-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const classpath=(await jars(path.join(engines,'tools/ghidra/Ghidra'))).join(path.delimiter);
  const sources=['RetkMutations.java','RetkAnalysis.java','RetkQueries.java','RetkSymbols.java','RetkProgramIdentity.java'].map(name=>path.join(root,'scripts/ghidra',name));
  run(javac,['-cp',classpath,'-d',directory,...sources,path.join(root,'test/fixtures/RetkMutationDigestFixture.java')]);
  const args=['-Xmx96m','-cp',directory+path.delimiter+classpath,'RetkMutationDigestFixture'];
  assert.match(run(java,[...args,'compatible',directory]),/compatible=/);
  assert.match(run(java,[...args,'copy',directory]),/bulkCopyAvoided=true/);
  assert.match(run(java,[...args,'large',directory]),/aggregateBytes=/);
});
