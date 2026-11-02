import path from 'node:path';
import {assetPaths,selectedAssetBinding,safeAssetExportPath} from './context.js';
import {readAssetJson} from './service.js';
import {verifyGraphFiles,locateUnityProject,UNITY_PROJECT_LIMITS} from './graph.js';
import {assertGraphManifest,verifyStoredGraph} from './graph-storage.js';
import {createValidationSourceSnapshot} from './validation-snapshot.js';
import {fingerprint} from '../state.js';
import {assertSourceIndex} from './source-index.js';

/** Read-only snapshot; availability never implies compilation or behavior. */
export async function inspectAssetReadiness(toolkit,name) {
 const result={state:'unknown',compileReady:false,bindingsVerified:false,behavior:'unverified'};
 try {
  const selected=selectedAssetBinding(toolkit,name),paths=assetPaths(toolkit,name);
  const projectDir=await locateUnityProject(safeAssetExportPath(paths.workspace,selected.project.reconstructedSourceDir??path.join(paths.workspace,'05_ReconstructedSource'),selected.inputPath));
  let staticGraph={};
  try{
   const graph=readAssetJson(paths.graphFile,UNITY_PROJECT_LIMITS.maxStoredGraphBytes);
   assertGraphManifest(graph,{expectedStorage:selected.project.assetReconstruction?.graphStorage});verifyStoredGraph(graph,paths.graphFile);
   if(fingerprint(graph.binding)!==fingerprint(selected.binding))staticGraph={state:'stale'};
   else{await verifyGraphFiles(projectDir,graph);staticGraph={state:'indexed',revision:graph.revision,coverage:graph.coverage};}
  }catch(error){staticGraph={state:['stale_graph','asset_input_stale'].includes(error.code)?'stale':'unknown',code:typeof error.code==='string'?error.code:'asset_snapshot_unavailable'};}
  let sourceIndex={state:'unavailable'};
  try{
   const index=assertSourceIndex(readAssetJson(path.join(paths.base,'source-index.json')));
   if(fingerprint(index.binding)!==fingerprint(selected.binding))sourceIndex={state:'stale'};
   else {await verifyGraphFiles(projectDir,index);sourceIndex={state:'ready',revision:index.revision,coverage:index.coverage};}
  }catch(error){if(error.code==='stale_graph')sourceIndex={state:'stale'};}
  let validation={};
  if(selected.project.assetReconstruction?.validationOperation)try{
   const graph=await createValidationSourceSnapshot({projectDir,binding:selected.binding});
   const {readUnityValidation}=await import('../unity/validation.js');const observed=await readUnityValidation({toolkit,name,projectDir,graph,operationId:selected.project.assetReconstruction.validationOperation});
   validation={compilation:observed.compilation??{state:observed.compileReady?'succeeded':'unverified'},compileReady:observed.compileReady,bindingsVerified:observed.bindingsVerified,scopeBindingsVerified:observed.scopeBindingsVerified??false,validationScope:observed.scope,validationCoverage:observed.coverage,validationOperation:observed.operationId,validationState:observed.state,validationSourceSnapshot:observed.sourceSnapshot??{kind:graph.kind,revision:graph.revision,coverage:graph.coverage}};
  }catch{validation={validationState:'stale-or-unavailable'};}
  return {...result,...staticGraph,sourceIndex,...validation};
 }catch(error){return {...result,state:['stale_graph','asset_input_stale'].includes(error.code)?'stale':'unknown',code:typeof error.code==='string'?error.code:'asset_snapshot_unavailable'};}
}
