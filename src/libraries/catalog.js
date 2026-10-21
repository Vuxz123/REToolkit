import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {extractChecked,hashFile,mkdirSafe,privateArchive} from '../toolchain/archive-io.js';
import {assertNoLinks,createPathAccountant,MAX_METADATA_BYTES,MAX_PACKAGE_BYTES,safeRelative,snapshotTree,within} from '../toolchain/manifest.js';
import {exactLibraryVersion as exactVersion,validatedDescriptors} from './descriptors.js';
import {parseCSharp} from '../assets/csharp.js';
import {parseDocument} from 'yaml';

const MAX_ARCHIVES=256,MAX_EXTRACTION=16*1024**3,MAX_TEXT=4*1024**2;
const error=(code,message)=>Object.assign(Error(message),{code});
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const packageId=value=>typeof value==='string'&&value.length<=214&&/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(value);
const below=(root,file)=>root===''||file===root||file.startsWith(root+'/');
const unique=values=>[...new Set(values)].sort();
const dirname=file=>path.posix.dirname(file)==='.'?'':path.posix.dirname(file);
const LIMITS=['Cataloging reads metadata only; package code, DLLs and setup instructions were not executed. Content hashes do not authenticate publishers or prove Unity compatibility.'];
function nativePayloadPath(file,directory){
  const parts=file.split('/');
  const index=parts.findIndex(part=>/\.(?:bundle|framework|xcframework)$/i.test(part));
  if(index>=0)return parts.slice(0,index+1).join('/');
  return !directory&&/\.(?:so(?:\.\d+)*|dylib|a|aar|jar|lib)$/i.test(parts.at(-1))?file:null;
}
function assemblySettings(value){
  const settings={};
  const string=item=>typeof item==='string'&&item.length<=512&&!/[\x00-\x1f]/.test(item);
  for(const key of ['references','includePlatforms','excludePlatforms','defineConstraints'])if(value?.[key]!==undefined){
    if(!Array.isArray(value[key])||value[key].length>256||!value[key].every(string))return null;
    settings[key]=value[key];
  }
  if(value?.versionDefines!==undefined){
    if(!Array.isArray(value.versionDefines)||value.versionDefines.length>256||!value.versionDefines.every(item=>item&&typeof item==='object'&&!Array.isArray(item)&&Object.keys(item).length===3&&['name','expression','define'].every(key=>Object.hasOwn(item,key)&&string(item[key]))))return null;
    settings.versionDefines=value.versionDefines.map(item=>({name:item.name,expression:item.expression,define:item.define}));
  }
  return settings;
}

async function listArchives(roots,account){
  const archives=[],seen=new Set();let entries=0;
  async function walk(folder,depth=0){
    if(depth>64)throw error('LIBRARY_SCAN_LIMIT','Library root directory depth exceeds 64.');
    await assertNoLinks(folder);
    const directory=await fs.opendir(folder);
    for await(const entry of directory){
      if(++entries>100000)throw error('LIBRARY_SCAN_LIMIT','Library root entry count exceeds 100000.');
      const file=path.join(folder,entry.name);account.claim(file,128);
      await assertNoLinks(file);const stat=await fs.lstat(file);
      if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory()))throw error('LIBRARY_PATH_UNSAFE','Library roots contain an unsupported file type or link.');
      const identity=file.toLowerCase();if(seen.has(identity))throw error('LIBRARY_PATH_UNSAFE','Library root has case-colliding paths.');seen.add(identity);
      if(stat.isDirectory())await walk(file,depth+1);
      else if(path.extname(file).toLowerCase()==='.zip'){
        if(archives.length>=MAX_ARCHIVES)throw error('LIBRARY_SCAN_LIMIT','Library archive count exceeds 256.');
        if(stat.size>MAX_PACKAGE_BYTES)throw error('LIBRARY_SCAN_LIMIT','Individual library ZIP exceeds 8 GiB.');
        archives.push(file);
      }
    }
  }
  for(const root of roots)await walk(root);
  return archives.sort();
}

