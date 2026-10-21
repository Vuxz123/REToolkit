import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {captureBundle} from '../src/adb/capture.js';
import {extractZip} from '../src/archive.js';
import {fileIdentity} from '../src/state.js';

function setup(t,overrides={}){
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'retk-adb-capture-'));t.after(()=>fs.rmSync(workspace,{recursive:true,force:true}));
 const calls=[],client={
  packagePaths:async()=>['/data/app/com.example.game/base.apk','/data/app/com.example.game/split_config.arm64.apk'],
  obbPaths:async()=>['/sdcard/Android/obb/com.example.game/main.1.com.example.game.obb'],
  launch:async()=>calls.push('launch'),
  size:async(serial,remote)=>Buffer.byteLength('owned fixture: '+remote),
  pull:async(serial,remote,local)=>{calls.push(remote);fs.writeFileSync(local,Buffer.from('owned fixture: '+remote));},...overrides
 };
 const options={workspace,packageName:'com.example.game',serial:'emulator-5554',client,skipLaunch:true};
 return {workspace,calls,client,options};
}
test('capture publishes verified base, splits, OBB and embedded inventory exclusively',async t=>{
 const {workspace,calls,options}=setup(t);const old=path.join(workspace,'00_OriginalBuild/older.xapk');fs.mkdirSync(path.dirname(old));fs.writeFileSync(old,'previous bundle');
 const result=await captureBundle(options);assert.equal(result.state,'captured');assert.equal(result.files.length,3);assert.equal(calls.length,3);assert.equal(fs.readFileSync(old,'utf8'),'previous bundle');
 assert.equal(result.archive.sha256,fileIdentity(result.bundle).sha256);assert.equal(path.dirname(result.bundle),path.join(workspace,'00_OriginalBuild'));
 const extracted=path.join(workspace,'verify');await extractZip(result.bundle,extracted);const inventory=JSON.parse(fs.readFileSync(path.join(extracted,'retk-capture.json')));assert.equal(inventory.serial,'emulator-5554');
 for(const item of result.files){assert.equal(fileIdentity(path.join(extracted,item.entry)).sha256,item.sha256);assert.ok(item.size>0);}
 assert.equal(fs.existsSync(path.join(result.staging,'payload')),false,'completed payload staging can be removed after durable publication');
 assert.ok(fs.existsSync(result.manifest));
});
test('duplicate or case-colliding APK/OBB basenames are rejected before any pull',async t=>{
 for(const apks of [['/a/base.apk','/b/base.apk'],['/a/Base.apk','/b/base.apk']]){
  const {options,calls}=setup(t,{packagePaths:async()=>apks});await assert.rejects(captureBundle(options),/collid|duplicate/i);assert.deepEqual(calls,[]);
 }
});
test('unsafe names, remote paths and inputs fail before pulls',async t=>{
 for(const value of ['/a/../base.apk','/a/base.apk;touch','/a/CON.apk','/a/base.apk:stream']){
  const {options,calls}=setup(t,{packagePaths:async()=>[value]});await assert.rejects(captureBundle(options),/unsafe|invalid/i);assert.deepEqual(calls,[]);
 }
 const {options,calls}=setup(t);await assert.rejects(captureBundle({...options,packageName:'com.x;echo'}),/package|invalid/i);assert.deepEqual(calls,[]);
 await assert.rejects(captureBundle({...options,serial:'x;echo'}),/serial|invalid/i);assert.deepEqual(calls,[]);
});
test('failed or empty pulls preserve diagnostics and never publish a bundle',async t=>{
 for(const mode of ['failed','empty','missing','unexpected']){
  const {workspace,options}=setup(t,{pull:async(serial,remote,local)=>{
   if(mode==='missing')return;
   fs.writeFileSync(local,mode==='empty'?'':'partial');
   if(mode==='unexpected')fs.writeFileSync(path.join(path.dirname(local),'unrequested.bin'),'extra');
   if(mode==='failed')throw Error('ADB fixture failed');
  }});
  await assert.rejects(captureBundle(options),error=>{assert.match(error.message,/staging/i);return true;});
  assert.equal(fs.existsSync(path.join(workspace,'00_OriginalBuild')),false);
  assert.equal(fs.readdirSync(workspace).filter(name=>name.startsWith('.adb-capture-')).length,1);
 }
});
test('zero-exit partial pulls and changing remote sizes cannot establish capture success',async t=>{
 for(const mode of ['partial','changed']){
  let observed=0;const {workspace,options}=setup(t,{size:async(serial,remote)=>Buffer.byteLength('owned fixture: '+remote)+(mode==='partial'?1:(observed++?1:0))});
  await assert.rejects(captureBundle(options),/size|changed|staging/i);assert.equal(fs.existsSync(path.join(workspace,'00_OriginalBuild')),false);
 }
});
test('links in requested output ancestors are refused and empty APK metadata cannot succeed',async t=>{
 const {workspace,options}=setup(t,{packagePaths:async()=>[]});await assert.rejects(captureBundle(options),/APK|empty/i);assert.equal(fs.existsSync(path.join(workspace,'00_OriginalBuild')),false);
 const outside=fs.mkdtempSync(path.join(os.tmpdir(),'retk-adb-linked-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));fs.symlinkSync(outside,path.join(workspace,'00_OriginalBuild'),'junction');
 options.client.packagePaths=async()=>['/a/base.apk'];await assert.rejects(captureBundle(options),/link|junction/i);assert.deepEqual(fs.readdirSync(outside),[]);
});
test('interactive launch requires a confirmation callback and re-reads current APK paths',async t=>{
 const {options,calls}=setup(t);await assert.rejects(captureBundle({...options,skipLaunch:false}),/interactive|confirmation/i);assert.deepEqual(calls,[]);
 let scans=0;options.client.packagePaths=async()=>++scans===1?['/old/base.apk']:['/new/base.apk','/new/split.apk'];
 const result=await captureBundle({...options,skipLaunch:false,confirm:async()=>calls.push('confirmed')});
 assert.deepEqual(calls.slice(0,2),['launch','confirmed']);assert.equal(scans,2);assert.equal(result.files.some(item=>item.remote==='/old/base.apk'),false,'capture current paths rather than stale duplicate base paths');
});
