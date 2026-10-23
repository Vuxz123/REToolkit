import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import yazl from 'yazl';
import {buildDesktopCommand} from '../src/desktop/operations.js';
import {createToolkit} from '../src/toolkit.js';
import {createApkProject} from '../src/desktop/projects.js';
import {buildResultModel} from '../src/desktop/result-model.js';
const revision='a'.repeat(64);
test('successful extraction awaiting ABI selection is an actionable warning',()=>{
 const model=buildResultModel({operation:'workspace.add',state:'succeeded',result:{name:'Game',inputSelection:{state:'needs-selection'},steps:{extract:{state:'succeeded'},scan:{state:'awaiting-user'}}}});assert.equal(model.status.tone,'warn');
});
test('desktop selection uses exact candidates and revision without arbitrary command fields',()=>{
 assert.deepEqual(buildDesktopCommand('project.inputs.select',{name:'Game',binary:'lib/arm64-v8a/libil2cpp.so',metadata:'assets/global-metadata.dat',revision}),['inputs','select','Game','--binary','lib/arm64-v8a/libil2cpp.so','--metadata','assets/global-metadata.dat','--revision',revision]);
 assert.deepEqual(buildDesktopCommand('project.inputs.recover',{name:'Game',revision}),['inputs','recover','Game','--revision',revision]);
 for(const extra of [{binary:'../bad'},{binary:'C:/bad'},{metadata:'--root'},{revision:'wrong'},{command:'calc.exe'}])assert.throws(()=>buildDesktopCommand('project.inputs.select',{name:'Game',binary:'lib/libil2cpp.so',metadata:'global-metadata.dat',revision,...extra}));
});
test('desktop multi-ABI intake selects canonical ARM64 inputs by policy',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-desktop-abi-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const input=path.join(root,'fixture.apk'),zip=new yazl.ZipFile();
 for(const abi of ['arm64-v8a','armeabi-v7a']){const header=Buffer.alloc(64);header.set([127,69,76,70,2,1]);header.writeUInt16LE(abi==='arm64-v8a'?183:40,18);zip.addBuffer(header,`lib/${abi}/libil2cpp.so`);}zip.addBuffer(Buffer.from('metadata'),'assets/global-metadata.dat');zip.end();const stream=fs.createWriteStream(input);zip.outputStream.pipe(stream);await once(stream,'close');
 const toolkit=createToolkit(root,{log:()=>{},run:()=>{throw Error('No native execution');}}),result=await createApkProject(toolkit,'Fixture',input);
 assert.equal(result.state,'created');assert.equal(result.inputSelection.source.location,'canonical');assert.equal(result.inputSelection.binaries.length,2);assert.equal(result.inputSelection.metadata.length,1);assert.equal(result.inputSelection.selection.binary,'lib/arm64-v8a/libil2cpp.so');assert.equal(result.inputSelection.selection.reason,'abi-preference');assert.equal(toolkit.read('Fixture').steps.extract.state,'succeeded');assert.equal(toolkit.read('Fixture').steps.scan.state,'succeeded');assert.notEqual(toolkit.read('Fixture').steps.import.state,'succeeded');
});
