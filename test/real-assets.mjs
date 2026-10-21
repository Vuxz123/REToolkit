// No user inputs are loaded: this qualifies real startup/OpenAPI/owned stop only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createToolkit} from '../src/toolkit.js';
import {fileIdentity} from '../src/state.js';
import {startAssetSession,assetSessionStatus,stopAssetSession} from '../src/assets/session.js';
import {readJson,runtimePaths} from '../src/assets/runtime.js';
const installed=process.argv[2];if(!installed)throw Error('Usage: node test/real-assets.mjs <toolkit-with-AssetRipper>');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-real-assets-')),toolkit=createToolkit(root,{log:()=>{}});let stopped=false;
toolkit.tools.assetripper=path.join(path.resolve(installed),'tools/AssetRipper/AssetRipper.exe');
try{
 await toolkit.init('OwnedFixture');const project=toolkit.read('OwnedFixture');project.extractedPath=path.join(toolkit.workspace('OwnedFixture'),'01_Extracted');project.nativeBinary=path.join(project.extractedPath,'GameAssembly.dll');project.metadata=path.join(project.extractedPath,'global-metadata.dat');fs.writeFileSync(project.nativeBinary,'source-owned native placeholder, never loaded');fs.writeFileSync(project.metadata,'source-owned metadata placeholder, never loaded');project.identities.native=fileIdentity(project.nativeBinary);project.identities.metadata=fileIdentity(project.metadata);await toolkit.save('OwnedFixture',project);
 const start=await startAssetSession(toolkit,'OwnedFixture',{timeoutMs:60000},{skipLoad:true});assert.equal(start.state,'ready');
 const status=await assetSessionStatus(toolkit,'OwnedFixture');assert.equal(status.live.engineVersion,'1.3.14');assert.equal(status.live.jobs.length,0);assert.ok(status.live.capabilities.includes('/Assets/Json'));
 const p=runtimePaths(toolkit,'OwnedFixture',start.runId),config=readJson(p.config);assert.notEqual(config.engine.file,toolkit.tools.assetripper);assert.ok(config.engineIdentity.length>=2);
 assert.equal(fs.existsSync(path.join(p.run,'assetripper.log')),false,'upstream file logging must be disabled; captured stdout owns the log cap');
 const stop=await stopAssetSession(toolkit,'OwnedFixture');assert.equal(stop.state,'stopped');stopped=true;
 assert.equal(fs.readdirSync(path.join(root,'.cache/toolchain/readers')).length,0);assert.equal(fs.existsSync(path.join(toolkit.workspace('OwnedFixture'),'.retk-lock')),false);
 console.log(JSON.stringify({engine:'AssetRipper 1.3.14',acceptance:'real startup, private verified copy, pinned OpenAPI, owned close and leases only',loadedUserData:false,capabilities:status.live.capabilities,runId:start.runId}));
}finally{if(!stopped)try{stopped=(await stopAssetSession(toolkit,'OwnedFixture')).state==='stopped';}catch{}if(stopped)fs.rmSync(root,{recursive:true,force:true});else console.error('Preserved diagnostic runtime: '+root);}
