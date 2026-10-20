// Source-owned ZIP/CLI integration only; no real vendor executables are run.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {pipeline} from 'node:stream/promises';import yazl from 'yazl';
const root=fileURLToPath(new URL('..',import.meta.url)),temp=fs.mkdtempSync(path.join(os.tmpdir(),'retk-locked-smoke-'));let success=false;
const cli=(expected,...args)=>{const r=spawnSync(process.execPath,[path.join(root,'re.js'),'toolchain',...args,'--root',temp,'--json'],{encoding:'utf8'});assert.equal(r.status,expected,r.stderr);return JSON.parse(r.stdout);};
try{
 const archive=path.join(temp,'owned.zip'),zip=new yazl.ZipFile();zip.addBuffer(Buffer.from('Source-owned fixture bytes; not executable.'),'bundle/AssetRipper.GUI.Free.exe');zip.end();await pipeline(zip.outputStream,fs.createWriteStream(archive));
 const bytes=fs.readFileSync(archive),sha256=crypto.createHash('sha256').update(bytes).digest('hex');const cache=path.join(temp,'packages');fs.mkdirSync(cache);fs.copyFileSync(archive,path.join(cache,sha256+'.zip'));
 const lockFile=path.join(temp,'toolchain.lock.json');fs.writeFileSync(lockFile,JSON.stringify({kind:'retoolkit-toolchain-lock',schemaVersion:1,platform:'win32-x64',packages:[{id:'assetripper',version:'1.0.0',source:{url:'https://example.invalid/releases/1.0.0/source-owned.zip',sha256,size:bytes.length,verification:'recorded-download'},archiveRoot:'bundle'}]}));
 assert.equal(cli(0,'plan',lockFile).packages[0].target,'tools/AssetRipper');
 const installer=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'install-re-toolkit.ps1'),'-InstallDir',temp,'-LockedManifest',lockFile,'-PackageCache',cache],{encoding:'utf8'});assert.equal(installer.status,0,installer.stderr);const installed=JSON.parse(installer.stdout);assert.equal(installed.packages[0].source.sha256,sha256);
 assert.equal(cli(0,'verify').state,'verified');
 const exe=path.join(temp,'tools/AssetRipper/AssetRipper.exe');assert.equal(fs.readFileSync(exe,'utf8'),'Source-owned fixture bytes; not executable.');fs.appendFileSync(exe,'tampered');assert.equal(cli(1,'verify').state,'changed');
 cli(0,'install',lockFile,'--cache',cache);assert.equal(cli(0,'verify').state,'verified');
 const transactions=path.join(temp,'.cache/toolchain/transactions');assert.ok(fs.readdirSync(transactions).some(name=>fs.existsSync(path.join(transactions,name,'backup/assetripper/AssetRipper.exe'))));
 success=true;console.log(JSON.stringify({passed:true,fixture:'source-owned ZIP layout only',downloads:0,installed:'verified',tamper:'detected',replacement:'previous tree retained in backup',vendorExecution:'not-run'}));
}finally{assert.equal(path.dirname(temp).toLowerCase(),os.tmpdir().toLowerCase());if(success&&!process.env.RETK_KEEP_FIXTURE)fs.rmSync(temp,{recursive:true,force:true});else console.error(`Diagnostics retained: ${temp}`);}
