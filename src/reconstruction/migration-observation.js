import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fingerprint,ownsWorkspaceLock} from '../state.js';
import {assertAssetPath} from '../assets/context.js';
import {verifyGraphFiles} from '../assets/graph.js';
import {stageUnityProject,resolveUnityEditor} from '../unity/validation.js';
import {runUnityEditor} from '../unity/runner.js';
import {isComponent} from '../components/inventory.js';

function check(ok,message,code='migration_observation_invalid'){if(!ok)throw Object.assign(Error(message),{code});}
const hash=b=>createHash('sha256').update(b).digest('hex');
/** Fixed helper, fresh private staging, no execution or source-project writes. */
export async function stageMigrationObservation({projectDir,graph,runDir,templateRoot,componentMode=false}){
 const stage=await stageUnityProject({projectDir,graph,runDir,templateRoot});
 const helper=await fs.readFile(assertAssetPath(path.join(templateRoot,'Unity/REToolkitMigrationObservation.cs')));
 await fs.writeFile(path.join(stage.projectDir,'Assets/REToolkitValidation/Editor/REToolkitValidation.cs'),helper);
 const request={kind:'retoolkit-migration-observation-request',schemaVersion:1,runId:stage.request.runId,graphRevision:graph.revision,inventorySha256:fingerprint(graph.files),unityVersion:graph.unityVersion,...(componentMode?{componentMode:true}:{}),
  scripts:graph.assets.filter(a=>/\.(?:cs|dll)$/i.test(a.path)).map(a=>({path:a.path})),
  assets:graph.assets.filter(a=>['scene','prefab','asset'].includes(a.kind)).map(a=>({path:a.path,kind:a.kind,guid:a.guid})),
  components:graph.nodes.filter(n=>n.guid&&(componentMode?isComponent(n):n.classID===114&&n.scriptRef)).map(n=>({componentId:n.id,guid:n.guid,fileID:n.fileID,path:graph.assets.find(a=>a.id===n.assetId).path}))};
 check(request.scripts.length<=10000&&request.assets.length<=10000&&request.components.length<=100000,'Migration observation request exceeds limits');
 await fs.writeFile(stage.requestFile,JSON.stringify(request,null,2));await verifyGraphFiles(projectDir,graph);
 return {...stage,request,requestSha256:hash(await fs.readFile(stage.requestFile)),helperSha256:hash(helper)};
}
/** Caller owns the workspace lease. The existing supervisor owns Editor close. */
export async function observeMigration({projectDir,graph,runDir,templateRoot,editor,lockDirectory,toolkitRoot,timeoutSeconds=600,componentMode=false},dependencies={}){
 check(ownsWorkspaceLock(path.dirname(lockDirectory)),'Migration observation requires the workspace lease','asset_lease_required');
 const selected=editor??resolveUnityEditor(graph.unityVersion);check(selected,'Exact Unity Editor is missing','unity_editor_missing');
 const staged=await stageMigrationObservation({projectDir,graph,runDir,templateRoot,componentMode});
 const processResult=await (dependencies.runEditor??runUnityEditor)({editor:selected,projectDir:staged.projectDir,requestFile:staged.requestFile,reportFile:staged.reportFile,lockDirectory,toolkitRoot,timeoutSeconds});
 await fs.writeFile(assertAssetPath(path.join(runDir,'editor-output.txt')),String(processResult.logTail??'').slice(-4*1024**2),{flag:'wx'});
 await fs.writeFile(assertAssetPath(path.join(runDir,'process.json')),JSON.stringify({exitCode:processResult.exitCode,closed:processResult.closed,timedOut:processResult.timedOut}),{flag:'wx'});
 check(processResult.closed===true,'Unity child closure is uncertain','unity_recovery_required');await verifyGraphFiles(projectDir,graph);
 check(hash(await fs.readFile(staged.requestFile))===staged.requestSha256&&hash(await fs.readFile(path.join(templateRoot,'Unity/REToolkitMigrationObservation.cs')))===staged.helperSha256&&hash(await fs.readFile(path.join(staged.projectDir,'Assets/REToolkitValidation/Editor/REToolkitValidation.cs')))===staged.helperSha256,'Migration helper or control request changed','migration_observation_stale');
 check(processResult.exitCode===0&&!processResult.timedOut,'Unity migration observation failed; inspect retained staging/logs','migration_editor_failed');
 const stat=await fs.lstat(assertAssetPath(staged.reportFile));check(stat.isFile()&&stat.size<=32*1024**2,'Migration observation report exceeds limit');const bytes=await fs.readFile(staged.reportFile),observation=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 check(observation.kind==='retoolkit-migration-observation'&&observation.schemaVersion===1&&observation.runId===staged.request.runId&&observation.graphRevision===graph.revision&&observation.inventorySha256===fingerprint(graph.files)&&observation.unityVersion===graph.unityVersion&&observation.complete===true&&observation.compilation?.state==='succeeded'&&Array.isArray(observation.scripts)&&Array.isArray(observation.components),'Invalid or incomplete migration Editor observation');
 return {observation,requestSha256:hash(await fs.readFile(staged.requestFile)),observationSha256:hash(bytes),helperSha256:staged.helperSha256,process:processResult};
}
