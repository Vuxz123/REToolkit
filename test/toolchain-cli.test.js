import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const entry=fileURLToPath(new URL('../re.js',import.meta.url));
test('toolchain CLI validates offline plans and keeps missing receipt unknown without writes',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-tc-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const run=(...args)=>spawnSync(process.execPath,[entry,...args,'--root',root,'--json'],{encoding:'utf8'});
 const lock={kind:'retoolkit-toolchain-lock',schemaVersion:1,platform:'win32-x64',packages:[{id:'assetripper',version:'1.0.0',source:{url:'https://example.com/releases/1.0.0/fixture.zip',sha256:'a'.repeat(64),size:100,verification:'recorded-download'},archiveRoot:''}]};
 const file=path.join(root,'lock.json');fs.writeFileSync(file,JSON.stringify(lock));
 const plan=run('toolchain','plan',file);assert.equal(plan.status,0,plan.stderr);assert.equal(JSON.parse(plan.stdout).packages[0].target,'tools/AssetRipper');assert.deepEqual(fs.readdirSync(root),['lock.json']);
 const verify=run('toolchain','verify');assert.equal(verify.status,1);assert.equal(JSON.parse(verify.stdout).state,'unknown');assert.deepEqual(fs.readdirSync(root),['lock.json']);
 for(const args of [['toolchain','install'],['toolchain','plan',file,'--force'],['toolchain','verify',file],['toolchain','plan',file,'--cache',root]]){const result=run(...args);assert.equal(result.status,1);assert.ok(JSON.parse(result.stderr).error.code);}
});
test('PowerShell locked plan delegates before legacy temp sweeps and refuses mixed flags',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-tc-ps-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'lock.json');fs.writeFileSync(file,JSON.stringify({kind:'retoolkit-toolchain-lock',schemaVersion:1,platform:'win32-x64',packages:[{id:'assetripper',version:'1.0.0',source:{url:'https://example.com/fixture-1.0.0.zip',sha256:'a'.repeat(64),size:100,verification:'recorded-download'},archiveRoot:''}]}));
 const installer=fileURLToPath(new URL('../install-re-toolkit.ps1',import.meta.url));
 const marker=path.join(root,'retk-must-stay.txt');fs.writeFileSync(marker,'preserve');
 const run=extra=>spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',installer,'-InstallDir',root,'-LockedManifest',file,'-Plan',...extra],{encoding:'utf8',env:{...process.env,TEMP:root,TMP:root}});
 const plan=run([]);assert.equal(plan.status,0,plan.stderr);assert.equal(JSON.parse(plan.stdout).packages[0].target,'tools/AssetRipper');assert.ok(fs.existsSync(marker));assert.ok(!fs.existsSync(path.join(root,'runtime')));
 assert.equal(run(['-All']).status,1);assert.ok(fs.existsSync(marker));
});
