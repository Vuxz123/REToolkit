// Real Editor acceptance on a source-owned project only; no user game is loaded.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createToolkit} from '../src/toolkit.js';
import {selectedAssetBinding} from '../src/assets/context.js';
import {indexUnityProject,verifyGraphFiles} from '../src/assets/graph.js';
import {withWorkspaceLock} from '../src/state.js';
import {validateUnityProject} from '../src/unity/validation.js';
const repository=path.resolve(import.meta.dirname,'..');
const root=path.join(repository,'.cache/unity-acceptance',randomUUID()),toolkit=createToolkit(root,{log:()=>{}});
const version=process.argv[2]??'2022.3.62f2';
await toolkit.init('OwnedFixture');const workspace=toolkit.workspace('OwnedFixture'),input=path.join(workspace,'01_Extracted');
fs.writeFileSync(path.join(input,'GameAssembly.dll'),'Owned fixture native placeholder, never loaded');fs.writeFileSync(path.join(input,'global-metadata.dat'),'Owned fixture metadata placeholder, never loaded');await toolkit.scan('OwnedFixture',input);
fs.mkdirSync(path.join(root,'templates/Unity'),{recursive:true});fs.copyFileSync(path.join(repository,'templates/Unity/REToolkitValidation.cs'),path.join(root,'templates/Unity/REToolkitValidation.cs'));
const projectDir=path.join(workspace,'05_ReconstructedSource');
const scriptGuid='22222222222222222222222222222222';
const prefab=guid=>`%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  serializedVersion: 6
  m_Component:
  - component: {fileID: 400}
  - component: {fileID: 11400}
  m_Layer: 0
  m_Name: OwnedFixture
  m_TagString: Untagged
  m_Icon: {fileID: 0}
  m_NavMeshLayer: 0
  m_StaticEditorFlags: 0
  m_IsActive: 1
--- !u!4 &400
Transform:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100}
  serializedVersion: 2
  m_LocalRotation: {x: 0, y: 0, z: 0, w: 1}
  m_LocalPosition: {x: 0, y: 0, z: 0}
  m_LocalScale: {x: 1, y: 1, z: 1}
  m_ConstrainProportionsScale: 0
  m_Children: []
  m_Father: {fileID: 0}
  m_LocalEulerAnglesHint: {x: 0, y: 0, z: 0}
--- !u!114 &11400
MonoBehaviour:
  m_ObjectHideFlags: 0
  m_CorrespondingSourceObject: {fileID: 0}
  m_PrefabInstance: {fileID: 0}
  m_PrefabAsset: {fileID: 0}
  m_GameObject: {fileID: 100}
  m_Enabled: 1
  m_EditorHideFlags: 0
  m_Script: {fileID: 11500000, guid: ${guid}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  health: 7
`;
for(const [relative,bytes]of Object.entries({'ProjectSettings/ProjectVersion.txt':`m_EditorVersion: ${version}\n`,'Packages/manifest.json':'{"dependencies":{}}','Assets/Player.cs':'namespace Owned { public class Player : UnityEngine.MonoBehaviour { public int health; } }','Assets/Player.cs.meta':`fileFormatVersion: 2\nguid: ${scriptGuid}\n`,'Assets/Owned.prefab':prefab(scriptGuid),'Assets/Owned.prefab.meta':'guid: 33333333333333333333333333333333\n'})){
 const file=path.join(projectDir,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);
}
const binding=selectedAssetBinding(toolkit,'OwnedFixture').binding;
let graph=await indexUnityProject(projectDir,{binding});
const validate=()=>withWorkspaceLock(workspace,()=>validateUnityProject({toolkit,name:'OwnedFixture',projectDir,graph,timeoutSeconds:240}));
const good=await validate();console.log(JSON.stringify({case:'real-compile-and-bindings',root,...good}));
assert.equal(good.compileReady,true,JSON.stringify(good));assert.equal(good.bindingsVerified,true,JSON.stringify(good));await verifyGraphFiles(projectDir,graph);
fs.writeFileSync(path.join(projectDir,'Assets/Owned.prefab'),prefab('44444444444444444444444444444444'));graph=await indexUnityProject(projectDir,{binding});
const missing=await validate();console.log(JSON.stringify({case:'real-missing-script',...missing}));assert.equal(missing.compileReady,true,JSON.stringify(missing));assert.equal(missing.bindingsVerified,false);await verifyGraphFiles(projectDir,graph);
fs.appendFileSync(path.join(projectDir,'Assets/Player.cs'),'\nthis is a compiler error;');graph=await indexUnityProject(projectDir,{binding});
const bad=await validate();console.log(JSON.stringify({case:'real-compile-failure',...bad}));assert.equal(bad.compileReady,false);assert.equal(bad.bindingsVerified,false);await verifyGraphFiles(projectDir,graph);
assert.equal(fs.existsSync(path.join(workspace,'.retk-lock')),false);assert.equal(fs.readdirSync(path.join(root,'.cache/toolchain/readers')).length,0);
console.log(JSON.stringify({passed:true,unityVersion:version,loadedUserData:false,acceptance:'three real Editor staging runs: compile+binding, missing script, compile failure; original inventory unchanged after each',root}));
