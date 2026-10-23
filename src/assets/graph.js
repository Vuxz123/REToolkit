import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { parseCSharp } from './csharp.js';
import {readUnityYamlStream} from './unity-yaml-stream.js';

export const UNITY_PROJECT_LIMITS=Object.freeze({maxFiles:250000,maxDirectories:100000,maxNodes:200000,maxEdges:1000000,maxGraphBytes:128*1024*1024,maxStoredGraphBytes:512*1024*1024,hashConcurrency:8});
const MAX_DIRECTORIES=UNITY_PROJECT_LIMITS.maxDirectories,MAX_NODES=200000,MAX_EDGES=1000000,MAX_TEXT=16*1024*1024,MAX_GRAPH=UNITY_PROJECT_LIMITS.maxGraphBytes;
const sourceDirs=['Assets','ProjectSettings','Packages'];
const guidPattern=/^[a-f0-9]{32}$/i;
const decimal=/^-?(?:0|[1-9]\d*)$/;
// Exact Unity class/path allowlist: these are bulk data, never component
// declarations or arbitrary user fields. Reference-bearing structures are kept.
const BULK_PAYLOADS=new Map([
 [43,{type:'Mesh',paths:new Set(['m_IndexBuffer','m_VertexData._typelessdata','m_BakedConvexCollisionMesh','m_BakedTriangleCollisionMesh','m_BoneNameHashes','m_Vertices','m_Normals','m_Tangents','m_Colors','m_UV','m_UV1','m_UV2','m_UV3','m_BindPose','m_Skin',...['m_Vertices','m_UV','m_Normals','m_Tangents','m_Weights','m_NormalSigns','m_TangentSigns','m_FloatColors','m_BoneIndices','m_Triangles'].map(p=>'m_CompressedMesh.'+p+'.m_Data')])}],
 [49,{type:'TextAsset',paths:new Set(['m_Script'])}],
 [28,{type:'Texture2D',paths:new Set(['image data','m_ImageData','m_TextureData'])}],
 [89,{type:'Cubemap',paths:new Set(['image data','m_ImageData','m_TextureData'])}],
 [83,{type:'AudioClip',paths:new Set(['m_AudioData','m_Resource.m_Data'])}],
 [128,{type:'Font',paths:new Set(['m_FontData'])}],
]);
const BULK_MIN_BYTES=4096;
function fail(code,detail=''){const error=new Error(`${code}${detail?`: ${detail}`:''}`);error.code=code;throw error;}
function hash(value){return crypto.createHash('sha256').update(value).digest('hex');}
function graphBudget(value=MAX_GRAPH){if(![128,256,512].map(n=>n*1024**2).includes(value))fail('invalid_graph_limits');return value;}
function metadataLimit(details){throw Object.assign(Error('graph_metadata_limit'),{code:'graph_metadata_limit',details});}
function structuralLimit(code,details){throw Object.assign(Error(code),{code,details});}
async function noLinks(file){let current=path.resolve(file);while(true){const stat=await fs.lstat(current);if(stat.isSymbolicLink())fail('unsafe_symlink',current);const parent=path.dirname(current);if(parent===current)break;current=parent;}}
async function existsDirectory(file){try{const stat=await fs.lstat(file);if(stat.isSymbolicLink())fail('unsafe_symlink',file);return stat.isDirectory();}catch(error){if(error.code==='ENOENT')return false;throw error;}}
export async function locateUnityProject(directory){
 const root=path.resolve(directory);await noLinks(root);const matches=[];let count=0;
 async function walk(dir,depth){if(++count>MAX_DIRECTORIES||depth>32)fail('project_search_limit');await noLinks(dir);
  if(await existsDirectory(path.join(dir,'Assets'))&&await existsDirectory(path.join(dir,'ProjectSettings'))){await noLinks(path.join(dir,'Assets'));await noLinks(path.join(dir,'ProjectSettings'));matches.push(dir);return;}
  for(const entry of (await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){if(entry.isSymbolicLink())fail('unsafe_symlink',entry.name);if(entry.isDirectory()&&!['Library','Temp','Logs','obj','node_modules','.git'].includes(entry.name))await walk(path.join(dir,entry.name),depth+1);}
 }
 await walk(root,0);if(matches.length!==1)fail(matches.length?'ambiguous_unity_project':'unity_project_not_found');return matches[0];
}
function sameFile(a,b){return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;}
function inventoryLimits(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['maxFiles','hashConcurrency'].includes(k)))fail('invalid_inventory_limits');
 const limits={maxFiles:value.maxFiles??UNITY_PROJECT_LIMITS.maxFiles,hashConcurrency:value.hashConcurrency??UNITY_PROJECT_LIMITS.hashConcurrency};
 if(!Number.isSafeInteger(limits.maxFiles)||limits.maxFiles<1||limits.maxFiles>UNITY_PROJECT_LIMITS.maxFiles||!Number.isSafeInteger(limits.hashConcurrency)||limits.hashConcurrency<1||limits.hashConcurrency>UNITY_PROJECT_LIMITS.hashConcurrency)fail('invalid_inventory_limits');return limits;
}
async function fileHash(file,before){
 const handle=await fs.open(file,'r');try{
  const opened=await handle.stat();if(!opened.isFile()||!sameFile(before,opened))fail('stale_graph','Source changed before hashing');
  const h=crypto.createHash('sha256');let size=0;for await(const bytes of handle.createReadStream({autoClose:false})){size+=bytes.length;if(size>before.size)fail('stale_graph','Source grew during hashing');h.update(bytes);}
  const after=await handle.stat(),current=await fs.lstat(file);if(size!==before.size||current.isSymbolicLink()||!current.isFile()||!sameFile(before,after)||!sameFile(before,current))fail('stale_graph','Source changed during hashing');return h.digest('hex');
 }finally{await handle.close();}
}
async function inventory(root,requestedLimits,maxGraphBytes=MAX_GRAPH){await noLinks(root);const limits=inventoryLimits(requestedLimits),files=[],fileSnapshots=[],directorySnapshots=[],absentRoots=[],pending=new Set();let totalBytes=0,directories=0,fileCount=0,metadataBytes=2,failure;
 async function enqueue(absolute){
  if(fileCount>=limits.maxFiles)fail('file_count_limit');const index=fileCount++;
  const task=(async()=>{const stat=await fs.lstat(absolute);if(stat.isSymbolicLink())fail('unsafe_symlink',absolute);if(!stat.isFile())fail('stale_graph','Source file type changed during discovery');totalBytes+=stat.size;if(totalBytes>64*1024*1024*1024)fail('source_bytes_limit');const record={path:path.relative(root,absolute).split(path.sep).join('/'),size:stat.size,sha256:await fileHash(absolute,stat)};metadataBytes+=Buffer.byteLength(JSON.stringify(record))+1;if(metadataBytes>maxGraphBytes)metadataLimit({metadataBytes,files:fileCount,assets:0,nodes:0,edges:0,lastRecordKind:'inventory',maxGraphBytes});files[index]=record;fileSnapshots[index]={dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs};})().catch(error=>{failure??=error;}).finally(()=>pending.delete(task));
  pending.add(task);if(pending.size>=limits.hashConcurrency)await Promise.race(pending);if(failure)throw failure;
 }
 async function walk(dir,depth=0){if(depth>100||++directories>MAX_DIRECTORIES)fail('directory_resource_limit');const before=await fs.lstat(dir);if(before.isSymbolicLink())fail('unsafe_symlink',dir);if(!before.isDirectory())fail('stale_graph','Source directory changed');const entries=(await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));directorySnapshots.push({dir,before,names:entries.map(e=>e.name)});
  for(const e of entries){const absolute=path.join(dir,e.name);if(e.isSymbolicLink())fail('unsafe_symlink',absolute);if(e.isDirectory())await walk(absolute,depth+1);else if(e.isFile())await enqueue(absolute);else fail('unsupported_file_type',absolute);}
 }
 try{
  for(const name of sourceDirs){const dir=path.join(root,name);if(await existsDirectory(dir)){await noLinks(dir);await walk(dir);}else absentRoots.push(dir);}
  await Promise.all(pending);if(failure)throw failure;
  // Hashing completes before these rechecks, including additions after the
  // directory was enumerated. Never publish a silently partial inventory.
  for(const {dir,before,names} of directorySnapshots){const after=await fs.lstat(dir);if(after.isSymbolicLink()||!after.isDirectory()||!sameFile(before,after))fail('stale_graph','Source directory changed during inventory');const current=(await fs.readdir(dir)).sort((a,b)=>a.localeCompare(b));if(JSON.stringify(current)!==JSON.stringify(names))fail('stale_graph','Source directory entries changed during inventory');}
  for(const dir of absentRoots)if(await existsDirectory(dir))fail('stale_graph','Source root appeared during inventory');
  // An unchanged directory membership does not attest earlier file bytes.
  // Recheck compact discovery identities after every directory recheck so an
  // already-hashed opaque file cannot change unnoticed before this snapshot.
  let cursor=0;await Promise.all(Array.from({length:Math.min(limits.hashConcurrency,files.length)},async()=>{
   while(!failure){const index=cursor++;if(index>=files.length)return;const current=await fs.lstat(path.join(root,files[index].path));if(current.isSymbolicLink()||!current.isFile()||!sameFile(fileSnapshots[index],current))fail('stale_graph','Source changed after hashing');}
  }).map(job=>job.catch(error=>{failure??=error.code==='stale_graph'?error:Object.assign(Error('stale_graph: Source changed after hashing'),{code:'stale_graph',cause:error});})));if(failure)throw failure;
  await noLinks(root);return files.sort((a,b)=>a.path.localeCompare(b.path));
 }catch(error){await Promise.all(pending);throw error;}
}
async function readText(root,file){if(file.size>MAX_TEXT)fail('text_file_limit',file.path);const absolute=path.join(root,file.path);await noLinks(absolute);const bytes=await fs.readFile(absolute);if(bytes.length!==file.size||hash(bytes)!==file.sha256)fail('stale_graph','File changed while indexing');if(bytes.includes(0))return null;const text=bytes.toString('utf8');if(text.includes('\ufffd'))return null;return text.replace(/^\uFEFF/,'');}
function safeYaml(text,label,{classID,summaries=[]}={}){
 const doc=YAML.parseDocument(text,{intAsBigInt:true,uniqueKeys:true,strict:true,keepSourceTokens:true,maxAliasCount:0});
 if(doc.errors.length||doc.warnings.length)fail('invalid_yaml',`${label}: ${doc.errors[0]?.message??doc.warnings[0]?.message}`);
 let count=0;const policy=BULK_PAYLOADS.get(classID);
 function validateNode(node,depth){if(depth>100||++count>500000)fail('yaml_resource_limit',label);if(YAML.isAlias(node)||node?.anchor)fail('yaml_alias_not_supported',label);if(node?.tag&&!['tag:yaml.org,2002:str','tag:yaml.org,2002:int','tag:yaml.org,2002:float','tag:yaml.org,2002:bool','tag:yaml.org,2002:null','tag:yaml.org,2002:map','tag:yaml.org,2002:seq'].includes(node.tag))fail('yaml_tag_not_supported',label);}
 function mapKey(key){if(!YAML.isScalar(key)||typeof key.value!=='string')fail('invalid_yaml_key',label);if(['__proto__','prototype','constructor','<<'].includes(key.value))fail('unsafe_yaml_key',label);return key.value;}
 function numericOnly(node,depth,checked=false){if(!checked)validateNode(node,depth);if(YAML.isScalar(node))return typeof node.value==='bigint'||typeof node.value==='number'&&Number.isFinite(node.value);if(YAML.isSeq(node))return node.items.every(n=>numericOnly(n,depth+1));if(YAML.isMap(node))return node.items.every(p=>{validateNode(p.key,depth+1);const key=mapKey(p.key);return !['fileID','guid'].includes(key)&&numericOnly(p.value,depth+1);});return false;}
 function project(node,depth,parts){
  if(!policy||parts[0]!==policy.type||parts.some(p=>typeof p!=='string'||p.includes('.'))||!policy.paths.has(parts.slice(1).join('.'))||!node?.range)return null;
  if(!YAML.isScalar(node)&&!YAML.isSeq(node))return null;const raw=text.slice(node.range[0],node.range[1]),serializedBytes=Buffer.byteLength(raw);if(serializedBytes<BULK_MIN_BYTES)return null;
  if(YAML.isSeq(node)&&!numericOnly(node,depth,true))return null;
  const field=parts.slice(1).join('.'),summary={kind:'opaque-payload',type:YAML.isSeq(node)?'numeric-array':'yaml-scalar',length:YAML.isSeq(node)?node.items.length:serializedBytes,lengthUnit:YAML.isSeq(node)?'items':'serialized-bytes',sha256:hash(raw),encoding:'unity-yaml-utf8',serializedBytes,readOnly:true};summaries.push({field,serializedBytes});return summary;
 }
 function convert(node,depth=0,parts=[]){validateNode(node,depth);const projected=project(node,depth,parts);if(projected)return projected;
  if(YAML.isMap(node)){const result={};for(const pair of node.items){const key=mapKey(pair.key),converted=convert(pair.value,depth+1,[...parts,key]);if(key==='fileID'){if(!YAML.isScalar(pair.value))fail('invalid_file_id',label);const raw=pair.value.type==='PLAIN'?pair.value.source:pair.value.value;if(typeof raw!=='string'||!decimal.test(raw))fail('invalid_file_id',label);result[key]=raw;}else if(key==='guid'&&YAML.isScalar(pair.value))result[key]=pair.value.type==='PLAIN'?pair.value.source:converted;else result[key]=converted;}return result;}
  if(YAML.isSeq(node))return node.items.map((n,i)=>convert(n,depth+1,[...parts,i]));if(node==null)return null;if(!YAML.isScalar(node))fail('invalid_yaml_node',label);const value=node.value;if(typeof value==='bigint')return value<=BigInt(Number.MAX_SAFE_INTEGER)&&value>=BigInt(Number.MIN_SAFE_INTEGER)?Number(value):value.toString();if(typeof value==='number'&&!Number.isFinite(value))fail('invalid_yaml_number',label);return value;
 }
 return convert(doc.contents);
}
function idString(value,label){const text=typeof value==='number'&&Number.isSafeInteger(value)?String(value):value;if(typeof text!=='string'||text.length>20||!decimal.test(text))fail('invalid_file_id',label);const number=BigInt(text);if(number<-(1n<<63n)||number>(1n<<63n)-1n)fail('invalid_file_id',label);return text;}
function parseUnityDocument(document,label){
 const {lines,bytes,...identity}=document;identity.fileID=idString(identity.fileID,label);const summaries=[],data=safeYaml(lines.join(''),label,{classID:identity.classID,summaries});if(!data||Array.isArray(data)||typeof data!=='object'||Object.keys(data).length!==1)fail('invalid_unity_document',label);const type=Object.keys(data)[0],fields=data[type];if(!fields||Array.isArray(fields)||typeof fields!=='object')fail('invalid_unity_fields',label);return {...identity,type,fields,summaries};
}

