import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createToolkit} from '../src/toolkit.js';

const metadata='assets/global-metadata.dat';
function elf(machine){const bytes=Buffer.alloc(64);bytes.set([127,69,76,70,2,1]);bytes.writeUInt16LE(machine,18);return bytes;}
async function fixture(t,entries){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-abi-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'source');fs.mkdirSync(source);
 for(const [name,data]of Object.entries(entries)){const file=path.join(source,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);}
 return {root,source,toolkit:createToolkit(root,{log:()=>{},run:()=>{throw Error('No engines allowed');}})};
}
const binaries={'lib/arm/libil2cpp.so':elf(40),'lib/x64/libil2cpp.so':elf(62),'lib/arm64/libil2cpp.so':elf(183),'lib/x86/libil2cpp.so':elf(3)};
test('default ABI preference uses ELF headers and persists selection provenance',async t=>{
 const {toolkit,source}=await fixture(t,{...binaries,[metadata]:'metadata'});const project=await toolkit.scan('Game',source);
 assert.equal(project.platform,'arm64-v8a');assert.equal(project.selection.reason,'abi-preference');assert.equal(project.selection.policy,'prefer-arm64');
 assert.equal(project.inputSelection.recommendation.abi,'arm64-v8a');
 await toolkit.scan('Game',source,{binary:'lib/arm/libil2cpp.so'});const result=await toolkit.resolveInputs('Game');assert.equal(result.selection.abi,'armeabi-v7a');assert.equal(result.selection.reason,'explicit');assert.equal(result.state,'selected');
});
test('one-call resolve selects unresolved canonical inputs and returns a bounded result',async t=>{
 const {toolkit,source}=await fixture(t,{...binaries,[metadata]:'metadata'});await toolkit.init('Game');
 fs.cpSync(source,path.join(toolkit.workspace('Game'),'01_Extracted'),{recursive:true});
 const result=await toolkit.resolveInputs('Game');assert.equal(result.state,'selected');assert.equal(result.selection.abi,'arm64-v8a');assert.equal(result.selection.reason,'abi-preference');assert.equal(result.policy,'prefer-arm64');assert.equal(result.candidates.binaryCount,4);assert.equal(result.binaries,undefined);assert.ok(JSON.stringify(result).length<6000);assert.equal(toolkit.read('Game').steps.dump.state==='succeeded',false);
});
test('manual policy persists and resolve does not select it implicitly',async t=>{
 const {toolkit,source}=await fixture(t,{...binaries,[metadata]:'metadata'});await toolkit.init('Game');fs.cpSync(source,path.join(toolkit.workspace('Game'),'01_Extracted'),{recursive:true});
 const result=await toolkit.resolveInputs('Game',{policy:'manual'});assert.equal(result.state,'needs-selection');assert.equal(result.policy,'manual');assert.equal(toolkit.read('Game').inputPolicy,'manual');assert.equal((await toolkit.resolveInputs('Game')).state,'needs-selection');
});
test('same preferred ABI, unknown competitor and ambiguous metadata remain unresolved',async t=>{
 for(const [name,entries]of Object.entries({duplicate:{...binaries,'another/libil2cpp.so':elf(183),[metadata]:'m'},unknown:{...binaries,'unknown/libil2cpp.so':'invalid',[metadata]:'m'},metadata:{...binaries,[metadata]:'m','another/global-metadata.dat':'m'}})){
  const {toolkit,source}=await fixture(t,entries);await toolkit.init(name);fs.cpSync(source,path.join(toolkit.workspace(name),'01_Extracted'),{recursive:true});assert.equal((await toolkit.resolveInputs(name)).state,'needs-selection');assert.equal(toolkit.read(name).nativeBinary,null);
 }
});
test('resolve reports missing inputs and caps candidate diagnostics',async t=>{
 const entries=Object.fromEntries(Array.from({length:20},(_,i)=>[`copy${i}/libil2cpp.so`,elf(183)]));const {toolkit,source}=await fixture(t,entries);await toolkit.init('Missing');fs.cpSync(source,path.join(toolkit.workspace('Missing'),'01_Extracted'),{recursive:true});const result=await toolkit.resolveInputs('Missing');assert.equal(result.state,'missing-input');assert.equal(result.candidates.binaryCount,20);assert.ok(result.candidates.binaries.length<=8);assert.equal(result.candidates.truncated,true);
});

