// Acceptance uses only generated source-owned ZIP/project data, never a game.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import yazl from 'yazl';
import {createToolkit} from '../src/toolkit.js';
import {selectedAssetBinding} from '../src/assets/context.js';
import {indexUnityProject,verifyGraphFiles} from '../src/assets/graph.js';
import {fileIdentity} from '../src/state.js';
import {addLibraryRoot,runLibraryOperation} from '../src/libraries/service.js';

const repository=path.resolve(import.meta.dirname,'..');
const root=path.join(repository,'.cache/library-acceptance',randomUUID());
const toolkit=createToolkit(root,{log:()=>{}}),name='OwnedFixture',version=process.argv[2]??'2022.3.62f2';
await toolkit.init(name);const workspace=toolkit.workspace(name),input=path.join(workspace,'01_Extracted');
fs.writeFileSync(path.join(input,'GameAssembly.dll'),'Owned fixture native placeholder, never loaded');
fs.writeFileSync(path.join(input,'global-metadata.dat'),'Owned fixture metadata placeholder, never loaded');await toolkit.scan(name,input);
fs.mkdirSync(path.join(root,'templates/Unity'),{recursive:true});
for(const helper of ['REToolkitValidation.cs','REToolkitLibraryImport.cs'])fs.copyFileSync(path.join(repository,'templates/Unity',helper),path.join(root,'templates/Unity',helper));
const projectDir=path.join(workspace,'05_ReconstructedSource');
for(const [relative,bytes]of Object.entries({
 'ProjectSettings/ProjectVersion.txt':`m_EditorVersion: ${version}\n`,
 'Packages/manifest.json':'{"dependencies":{}}',
 'Assets/Player.cs':'namespace Owned { public class Player : UnityEngine.MonoBehaviour { public int value = OwnedLibrary.Token.Value; } }',
 'Assets/Player.cs.meta':'fileFormatVersion: 2\nguid: 22222222222222222222222222222222\n'
})){const file=path.join(projectDir,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);}
const graph=await indexUnityProject(projectDir,{binding:selectedAssetBinding(toolkit,name).binding});
const archives=path.join(root,'libraries');fs.mkdirSync(archives);const archive=path.join(archives,'owned.zip'),zip=new yazl.ZipFile();
for(const [relative,bytes]of Object.entries({
 'package/package.json':JSON.stringify({name:'com.retk.ownedfixture',version:'1.2.3',unity:'2022.3'}),
 'package/Runtime/Token.cs':'namespace OwnedLibrary { public class Token { public static int Value = 7; } }',
 'package/Runtime/OwnedLibrary.asmdef':JSON.stringify({name:'OwnedLibrary'})
}))zip.addBuffer(Buffer.from(bytes),relative);
zip.end();await pipeline(zip.outputStream,fs.createWriteStream(archive));const archiveBefore=fileIdentity(archive);
addLibraryRoot(toolkit,archives);
const scanned=await runLibraryOperation(toolkit,null,'libraries.scan');assert.equal(scanned.packageCount,1);
const requirements={kind:'retoolkit-library-requirements',schemaVersion:1,packages:[{id:'com.retk.ownedfixture',version:'1.2.3'}]};
const plan=await runLibraryOperation(toolkit,name,'libraries.plan',{requirements});assert.equal(plan.state,'ready',JSON.stringify(plan));
console.log(JSON.stringify({case:'plan',root,operationId:plan.operationId,state:plan.state}));
const imported=await runLibraryOperation(toolkit,name,'libraries.import',{operationId:plan.operationId});
console.log(JSON.stringify({case:'real-import',root,...imported}));assert.equal(imported.state,'imported',JSON.stringify(imported));assert.equal(imported.compileReady,false);
const verified=await runLibraryOperation(toolkit,name,'libraries.verify',{operationId:plan.operationId});
console.log(JSON.stringify({case:'real-verify',root,...verified}));assert.equal(verified.compileReady,true,JSON.stringify(verified));assert.equal(verified.bindingsVerified,true,JSON.stringify(verified));assert.equal(verified.uiVerified,false);
await verifyGraphFiles(projectDir,graph);assert.equal(fileIdentity(archive).sha256,archiveBefore.sha256);
const repeat=await runLibraryOperation(toolkit,name,'libraries.import',{operationId:plan.operationId});assert.equal(repeat.operationId,plan.operationId);
assert.equal(fs.existsSync(path.join(workspace,'.retk-lock')),false);assert.equal(fs.readdirSync(path.join(root,'.cache/toolchain/readers')).length,0);
console.log(JSON.stringify({passed:true,root,unityVersion:version,loadedUserData:false,sourceAndArchiveUnchanged:true,uiVerified:false}));