function kindFor(file){const extension=path.posix.extname(file).toLowerCase();return ({'.unity':'scene','.prefab':'prefab','.cs':'script','.dll':'assembly','.asmdef':'assembly','.mat':'material','.controller':'animationController','.anim':'animationClip','.asset':'asset','.png':'texture','.jpg':'texture','.jpeg':'texture','.tga':'texture','.fbx':'mesh','.obj':'mesh'})[extension]??'opaque';}
function predefinedAssembly(file){
 // Unity 2022.3 predefined compilation phases. An asmdef boundary takes
 // precedence over these special folders at the call site.
 // https://docs.unity3d.com/2022.3/Documentation/Manual/ScriptCompileOrderFolders.html
 const folders=file.split('/').slice(0,-1),editor=folders.includes('Editor');
 const firstpass=['Plugins','Standard Assets','Pro Standard Assets'].includes(folders[1]);
 return `Assembly-CSharp${editor?'-Editor':''}${firstpass?'-firstpass':''}`;
}
/** Complete source inventory only: this does not parse serialized objects. */
export async function inventoryUnityProject(projectDir,{inventoryLimits:requestedLimits,graphLimitBytes}={}){
 const maxGraphBytes=graphBudget(graphLimitBytes),limits=inventoryLimits(requestedLimits),root=await locateUnityProject(projectDir);return {projectDir:root,files:await inventory(root,limits,maxGraphBytes)};
}
/** Shared metadata reader for full graph and validation-only source snapshots. */
export async function readUnitySourceMetadata(root,files){
 const guids=new Map(),metas=new Map(),assemblies=[],asmrefs=files.filter(f=>f.path.endsWith('.asmref')).map(f=>path.posix.dirname(f.path));
 for(const file of files.filter(f=>f.path.startsWith('Assets/')&&f.path.endsWith('.meta'))){const text=await readText(root,file);if(text===null)fail('invalid_meta',file.path);const meta=safeYaml(text,file.path),guid=meta?.guid;if(typeof guid!=='string'||!guidPattern.test(guid))fail('invalid_meta_guid',file.path);const normalized=guid.toLowerCase();if(guids.has(normalized))fail('duplicate_guid',file.path);guids.set(normalized,file.path.slice(0,-5));metas.set(file.path.slice(0,-5),normalized);}
 for(const file of files.filter(f=>f.path.endsWith('.asmdef'))){
  const text=await readText(root,file);let value;try{value=JSON.parse(text);}catch{fail('invalid_assembly_definition',file.path);}
  if(typeof value?.name!=='string'||!value.name||value.name.length>256||assemblies.some(a=>a.dir===path.posix.dirname(file.path)))fail('invalid_assembly_definition',file.path);
  for(const key of ['includePlatforms','excludePlatforms','defineConstraints'])if(value[key]!==undefined&&(!Array.isArray(value[key])||value[key].length>1000||value[key].some(v=>typeof v!=='string'||!v||v.length>256)))fail('invalid_assembly_definition',file.path);
  const definition={path:file.path,includePlatforms:value.includePlatforms??[],excludePlatforms:value.excludePlatforms??[],defineConstraints:value.defineConstraints??[]};assemblies.push({dir:path.posix.dirname(file.path),name:value.name,definition,constrained:definition.includePlatforms.length>0||definition.excludePlatforms.length>0||definition.defineConstraints.length>0});
 }return {metas,assemblies,asmrefs};
}
export async function describeUnitySourceScript(root,file,{assemblies,asmrefs}){
 const text=await readText(root,file),parsed=text===null?{supported:false,types:[],limitations:['Opaque C# source']}:parseCSharp(text,{fileName:file.path});
 const parent=assemblies.filter(a=>file.path.startsWith(a.dir+'/')).sort((a,b)=>b.dir.length-a.dir.length),definition=parent[0],asmref=asmrefs.some(dir=>file.path.startsWith(dir+'/')&&dir.length>=(definition?.dir.length??0)),assembly=asmref?null:definition?.name??predefinedAssembly(file.path);
 const script={assembly,types:parsed.types,supported:parsed.supported&&!asmref&&!definition?.constrained,limitations:[...parsed.limitations,...(asmref?['Unresolved asmref assembly boundary requires Unity Editor validation.']:[]),...(definition?.constrained?['Constrained assembly definition requires Unity Editor validation; source replacement is unsupported.']:[])]};if(definition)script.assemblyDefinition=definition.definition;return script;
}
export async function readUnityProjectVersion(root,files){const file=files.find(f=>f.path==='ProjectSettings/ProjectVersion.txt'),text=file?await readText(root,file):null;return text?.match(/^m_EditorVersion:\s*(\S+)/m)?.[1]??null;}
/** Shared records for bounded disk-backed indexing. */
export function makeUnityAsset(file,{metas}){const guid=metas.get(file.path)??null;return {id:guid?`asset:${guid}`:`opaque:${file.path}`,guid,path:file.path,kind:kindFor(file.path)};}
export async function readUnitySerializedRecords(root,file){if(!['scene','prefab','asset','material','animationController','animationClip'].includes(kindFor(file.path)))return null;return readUnityYamlStream(root,file,{noLinks,parseDocument:document=>parseUnityDocument(document,file.path)});}
export function makeUnityGraphNode(file,asset,parsed){const guid=asset.guid,node={id:guid?`object:${guid}:${parsed.fileID}`:`object:opaque:${file.path}:${parsed.fileID}`,assetId:asset.id,guid,fileID:parsed.fileID,classID:parsed.classID,type:parsed.type,name:typeof parsed.fields.m_Name==='string'?parsed.fields.m_Name:'',fields:parsed.fields};if(parsed.classID===114&&parsed.fields.m_Script){const ref=parsed.fields.m_Script;node.scriptRef={guid:typeof ref.guid==='string'?ref.guid.toLowerCase():ref.guid??null,fileID:idString(ref.fileID,file.path),type:ref.type??null};}if(parsed.summaries.length){node.payloadProjection={kind:'retoolkit-opaque-payload-projection',policy:'unity-bulk-payloads-v1',readOnly:true,dataTrust:'untrusted-target-content',sourcePath:file.path,sourceSha256:file.sha256,fields:parsed.summaries.map(s=>s.field)};}return node;}
export function* unityReferenceEdges(node,{findAssetGuid,findAssetId,hasNode}){let fields=0;
  function* refs(value,field='',depth=0){if(depth>100||++fields>500000)fail('field_resource_limit');if(!value||typeof value!=='object')return;
   if(!Array.isArray(value)&&Object.hasOwn(value,'fileID')){const fileID=idString(value.fileID,field),guid=value.guid==null?node.guid:String(value.guid).toLowerCase();if(guid!==null&&!guidPattern.test(guid))fail('invalid_reference_guid',field);const kind=field==='m_Script'?'script':field==='m_Father'?'parent':field.startsWith('m_Component[')?'component':/m_(?:CorrespondingSourceObject|PrefabInstance|PrefabAsset|SourcePrefab)|m_Modification/.test(field)?'prefab':'reference';let to=null,status;
    if(fileID==='0')status='null';else if(guid==='00000000000000000000000000000000'||guid==='0000000000000000e000000000000000'||guid==='0000000000000000f000000000000000')status='builtin';else {const targetGuid=guid??node.guid,targetAsset=targetGuid?findAssetGuid(targetGuid):findAssetId(node.assetId);const objectId=targetGuid?`object:${targetGuid}:${fileID}`:`object:opaque:${targetAsset?.path}:${fileID}`;if(hasNode(objectId)){to=objectId;status='resolved';}else if(targetAsset?.kind==='script'&&fileID==='11500000'){to=targetAsset.id;status='resolved';}else if(targetAsset&&['opaque','texture','mesh','assembly'].includes(targetAsset.kind)){to=targetAsset.id;status='opaque';}else status='missing';}
    yield {from:node.id,to,kind,field,guid,fileID,status};return;
   }
   for(const [key,child] of Object.entries(value))yield* refs(child,Array.isArray(value)?`${field}[${key}]`:field?`${field}.${key}`:key,depth+1);
  }yield* refs(node.fields);}
