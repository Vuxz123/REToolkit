import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fingerprint} from '../state.js';
import {assertAssetPath} from './context.js';
import {inventoryUnityProject,readUnitySourceMetadata,describeUnitySourceScript,readUnityProjectVersion,readUnitySerializedRecords,makeUnityAsset,makeUnityGraphNode,unityReferenceEdges,verifyGraphFiles,UNITY_PROJECT_LIMITS} from './graph.js';
import {createSqliteStore,SQLITE_GRAPH_LIMITS} from './sqlite-store.js';
const MAX_MANIFEST_BYTES=128*1024**2,MAX_LIMITATIONS=1000,MAX_LIMITATION_BYTES=256*1024;
const fail=(code,message=code,details)=>{throw Object.assign(new Error(message),{code,...(details?{details}:{})});};
const sha=value=>createHash('sha256').update(value).digest('hex');
function inside(file,root){const rel=path.relative(root,file);return rel===''||!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);}
function optionsValid({binding,databaseFile,storageRelativePath,limits}){
 if(!binding||typeof binding!=='object'||Array.isArray(binding)||!path.isAbsolute(databaseFile??'')||typeof storageRelativePath!=='string'||!storageRelativePath.length||storageRelativePath.length>2048||/[\\:\x00-\x1f]/.test(storageRelativePath)||storageRelativePath.startsWith('/')||storageRelativePath.split('/').some(p=>!p||p==='.'||p==='..')||path.posix.basename(storageRelativePath)!==path.basename(databaseFile))fail('invalid_sqlite_graph_options');
 const allowed=[...Object.keys(SQLITE_GRAPH_LIMITS),'maxManifestBytes','maxFiles','hashConcurrency'];if(!limits||typeof limits!=='object'||Array.isArray(limits)||Object.keys(limits).some(k=>!allowed.includes(k)))fail('invalid_graph_limits');
 const selected={...SQLITE_GRAPH_LIMITS,maxManifestBytes:MAX_MANIFEST_BYTES,maxFiles:UNITY_PROJECT_LIMITS.maxFiles,hashConcurrency:UNITY_PROJECT_LIMITS.hashConcurrency};
 for(const [key,value] of Object.entries(limits)){if(!Number.isSafeInteger(value)||value<1||value>selected[key])fail('invalid_graph_limits');selected[key]=value;}return selected;
}
/** Disk-backed structure, bounded manifest metadata; never materialize node/edge arrays. */
export async function indexUnityProjectSqlite(projectDir,{binding={},databaseFile,storageRelativePath,limits={},onProgress}={}){
 if(onProgress!==undefined&&typeof onProgress!=='function')fail('invalid_graph_progress');
 const selected=optionsValid({binding,databaseFile,storageRelativePath,limits}),target=assertAssetPath(databaseFile),storeLimits=Object.fromEntries(Object.keys(SQLITE_GRAPH_LIMITS).map(k=>[k,selected[k]]));
 try{await fs.lstat(target);fail('sqlite_output_exists','SQLite graph output already exists; choose a fresh operation file.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const snapshot=await inventoryUnityProject(projectDir,{inventoryLimits:{maxFiles:selected.maxFiles,hashConcurrency:selected.hashConcurrency}}),root=snapshot.projectDir,files=snapshot.files;
 if(inside(target,root))fail('sqlite_output_overlaps_source','SQLite graph output must be outside the source Unity project.');
 // Normalize the build once; no mutable caller object can change the revision
 // after source processing has started.
 const normalizedBinding=JSON.parse(JSON.stringify(binding)),revision=sha(JSON.stringify({binding:normalizedBinding,files}));
 const assets=[],limitations=['Compilation, bindings and gameplay behavior are unverified.'];let metadataBytes=Buffer.byteLength(JSON.stringify(files))+Buffer.byteLength(JSON.stringify(normalizedBinding))+4096,limitationBytes=0,omittedLimitations=0,store,owned=false,ownedIdentity;
 const counts={assets:0,nodes:0,edges:0},coverage={assets:0,nodes:0,edges:0,opaqueAssets:0,missingReferences:0,unsupportedScripts:0,summarizedFields:0,summarizedNodes:0,summarizedSerializedBytes:0};let processedFiles=0;
 const progress=async phase=>{if(onProgress)await onProgress({phase,files:processedFiles,totalFiles:files.length,...counts});};
 const budget=kind=>{if(metadataBytes>selected.maxManifestBytes)fail('graph_metadata_limit','SQLite graph manifest metadata exceeds its byte budget.',{metadataBytes,maxGraphBytes:selected.maxManifestBytes,files:files.length,...counts,lastRecordKind:kind});};
 const account=(value,kind)=>{metadataBytes+=Buffer.byteLength(JSON.stringify(value))+1;budget(kind);};
 const limitation=message=>{const bytes=Buffer.byteLength(message);if(limitations.length>=MAX_LIMITATIONS||limitationBytes+bytes>MAX_LIMITATION_BYTES){omittedLimitations++;return;}limitations.push(message);limitationBytes+=bytes;account(message,'limitation');};
 budget('inventory');const metadata=await readUnitySourceMetadata(root,files);
 const profile={kind:'retoolkit-graph-profile',schemaVersion:1,storage:'sqlite',limits:{maxGraphBytes:MAX_MANIFEST_BYTES,maxManifestBytes:selected.maxManifestBytes,maxFiles:selected.maxFiles,...storeLimits},projectionPolicy:'unity-bulk-payloads-v1'};
 try{
 await fs.mkdir(path.dirname(target),{recursive:true});assertAssetPath(target);store=createSqliteStore({file:target,limits:storeLimits});owned=true;ownedIdentity=store.createdIdentity;await progress('indexing');
 for(const file of files){
 processedFiles++;if(processedFiles%1000===0)await progress('indexing');
 if(!file.path.startsWith('Assets/')||file.path.endsWith('.meta'))continue;
 const asset=makeUnityAsset(file,metadata);if(!asset.guid)limitation(`Missing metadata: ${file.path}`);
 let records=null;
 if(asset.kind==='script'){asset.script=await describeUnitySourceScript(root,file,metadata);if(!asset.script.supported)limitation(`Unsupported script declarations: ${file.path}`);}
 else if(['scene','prefab','asset','material','animationController','animationClip'].includes(asset.kind)){records=await readUnitySerializedRecords(root,file);if(records===null){asset.kind='opaque';limitation(`Opaque serialized asset: ${file.path}`);}}
 account(asset,'asset');store.addAsset(asset);assets.push(asset);counts.assets++;if(asset.kind==='opaque')coverage.opaqueAssets++;if(asset.script&&!asset.script.supported)coverage.unsupportedScripts++;
 if(records!==null)for(const parsed of records){const node=makeUnityGraphNode(file,asset,parsed);store.addNode(node);counts.nodes++;if(parsed.summaries?.length){coverage.summarizedFields+=parsed.summaries.length;coverage.summarizedNodes++;coverage.summarizedSerializedBytes+=parsed.summaries.reduce((n,s)=>n+s.serializedBytes,0);}if(counts.nodes%1000===0)await progress('indexing');}
 }
 const lookup={findAssetGuid:guid=>store.findAssetGuid(guid),findAssetId:id=>store.findAssetId(id),hasNode:id=>store.hasNode(id)};
 await progress('references');for(const node of store.nodes())for(const edge of unityReferenceEdges(node,lookup)){store.addEdge(edge);counts.edges++;if(edge.status==='missing')coverage.missingReferences++;if(counts.edges%1000===0)await progress('references');}
 const unityVersion=await readUnityProjectVersion(root,files);if(coverage.summarizedFields)limitation(`${coverage.summarizedFields} allowlisted Unity bulk payload fields summarized as read-only opaque tokens; original bytes remain in inventoried source files. Component fields and all structural object references remain unprojected.`);
 if(omittedLimitations){const message=`${omittedLimitations} additional source limitations omitted from this bounded manifest; asset metadata and aggregate coverage remain included.`;limitations.push(message);account(message,'limitation-summary');}
 Object.assign(coverage,counts);
 const manifest={kind:'retoolkit-asset-graph',schemaVersion:2,binding:normalizedBinding,revision,unityVersion,profile,files,assets,coverage,limitations};
 // Verify source before sealing; no sealed receipt is returned while source
 // files or directory membership differ from the original complete inventory.
 await progress('verifying');await verifyGraphFiles(root,manifest);
 const graphSha256=fingerprint(manifest),receipt=store.seal({revision,binding:normalizedBinding,coverage,graphSha256});store.close();store=null;const sealedStat=await fs.lstat(target);
 if(!receipt||receipt.schemaVersion!==1||receipt.graphSha256!==graphSha256||receipt.revision!==revision||receipt.bindingSha256!==fingerprint(normalizedBinding)||!/^[a-f0-9]{64}$/.test(receipt.sha256)||!Number.isSafeInteger(receipt.size)||receipt.size<1||receipt.size>selected.maxDatabaseBytes||!receipt.counts||Object.keys(receipt.counts).length!==3||Object.keys(counts).some(k=>receipt.counts[k]!==counts[k]))fail('sqlite_receipt_invalid','SQLite graph receipt does not match the complete manifest, indexed counts, binding or revision.');
 manifest.storage={...receipt,kind:'sqlite',schemaVersion:1,relativePath:storageRelativePath};
 const actualBytes=Buffer.byteLength(JSON.stringify(manifest));if(actualBytes>selected.maxManifestBytes)fail('graph_metadata_limit','SQLite graph manifest exceeds its byte budget.',{metadataBytes:actualBytes,maxGraphBytes:selected.maxManifestBytes,...counts,lastRecordKind:'manifest'});
 await progress('sealed');await verifyGraphFiles(root,manifest);assertAssetPath(target);const current=await fs.lstat(target);
 if(!current.isFile()||current.dev!==sealedStat.dev||current.ino!==sealedStat.ino||current.size!==receipt.size||current.mtimeMs!==sealedStat.mtimeMs||current.ctimeMs!==sealedStat.ctimeMs)fail('sqlite_graph_changed','Sealed database changed before manifest publication.');return manifest;
 }catch(error){
 if(!owned&&error.sqliteCreatedFileIdentity){owned=true;ownedIdentity=error.sqliteCreatedFileIdentity;}
 let cleanupError;try{store?.close();}catch(e){cleanupError=e;}
 if(owned&&!cleanupError){try{assertAssetPath(target);let current;try{current=await fs.lstat(target);}catch(e){if(e.code!=='ENOENT')throw e;}if(current){if(!ownedIdentity||!current.isFile()||current.dev!==ownedIdentity.dev||current.ino!==ownedIdentity.ino)fail('sqlite_graph_changed','Owned SQLite database was replaced; external replacement was preserved.');await fs.rm(target);for(const suffix of ['-journal','-wal','-shm']){const sidecar=assertAssetPath(target+suffix);await fs.rm(sidecar,{force:true});}}}catch(e){cleanupError=e;}}
 if(cleanupError)throw Object.assign(new Error('SQLite index failed; owned database cleanup requires inspection.'),{code:'sqlite_index_recovery_required',cause:error,cleanupCause:cleanupError});throw error;
 }
}
