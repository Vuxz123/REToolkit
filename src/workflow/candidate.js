import path from 'node:path';
import {fingerprint} from '../state.js';
import {assetPaths,selectedAssetBinding,assetProjectPath,createArtifactToolkit} from '../assets/context.js';
import {inventoryUnityProject} from '../assets/graph.js';
import {artifactPaths,loadArtifact,loadGeneration} from '../recovery/artifacts.js';
import {check} from './store.js';

export async function readCandidate(toolkit,name,artifactId){
 const selected=selectedAssetBinding(toolkit,name);let project=assetProjectPath(toolkit,name,selected),base=assetPaths(toolkit,name).base,revision=null;
 if(artifactId){const paths=artifactPaths(toolkit,name,artifactId),manifest=loadArtifact(paths,artifactId);check(!manifest.pending,'Artifact mutation needs inspection','workflow_candidate_stale');check(fingerprint(manifest.binding)===fingerprint(selected.binding),'Artifact inputs changed','workflow_candidate_stale');const g=loadGeneration(paths,manifest);project=g.project;base=path.join(paths.base,'assets');revision=manifest.revision;}
 const {files}=await inventoryUnityProject(project);
 if(artifactId){const paths=artifactPaths(toolkit,name,artifactId),manifest=loadArtifact(paths,artifactId);check(manifest.revision===revision&&fingerprint(loadGeneration(paths,manifest).receipt.files)===fingerprint(files),'Artifact inventory changed','workflow_candidate_stale');}
 const reader=artifactId?createArtifactToolkit(toolkit,name,{base:path.dirname(base),projectDir:project,readState:()=>undefined,saveState:()=>{throw Error('Read-only validation context');}}):toolkit;
 return {project,base,files,toolkit:reader,name,binding:selected.binding,identity:{artifactId:artifactId??null,revision,project,inventorySha256:fingerprint(files),bindingSha256:fingerprint(selected.binding)}};
}
export const sameCandidate=(a,b)=>fingerprint(a)===fingerprint(b);
