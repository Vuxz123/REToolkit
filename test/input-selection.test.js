import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pipeline} from 'node:stream/promises';
import {spawnSync} from 'node:child_process';
import yazl from 'yazl';
import {createToolkit} from '../src/toolkit.js';

const binary='lib/arm64-v8a/libil2cpp.so', other='lib/armeabi-v7a/libil2cpp.so', metadata='assets/bin/Data/Managed/Metadata/global-metadata.dat';
function elf(machine){const data=Buffer.alloc(64);data.set([127,69,76,70,2,1]);data.writeUInt16LE(machine,18);return data;}
async function fixture(t,entries={[binary]:elf(183),[other]:elf(40),[metadata]:Buffer.from('metadata')}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-inputs-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'fixture.apk'),zip=new yazl.ZipFile();for(const [name,data]of Object.entries(entries))zip.addBuffer(data,name);zip.end();await pipeline(zip.outputStream,fs.createWriteStream(source));
 const toolkit=createToolkit(root,{inputPolicy:'manual',log:()=>{},run:()=>{throw Error('Fixture must never execute engines');}});return {root,source,toolkit};
}
test('first multi-ABI import publishes canonical extraction and waits for explicit selection',async t=>{
 const {toolkit,source}=await fixture(t);const project=await toolkit.add('Game',source);
 assert.equal(project.steps.extract.state,'succeeded');assert.equal(project.steps.scan.state,'awaiting-user');assert.equal(project.nativeBinary,null);assert.equal(project.metadata,null);assert.equal(project.inputSelection.state,'needs-selection');
 assert.equal(fs.existsSync(path.join(toolkit.workspace('Game'),'01_Extracted',other)),true);
 const before=fs.readFileSync(toolkit.projectPath('Game'));const view=await toolkit.inspectInputs('Game');assert.deepEqual(fs.readFileSync(toolkit.projectPath('Game')),before);
 assert.equal(view.source.location,'canonical');assert.deepEqual(view.binaries.map(item=>item.abi),['arm64-v8a','armeabi-v7a']);assert.equal(view.canSelect,true);assert.match(view.revision,/^[a-f0-9]{64}$/);
 const selected=await toolkit.selectBuildInputs('Game',{binary,metadata,revision:view.revision});assert.equal(selected.steps.scan.state,'succeeded');assert.equal(selected.platform,'arm64-v8a');assert.equal(selected.inputSelection.state,'selected');assert.equal(selected.steps.import.state==='succeeded',false);
});
test('missing pair is extracted successfully and flow returns before engine execution',async t=>{
 const {toolkit,source}=await fixture(t,{[metadata]:Buffer.from('metadata')});const project=await toolkit.flow('Game',source,{noOpen:true});
 assert.equal(project.steps.extract.state,'succeeded');assert.equal(project.steps.scan.state,'awaiting-user');assert.equal(project.inputSelection.state,'missing-input');assert.notEqual(project.steps.dump.state,'succeeded');
});
test('selection rejects stale revisions and candidates outside the exact inventory',async t=>{
 const {toolkit,source}=await fixture(t);await toolkit.add('Game',source);const view=await toolkit.inspectInputs('Game');
 await assert.rejects(toolkit.selectBuildInputs('Game',{binary:'../libil2cpp.so',metadata,revision:view.revision}),/candidate|relative/i);
 fs.appendFileSync(path.join(view.source.path,binary),'changed');await assert.rejects(toolkit.selectBuildInputs('Game',{binary,metadata,revision:view.revision}),{code:'INPUT_REVISION_CHANGED'});
 assert.equal(toolkit.read('Game').nativeBinary,null);
});
test('ambiguous replacement keeps selected project and canonical bytes until explicit choice',async t=>{
 const {toolkit,source,root}=await fixture(t);const folder=path.join(root,'original');fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'libil2cpp.so'),elf(183));fs.writeFileSync(path.join(folder,'global-metadata.dat'),'old');await toolkit.scan('Game',folder);
 const old=toolkit.read('Game').nativeBinary;const canonical=path.join(toolkit.workspace('Game'),'01_Extracted');fs.writeFileSync(path.join(canonical,'retained.txt'),'old extraction');
 await assert.rejects(toolkit.add('Game',source),/Ambiguous binary|not a candidate/);assert.equal(toolkit.read('Game').nativeBinary,old);assert.equal(fs.readFileSync(path.join(canonical,'retained.txt'),'utf8'),'old extraction');
 const view=await toolkit.inspectInputs('Game');assert.equal(view.source.location,'staging');assert.equal(view.canRecover,false);assert.equal(view.canSelect,true);
 const project=await toolkit.selectBuildInputs('Game',{binary:other,metadata,revision:view.revision});assert.equal(project.platform,'armeabi-v7a');assert.equal(project.steps.extract.state,'succeeded');assert.equal(fs.existsSync(path.join(canonical,other)),true);
});
test('legacy failed first import recovers only recorded staging and preserves error evidence',async t=>{
 const {toolkit}=await fixture(t);await toolkit.init('Legacy');const directory=toolkit.workspace('Legacy'),stage=path.join(directory,'.extract-legacy-fixture');fs.mkdirSync(stage);for(const [relative,bytes]of Object.entries({[binary]:elf(183),[other]:elf(40),[metadata]:Buffer.from('metadata')})){const file=path.join(stage,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
 const project=toolkit.read('Legacy');project.steps.extract.state='failed';project.steps.extract.error=`Ambiguous binary; staging: ${stage}`;await toolkit.save('Legacy',project);
 const view=await toolkit.inspectInputs('Legacy');assert.equal(view.canRecover,true);assert.equal(view.canSelect,false);assert.equal(fs.existsSync(stage),true);
 const recovered=await toolkit.recoverInputs('Legacy',{revision:view.revision});assert.equal(recovered.nativeBinary,null);assert.equal(recovered.steps.extract.state,'succeeded');assert.equal(recovered.steps.scan.state,'awaiting-user');assert.equal(recovered.inputSelection.source.location,'canonical');assert.match(recovered.recoveryReceipt.previousExtractError,/Ambiguous binary/);assert.equal(fs.existsSync(recovered.recoveryReceipt.projectBackup),true);
});
test('recovery refuses nonempty canonical, escaped stages and linked candidate trees',async t=>{
 const {toolkit,root}=await fixture(t);await toolkit.init('Unsafe');let project=toolkit.read('Unsafe');const stage=path.join(toolkit.workspace('Unsafe'),'.extract-fixture');fs.mkdirSync(stage);fs.writeFileSync(path.join(stage,'libil2cpp.so'),elf(183));fs.writeFileSync(path.join(stage,'global-metadata.dat'),'metadata');project.steps.extract.state='failed';project.steps.extract.error=`Ambiguous binary; staging: ${stage}`;await toolkit.save('Unsafe',project);
 let view=await toolkit.inspectInputs('Unsafe');fs.writeFileSync(path.join(toolkit.workspace('Unsafe'),'01_Extracted/retained'),'old');await assert.rejects(toolkit.recoverInputs('Unsafe',{revision:view.revision}),{code:'INPUT_REVISION_CHANGED'});
 project=toolkit.read('Unsafe');project.steps.extract.error=`Ambiguous binary; staging: ${root}`;await toolkit.save('Unsafe',project);view=await toolkit.inspectInputs('Unsafe');assert.equal(view.canRecover,false);assert.equal(view.source.location,'canonical');
 fs.symlinkSync(root,path.join(stage,'linked'),'junction');project.steps.extract.error=`Ambiguous binary; staging: ${stage}`;await toolkit.save('Unsafe',project);assert.throws(()=>toolkit.inspectInputs('Unsafe'),/link|junction/i);
});
test('typed inputs CLI inspects and selects exact candidates without engines',async t=>{
 const {toolkit,source,root}=await fixture(t);await toolkit.add('CliGame',source);
 const invoke=args=>spawnSync(process.execPath,[path.resolve('re.js'),'inputs',...args,'--root',root,'--json'],{encoding:'utf8'});
 let result=invoke(['CliGame']);assert.equal(result.status,0,result.stderr);const view=JSON.parse(result.stdout);assert.equal(view.state,'needs-selection');
 result=invoke(['select','CliGame','--binary',binary,'--metadata',metadata,'--revision',view.revision]);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).inputSelection.state,'selected');
 for(const args of [['select','CliGame'],['CliGame','--unknown'],['recover','CliGame','--binary',binary,'--revision',view.revision],['select','CliGame','--binary',binary,'--binary',other,'--metadata',metadata,'--revision',view.revision]]){result=invoke(args);assert.equal(result.status,1);}
});
test('legacy extraction failures cannot publish a partial stage with valid-looking candidates',async t=>{
 const {toolkit}=await fixture(t);await toolkit.init('Corrupt');const stage=path.join(toolkit.workspace('Corrupt'),'.extract-corrupt');fs.mkdirSync(stage);fs.writeFileSync(path.join(stage,'libil2cpp.so'),elf(183));fs.writeFileSync(path.join(stage,'global-metadata.dat'),'metadata');
 const project=toolkit.read('Corrupt');project.steps.extract.state='failed';project.steps.extract.error=`Invalid ZIP CRC after partial extraction; staging: ${stage}`;await toolkit.save('Corrupt',project);
 const view=toolkit.inspectInputs('Corrupt');assert.equal(view.canRecover,false);assert.equal(view.source.location,'canonical');await assert.rejects(toolkit.recoverInputs('Corrupt',{revision:view.revision}),{code:'INPUT_RECOVERY_UNSAFE'});assert.equal(fs.existsSync(stage),true);
});
test('candidate IO errors remain failed extraction instead of awaiting selection',async t=>{
 const {toolkit,source}=await fixture(t,{[binary]:elf(183),[metadata]:Buffer.from('metadata')});const open=fs.openSync;
 fs.openSync=(file,...args)=>{if(String(file).includes('.extract-')&&String(file).endsWith('libil2cpp.so'))throw Error('Fixture candidate IO failure');return open(file,...args);};
 try{await assert.rejects(toolkit.add('IoFailure',source),/Fixture candidate IO failure/);}finally{fs.openSync=open;}
 assert.equal(toolkit.read('IoFailure').steps.extract.state,'failed');assert.equal(fs.readdirSync(path.join(toolkit.workspace('IoFailure'),'01_Extracted')).length,0);
});
test('a later extraction failure cannot expose an older pending staging selection',async t=>{
 const {toolkit,source,root}=await fixture(t);await toolkit.init('Latest');fs.writeFileSync(path.join(toolkit.workspace('Latest'),'01_Extracted/retained'),'old');await assert.rejects(toolkit.add('Latest',source),/Ambiguous/);const oldView=toolkit.inspectInputs('Latest');assert.equal(oldView.source.location,'staging');
 const broken=path.join(root,'broken.apk');fs.writeFileSync(broken,'corrupt zip');await assert.rejects(toolkit.add('Latest',broken));const view=toolkit.inspectInputs('Latest');assert.equal(view.source.location,'canonical');assert.equal(view.canRecover,false);assert.equal(fs.existsSync(oldView.source.path),true);
});
test('legacy selected-input evidence blocks recovery even when old paths were lost',async t=>{
 const {toolkit}=await fixture(t);await toolkit.init('Prior');const stage=path.join(toolkit.workspace('Prior'),'.extract-prior');fs.mkdirSync(stage);fs.writeFileSync(path.join(stage,'libil2cpp.so'),elf(183));fs.writeFileSync(path.join(stage,'global-metadata.dat'),'metadata');
 const project=toolkit.read('Prior');project.steps.extract.state='failed';project.steps.extract.error=`Ambiguous binary; staging: ${stage}`;project.steps.scan.state='unknown';await toolkit.save('Prior',project);
 assert.equal(toolkit.inspectInputs('Prior').canRecover,false);
});
test('successful explicit rescan abandons pending replacement while preserving its stage',async t=>{
 const {toolkit,source,root}=await fixture(t);const folder=path.join(root,'selected');fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'libil2cpp.so'),elf(183));fs.writeFileSync(path.join(folder,'global-metadata.dat'),'old');await toolkit.scan('Rescan',folder);await assert.rejects(toolkit.add('Rescan',source));const stage=toolkit.inspectInputs('Rescan').source.path;
 await toolkit.scan('Rescan',folder);const view=toolkit.inspectInputs('Rescan');assert.equal(view.state,'selected');assert.equal(view.source.path,folder);assert.equal(toolkit.read('Rescan').pendingExtraction,undefined);assert.equal(fs.existsSync(stage),true);
});