async function inspectArchive(archive,files,extracted,descriptors,account,nativeEntries){
  const texts=new Map(),parseProblems=[];
  async function text(file){
    if(texts.has(file.path))return texts.get(file.path);
    if(file.size>MAX_TEXT){parseProblems.push(`Metadata text exceeds 4 MiB and was not parsed: ${file.path}`);return null;}
    account.claim('',file.size);
    const bytes=await fs.readFile(path.join(extracted,...file.path.split('/')));
    if(bytes.length!==file.size||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw error('LIBRARY_CACHE_CHANGED','Private library cache changed during inspection.');
    const result=bytes.toString('utf8').replace(/^\uFEFF/,'');texts.set(file.path,result);return result;
  }
  async function json(file){const value=await text(file);if(value===null)return null;try{const parsed=JSON.parse(value);return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;}catch{parseProblems.push(`Malformed JSON metadata: ${file.path}`);return null;}}
  const roots=[];
  for(const file of files){
    if(path.posix.basename(file.path).toLowerCase()==='package.json'){
      const metadata=await json(file);if(metadata&&packageId(metadata.name))roots.push({root:dirname(file.path),format:'upm',metadata,file:file.path});
    }
  }
  // Assets is an actual path segment. A name such as MyAssets never qualifies.
  const assetRoots=new Set();
  for(const file of files){const parts=file.path.split('/');const at=parts.findIndex(part=>part.toLowerCase()==='assets');if(at>=0)assetRoots.add(parts.slice(0,at+1).join('/'));}
  for(const root of assetRoots){
    const existing=roots.find(item=>item.root===root);
    if(existing)existing.format='assets';else roots.push({root,format:'assets',metadata:null,file:null});
  }
  if(!roots.length)roots.push({root:'',format:files.some(file=>file.path.toLowerCase().endsWith('.unitypackage'))?'unitypackage':'unsupported',metadata:null,file:null});
  const packages=[];
  for(const entry of roots.sort((a,b)=>a.root.localeCompare(b.root,'en'))){
    const payloadFiles=files.filter(file=>below(entry.root,file.path));
    const metadata=entry.metadata;const evidence=[];const limitations=[...parseProblems];
    const assemblies=[],namespaces=[],types=[],guidInventory=[];
    let version=exactVersion(metadata?.version)?metadata.version:null;
    let id=metadata?.name??null,recognition=id?'candidate':'unknown';
    const dependencies={};
    if(metadata){
      evidence.push({kind:'package-manifest',path:entry.file,value:{name:metadata.name,version:typeof metadata.version==='string'?metadata.version:null}});
      if(version)recognition='confirmed';else limitations.push('Package release version is missing or is not an exact supported version.');
      if(metadata.dependencies&&typeof metadata.dependencies==='object'&&!Array.isArray(metadata.dependencies)){
        for(const [name,value] of Object.entries(metadata.dependencies)){
          if(packageId(name)&&typeof value==='string'&&value.length<=512)Object.defineProperty(dependencies,name,{value,enumerable:true,writable:true,configurable:true});
          else{recognition='conflict';limitations.push('Invalid package dependency metadata.');}
        }
      }else if(metadata.dependencies!==undefined){recognition='conflict';limitations.push('Invalid package dependency metadata.');}
      if(path.posix.basename(entry.file)!=='package.json'){recognition='conflict';limitations.push('UPM requires canonical package.json filename case.');}
    }
    for(const file of payloadFiles){
      const lower=file.path.toLowerCase();
      if(lower.endsWith('.asmdef')){
        const value=await json(file);
        if(value&&typeof value.name==='string'&&/^[A-Za-z_][A-Za-z0-9_.-]{0,511}$/.test(value.name)){assemblies.push(value.name);evidence.push({kind:'assembly-definition',path:file.path,value:value.name});}
        else{
          evidence.push({kind:'unsupported-assembly-definition',path:file.path,value:'Missing or invalid assembly name metadata.'});
          limitations.push(`Assembly definition identity is unproven: ${file.path}`);
        }
        const settings=assemblySettings(value);
        if(settings===null){
          evidence.push({kind:'unsupported-assembly-definition',path:file.path,value:'Assembly settings are malformed or exceed static metadata limits.'});
          limitations.push(`Assembly settings are unverified: ${file.path}; malformed or oversized metadata.`);
        }else if(Object.keys(settings).length){
          evidence.push({kind:'assembly-settings',path:file.path,value:settings});
          limitations.push(`Assembly settings are unverified: ${file.path}; references, defines and platform filters require Unity validation.`);
        }
      }else if(lower.endsWith('.cs')){
        const value=await text(file);if(value===null){
          evidence.push({kind:'unsupported-source-declarations',path:file.path,value:'Opaque source exceeds the static text inspection limit.'});
          limitations.push(`Opaque source declarations are unproven: ${file.path}; static text inspection limit exceeded.`);
          continue;
        }
        // Conservative lexical hints. These do not establish a release identity.
        const clean=value.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/\/\/[^\r\n]*/g,' ').replace(/@?"(?:""|\\.|[^"\\])*"/g,'""');
        const ns=[...clean.matchAll(/\bnamespace\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/g)].map(match=>match[1]);
        namespaces.push(...ns);
        const parsed=parseCSharp(value,{fileName:file.path});
        if(parsed.supported)types.push(...parsed.types.map(type=>type.fullName));
        else{
          evidence.push({kind:'unsupported-source-declarations',path:file.path,value:parsed.reason});
          limitations.push(`Unsupported C# declarations require compiler validation: ${file.path}: ${parsed.reason}`);
        }
      }else if(lower.endsWith('.meta')){
        const value=await text(file);let guid;
        try{
          if(value===null)throw Error('Opaque metadata exceeds static text inspection limit.');
          // Failsafe scalars preserve all-digit GUIDs exactly. No aliases are
          // expanded, and malformed/duplicate YAML fields cannot prove identity.
          const document=parseDocument(value,{schema:'failsafe',uniqueKeys:true,strict:true});
          if(document.errors.length)throw Error('Malformed or duplicate YAML metadata fields.');
          const metadata=document.toJS({maxAliasCount:0});guid=metadata?.guid;
          if(typeof guid!=='string'||!/^[0-9a-fA-F]{32}$/.test(guid))throw Error('Missing or malformed GUID metadata.');
          guidInventory.push({path:file.path.slice(0,-5),guid:guid.toLowerCase()});
        }catch(problem){
          recognition='conflict';
          evidence.push({kind:'unsupported-guid-inventory',path:file.path,value:problem.message});
          limitations.push(`GUID inventory is unproven: ${file.path}: ${problem.message}`);
        }
        if(value===null)continue;
        if(/^\s*PluginImporter\s*:/m.test(value)){
          evidence.push({kind:'unsupported-native-plugin',path:file.path,value:'PluginImporter settings are unverified; native status, platform and ABI are unproven.'});
          limitations.push(`Native/plugin importer settings are unverified: ${file.path}; platform and ABI metadata were not validated.`);
        }
      }else if(lower.endsWith('.dll')||lower.endsWith('.winmd')){
        evidence.push({kind:'unsupported-managed-metadata',path:file.path,value:'Static DLL/WinMD assembly/type metadata is not inspected.'});
        limitations.push(`DLL/WinMD assembly/type identity is unproven: ${file.path}; no assembly was loaded or executed.`);
      }
    }
    for(const nativePath of nativeEntries)if(below(entry.root,nativePath)){
      evidence.push({kind:'unsupported-native-plugin',path:nativePath,value:'Native payload platform, ABI and importer settings are unverified.'});
      limitations.push(`Native plugin identity and compatibility are unproven: ${nativePath}; static platform/ABI analysis is unsupported.`);
    }
    if(entry.format==='assets'){
      const declarations=payloadFiles.filter(file=>path.posix.basename(file.path).toLowerCase()==='.retk-library.json');
      if(declarations.length>1){recognition='conflict';limitations.push('Multiple Assets library metadata records are ambiguous.');}
      else if(declarations.length===1){
        const declaration=declarations[0],value=await json(declaration);
        if(!value||Object.keys(value).some(key=>!['kind','schemaVersion','id','version','dependencies'].includes(key))||value.kind!=='retoolkit-library-metadata'||value.schemaVersion!==1||typeof value.id!=='string'||!/^[a-z0-9][a-z0-9._-]{0,213}$/.test(value.id)||!exactVersion(value.version)){
          recognition='conflict';limitations.push('Invalid Assets library metadata schema or exact release version.');
        }else{
          evidence.push({kind:'assets-library-metadata',path:declaration.path,value:{id:value.id,version:value.version}});
          if((id&&id!==value.id)||(version&&version!==value.version)){recognition='conflict';limitations.push('Assets library metadata conflicts with package identity.');}
          else{
            id=value.id;version=value.version;
            if(assemblies.length&&recognition!=='conflict')recognition='confirmed';
            else if(recognition!=='conflict'){recognition='candidate';limitations.push('Assets release metadata requires an actual assembly definition identity.');}
            if(value.dependencies!==undefined){
              if(!value.dependencies||typeof value.dependencies!=='object'||Array.isArray(value.dependencies)){recognition='conflict';limitations.push('Invalid Assets dependency metadata.');}
              else for(const [name,required] of Object.entries(value.dependencies)){
                if(!/^[a-z0-9][a-z0-9._-]{0,213}$/.test(name)||typeof required!=='string'||required.length>512||(dependencies[name]!==undefined&&dependencies[name]!==required)){recognition='conflict';limitations.push('Invalid or conflicting Assets dependency metadata.');}
                else Object.defineProperty(dependencies,name,{value:required,enumerable:true,writable:true,configurable:true});
              }
            }
          }
        }
      }
    }
    const identity={packageId:metadata?.name??null,assemblies:unique(assemblies),namespaces:unique(namespaces),types:unique(types)};
    const matches=descriptors.filter(d=>(d.packageIds??[]).includes(identity.packageId)||(d.assemblies??[]).some(x=>identity.assemblies.includes(x))||(d.namespaces??[]).some(x=>identity.namespaces.some(ns=>ns===x||ns.startsWith(x+'.'))));
    if(!id&&matches.length===1){id=matches[0].id;if(recognition!=='conflict')recognition='candidate';evidence.push({kind:'descriptor-hint',path:entry.root,value:id});}
    if(!id&&matches.length>1){recognition='conflict';limitations.push('Multiple descriptors match static namespace or assembly hints.');}
    const pins=descriptors.flatMap(d=>(d.pins??[]).filter(pin=>pin.archiveSha256===archive.sha256&&pin.root===entry.root).map(pin=>({descriptor:d,pin})));
    if(pins.length){
      const pinIdentities=new Set(pins.map(({descriptor,pin})=>`${descriptor.id}:${pin.version}:${pin.packageId??''}`));
      if(pinIdentities.size!==1){recognition='conflict';limitations.push('Conflicting exact content descriptor pins.');}
      else{
        const {descriptor,pin}=pins[0];
        if((version&&version!==pin.version)||(pin.packageId&&identity.packageId&&pin.packageId!==identity.packageId)){
          recognition='conflict';limitations.push('Descriptor pin conflicts with package metadata.');
        }else if(entry.format==='assets'||entry.format==='upm'){
          version=pin.version;id=identity.packageId??descriptor.id;if(pin.packageId)identity.packageId=pin.packageId;
          if(recognition!=='conflict')recognition='confirmed';
          evidence.push({kind:'exact-content-pin',path:entry.root,value:{descriptorId:descriptor.id,archiveSha256:pin.archiveSha256,version:pin.version}});
        }
      }
    }
    if(entry.format==='assets'&&!version)limitations.push('Assets layout does not prove a library release version; exact content pin or package metadata required.');
    if(entry.format==='unsupported')limitations.push('Unsupported payload. Managed DLL metadata is not inspected; DLL filenames and assembly versions do not prove a library release.');
    if(entry.format==='unitypackage')limitations.push('Unitypackage inner tar/GUID/path analysis is unsupported; nested archives are not inspected.');
    if(payloadFiles.some(file=>file.path.toLowerCase().endsWith('.zip')))limitations.push('Nested ZIP payloads are not recursively inspected.');
    const guidSeen=new Set();for(const item of guidInventory){if(guidSeen.has(item.guid)){recognition='conflict';limitations.push(`Duplicate GUID inside payload: ${item.guid}`);}guidSeen.add(item.guid);}
    if(entry.format==='unsupported'||entry.format==='unitypackage'){if(recognition==='confirmed')recognition='candidate';}
    const result={id:fingerprint({archiveSha256:archive.sha256,root:entry.root,payloadFiles}),libraryId:id??`unknown:${archive.sha256.slice(0,16)}`,version,format:entry.format,recognition,archiveSha256:archive.sha256,archivePath:archive.path,root:entry.root,payloadFiles,identity,dependencies,compatibility:{unity:typeof metadata?.unity==='string'&&metadata.unity.length<=128?metadata.unity:null,platforms:[]},evidence,limitations:unique(limitations),guidInventory};
    account.claim(JSON.stringify(result));packages.push(result);
  }
  for(let i=0;i<packages.length;i++)for(let j=i+1;j<packages.length;j++)if(below(packages[i].root,packages[j].root)||below(packages[j].root,packages[i].root)){
    for(const p of [packages[i],packages[j]]){p.recognition='conflict';p.limitations=unique([...p.limitations,'Overlapping package roots are ambiguous and cannot be imported.']);}
  }
  return packages;
}

