import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {assertAssetPath} from '../assets/context.js';
import {fileIdentity} from '../state.js';

const fail=(code,message)=>Object.assign(new Error(message),{code});
// This intake intentionally stops before dumper, native engines or target execution.
export async function createApkProject(toolkit,name,input){
 if(typeof input!=='string'||!input||input.length>4096||/[\x00-\x1f]/.test(input)||! /\.(apk|xapk|apks|aab|zip)$/i.test(input))throw fail('PROJECT_INPUT_INVALID','Choose an APK, XAPK, APKS, AAB or ZIP archive');
 const workspace=assertAssetPath(toolkit.workspace(name)),source=assertAssetPath(path.resolve(input));
 if(!fs.lstatSync(source).isFile())throw fail('PROJECT_INPUT_INVALID','Project input must be a regular archive');
 fs.mkdirSync(assertAssetPath(path.dirname(workspace)),{recursive:true});
 try{fs.mkdirSync(workspace);}catch(error){if(error.code==='EEXIST')throw fail('PROJECT_EXISTS','A project with this name already exists. Choose a new name or open the existing project.');throw error;}
 const result={kind:'retoolkit-project-intake',schemaVersion:1,name,workspace,state:'created',analysisReady:false,nextSteps:[]};
 await toolkit.init(name);
 try{
  const original=assertAssetPath(path.join(workspace,'00_OriginalBuild',path.basename(source)),workspace),before=fileIdentity(source);
  fs.copyFileSync(source,original,fs.constants.COPYFILE_EXCL);
  if(fileIdentity(original).sha256!==before.sha256||fileIdentity(source).sha256!==before.sha256)throw fail('PROJECT_INPUT_CHANGED','Input archive changed while creating the project');
  result.input={path:original,sha256:before.sha256,size:before.size};
  const project=await toolkit.add(name,original);
  result.platform=project.platform;result.nextSteps=['Inspect current workspace status, then prepare missing dump/import/analysis stages.'];
  result.inputSelection=await toolkit.inspectInputs(name);
  if(result.inputSelection.state!=='selected'){
   result.state='needs-input';result.issue={code:'input_selection_required',message:result.inputSelection.state==='missing-input'?'Archive extracted to 01_Extracted; binary or metadata is missing.':'Archive extracted to 01_Extracted; select the binary / ABI and metadata to continue.'};
   result.nextSteps=['Choose binary / ABI and metadata in the project input-selection panel.'];
   if(result.inputSelection.state==='missing-input')result.nextSteps.push('Inspect whether a matching split APK / OBB is missing or this is a Mono or unsupported build.');
  }
 }catch(error){
  const selection=/^(No IL2CPP (binary|metadata) found|Ambiguous (binary|metadata);)/.test(error.message);
  result.state=selection?'needs-input':'failed';result.issue={code:selection?'input_selection_required':error.code??'PROJECT_IMPORT_FAILED',message:String(error.message).slice(0,12000)};
  result.nextSteps=selection?['Inspect the retained extraction staging and resolve binary/metadata or ABI selection.','If this is a base APK missing Unity inputs, locate the matching installed package and pull split APKs/OBB from an explicitly selected LDPlayer device. Missing IL2CPP can also mean a Mono or unsupported build; do not assume splits are the cause.']:['Inspect the intake issue and preserved workspace before retrying with a corrected archive.'];
 }
 const receipt=assertAssetPath(path.join(workspace,'04_Notes',`project-intake-${randomUUID()}.json`),workspace);result.receipt=receipt;
 fs.writeFileSync(receipt,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return result;
}
