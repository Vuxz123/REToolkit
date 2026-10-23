import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createToolkit} from '../src/toolkit.js';
import {writeApk} from './fixtures/apk-fixture.js';
import yazl from 'yazl';
import {pipeline} from 'node:stream/promises';
import {createWriteStream} from 'node:fs';

test('outer archive inspection stages only nested APKs and leaves original OBB bytes unchanged',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-apk-container-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const apk=await writeApk(path.join(root,'base.apk')),input=path.join(root,'game.xapk'),archive=new yazl.ZipFile(),done=pipeline(archive.outputStream,createWriteStream(input));
 archive.addFile(apk,'base.apk');archive.addBuffer(Buffer.from('owned OBB fixture'),'Android/obb/com.example.game/main.7.com.example.game.obb');archive.end();await done;
 const before=sha(await fs.readFile(input)),{collectArchiveApks}=await api(),result=await collectArchiveApks(input,path.join(root,'inspection'));
 assert.equal(result.apks.length,1);assert.equal(result.obbEntries.length,1);assert.deepEqual(await fs.readFile(result.apks[0]),await fs.readFile(apk));assert.equal(sha(await fs.readFile(input)),before);assert.deepEqual(await fs.readdir(path.join(root,'inspection')),['apk-0.apk']);
});

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-android-preflight-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:50}));
 const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Game');const workspace=toolkit.workspace('Game'),input=path.join(workspace,'00_OriginalBuild/base.apk');await fs.writeFile(input,'original-base');
 const project=toolkit.read('Game');project.identities.archive={path:input,size:13,sha256:sha('original-base')};await toolkit.save('Game',project);
 let pulls=0,captures=0,adds=0;const operations=[];
 toolkit.inspectInputs=()=>({state:'missing-input',binaries:[],metadata:[]});toolkit.add=async()=>{adds++;return {}};
 const inspectSet=async files=>{
  const apks=[];for(const file of files){const bytes=await fs.readFile(file);apks.push({path:file,sha256:sha(bytes),size:bytes.length,packageName:'com.example.game',versionCode:'7',splitName:path.basename(file)==='feature.apk'?'feature':null,signing:{state:'verified',certificateSha256:['a'.repeat(64)]}});}
  return {state:apks.length>1?'complete-for-declared-requirements':'missing-splits',packageName:'com.example.game',versionCode:'7',baseSha256:apks.find(apk=>apk.splitName===null)?.sha256,apks,missingSplits:apks.length>1?[]:['feature'],missingSplitTypes:[],signing:{state:'verified',certificateSha256:['a'.repeat(64)]}};
 };
 const dependencies={inspectSet,collectApks:async archive=>({apks:[archive],obbEntries:[]}),client:{selectDevice:async serial=>serial,packagePaths:async()=>['/data/app/game/base.apk','/data/app/game/feature.apk'],obbPaths:async()=>[],size:async(serial,remote)=>remote.endsWith('base.apk')?13:7,pull:async(serial,remote,local)=>{pulls++;await fs.writeFile(local,remote.endsWith('base.apk')?'original-base':'feature');}},capture:async()=>{captures++;const directory=path.join(workspace,'captured');await fs.mkdir(directory,{recursive:true});const base=path.join(directory,'base.apk'),feature=path.join(directory,'feature.apk');await fs.writeFile(base,'original-base');await fs.writeFile(feature,'feature');return {bundle:path.join(directory,'capture.xapk'),manifest:path.join(directory,'capture.json'),files:[{entry:'base.apk'},{entry:'feature.apk'}],testApks:[base,feature]};}};
 dependencies.collectApks=async archive=>({apks:archive.endsWith('capture.xapk')?[path.join(path.dirname(archive),'base.apk'),path.join(path.dirname(archive),'feature.apk')]:[archive],obbEntries:[]});
 return {root,toolkit,workspace,input,dependencies,counts:()=>({pulls,captures,adds}),operations};
}
async function api(){const module=await import('../src/adb/preparation.js').catch(()=>({}));assert.equal(typeof module.runAndroidPreflight,'function','Android preflight must be implemented');return module;}

