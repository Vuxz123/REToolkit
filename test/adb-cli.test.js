import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import yazl from 'yazl';
import {parseAdbArgs} from '../src/adb/options.js';
import {createToolkit} from '../src/toolkit.js';
import {withToolchainWrite} from '../src/toolchain/lease.js';

const entry=path.resolve('re.js');
async function fixture(t,{ambiguous=false,duplicateAbi=false,failPull=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-adb-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const adb=path.join(root,'adb.exe');fs.writeFileSync(adb,'inert executable placeholder; transport injected');
 const sources=path.join(root,'owned');fs.mkdirSync(sources);
 const elf=Buffer.alloc(64);elf.set([127,69,76,70,2,1]);elf.writeUInt16LE(183,18);
 async function zip(name,files){const z=new yazl.ZipFile();for(const [p,b]of files)z.addBuffer(b,p);z.end();await pipeline(z.outputStream,fs.createWriteStream(path.join(sources,name)));}
 await zip('base.apk',[['assets/bin/Data/Managed/Metadata/global-metadata.dat',Buffer.from('source-owned metadata')]]);
 const otherElf=Buffer.from(elf);if(!duplicateAbi)otherElf.writeUInt16LE(40,18);
 await zip('split.apk',[['lib/arm64-v8a/libil2cpp.so',elf],...(ambiguous?[['lib/armeabi-v7a/libil2cpp.so',otherElf]]:[])]);
 const calls=[];let checked=false;
 const run=async(file,args,options)=>{
  assert.equal(file,adb,'ADB capture must not invoke PowerShell');calls.push(args);
  assert.equal(fs.existsSync(options.leaseDirectory),true);assert.equal(options.toolchainRoot,root);
  if(!checked){checked=true;await assert.rejects(withToolchainWrite(root,()=>{}, {inspectProcesses:async()=>({state:'idle',processes:[]})}),/lease|busy/i);}
  const out=text=>({exitCode:0,stdout:text,stderr:''});
  if(args[0]==='devices')return out('List of devices attached\nemulator-5554 device\n');
  assert.equal(args[1],'emulator-5554');const op=args.slice(2);
  if(op.slice(0,4).join(' ')==='shell pm list packages')return out('package:com.example.game\n');
  if(op.slice(0,3).join(' ')==='shell pm path')return out('package:/data/app/game/base.apk\npackage:/data/app/game/split.apk\n');
  if(op[1]==='ls')return out('');
  const remote=op.at(-1),source=path.join(sources,path.posix.basename(remote));
  if(op[1]==='stat')return out(fs.statSync(source).size+'\n');
  if(op[0]==='pull'){if(failPull)throw Error('fixture pull failure');fs.copyFileSync(path.join(sources,path.posix.basename(op[1])),op[2]);return out('pulled');}
  throw Error('Unexpected fixture ADB operation '+JSON.stringify(args));
 };
 const toolkit=createToolkit(root,{run,log:()=>{}});return {root,adb,toolkit,calls};
}
test('ADB parser accepts native and retained flags, rejects ambiguity and unsafe identifiers',()=>{
 assert.deepEqual(parseAdbArgs(['pull-ldplayer','Game','com.example.game','-DeviceSerial','emulator-5554','-AdbPath','C:/adb.exe','-SkipLaunch']).options,{serial:'emulator-5554',adb:'C:/adb.exe',skipLaunch:true});
 assert.equal(parseAdbArgs(['adb','devices','--json']).command,'devices');
 for(const args of [[],['pull-ldplayer','Game'],['adb','pull'],['adb','devices','--serial','a'],['pull-ldplayer','..','com.x'],['pull-ldplayer','Game','com.x;bad'],['pull-ldplayer','Game','com.x','--serial','a','-DeviceSerial','b'],['pull-ldplayer','Game','com.x','--unknown']])assert.throws(()=>parseAdbArgs(args));
});
test('actual CLI refuses noninteractive launch and invalid options before writes',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-adb-parse-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const tail of [[],['--skip-launch','--serial','bad;serial'],['--skip-launch','--unknown']]){
  const result=spawnSync(process.execPath,[entry,'pull-ldplayer','Game','com.example.game','--root',root,'--json',...tail],{encoding:'utf8'});assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).ok,false);assert.deepEqual(fs.readdirSync(root),[]);
 }
 assert.match(spawnSync(process.execPath,[entry,'adb','--help'],{encoding:'utf8'}).stdout,/devices/);
});
test('native capture holds leases, preserves split APKs and imports through Node add',async t=>{
 const {root,adb,toolkit,calls}=await fixture(t);const result=await toolkit.pullLdPlayer('Game','com.example.game',{adb,serial:'emulator-5554',skipLaunch:true});
 assert.equal(result.state,'prepared');assert.equal(result.capture.files.length,2);assert.equal(result.project.platform,'arm64-v8a');assert.equal(result.project.steps.scan.state,'succeeded');assert.notEqual(result.project.steps.import.state,'succeeded');
 assert.equal(calls.some(args=>args.includes('monkey')),false);assert.equal(fs.existsSync(path.join(toolkit.workspace('Game'),'.retk-lock')),false);assert.deepEqual(fs.readdirSync(path.join(root,'.cache/toolchain/readers')),[]);
 assert.equal(result.capture.serial,'emulator-5554');
});
test('fresh multi-ABI capture selects ARM64 by header policy without launching analysis',async t=>{
 const {adb,toolkit}=await fixture(t,{ambiguous:true}),result=await toolkit.pullLdPlayer('Game','com.example.game',{adb,skipLaunch:true});
 assert.equal(result.state,'prepared');assert.equal(result.project.steps.extract.state,'succeeded');assert.equal(result.project.steps.scan.state,'succeeded');assert.equal(result.project.inputSelection.source.location,'canonical');assert.equal(result.project.selection.abi,'arm64-v8a');assert.equal(result.project.selection.reason,'abi-preference');assert.notEqual(result.project.steps.import.state,'succeeded');
});
test('partial pull preserves existing project bytes and extracted data',async t=>{
 const {adb,toolkit}=await fixture(t,{failPull:true});await toolkit.init('Game');const projectFile=toolkit.projectPath('Game'),before=fs.readFileSync(projectFile);const old=path.join(toolkit.workspace('Game'),'01_Extracted/retained.bin');fs.writeFileSync(old,'old valid source');
 await assert.rejects(toolkit.pullLdPlayer('Game','com.example.game',{adb,skipLaunch:true}),/fixture pull failure/);assert.deepEqual(fs.readFileSync(projectFile),before);assert.equal(fs.readFileSync(old,'utf8'),'old valid source');
});
test('capture refuses linked workspace ancestors before initialization or ADB calls',async t=>{
 const {root,adb,toolkit,calls}=await fixture(t);const outside=fs.mkdtempSync(path.join(os.tmpdir(),'retk-adb-outside-'));t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
 fs.symlinkSync(outside,path.join(root,'workspaces'),'junction');await assert.rejects(toolkit.pullLdPlayer('Game','com.example.game',{adb,skipLaunch:true}),/link|junction/i);
 assert.deepEqual(calls,[]);assert.deepEqual(fs.readdirSync(outside),[]);
});
test('ambiguous ABI is explicit and saved bundle remains available for re-selection',async t=>{
 const {adb,toolkit}=await fixture(t,{ambiguous:true,duplicateAbi:true});await toolkit.init('Game');const previous=path.join(toolkit.workspace('Game'),'01_Extracted/retained.bin');fs.writeFileSync(previous,'previous extraction');await assert.rejects(toolkit.pullLdPlayer('Game','com.example.game',{adb,skipLaunch:true}),/Ambiguous binary/);assert.equal(fs.readFileSync(previous,'utf8'),'previous extraction');
 const bundles=fs.readdirSync(path.join(toolkit.workspace('Game'),'00_OriginalBuild'));assert.equal(bundles.length,1);
 const selected=await toolkit.pullLdPlayer('Game','com.example.game',{adb,skipLaunch:true,binary:'split/lib/arm64-v8a/libil2cpp.so'});assert.equal(selected.project.selection.binary,path.join('split','lib','arm64-v8a','libil2cpp.so'));
});
