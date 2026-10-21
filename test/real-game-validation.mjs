// Explicit acceptance runner. Never included in the default test glob.
// node test/real-game-validation.mjs <reference-toolkit-root> <game> [timeout-seconds]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createToolkit} from '../src/toolkit.js';
import {fingerprint,withWorkspaceLock} from '../src/state.js';
import {acquireToolchainRead} from '../src/toolchain/lease.js';
import {assertAssetPath,selectedAssetBinding} from '../src/assets/context.js';
import {locateUnityProject,verifyGraphFiles} from '../src/assets/graph.js';
import {createValidationSourceSnapshot} from '../src/assets/validation-snapshot.js';
import {validateUnityProject} from '../src/unity/validation.js';

const [referenceRoot,game,timeoutArg='3600',...extra]=process.argv.slice(2);
if(!referenceRoot||!game||extra.length||!/^\d+$/.test(timeoutArg)||Number(timeoutArg)<1||Number(timeoutArg)>3600)throw Error('Usage: node test/real-game-validation.mjs <reference-toolkit-root> <game> [timeout-seconds:1..3600]');
const codeRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=assertAssetPath(path.join(codeRoot,'.cache/game-validation-acceptance',randomUUID()),codeRoot),name='SourceValidation';
fs.mkdirSync(root,{recursive:true});
const write=(file,value)=>{assertAssetPath(file,root);const bytes=JSON.stringify(value)+'\n';if(Buffer.byteLength(bytes)>128*1024**2)throw Error('Acceptance artifact exceeds 128 MiB');fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});};
const progress=message=>console.error(new Date().toISOString()+' '+message);
let mainReader,reader,uncertain=false,snapshot,projectDir,result;
const acceptance={kind:'retoolkit-real-source-validation-acceptance',schemaVersion:1,startedAt:new Date().toISOString(),root,sourceGraphCoverage:'unverified',behavior:'unverified'};
try{
 mainReader=acquireToolchainRead(path.resolve(referenceRoot));reader=acquireToolchainRead(root);
 progress('Reading selected original source binding; reference project is read only');
 const reference=createToolkit(referenceRoot,{log:progress}),selected=selectedAssetBinding(reference,game);
 projectDir=await locateUnityProject(selected.project.reconstructedSourceDir);
 const toolkit=createToolkit(root,{log:progress});await toolkit.init(name);
 const project=toolkit.read(name);
 for(const key of ['platform','extractedPath','nativeBinary','metadata','ghidraProjectName','ghidraProgramName','unityEditorPath'])if(selected.project[key]!==undefined)project[key]=selected.project[key];
 project.identities=structuredClone(selected.project.identities);project.reconstructedSourceDir=projectDir;await toolkit.save(name,project);
 if(fingerprint(selectedAssetBinding(toolkit,name).binding)!==fingerprint(selected.binding))throw Error('Private acceptance binding differs from original inputs');
 fs.mkdirSync(path.join(root,'templates/Unity'),{recursive:true});
 fs.copyFileSync(path.join(codeRoot,'templates/Unity/REToolkitValidation.cs'),path.join(root,'templates/Unity/REToolkitValidation.cs'),fs.constants.COPYFILE_EXCL);
 progress('Building complete source inventory and validation selectors; no serialized-reference index');
 snapshot=await createValidationSourceSnapshot({projectDir,binding:selected.binding});
 write(path.join(root,'validation-source-snapshot.json'),snapshot);
 Object.assign(acceptance,{projectDir,sourceRevision:snapshot.revision,sourceCoverage:snapshot.coverage,unityVersion:snapshot.unityVersion});
 progress('Staging complete private copy and running exact-version Unity validation');
 result=await withWorkspaceLock(toolkit.workspace(name),async()=>{
  const marker=path.join(toolkit.workspace(name),'.retk-lock','real-validation-'+randomUUID()+'.json');write(marker,{kind:'real-source-validation-in-progress',sourceRevision:snapshot.revision});
  try{return await validateUnityProject({toolkit,name,projectDir,graph:snapshot,timeoutSeconds:Number(timeoutArg)});}
  catch(error){uncertain=error.preserveToolchainGate===true||error.code==='unity_recovery_required';throw error;}
  finally{if(!uncertain)fs.unlinkSync(marker);}
 });
 progress('Verifying original export and selected input binding after Editor close');
 await verifyGraphFiles(projectDir,snapshot);
 if(fingerprint(selectedAssetBinding(reference,game).binding)!==fingerprint(selected.binding))throw Error('Original selected input binding changed');
 Object.assign(acceptance,{state:'completed',originalSourceUnchanged:true,result,receipt:path.join(toolkit.workspace(name),result.storedReceipt)});
}catch(error){
 uncertain=uncertain||error.preserveToolchainGate===true||error.code==='unity_recovery_required';
 Object.assign(acceptance,{state:uncertain?'recovery_required':'failed',error:{code:error.code??'acceptance_failed',message:String(error.message).slice(0,8192)},originalSourceUnchanged:false});process.exitCode=1;
}finally{
 acceptance.finishedAt=new Date().toISOString();write(path.join(root,'acceptance.json'),acceptance);
 if(!uncertain){reader?.release();mainReader?.release();}
 console.log(JSON.stringify({state:acceptance.state,root,sourceRevision:snapshot?.revision,compileReady:result?.compileReady??false,bindingsVerified:result?.bindingsVerified??false,sourceGraphCoverage:'unverified',originalSourceUnchanged:acceptance.originalSourceUnchanged,receipt:acceptance.receipt,error:acceptance.error},null,2));
}
