// Actual CLI/engine-supervisor fixture integration, not real-device acceptance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import yazl from 'yazl';
import {fileIdentity} from '../src/state.js';
import {extractZip} from '../src/archive.js';
if(process.platform!=='win32')throw Error('The ADB executable fixture requires Windows PowerShell/.NET Framework');
const repository=path.resolve(import.meta.dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-adb-smoke-'));
const owned=path.join(root,'owned'),toolkit=path.join(root,'toolkit'),workspace=path.join(toolkit,'workspaces/OwnedFixture');fs.mkdirSync(owned);fs.mkdirSync(toolkit);
const executable=path.join(owned,'adb.exe'),source=path.join(repository,'test/fixtures/adb-engine.cs');let success=false;
const env={...process.env,RETK_ADB_FIXTURE_ROOT:owned,RETK_ADB_FIXTURE_WORKSPACE:workspace,RETK_ADB_FIXTURE_SOURCE:source,RETK_ADB_FIXTURE_EXE:executable};
const command=(args,expected=0,mode='normal')=>{
 const result=spawnSync(process.execPath,[path.join(repository,'re.js'),...args,'--root',toolkit,'--json'],{encoding:'utf8',env:{...env,RETK_ADB_FIXTURE_MODE:mode},timeout:60000});
 assert.equal(result.status,expected,result.stderr||result.error?.message);return expected===0?JSON.parse(result.stdout):JSON.parse(result.stderr);
};
async function zip(name,files){const archive=new yazl.ZipFile();for(const [entry,bytes]of files)archive.addBuffer(bytes,entry);archive.end();await pipeline(archive.outputStream,fs.createWriteStream(path.join(owned,name),{flags:'wx'}));}
try{
 const compile=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','$ErrorActionPreference="Stop"; Add-Type -Path $env:RETK_ADB_FIXTURE_SOURCE -OutputAssembly $env:RETK_ADB_FIXTURE_EXE -OutputType ConsoleApplication'],{encoding:'utf8',env,timeout:30000,windowsHide:true});assert.equal(compile.status,0,compile.stderr);
 const elf=Buffer.alloc(64);elf.set([127,69,76,70,2,1]);elf.writeUInt16LE(183,18);
 await zip('base.apk',[['assets/bin/Data/Managed/Metadata/global-metadata.dat',Buffer.from('source-owned metadata fixture')]]);
 await zip('split_config.arm64.apk',[['lib/arm64-v8a/libil2cpp.so',elf]]);
 await zip('main.1.com.example.fixture.obb',[['assets/owned.txt',Buffer.from('owned OBB fixture')]]);
 fs.writeFileSync(path.join(owned,'external.bin'),Buffer.from([0,255,13,10]));fs.writeFileSync(path.join(owned,'private.bin'),Buffer.from([128,0,1,254]));
 const identities=Object.fromEntries(fs.readdirSync(owned).filter(name=>/\.(apk|obb)$/.test(name)).map(name=>[name,fileIdentity(path.join(owned,name)).sha256]));
 assert.equal(command(['adb','devices','--adb',executable]).devices[0].state,'device');fs.writeFileSync(path.join(owned,'events.txt'),'');
 const args=['pull-ldplayer','OwnedFixture','com.example.fixture','--adb',executable,'--serial','emulator-5554','--skip-launch'];
 const result=command(args);assert.equal(result.state,'prepared');assert.equal(result.capture.files.length,3);assert.equal(result.project.platform,'arm64-v8a');assert.equal(result.project.steps.scan.state,'succeeded');assert.notEqual(result.project.steps.import.state,'succeeded');
 assert.equal(fs.readFileSync(path.join(workspace,'01_Extracted/Android/obb/com.example.fixture/main.1.com.example.fixture/assets/owned.txt'),'utf8'),'owned OBB fixture');
 const events=fs.readFileSync(path.join(owned,'events.txt'),'utf8').trim().split('\n').map(line=>{const [pid,lease,encoded]=line.split(' ');return {pid:Number(pid),lease,args:Buffer.from(encoded,'base64').toString('utf8').split('\0')};});
 assert(events.length>=10);assert(events.every(event=>event.lease==='locked'));assert(!events.some(event=>event.args.includes('monkey')));
 assert.equal(fs.existsSync(path.join(workspace,'.retk-lock')),false);assert.deepEqual(fs.readdirSync(path.join(toolkit,'.cache/toolchain/readers')),[]);
 const projectFile=path.join(workspace,'project.re.json'),previous=fs.readFileSync(projectFile),captureHash=fileIdentity(result.capture.bundle).sha256;
 assert.equal(command(args,1,'partial').ok,false);assert.deepEqual(fs.readFileSync(projectFile),previous);assert.equal(fileIdentity(result.capture.bundle).sha256,captureHash);assert.equal(fs.readdirSync(path.join(workspace,'00_OriginalBuild')).length,1);
 for(const [name,sha256]of Object.entries(identities))assert.equal(fileIdentity(path.join(owned,name)).sha256,sha256);
 const full=command([...args,'--include-data']);assert.equal(full.capture.applicationData.coverage,'complete');assert.equal(full.capture.applicationData.files,2);assert.equal(full.state,'prepared');assert(fs.existsSync(full.capture.applicationData.bundle));
 const dataCheck=path.join(root,'data-check');await extractZip(full.capture.applicationData.bundle,dataCheck);assert.deepEqual(fs.readFileSync(path.join(dataCheck,'private/com.example.fixture/private.bin')),fs.readFileSync(path.join(owned,'private.bin')));assert.deepEqual(fs.readFileSync(path.join(dataCheck,'Android/data/com.example.fixture/external.bin')),fs.readFileSync(path.join(owned,'external.bin')));assert.equal(fs.existsSync(path.join(workspace,'01_Extracted/private')),false);
 const denied=command([...args,'--include-data'],0,'private-denied');assert.equal(denied.state,'partial');assert.equal(denied.capture.applicationData.coverage,'partial');assert.equal(denied.capture.applicationData.scopes.find(scope=>scope.id==='private').state,'denied');
 const fullEvents=fs.readFileSync(path.join(owned,'events.txt'),'utf8').trim().split('\n').map(line=>{const [pid,lease,encoded]=line.split(' ');return {pid:Number(pid),lease,args:Buffer.from(encoded,'base64').toString('utf8').split('\0')};});assert(fullEvents.every(event=>event.lease==='locked'));assert(!fullEvents.some(event=>event.args.includes('monkey')||event.args[0]==='root'||event.args[0]==='remount'));
 success=true;console.log(JSON.stringify({passed:true,fixture:'source-owned compiled ADB executable with APK/split/OBB and binary app data',deviceAccess:false,psPipeline:false,supervisedAdbCalls:fullEvents.length,capturedFiles:3,appDataFiles:2,privateDenied:'partial',partialPull:'refused; prior project and bundle unchanged',vendorExecution:false}));
}finally{
 assert.equal(path.dirname(root).toLowerCase(),os.tmpdir().toLowerCase());
 if(success&&!process.env.RETK_KEEP_FIXTURE)fs.rmSync(root,{recursive:true,force:true});else console.error('ADB fixture diagnostics retained: '+root);
}
