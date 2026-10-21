import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createToolkit} from '../src/toolkit.js';
import {withWorkspaceLock} from '../src/state.js';
import {indexUnityProject,verifyGraphFiles} from '../src/assets/graph.js';
import {observeMigration} from '../src/reconstruction/migration-observation.js';
import {createMigrationPlan,applyMigrationPlan,verifyMigration} from '../src/reconstruction/migration.js';

test('real Unity observes and verifies explicit rebind and field migration in a source-owned fixture', {skip:process.env.RETK_UNITY_MIGRATION_ACCEPTANCE!=='1',timeout:600000},async()=>{
 const repository=path.resolve(import.meta.dirname,'..'),root=path.join(repository,'.cache/migration-acceptance',randomUUID()),toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('OwnedMigration');const workspace=toolkit.workspace('OwnedMigration'),projectDir=path.join(workspace,'05_ReconstructedSource');
 const files={'ProjectSettings/ProjectVersion.txt':'m_EditorVersion: 2022.3.62f2\n','Packages/manifest.json':'{"dependencies":{}}','Assets/Old.cs':'namespace Owned { public class Old : UnityEngine.MonoBehaviour { public int health; public UnityEngine.GameObject friend; public bool ready; } }','Assets/Old.cs.meta':'fileFormatVersion: 2\nguid: '+ 'a'.repeat(32)+'\n','Assets/New.cs':'namespace Owned { public class New : UnityEngine.MonoBehaviour { public int score; public UnityEngine.GameObject buddy; public bool prepared; } }','Assets/New.cs.meta':'fileFormatVersion: 2\nguid: '+ 'b'.repeat(32)+'\n','Assets/Owned.prefab.meta':'fileFormatVersion: 2\nguid: '+ 'c'.repeat(32)+'\n','Assets/Owned.prefab':`%YAML 1.1
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
  m_Name: OwnedMigration
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
  m_Script: {fileID: 11500000, guid: ${'a'.repeat(32)}, type: 3}
  m_Name:
  m_EditorClassIdentifier:
  health: 7
  friend: {fileID: 100}
  ready: 1
`};
 for(const [name,bytes] of Object.entries(files)){await fs.mkdir(path.dirname(path.join(projectDir,name)),{recursive:true});await fs.writeFile(path.join(projectDir,name),bytes);}
 const graph=await indexUnityProject(projectDir,{binding:{ownedFixture:true}}),options={graph,projectDir,templateRoot:path.join(repository,'templates'),toolkitRoot:root,lockDirectory:path.join(workspace,'.retk-lock'),timeoutSeconds:240};
 await withWorkspaceLock(workspace,async()=>{
  const {observation}=await observeMigration({...options,runDir:path.join(workspace,'observe-before')});const identity=s=>({assembly:s.assembly,fullName:s.fullName,guid:s.guid,fileID:s.fileID});const from=identity(observation.scripts.find(s=>s.fullName==='Owned.Old')),to=identity(observation.scripts.find(s=>s.fullName==='Owned.New'));
  const componentId='object:'+ 'c'.repeat(32)+':11400',request={kind:'retoolkit-migration-request',schemaVersion:1,graphRevision:graph.revision,rebindings:[{componentId,from,to}],fieldRenames:[{componentId,from:'health',to:'score',type:'System.Int32',expectedValue:7},{componentId,from:'friend',to:'buddy',type:'UnityEngine.GameObject',expectedValue:{fileID:'100'}},{componentId,from:'ready',to:'prepared',type:'System.Boolean',expectedValue:1}]};
  const plan=await createMigrationPlan({projectDir,graph,observations:observation,request}),runDir=path.join(workspace,'migration'),receipt=await applyMigrationPlan({projectDir,graph,observations:observation,plan,runDir});const changed=path.join(runDir,'project'),afterGraph=await indexUnityProject(changed,{binding:graph.binding});
  const after=await observeMigration({...options,projectDir:changed,graph:afterGraph,runDir:path.join(workspace,'observe-after')});const verified=await verifyMigration({projectDir:changed,receipt,observations:after.observation});assert.equal(verified.valid,true);assert.equal(verified.compileReady,true);assert.equal(verified.bindingsVerified,true);assert.equal(verified.migratedValuesVerified,true);await verifyGraphFiles(projectDir,graph);console.log(JSON.stringify({root,verified,sourceUntouched:true}));
 });
});
