import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {captureBundle} from '../src/adb/capture.js';import {extractZip} from '../src/archive.js';
function fixture(t,{denied=false,fail=false}={}){const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'retk-full-data-'));t.after(()=>fs.rmSync(workspace,{recursive:true,force:true}));const bytes=Buffer.from([0,255,13,10,128]),calls=[];
 const client={packagePaths:async()=>['/data/app/com.example.game/base.apk'],obbPaths:async()=>[],size:async()=>3,pull:async(_s,_r,file)=>fs.writeFileSync(file,'apk')};
 const dataClient={inspect:async()=>({scopes:[{id:'external',state:'available',access:'shell',root:'/sdcard/Android/data/com.example.game',files:[{relative:'files/level.dat',size:bytes.length}]},{id:'private',state:denied?'denied':'available',access:denied?'none':'run-as',root:'/data/user/0/com.example.game',files:denied?[]:[{relative:'databases/save.db',size:bytes.length}]}]}),pull:async(_s,_p,scope,item,file)=>{calls.push(scope.id);fs.writeFileSync(file,bytes);if(fail)throw Error('fixture disconnect');}};
 return {workspace,bytes,calls,options:{workspace,packageName:'com.example.game',serial:'emulator-5554',skipLaunch:true,includeData:true,client,dataClient}};
}
test('full package keeps app data separate from install XAPK with exact binary bytes and scope coverage',async t=>{
 const f=fixture(t),result=await captureBundle(f.options);assert.equal(result.applicationData.coverage,'complete');assert.equal(result.applicationData.files,2);assert.deepEqual(f.calls,['external','private']);
 const apk=path.join(f.workspace,'verify-apk'),data=path.join(f.workspace,'verify-data');await extractZip(result.bundle,apk);await extractZip(result.applicationData.bundle,data);
 assert.equal(fs.existsSync(path.join(apk,'private')),false);assert.deepEqual(fs.readFileSync(path.join(data,'private/com.example.game/databases/save.db')),f.bytes);assert.deepEqual(fs.readFileSync(path.join(data,'Android/data/com.example.game/files/level.dat')),f.bytes);
 const manifest=JSON.parse(fs.readFileSync(path.join(data,'retk-app-data.json')));assert.equal(manifest.scopes.length,2);assert.equal(manifest.files.length,2);assert.ok(manifest.files.every(item=>/^[a-f0-9]{64}$/.test(item.sha256)));assert.equal(fs.existsSync(path.join(result.staging,'data-payload')),false);
});
test('denied private data is explicit partial coverage and never reported as complete',async t=>{
 const f=fixture(t,{denied:true}),result=await captureBundle(f.options);assert.equal(result.applicationData.coverage,'partial');assert.equal(result.applicationData.scopes.find(scope=>scope.id==='private').state,'denied');assert.equal(result.applicationData.files,1);assert.equal(result.state,'captured');
});
test('failed app data pull retains diagnostics and does not publish a successful capture',async t=>{
 const f=fixture(t,{fail:true});await assert.rejects(captureBundle(f.options),/disconnect|staging/);assert.equal(fs.existsSync(path.join(f.workspace,'00_OriginalBuild')),false);assert.ok(fs.readdirSync(f.workspace).some(name=>name.startsWith('.adb-capture-')));
});
test('unexpected app data scope or unsafe relative file fails before data pull',async t=>{
 const f=fixture(t);f.options.dataClient.inspect=async()=>({scopes:[{id:'private',state:'available',access:'shell',files:[{relative:'../outside',size:5}]},{id:'external',state:'absent',access:'none',files:[]}]});await assert.rejects(captureBundle(f.options),/unsafe|invalid/i);assert.deepEqual(f.calls,[]);
});
