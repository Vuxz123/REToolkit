import {createHash} from 'node:crypto';
import {inventoryUnityProject,readUnitySourceMetadata,describeUnitySourceScript,readUnityProjectVersion,makeUnityAsset,verifyGraphFiles} from './graph.js';

/** Source facts for library staging. This DTO never claims serialized coverage. */
export async function createUnitySourceFacts(projectDir,{binding={}}={}){
 const {projectDir:root,files}=await inventoryUnityProject(projectDir),metadata=await readUnitySourceMetadata(root,files),assets=[];let bytes=Buffer.byteLength(JSON.stringify(files));
 for(const file of files){if(!file.path.startsWith('Assets/')||file.path.endsWith('.meta'))continue;const asset=makeUnityAsset(file,metadata);if(asset.kind==='script')asset.script=await describeUnitySourceScript(root,file,metadata);bytes+=Buffer.byteLength(JSON.stringify(asset))+1;if(bytes>128*1024**2)throw Object.assign(Error('Source facts exceed 128 MiB'),{code:'source_facts_limit'});assets.push(asset);}
 const result={kind:'retoolkit-unity-source-facts',schemaVersion:1,binding:structuredClone(binding),revision:createHash('sha256').update(JSON.stringify({binding,files})).digest('hex'),unityVersion:await readUnityProjectVersion(root,files),files,assets,coverage:{kind:'source-facts-only',serializedReferences:'unverified'},limitations:['Library source facts only; serialized references and runtime behavior remain unverified.']};
 await verifyGraphFiles(root,result);return result;
}
export const supportsLibraryFacts=value=>value?.kind==='retoolkit-unity-source-facts'&&value.schemaVersion===1||value?.kind==='retoolkit-asset-graph'&&(value.schemaVersion===1||value.schemaVersion===2&&value.storage?.kind==='sqlite');
