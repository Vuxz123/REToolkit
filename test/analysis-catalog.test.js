import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {classifyAnalysisTarget,parseMethodCatalog,analysisTargets} from '../src/ghidra/analysis-catalog.js';
import {createToolkit} from '../src/toolkit.js';
import {setStep,outputManifest} from '../src/state.js';
import {stepFingerprint} from '../src/inputs.js';
test('SDK hints respect namespace boundaries, retain unknown and supporting dependencies',()=>{
 assert.equal(classifyAnalysisTarget({namespace:'GoogleMobileAds.Api',type:'RewardedAd'}).category,'sdk-excluded');
 assert.equal(classifyAnalysisTarget({namespace:'Firebase.Analytics',type:'FirebaseAnalytics'}).category,'sdk-excluded');
 for(const ns of ['GoogleMobileAdsGame','Firebase.RemoteConfig','MyGame.AnalyticsPuzzle'])assert.notEqual(classifyAnalysisTarget({namespace:ns,type:'Controller'}).category,'sdk-excluded');
 assert.equal(classifyAnalysisTarget({namespace:'DG.Tweening',type:'Tween'}).category,'support');
 assert.equal(classifyAnalysisTarget({namespace:'Game',type:'BoardController'}).category,'gameplay-candidate');
 assert.equal(classifyAnalysisTarget({namespace:'',type:'a'}).category,'unknown');
 assert.notEqual(classifyAnalysisTarget({namespace:'Game',type:'AdsManager',method:'ShowRewarded'}).category,'sdk-excluded');
});
test('catalog pages bind verified dump bytes and preserve excluded/unknown targets and input freshness',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-catalog-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Game');
 const input=path.join(root,'input');fs.mkdirSync(input);fs.writeFileSync(path.join(input,'libil2cpp.so'),'owned');fs.writeFileSync(path.join(input,'global-metadata.dat'),'owned');await toolkit.scan('Game',input);
 const p=toolkit.read('Game'),file=path.join(p.il2cppDumperOutput,'dump.cs');
 const method=(ns,type,rva,name)=>`// Namespace: ${ns}\npublic class ${type} // TypeDefIndex: 1\n// RVA: ${rva} Offset: 0x1 VA: ${rva}\npublic void ${name}() { }\n`;
 fs.writeFileSync(file,method('GoogleMobileAds.Api','Ad','0x1','Show')+method('Game','BoardController','0x20000000000001','Move')+method('','a','0x3','b'));
 const attest=async()=>{setStep(p,'dump','succeeded',stepFingerprint(p,'dump',toolkit.tools,toolkit.root),outputManifest([file]));await toolkit.save('Game',p);};await attest();
 const first=await analysisTargets(toolkit,'Game',{limit:1});assert.equal(first.items[0].method,'Move');assert.equal(first.items[0].rva,'0x20000000000001');assert(first.nextCursor);assert.equal(first.counts.excluded,1);
 const second=await analysisTargets(toolkit,'Game',{limit:1,cursor:first.nextCursor});assert.equal(second.items[0].category,'unknown');assert.equal(second.nextCursor,null);
 assert.equal((await analysisTargets(toolkit,'Game',{focus:'all'})).items.length,3);
 await assert.rejects(analysisTargets(toolkit,'Game',{focus:'all',cursor:first.nextCursor}),{code:'invalid_cursor'});
 fs.appendFileSync(file,method('Game','LevelManager','0x4','Start'));await attest();await assert.rejects(analysisTargets(toolkit,'Game',{cursor:first.nextCursor}),{code:'revision_conflict'});
 fs.appendFileSync(file,'x'.repeat(70000)+'\n');await attest();await assert.rejects(analysisTargets(toolkit,'Game'),{code:'request_limit'});
 fs.writeFileSync(p.nativeBinary,'different');await assert.rejects(analysisTargets(toolkit,'Game'),{code:'input_changed'});
});
test('catalog streams methods with exact addresses and never guesses a function end',async()=>{
 const lines=['// Image 0: Assembly-CSharp.dll - 0','// Image 1: GoogleMobileAds.dll - 2','// Namespace: Game','public class BoardController // TypeDefIndex: 1','{','// RVA: 0x20000000000001 Offset: 0x1 VA: 0x20000000100001','public void Move() { }','// RVA: 0x0 Offset: 0x0 VA: 0x0','public void Missing() { }','}','// Namespace: GoogleMobileAds.Api','public class RewardedAd // TypeDefIndex: 2','// RVA: 0x50 Offset: 0x50 VA: 0x100050','public void Show() { }'];
 async function* source(){for(const line of lines)yield line;}
 const rows=[];for await(const row of parseMethodCatalog(source()))rows.push(row);
 assert.equal(rows.length,2);assert.equal(rows[0].rva,'0x20000000000001');assert.equal(rows[0].va,'0x20000000100001');assert.equal(rows[0].method,'Move');assert.equal(rows[0].assembly,'Assembly-CSharp');assert.equal(rows[1].category,'sdk-excluded');assert.equal(rows[0].endAddress,undefined);
});