test('ADB preparation deadlines report pending cleanup without claiming or killing a running child',async()=>{
 const {boundedAdbRun}=await api();assert.equal(typeof boundedAdbRun,'function');
 let finished=false;let release;const child=new Promise(resolve=>{release=()=>{finished=true;resolve({code:0});};});
 const run=boundedAdbRun(()=>child,{metadataMs:10,pullMs:20});
 await assert.rejects(run('adb',['shell','echo','ok'],{}),{code:'cleanup_pending'});
 assert.equal(finished,false);release();await child;
 const {createAdbClient}=await import('../src/adb/client.js');
 await assert.rejects(createAdbClient({file:'adb.exe',run:boundedAdbRun(()=>new Promise(()=>{}),{metadataMs:5})}).devices(),{code:'cleanup_pending'});
 assert.deepEqual(await boundedAdbRun(async()=>({code:0}),{metadataMs:50})('adb',['devices'],{}),{code:0});
});

test('a captured package changing during pull preserves original input and existing outputs',async t=>{
 const f=await fixture(t),{runAndroidPreflight}=await api();let calls=0;
 f.dependencies.client.packagePaths=async()=>++calls===1?['/data/app/game/base.apk','/data/app/game/feature.apk']:['/data/app/update/base.apk','/data/app/update/feature.apk'];
 const result=await runAndroidPreflight(f.toolkit,'Game',{serial:'emulator-5554'},f.dependencies);
 assert.equal(result.state,'blocked');assert.equal(f.counts().adds,0);assert.equal(await fs.readFile(f.input,'utf8'),'original-base');
});

test('verified recovery is retained for review when downstream outputs already exist',async t=>{
 const f=await fixture(t),{runAndroidPreflight}=await api(),project=f.toolkit.read('Game');project.steps.analyze={state:'succeeded'};await f.toolkit.save('Game',project);
 const result=await runAndroidPreflight(f.toolkit,'Game',{serial:'emulator-5554'},f.dependencies);
 assert.equal(result.state,'needs-input');assert.equal(result.changedInputs,false);assert.equal(f.counts().captures,1);assert.equal(f.counts().adds,0);
});

test('Android preparation reports a missing split without guessing a device',async t=>{
 const f=await fixture(t),{runAndroidPreflight}=await api(),result=await runAndroidPreflight(f.toolkit,'Game',{},f.dependencies);
 assert.equal(result.state,'needs-input');assert(result.missingSplits.includes('feature'));assert.deepEqual(f.counts(),{pulls:0,captures:0,adds:0});
});
test('Android preparation verifies matching base before capture and set before selecting inputs',async t=>{
 const f=await fixture(t),{runAndroidPreflight}=await api(),result=await runAndroidPreflight(f.toolkit,'Game',{serial:'emulator-5554',packageName:'com.example.game'},f.dependencies);
 assert.equal(result.changedInputs,true);assert.equal(result.downloadedData.coverage,'unverified');assert.equal(f.counts().captures,1);assert.equal(f.counts().adds,1);assert.equal(f.counts().pulls,1);
 assert.equal(await fs.readFile(f.input,'utf8'),'original-base');
});
test('wrong installed base or explicit package refuses full capture and input mutation',async t=>{
 const {runAndroidPreflight}=await api();
 for(const mode of ['base','package']){
  const f=await fixture(t);if(mode==='base')f.dependencies.client.pull=async(serial,remote,file)=>fs.writeFile(file,'different-one');
  const result=await runAndroidPreflight(f.toolkit,'Game',{serial:'emulator-5554',packageName:mode==='package'?'com.other.game':'com.example.game'},f.dependencies);
  assert.equal(result.state,'blocked');assert.equal(f.counts().captures,0);assert.equal(f.counts().adds,0);
 }
});
test('unverified signing or a changed captured set cannot authorize source replacement',async t=>{
 const {runAndroidPreflight}=await api();
 for(const mode of ['signer','capture']){
  const f=await fixture(t),inspect=f.dependencies.inspectSet;f.dependencies.inspectSet=async files=>{const result=await inspect(files);if(mode==='signer')result.signing.state='unverified';if(mode==='capture'&&files.length>1)result.baseSha256='f'.repeat(64);return result;};
  const result=await runAndroidPreflight(f.toolkit,'Game',{serial:'emulator-5554'},f.dependencies);
  assert.equal(result.state,'blocked');assert.equal(f.counts().adds,0);
 }
});
