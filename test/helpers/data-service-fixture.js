import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fixture} from '../reconstruction-fixture.js';
import {createToolkit} from '../../src/toolkit.js';
import {runDataOperation} from '../../src/data/service.js';
import {dataSnapshot} from './scriptable-data.js';
export async function dataFixture(t){
 const f=await fixture(t),toolkit=createToolkit(f.root,{log:()=>{}});await toolkit.init('Game');const workspace=toolkit.workspace('Game'),input=path.join(workspace,'01_Extracted');
 fs.writeFileSync(path.join(input,'libil2cpp.so'),'owned native');fs.writeFileSync(path.join(input,'global-metadata.dat'),'owned metadata');await toolkit.scan('Game',input);
 const project=path.join(workspace,'05_ReconstructedSource');fs.cpSync(f.projectDir,project,{recursive:true});fs.writeFileSync(path.join(project,'Assets/Player.cs'),f.files['Assets/Player.cs'].replace('MonoBehaviour','ScriptableObject'));
 fs.writeFileSync(path.join(project,'Assets/Level.asset'),'%YAML 1.1\n--- !u!114 &11400000\nMonoBehaviour:\n  m_Script: {fileID: 11500000, guid: '+ 'a'.repeat(32)+', type: 3}\n  health: 42\n');fs.writeFileSync(path.join(project,'Assets/Level.asset.meta'),'guid: '+ 'b'.repeat(32)+'\n');
 fs.mkdirSync(path.join(f.root,'templates/Unity'),{recursive:true});fs.copyFileSync(path.resolve('templates/Unity/REToolkitValidation.cs'),path.join(f.root,'templates/Unity/REToolkitValidation.cs'));
 const editor=path.join(f.root,'fixture-editor');fs.writeFileSync(editor,'inert fixture');let edit=()=>{},calls=0;
 const dependencies={validation:{editor,runEditor:async config=>{
  calls++;const r=JSON.parse(fs.readFileSync(config.requestFile));assert.equal(r.dataCapture,true);
  const data=dataSnapshot();if(fs.readFileSync(path.join(config.projectDir,'Assets/REToolkitValidation/Editor/REToolkitValidation.cs'),'utf8').includes('"scriptable-data-v2"'))data.policy='scriptable-data-v2';data.objects[0].fullName='Game.Player';data.objects[0].properties.push({path:'m_Script',kind:'ObjectReference',type:'PPtr<MonoScript>',value:'a'.repeat(32)+':11500000'});edit(data);
  const report={kind:'retoolkit-unity-observation',schemaVersion:1,runId:r.runId,graphRevision:r.graphRevision,unityVersion:r.unityVersion,complete:true,traversal:{policy:'reference-scan-v2'},compilation:{state:'succeeded'},scripts:r.scripts.map(s=>({...s,guid:'a'.repeat(32),fileID:'11500000',fullName:'Game.Player',assembly:'Assembly-CSharp',resolved:true,classification:'attachable'})),assets:r.assets.map(a=>({...a,loaded:true,missingScripts:0,missingReferences:0,traversal:{complete:true,objects:data.objects.length,properties:data.objects.reduce((n,o)=>n+o.properties.length,0),skippedSubtrees:0,stopReason:'',objectPath:'',componentType:'',propertyPath:''},data})),diagnostics:[]};fs.writeFileSync(config.reportFile,JSON.stringify(report));return {closed:true,exitCode:0,timedOut:false,logTail:''};
 }}};
 const call=(command,params={})=>runDataOperation(toolkit,'Game',command,params,dependencies);
 return {...f,toolkit,workspace,project,call,dependencies,scope:['asset:'+'b'.repeat(32)],edit:fn=>edit=fn,calls:()=>calls};
}