export async function indexUnityProject(projectDir,{binding={},inventoryLimits:requestedLimits,graphLimitBytes}={}){
 const maxGraphBytes=graphBudget(graphLimitBytes),limits=inventoryLimits(requestedLimits),root=await locateUnityProject(projectDir),files=await inventory(root,limits,maxGraphBytes),assets=[],nodes=[],edges=[],limitations=['Compilation, bindings and gameplay behavior are unverified.'];
 const scale=maxGraphBytes/MAX_GRAPH,profile={kind:'retoolkit-graph-profile',schemaVersion:1,limits:{maxGraphBytes,maxFiles:limits.maxFiles,maxNodes:MAX_NODES*scale,maxEdges:MAX_EDGES*scale},projectionPolicy:'unity-bulk-payloads-v1'};
 let metadataBytes=Buffer.byteLength(JSON.stringify(files)),summarizedFields=0,summarizedNodes=0,summarizedSerializedBytes=0;
 const diagnostic=(lastRecordKind,bytes=metadataBytes)=>({metadataBytes:bytes,files:files.length,assets:assets.length,nodes:nodes.length,edges:edges.length,lastRecordKind,maxGraphBytes,maxNodes:profile.limits.maxNodes,maxEdges:profile.limits.maxEdges});
 function account(record,lastRecordKind){metadataBytes+=Buffer.byteLength(JSON.stringify(record))+1;if(metadataBytes>maxGraphBytes)metadataLimit(diagnostic(lastRecordKind));}
 function limitation(message){limitations.push(message);account(message,'limitation');}
 account({binding,profile,limitations},'profile');
 const sourceMetadata=await readUnitySourceMetadata(root,files),{metas}=sourceMetadata;
 for(const file of files.filter(f=>f.path.startsWith('Assets/')&&!f.path.endsWith('.meta'))){const guid=metas.get(file.path)??null,asset={id:guid?`asset:${guid}`:`opaque:${file.path}`,guid,path:file.path,kind:kindFor(file.path)};assets.push(asset);if(!guid)limitation(`Missing metadata: ${file.path}`);
  if(asset.kind==='script'){
   asset.script=await describeUnitySourceScript(root,file,sourceMetadata);
   if(!asset.script.supported)limitation(`Unsupported script declarations: ${file.path}`);account(asset,'asset');continue;
  }
  if(!['scene','prefab','asset','material','animationController','animationClip'].includes(asset.kind)){account(asset,'asset');continue;}
  const records=await readUnitySerializedRecords(root,file);if(records===null){asset.kind='opaque';limitation(`Opaque serialized asset: ${file.path}`);account(asset,'asset');continue;}
  const seen=new Set();for await(const parsed of records){if(seen.has(parsed.fileID))fail('duplicate_document_id',file.path);seen.add(parsed.fileID);const node=makeUnityGraphNode(file,asset,parsed);if(parsed.summaries.length){summarizedFields+=parsed.summaries.length;summarizedNodes++;summarizedSerializedBytes+=parsed.summaries.reduce((n,s)=>n+s.serializedBytes,0);}nodes.push(node);if(nodes.length>profile.limits.maxNodes)structuralLimit('node_count_limit',diagnostic('node'));account(node,'node');}account(asset,'asset');
 }
 const nodeById=new Map(nodes.map(n=>[n.id,n])),assetByGuid=new Map(assets.filter(a=>a.guid).map(a=>[a.guid,a]));
 for(const node of nodes)for(const edge of unityReferenceEdges(node,{findAssetGuid:guid=>assetByGuid.get(guid),findAssetId:id=>assets.find(a=>a.id===id),hasNode:id=>nodeById.has(id)})){edges.push(edge);if(edges.length>profile.limits.maxEdges)structuralLimit('edge_count_limit',diagnostic('edge'));account(edge,'edge');}

 const unityVersion=await readUnityProjectVersion(root,files);
 if(summarizedFields)limitation(`${summarizedFields} allowlisted Unity bulk payload fields summarized as read-only opaque tokens; original bytes remain in inventoried source files. Component fields and all structural object references remain unprojected.`);
 const coverage={assets:assets.length,nodes:nodes.length,edges:edges.length,opaqueAssets:assets.filter(a=>a.kind==='opaque').length,missingReferences:edges.filter(e=>e.status==='missing').length,unsupportedScripts:assets.filter(a=>a.script&&!a.script.supported).length,summarizedFields,summarizedNodes,summarizedSerializedBytes};
 const graph={kind:'retoolkit-asset-graph',schemaVersion:1,binding,revision:hash(JSON.stringify({binding,files})),unityVersion,profile,files,assets,nodes,edges,coverage,limitations};const actualBytes=Buffer.byteLength(JSON.stringify(graph));if(actualBytes>maxGraphBytes)metadataLimit(diagnostic('graph',actualBytes));return graph;
}
export async function verifyGraphFiles(projectDir,graph){try{const maxGraphBytes=graphBudget(graph.profile?.limits?.maxGraphBytes),root=await locateUnityProject(projectDir),current=await inventory(root,undefined,maxGraphBytes);if(JSON.stringify(current)!==JSON.stringify(graph.files))fail('stale_graph','Source inventory changed');return true;}catch(error){if(error.code==='stale_graph')throw error;fail('stale_graph',error.message);}}

