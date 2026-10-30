import test from 'node:test';import assert from 'node:assert/strict';
import {sourceDelta} from '../src/unity/resident.js';
test('resident sync selects only changed files and retains explicit removals',()=>{
 const f=(path,sha256)=>({path,sha256,size:1});const a=f('Assets/A.cs','a'),b=f('Assets/B.cs','b');
 assert.deepEqual(sourceDelta([a,b],[a,f('Assets/C.cs','c')]),{copy:[f('Assets/C.cs','c')],remove:[b]});
 assert.throws(()=>sourceDelta([],[f('../escape','x')]));
});

import fs from 'node:fs';import path from 'node:path';
import {fixture} from './reconstruction-fixture.js';
import {createToolkit} from '../src/toolkit.js';
import {selectedAssetBinding} from '../src/assets/context.js';
import {indexUnityProject} from '../src/assets/graph.js';
import {withWorkspaceLock} from '../src/state.js';
import {validateUnityProject,readUnityValidation} from '../src/unity/validation.js';
import {residentSessionOperation} from '../src/unity/resident.js';
import {validationExecutionComplete} from '../src/unity/execution.js';

async function setup(t){
 const f=await fixture(t),toolkit=createToolkit(f.root,{log:()=>{}});await toolkit.init('Game');
 const input=path.join(toolkit.workspace('Game'),'01_Extracted');fs.writeFileSync(path.join(input,'libil2cpp.so'),'native');fs.writeFileSync(path.join(input,'global-metadata.dat'),'metadata');await toolkit.scan('Game',input);
 fs.writeFileSync(path.join(f.projectDir,'ProjectSettings/ProjectVersion.txt'),'m_EditorVersion: 6000.0.66f2\n');
 const binding=selectedAssetBinding(toolkit,'Game').binding;
 fs.mkdirSync(path.join(f.root,'templates/Unity'),{recursive:true});fs.copyFileSync('templates/Unity/REToolkitValidation.cs',path.join(f.root,'templates/Unity/REToolkitValidation.cs'));
 const editor=path.join(f.root,'Unity.exe');fs.writeFileSync(editor,'fixture');let launches=0,alive=true,calls=[];
 const dependencies={editor,resident:{launchEditor:async()=>{launches++;return 12345;},alive:()=>alive,cli:async args=>{
  calls.push(args);
  if(args[0]!=='command')return {success:true,data:{}};
  const code=args[2],project=args[args.indexOf('--project-path')+1];let result=true;
  if(code.includes('InspectLive'))result=JSON.stringify({projectPath:project,unityVersion:'6000.0.66f2',isCompiling:false,isPlaying:false,scriptCompilationFailed:false,dirtyScenes:0});
  if(code.includes('EditorApplication.Exit'))alive=false;
  if(code.includes('RunLive')){
   const [requestFile,reportFile]=JSON.parse('['+code.slice(code.indexOf('RunLive(')+8,code.lastIndexOf(');'))+']');
   const request=JSON.parse(fs.readFileSync(requestFile));
   fs.writeFileSync(reportFile,JSON.stringify({kind:'retoolkit-unity-observation',schemaVersion:1,runId:request.runId,graphRevision:request.graphRevision,unityVersion:request.unityVersion,complete:true,compilation:{state:'succeeded'},scripts:request.scripts.map(s=>({...s,guid:'a'.repeat(32),fileID:'11500000',fullName:'Game.Player',assembly:'Assembly-CSharp',resolved:true})),assets:request.assets.map(a=>({...a,loaded:true,missingScripts:0,missingReferences:0})),diagnostics:[]}));result=request.runId;
  }
  return {success:true,data:{result:{success:true,result}}};
 }}};
 const graph=()=>indexUnityProject(f.projectDir,{binding});
 const validate=async()=>{const g=await graph();return withWorkspaceLock(toolkit.workspace('Game'),()=>validateUnityProject({toolkit,name:'Game',projectDir:f.projectDir,graph:g,mode:'resident'},dependencies));};
 return {...f,toolkit,dependencies,graph,validate,launches:()=>launches,calls};
}
test('resident validation reuses one project/Editor, syncs changed files and attests a completed invocation',async t=>{
 const f=await setup(t),first=await f.validate();assert.equal(first.compileReady,true);assert.equal(first.process.closed,false);assert.equal(validationExecutionComplete(first),true);assert.equal(first.execution.mode,'resident');
 const second=await f.validate();assert.equal(f.launches(),1);assert.equal(second.execution.project,first.execution.project);assert.equal(second.resident.copiedFiles,0);
 fs.appendFileSync(path.join(f.projectDir,'Assets/Player.cs'),'\n// changed');
 const third=await f.validate();assert.equal(third.resident.copiedFiles,1);assert.equal(f.launches(),1);
 const read=await readUnityValidation({toolkit:f.toolkit,name:'Game',projectDir:f.projectDir,graph:await f.graph(),operationId:third.operationId});assert.equal(read.compileReady,true);
 const receiptDirectory=path.dirname(path.join(f.toolkit.workspace('Game'),third.storedReceipt));fs.appendFileSync(path.join(receiptDirectory,'execution.json'),'bad');
 await assert.rejects(readUnityValidation({toolkit:f.toolkit,name:'Game',projectDir:f.projectDir,graph:await f.graph(),operationId:third.operationId}));
 const stopped=await residentSessionOperation(f.toolkit,'Game','stop',f.dependencies.resident);assert.equal(stopped.state,'stopped');
});
test('resident validation rejects untracked working edits and leaves original source intact',async t=>{
 const f=await setup(t),first=await f.validate(),file=path.join(first.execution.project,'Assets/Player.cs');fs.appendFileSync(file,'// external');await assert.rejects(f.validate(),{code:'unity_resident_stale'});
 assert(!fs.readFileSync(path.join(f.projectDir,'Assets/Player.cs'),'utf8').includes('// external'));
});

