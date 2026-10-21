import path from 'node:path';
import {assetPaths,selectedAssetBinding,safeAssetExportPath} from './context.js';
import {readAssetJson} from './service.js';
import {verifyGraphFiles,locateUnityProject,UNITY_PROJECT_LIMITS} from './graph.js';
import {assertGraphManifest,verifyStoredGraph} from './graph-storage.js';
import {fingerprint} from '../state.js';

/** Read-only snapshot; availability never implies compilation or behavior. */
export async function inspectAssetReadiness(toolkit,name) {
 const result={state:'unknown',compileReady:false,bindingsVerified:false,behavior:'unverified'};
 try {
  const selected=selectedAssetBinding(toolkit,name),paths=assetPaths(toolkit,name),graph=readAssetJson(paths.graphFile,UNITY_PROJECT_LIMITS.maxStoredGraphBytes);
  assertGraphManifest(graph,{expectedStorage:selected.project.assetReconstruction?.graphStorage});verifyStoredGraph(graph,paths.graphFile);
  if(fingerprint(graph.binding)!==fingerprint(selected.binding))return {...result,state:'stale'};
  const projectDir=await locateUnityProject(safeAssetExportPath(paths.workspace,selected.project.reconstructedSourceDir??path.join(paths.workspace,'05_ReconstructedSource'),selected.inputPath));
  await verifyGraphFiles(projectDir,graph);
  let validation={};
  if(selected.project.assetReconstruction?.validationOperation)try{
   const {readUnityValidation}=await import('../unity/validation.js');const observed=await readUnityValidation({toolkit,name,projectDir,graph,operationId:selected.project.assetReconstruction.validationOperation});
   validation={compileReady:observed.compileReady,bindingsVerified:observed.bindingsVerified,validationOperation:observed.operationId};
  }catch{validation={validationState:'stale-or-unavailable'};}
  return {...result,state:'indexed',revision:graph.revision,coverage:graph.coverage,...validation};
 }catch(error){return {...result,state:['stale_graph','asset_input_stale'].includes(error.code)?'stale':'unknown',code:typeof error.code==='string'?error.code:'asset_snapshot_unavailable'};}
}