export function queryGraph(graph,method,params={}){
 if(!params||typeof params!=='object'||Array.isArray(params))fail('invalid_query');const limit=params.limit??100;if(!Number.isInteger(limit)||limit<1||limit>1000)fail('invalid_limit');
 const allowed=new Set(['id','assetId','kind','name','path','search','direction','depth','limit','cursor']);for(const key of Object.keys(params))if(!allowed.has(key))fail('invalid_query_parameter',key);
 for(const key of ['id','assetId','kind','name','path','search','direction','cursor'])if(params[key]!==undefined&&(typeof params[key]!=='string'||params[key].length>4096))fail('invalid_query_parameter',key);
 const signature=hash(JSON.stringify({method,...Object.fromEntries(Object.entries(params).filter(([k])=>!['cursor','limit'].includes(k)).sort(([a],[b])=>a.localeCompare(b)))}));let offset=0;
 if(params.cursor){try{const cursor=JSON.parse(Buffer.from(params.cursor,'base64url').toString('utf8'));if(cursor.revision!==graph.revision||cursor.signature!==signature||!Number.isSafeInteger(cursor.offset)||cursor.offset<0)throw Error();offset=cursor.offset;}catch{fail('invalid_cursor');}}
 const base={revision:graph.revision,coverage:graph.coverage};const byId=new Map([...graph.assets,...graph.nodes].map(n=>[n.id,n]));
 if(method==='assets.get'){if(!params.id)fail('missing_selector');const item=byId.get(params.id);if(!item)fail('asset_not_found');return {...base,item};}
 let items;
 if(method==='assets.list'){items=graph.assets.filter(a=>(!params.kind||a.kind===params.kind)&&(!params.name||a.path.toLowerCase().includes(params.name.toLowerCase()))&&(!params.path||a.path.startsWith(params.path))&&(!params.search||`${a.path} ${a.kind}`.toLowerCase().includes(params.search.toLowerCase())));}
 else if(method==='assets.refs'){if(!params.id||!byId.has(params.id))fail('asset_not_found');const direction=params.direction??'both';if(!['incoming','outgoing','both'].includes(direction))fail('invalid_direction');const ids=new Set([params.id,...graph.nodes.filter(n=>n.assetId===params.id).map(n=>n.id)]);items=graph.edges.filter(e=>(direction!=='incoming'&&ids.has(e.from))||(direction!=='outgoing'&&ids.has(e.to)));}
 else if(method==='assets.tree'){
  const selector=params.id??params.assetId;if(!selector||!byId.has(selector))fail('asset_not_found');
  const depth=params.depth??32;if(!Number.isInteger(depth)||depth<0||depth>100)fail('invalid_depth');
  const selected=byId.get(selector),seen=new Set(),children=new Map(),owners=new Map(),childObjects=new Set();
  function add(parent,child){if(parent&&child&&parent!==child){if(!children.has(parent))children.set(parent,new Set());children.get(parent).add(child);}}
  for(const edge of graph.edges)if(edge.field==='m_GameObject'&&edge.to&&edge.status==='resolved')owners.set(edge.from,edge.to);
  for(const edge of graph.edges){
   if(edge.kind==='component')add(edge.from,edge.to);
   if(edge.kind==='parent'&&edge.to){
    add(edge.to,edge.from);
    const parentObject=owners.get(edge.to),childObject=owners.get(edge.from);
    if(parentObject&&childObject&&parentObject!==childObject){add(parentObject,childObject);if(byId.get(parentObject)?.assetId===byId.get(childObject)?.assetId)childObjects.add(childObject);}
   }
  }
  // Unity's hierarchy links Transforms. Traverse their GameObject ownership as
  // well, so the child's other components remain reachable from its parent.
  for(const [component,owner] of owners)if(['Transform','RectTransform'].includes(byId.get(component)?.type))add(component,owner);
  let roots;
  if(graph.nodes.some(n=>n.id===selector))roots=[selector];
  else{
   const assetNodes=graph.nodes.filter(n=>n.assetId===selected.id);
   roots=assetNodes.filter(n=>!owners.has(n.id)&&!childObjects.has(n.id)).map(n=>n.id);
   // A malformed cycle may have no semantic root. Include each disconnected
   // component once without mistaking depth-limited descendants for new roots.
   const reachable=new Set();
   function mark(root){const pending=[root];while(pending.length){const id=pending.pop();if(reachable.has(id))continue;reachable.add(id);for(const child of children.get(id)??[])if(!reachable.has(child))pending.push(child);}}
   for(const root of roots)mark(root);
   for(const node of assetNodes)if(!reachable.has(node.id)){roots.push(node.id);mark(node.id);}
  }
  const queue=roots.map(id=>[id,0]);items=[];
  for(let i=0;i<queue.length;i++){const [id,level]=queue[i];if(seen.has(id))continue;seen.add(id);const node=byId.get(id);if(node)items.push({...node,depth:level});if(level<depth)for(const child of children.get(id)??[])if(!seen.has(child))queue.push([child,level+1]);}
 }
 else fail('unsupported_graph_query',method);
 const next=offset+limit;return {...base,items:items.slice(offset,next),nextCursor:next<items.length?Buffer.from(JSON.stringify({revision:graph.revision,signature,offset:next})).toString('base64url'):null};
}