test('resident observation rejects added executable source and modified helper before attesting',async t=>{
 for(const change of ['source','helper']){
  const f=await setup(t),original=f.dependencies.resident.cli;
  f.dependencies.resident.cli=async args=>{
   const result=await original(args);
   if(args[0]==='command'&&args[2].includes('RunLive')){
    const project=args[args.indexOf('--project-path')+1];
    if(change==='source')fs.writeFileSync(path.join(project,'Assets/Unexpected.cs'),'class Unexpected {}');
    else fs.appendFileSync(path.join(project,'Assets/REToolkitValidation/Editor/REToolkitValidation.cs'),'// changed');
   }
   return result;
  };
  await assert.rejects(f.validate(),{code:'unity_resident_stale'});
  await residentSessionOperation(f.toolkit,'Game','stop',f.dependencies.resident);
 }
});

import {dataFixture} from './helpers/data-service-fixture.js';
import {runRecoveryOperation} from '../src/recovery/service.js';
import {buildDesktopCommand,desktopOperations} from '../src/desktop/operations.js';
test('desktop exposes resident mode and exact session controls',()=>{
 assert.deepEqual(buildDesktopCommand('reconstruct.validate',{name:'Game',mode:'resident'}),['reconstruct','validate','Game','--mode','resident']);
 for(const command of ['resident-status','resident-stop']){
  assert(desktopOperations.some(v=>v.id==='reconstruct.'+command));
  assert.deepEqual(buildDesktopCommand('reconstruct.'+command,{name:'Game'}),['reconstruct',command,'Game']);
 }
});
test('resident data verification accepts bound completion without process closure and retains baseline provenance',async t=>{
 const f=await dataFixture(t);
 fs.writeFileSync(path.join(f.project,'ProjectSettings/ProjectVersion.txt'),'m_EditorVersion: 6000.0.66f2\n');
 const baseline=await f.call('capture',{assetIds:f.scope});let running=true;
 f.dependencies.validation.resident={launchEditor:async()=>{running=true;return 12345;},alive:()=>running,cli:async args=>{
  if(args[0]!=='command')return {success:true,data:{}};
  const code=args[2],project=args[args.indexOf('--project-path')+1];let result=true;
  if(code.includes('InspectLive'))result=JSON.stringify({projectPath:project,unityVersion:'6000.0.66f2',isCompiling:false,isPlaying:false,scriptCompilationFailed:false,dirtyScenes:0});
  if(code.includes('EditorApplication.Exit'))running=false;
  if(code.includes('RunLive')){
   const [requestFile,reportFile]=JSON.parse('['+code.slice(code.indexOf('RunLive(')+8,code.lastIndexOf(');'))+']');
   await f.dependencies.validation.runEditor({projectDir:project,requestFile,reportFile});
   result=JSON.parse(fs.readFileSync(requestFile)).runId;
  }
  return {success:true,data:{result:{success:true,result}}};
 }};
 const verified=await f.call('verify',{baselineId:baseline.baselineId,mode:'resident'});
 assert.equal(verified.dataPreserved,true);
 await f.call('report',{operationId:verified.operationId});
 assert.equal((await residentSessionOperation(f.toolkit,'Game','stop',f.dependencies.validation.resident)).state,'stopped');
 const artifact=await runRecoveryOperation(f.toolkit,'Game','create');
 const captured=await runRecoveryOperation(f.toolkit,'Game','run',{artifactId:artifact.artifactId,revision:artifact.revision,operation:'data.capture',params:{assetIds:f.scope}},{data:f.dependencies});
 const checked=await runRecoveryOperation(f.toolkit,'Game','run',{artifactId:artifact.artifactId,revision:captured.revision,operation:'data.verify',params:{baselineId:captured.result.baselineId,mode:'resident'}},{data:f.dependencies});
 assert.equal(checked.revision,captured.revision);assert.equal(checked.result.dataPreserved,true);
 fs.appendFileSync(path.join(f.workspace,checked.project,'Assets/Player.cs'),'// stale original');
 const closed=await runRecoveryOperation(f.toolkit,'Game','run',{artifactId:artifact.artifactId,revision:checked.revision,operation:'reconstruct.resident-stop',params:{}},f.dependencies);
 assert.equal(closed.result.state,'stopped');assert.equal(closed.revision,checked.revision);
});