test('typed CLI resolve needs no revision and rejects selection-only flags',async t=>{
 const {toolkit,source,root}=await fixture(t,{...binaries,[metadata]:'metadata'});await toolkit.init('Cli');fs.cpSync(source,path.join(toolkit.workspace('Cli'),'01_Extracted'),{recursive:true});
 const {spawnSync}=await import('node:child_process');const invoke=args=>spawnSync(process.execPath,[path.resolve('re.js'),'inputs','resolve','Cli','--root',root,'--json',...args],{encoding:'utf8'});
 let result=invoke([]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).selection.abi,'arm64-v8a');
 result=invoke(['--policy','manual']);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).policy,'manual');
 for(const args of [['--policy','bad'],['--revision','a'.repeat(64)],['--binary','lib/arm/libil2cpp.so']])assert.equal(invoke(args).status,1);
});
test('resolve rejects candidate mutation during identity hashing without publishing selection',async t=>{
 const {toolkit,source}=await fixture(t,{...binaries,[metadata]:'metadata'});await toolkit.init('Race');const destination=path.join(toolkit.workspace('Race'),'01_Extracted');fs.cpSync(source,destination,{recursive:true});
 const original=fs.readSync;let changed=false;
 fs.readSync=(fd,buffer,...args)=>{const result=original(fd,buffer,...args);if(buffer.length===65536&&!changed){changed=true;fs.appendFileSync(path.join(destination,metadata),'changed');}return result;};
 try{await assert.rejects(toolkit.resolveInputs('Race'),{code:'INPUT_REVISION_CHANGED'});}finally{fs.readSync=original;}
 assert.equal(toolkit.read('Race').nativeBinary,null);
});
test('resolve recovers only safe recorded legacy staging and preserves evidence',async t=>{
 const {toolkit,source}=await fixture(t,{...binaries,[metadata]:'metadata'});await toolkit.init('Legacy');const stage=path.join(toolkit.workspace('Legacy'),'.extract-legacy');fs.cpSync(source,stage,{recursive:true});
 const project=toolkit.read('Legacy');project.steps.extract.state='failed';project.steps.extract.error=`Ambiguous binary; staging: ${stage}`;await toolkit.save('Legacy',project);
 const result=await toolkit.resolveInputs('Legacy');assert.equal(result.state,'selected');const persisted=toolkit.read('Legacy');assert.equal(persisted.selection.abi,'arm64-v8a');assert.ok(fs.existsSync(persisted.recoveryReceipt.projectBackup));assert.match(persisted.recoveryReceipt.previousExtractError,/Ambiguous/);
});

test('pending replacement keeps valid remembered ABI and refuses an absent prior binary',async t=>{
 for(const keepPrior of [true,false]){
  const {toolkit,source,root}=await fixture(t,{...binaries,[metadata]:'metadata'});await toolkit.scan('Pending',source,{binary:'lib/arm/libil2cpp.so'});
  const stage=path.join(toolkit.workspace('Pending'),'.extract-pending');fs.cpSync(source,stage,{recursive:true});if(!keepPrior)fs.rmSync(path.join(stage,'lib/arm/libil2cpp.so'));
  const project=toolkit.read('Pending');project.pendingExtraction={stage,fingerprint:'fixture',archive:null};await toolkit.save('Pending',project);
  const result=await toolkit.resolveInputs('Pending');assert.equal(result.state,keepPrior?'selected':'needs-selection');assert.equal(toolkit.read('Pending').platform,'armeabi-v7a');if(!keepPrior)assert.equal(toolkit.read('Pending').nativeBinary,path.join(source,'lib/arm/libil2cpp.so'));
 }
});

test('fresh archive auto selection retains policy provenance across canonical publication and reuse',async t=>{
 const {toolkit,root}=await fixture(t,{[metadata]:'m'});const {default:yazl}=await import('yazl');const {pipeline}=await import('node:stream/promises');const zip=new yazl.ZipFile();for(const [name,data]of Object.entries({...binaries,[metadata]:Buffer.from('metadata')}))zip.addBuffer(data,name);zip.end();const archive=path.join(root,'fixture.apk');await pipeline(zip.outputStream,fs.createWriteStream(archive));
 for(let attempt=0;attempt<2;attempt++){const project=await toolkit.add('Archive',archive);assert.equal(project.platform,'arm64-v8a');assert.equal(project.selection.reason,'abi-preference');assert.equal(project.selection.policy,'prefer-arm64');assert.equal(project.inputSelection.selection.abi,'arm64-v8a');assert.equal(project.inputSelection.selection.reason,'abi-preference');assert.ok(project.nativeBinary.startsWith(path.join(toolkit.workspace('Archive'),'01_Extracted')));}
});

test('explicit and current selections do not inspect unrelated binaries to choose an ABI',async t=>{
 const {toolkit,source}=await fixture(t,{...binaries,[metadata]:'metadata'});const open=fs.openSync;
 fs.openSync=(file,...args)=>{if(String(file)===path.join(source,'lib/x64/libil2cpp.so'))throw Error('Unrelated binary unavailable');return open(file,...args);};
 // scan attaches a complete inventory after selection, so exercise the selection primitive directly.
 const {selectInputs}=await import('../src/inputs.js');const project=toolkit.read;const state={identities:{},steps:{}};
 try{selectInputs(state,source,{binary:'lib/arm/libil2cpp.so'});assert.equal(state.selection.abi,'armeabi-v7a');selectInputs(state,source);assert.equal(state.selection.abi,'armeabi-v7a');}finally{fs.openSync=open;}
});
