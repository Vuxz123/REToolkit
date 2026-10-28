import fs from 'node:fs';
import path from 'node:path';
import {fixture} from '../reconstruction-fixture.js';
import {createToolkit} from '../../src/toolkit.js';
import {runAssetOperation} from '../../src/assets/service.js';
export async function componentFixture(t,storage='json'){
 const f=await fixture(t),toolkit=createToolkit(f.root,{log:()=>{}});await toolkit.init('Game');const workspace=toolkit.workspace('Game'),input=path.join(workspace,'01_Extracted');
 fs.writeFileSync(path.join(input,'libil2cpp.so'),'owned native');fs.writeFileSync(path.join(input,'global-metadata.dat'),'owned metadata');await toolkit.scan('Game',input);
 const project=path.join(workspace,'05_ReconstructedSource');fs.cpSync(f.projectDir,project,{recursive:true});
 fs.writeFileSync(path.join(project,'Assets/Main.unity'),f.files['Assets/Main.unity'].replace('  m_Script:','  m_GameObject: {fileID: 1}\n  m_Script:')+'--- !u!4 &2\nTransform:\n  m_GameObject: {fileID: 1}\n');
 fs.writeFileSync(path.join(project,'Assets/Main.unity.meta'),'guid: '+'c'.repeat(32)+'\n');
 fs.writeFileSync(path.join(project,'Assets/Replacement.cs'),'namespace Game { public class Replacement : UnityEngine.MonoBehaviour { public int health; } }');fs.writeFileSync(path.join(project,'Assets/Replacement.cs.meta'),'guid: '+'b'.repeat(32)+'\n');
 fs.mkdirSync(path.join(f.root,'templates/Unity'),{recursive:true});for(const file of ['REToolkitValidation.cs','REToolkitMigrationObservation.cs'])fs.copyFileSync(path.resolve('templates/Unity/'+file),path.join(f.root,'templates/Unity/'+file));
 const editor=path.join(f.root,'fixture-editor');fs.writeFileSync(editor,'inert fixture');const p=toolkit.read('Game');p.unityEditorPath=editor;await toolkit.save('Game',p);
 await runAssetOperation(toolkit,'Game','assets.index',{storage});let edit=()=>{};
 const identity=(g,n)=>({guid:g.repeat(32),fileID:'11500000',assembly:'Assembly-CSharp',fullName:'Game.'+n}),from=identity('a','Player'),to=identity('b','Replacement'),id='object:'+'c'.repeat(32)+':9007199254740993',nativeId='object:'+'c'.repeat(32)+':2';
 const dependencies={runEditor:async config=>{const r=JSON.parse(fs.readFileSync(config.requestFile)),rebound=fs.readFileSync(path.join(config.projectDir,'Assets/Main.unity'),'utf8').includes('guid: '+'b'.repeat(32));const fields=[{name:'health',type:'System.Int32',propertyType:'Integer'}];const report={kind:'retoolkit-migration-observation',schemaVersion:1,runId:r.runId,graphRevision:r.graphRevision,inventorySha256:r.inventorySha256,unityVersion:r.unityVersion,complete:true,compilation:{state:'succeeded'},scripts:[{...from,path:'Assets/Player.cs',fields},{...to,path:'Assets/Replacement.cs',fields}],components:r.components.map(c=>c.componentId===nativeId?{componentId:nativeId,native:true,fullName:'UnityEngine.Transform',assembly:'UnityEngine.CoreModule',fields:[]}:{componentId:id,script:rebound?to:from,fields:[{...fields[0],valueJson:'42'}]})};edit(report);fs.writeFileSync(config.reportFile,JSON.stringify(report));return {closed:true,exitCode:0,timedOut:false,logTail:''};}};
 return {...f,toolkit,workspace,project,dependencies,id,nativeId,edit:fn=>edit=fn};
}
