import {fingerprint} from '../state.js';
import {assetError} from './context.js';
import {inventoryUnityProject,readUnitySourceMetadata,describeUnitySourceScript,readUnityProjectVersion} from './graph.js';

export const isSourceIndex=value=>value?.kind==='retoolkit-source-index';
export function assertSourceIndex(value){
 const {revision,...payload}=value??{};
 if(!isSourceIndex(value)||value.schemaVersion!==1||!Array.isArray(value.files)||!Array.isArray(value.assets)||value.coverage?.serializedReferences!=='unverified'||revision!==fingerprint(payload))throw assetError('source_index_invalid','Invalid source index identity');
 return value;
}
// Hash the entire candidate for rollback/integrity, but parse only C# identity
// and compiler boundaries. No prefab/scene/data documents or SQLite edges.
export async function createSourceIndex({projectDir,binding}){
 const {projectDir:root,files}=await inventoryUnityProject(projectDir);
 const selected=files.filter(f=>f.path.startsWith('Assets/')&&f.path.endsWith('.cs'));
 if(selected.length>50000)throw assetError('source_index_limit','Source index exceeds 50000 C# files');
 const maxBytes=128*1024**2;
 let bytes=Buffer.byteLength(JSON.stringify({files,binding}))+4096;
 const account=value=>{bytes+=Buffer.byteLength(JSON.stringify(value))+1;if(bytes>maxBytes)throw assetError('source_index_limit','Source index metadata exceeds 128 MiB');};
 account(null);
 const metadata=await readUnitySourceMetadata(root,files.filter(f=>f.path.endsWith('.cs.meta')||f.path.endsWith('.asmdef')||f.path.endsWith('.asmref')));
 const assets=[];
 for(const file of selected){const guid=metadata.metas.get(file.path)??null,asset={id:guid?`asset:${guid}`:`opaque:${file.path}`,guid,path:file.path,kind:'script',script:await describeUnitySourceScript(root,file,metadata)};account(asset);assets.push(asset);}
 const payload={kind:'retoolkit-source-index',schemaVersion:1,binding:structuredClone(binding),unityVersion:await readUnityProjectVersion(root,files),files,assets,coverage:{kind:'source-only',files:files.length,scripts:assets.length,serializedReferences:'unverified'},limitations:['Source identity only; asset binding, serialized data and gameplay remain unverified.']};
 return {...payload,revision:fingerprint(payload)};
}