export async function scanLibraries({roots=[],cacheDir,descriptors=[]}={}){
  if(!Array.isArray(roots)||roots.length>256||!roots.every(root=>typeof root==='string'&&root.length&&path.isAbsolute(root)))throw error('LIBRARY_ROOT_INVALID','Library roots must be a bounded array of absolute directory paths.');
  const knowledge=validatedDescriptors(descriptors);
  for(const d of knowledge)for(const pin of d.pins??[])if(!safeRelative(pin.root,{empty:true}))throw error('LIBRARY_DESCRIPTOR_INVALID','Unsafe descriptor package root.');
  const normalized=unique(roots.map(root=>path.resolve(root)));
  for(let i=0;i<normalized.length;i++){
    await assertNoLinks(normalized[i]);const stat=await fs.lstat(normalized[i]);if(!stat.isDirectory())throw error('LIBRARY_ROOT_INVALID','Library root must be a directory.');
    for(let j=0;j<i;j++)if(within(normalized[i],normalized[j])||within(normalized[j],normalized[i]))throw error('LIBRARY_ROOT_INVALID','Library roots overlap or collide.');
  }
  const catalog={kind:'retoolkit-library-catalog',schemaVersion:1,state:normalized.length?'indexed':'unconfigured',roots:normalized,archives:[],packages:[],limitations:[...LIMITS]};
  if(!normalized.length)return {...catalog,revision:fingerprint(catalog)};
  if(typeof cacheDir!=='string'||!path.isAbsolute(cacheDir)||path.basename(cacheDir).toLowerCase()!=='libraries'||path.basename(path.dirname(cacheDir)).toLowerCase()!=='.cache')throw error('LIBRARY_CACHE_INVALID','Library cache must be a toolkit controlled .cache/libraries directory.');
  cacheDir=path.resolve(cacheDir);await assertNoLinks(cacheDir);
  for(const root of normalized)if(within(root,cacheDir)||within(cacheDir,root))throw error('LIBRARY_CACHE_INVALID','Library source and cache directories must not overlap.');
  const account=createPathAccountant(MAX_METADATA_BYTES);account.claim(JSON.stringify(knowledge));
  const archivePaths=await listArchives(normalized,account);let totalExtraction=0;
  await mkdirSafe(cacheDir);
  for(const source of archivePaths){
    const original=await hashFile(source);if(original.size>MAX_PACKAGE_BYTES)throw error('LIBRARY_SCAN_LIMIT','Individual library ZIP exceeds 8 GiB.');
    const archive={path:source,...original};account.claim(JSON.stringify(archive));
    // Unique private generations are never read back as trusted catalog metadata.
    // Remove the transaction tree after inspection; callers re-extract and verify.
    const generation=await fs.mkdtemp(path.join(cacheDir,`${original.sha256}-`));
    try{
      const snapshot=path.join(generation,'snapshot.zip'),extracted=path.join(generation,'payload');
      const nativeEntries=new Set();
      await privateArchive(source,snapshot,original);
      await extractChecked(snapshot,extracted,{budget:{entries:0,total:0,pathBudget:account},validateEntry:({path:relative,size,directory})=>{
        totalExtraction+=size;if(totalExtraction>MAX_EXTRACTION)throw error('LIBRARY_SCAN_LIMIT','Total library extraction exceeds 16 GiB.');
        const nativePath=nativePayloadPath(relative,directory);if(nativePath&&!nativeEntries.has(nativePath)){account.claim(nativePath,64);nativeEntries.add(nativePath);}
      }});
      const after=await hashFile(source);if(after.sha256!==original.sha256||after.size!==original.size)throw error('LIBRARY_SOURCE_CHANGED','Library ZIP changed during cataloging.');
      const files=await snapshotTree(extracted,{maxMetadataBytes:MAX_METADATA_BYTES-account.bytes});
      account.claim(JSON.stringify(files));
      catalog.archives.push(archive);catalog.packages.push(...await inspectArchive(archive,files,extracted,knowledge,account,nativeEntries));
      const final=await hashFile(source);if(final.sha256!==original.sha256||final.size!==original.size)throw error('LIBRARY_SOURCE_CHANGED','Library ZIP changed during metadata inspection.');
    }finally{
      if(!within(cacheDir,generation)||generation===cacheDir)throw error('LIBRARY_CACHE_INVALID','Private cache cleanup escaped its controlled parent.');
      await assertNoLinks(generation);await fs.rm(generation,{recursive:true,force:true});
    }
  }
  account.claim(JSON.stringify(catalog));
  return {...catalog,revision:fingerprint(catalog)};
}
