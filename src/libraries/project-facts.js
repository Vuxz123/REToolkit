import fs from 'node:fs/promises';
import {supportsLibraryFacts} from '../assets/source-facts.js';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertAssetPath,assetError} from '../assets/context.js';
import {safeRelative} from '../toolchain/manifest.js';
import {parseCSharp} from '../assets/csharp.js';
import {parseDocument,isAlias,visit} from 'yaml';

const MAX_FILE_BYTES=1024**2,MAX_METADATA_BYTES=16*1024**2,MAX_MANIFESTS=256;
const packageId=/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/;
const manifestPath=/^Packages\/(?:manifest\.json|packages-lock\.json|(?:[^/]+\/)+package\.json)$/i;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function check(ok,message,code='library_project_metadata_invalid'){if(!ok)throw assetError(code,message);}
function id(value){return typeof value==='string'&&value.length<=214&&packageId.test(value);}
function version(value){return typeof value==='string'&&value.length>0&&value.length<=128&&!/[\x00-\x1f]/.test(value);}

// These facts authorize only declared dependencies. A package name/version in
// JSON never proves that its implementation is installed or matches a catalog.
export async function enrichLibraryGraph(projectDir,graph) {
  check(supportsLibraryFacts(graph)&&Array.isArray(graph.files),'An indexed graph is required');
  const root=assertAssetPath(projectDir),inventory=new Map(graph.files.map(file=>[file.path,file]));
  const manifests=graph.files.filter(file=>manifestPath.test(file.path));
  check(manifests.length<=MAX_MANIFESTS,'Project package manifest count exceeds the metadata limit');
  for(const relative of ['Packages/manifest.json','Packages/packages-lock.json']) {
    const absolute=assertAssetPath(path.join(root,relative),root);
    try {await fs.lstat(absolute);check(inventory.has(relative),'Project manifest path is missing from graph inventory','stale_graph');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const packageManifestRequirements=[],installedPackageMetadata=[],packageMetadataLimitations=[];
  let total=0;
  for(const file of manifests.sort((a,b)=>a.path.localeCompare(b.path))) {
    check(safeRelative(file.path),'Unsafe project package metadata path');
    const absolute=assertAssetPath(path.join(root,...file.path.split('/')),root),stat=await fs.lstat(absolute);
    check(stat.isFile(),'Project package metadata must be a regular file');
    check(stat.size<=MAX_FILE_BYTES&&file.size<=MAX_FILE_BYTES,'Project package metadata exceeds the per-file metadata limit');
    total+=stat.size;check(total<=MAX_METADATA_BYTES,'Project package metadata exceeds the aggregate metadata budget');
    const bytes=await fs.readFile(absolute);assertAssetPath(absolute,root);
    const sha256=createHash('sha256').update(bytes).digest('hex');
    check(bytes.length===file.size&&stat.size===file.size&&sha256===file.sha256,'Project package manifest changed since graph indexing','stale_graph');
    let value;try {value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));}
    catch {throw assetError('library_project_metadata_invalid',`Invalid project package manifest JSON: ${file.path}`);}
    check(plain(value),'Project package manifest must be an object');
    const evidence={kind:'project-package-manifest',path:file.path,size:file.size,sha256};
    const isLock=/^Packages\/packages-lock\.json$/i.test(file.path),isRoot=/^Packages\/manifest\.json$/i.test(file.path);
    const dependencies=value.dependencies??{};check(plain(dependencies),'Project package dependencies must be an object');
    check(Object.keys(dependencies).length<=256,'Project package dependency count exceeds the metadata limit');
    if(!isRoot&&!isLock) {
      check(id(value.name),'Embedded package manifest has an invalid package name');
      check(value.version===undefined||version(value.version),'Embedded package manifest has an invalid version');
      installedPackageMetadata.push({id:value.name,version:value.version??null,source:'embedded-manifest',contentsVerified:false,evidence:[{...evidence,value:{id:value.name,version:value.version??null}}]});
    }
    for(const [dependency,spec]of Object.entries(dependencies).sort(([a],[b])=>a.localeCompare(b))) {
      check(id(dependency),'Project package dependency has an invalid id');
      if(isLock) {
        check(plain(spec)&&version(spec.version)&&typeof spec.source==='string'&&spec.source.length<=64,'Project package lock record is invalid');
        installedPackageMetadata.push({id:dependency,version:spec.version,source:`lock:${spec.source}`,contentsVerified:false,evidence:[{...evidence,value:{id:dependency,version:spec.version,source:spec.source}}]});
      } else {
        check(version(spec),'Project package dependency requires a bounded version string');
        check(packageManifestRequirements.length<256,'Project package requirements exceed the metadata limit');
        packageManifestRequirements.push({id:dependency,version:spec,source:'project-manifest',evidence:[{...evidence,value:{id:dependency,version:spec}}]});
        if(!/^[~^]?\d+\.\d+\.\d+$/.test(spec))packageMetadataLimitations.push(`Unsupported package dependency source or version remains blocked: ${dependency} (${file.path})`);
      }
    }
  }
  packageManifestRequirements.sort((a,b)=>a.id.localeCompare(b.id)||a.version.localeCompare(b.version)||a.evidence[0].path.localeCompare(b.evidence[0].path));
  const libraryDeclarations={types:[],assemblies:[],guids:[],unknownSources:[],unknownAssemblies:[],unknownMetadata:[]},definitions=[];
  let declarationBytes=0;
  function record(collection,value) {
    declarationBytes+=Buffer.byteLength(JSON.stringify(value));check(declarationBytes<=MAX_METADATA_BYTES,'Project package declaration facts exceed the metadata budget');collection.push(value);
  }
  async function sourceText(file) {
    check(safeRelative(file.path),'Unsafe project package source path');
    const absolute=assertAssetPath(path.join(root,...file.path.split('/')),root),stat=await fs.lstat(absolute);
    check(stat.isFile(),'Project package source must be a regular file');
    check(stat.size===file.size,'Project package source changed since indexing','stale_graph');
    if(stat.size>MAX_FILE_BYTES||total+stat.size>MAX_METADATA_BYTES)return null;
    total+=stat.size;
    const bytes=await fs.readFile(absolute);assertAssetPath(absolute,root);
    check(bytes.length===file.size&&createHash('sha256').update(bytes).digest('hex')===file.sha256,'Project package source changed since indexing','stale_graph');
    try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');}catch{return null;}
  }
  const packageFiles=graph.files.filter(file=>/^Packages\//i.test(file.path));
  for(const file of packageFiles.filter(file=>/\.(?:asmdef|asmref|dll|winmd)$/i.test(file.path))) {
    assertAssetPath(path.join(root,...file.path.split('/')),root);
    if(!file.path.toLowerCase().endsWith('.asmdef')){record(libraryDeclarations.unknownAssemblies,{path:file.path,reason:'Uninspected managed assembly or assembly reference'});continue;}
    const text=await sourceText(file);let value;try{value=JSON.parse(text);}catch{value=null;}
    if(!plain(value)||typeof value.name!=='string'||!value.name||value.name.length>256){record(libraryDeclarations.unknownAssemblies,{path:file.path,reason:'Unsupported assembly definition'});continue;}
    record(libraryDeclarations.assemblies,{name:value.name,path:file.path});definitions.push({name:value.name,dir:path.posix.dirname(file.path)});
  }
  definitions.sort((a,b)=>b.dir.length-a.dir.length);
  for(const file of packageFiles.filter(file=>file.path.toLowerCase().endsWith('.cs'))) {
    const text=await sourceText(file);
    if(text===null){record(libraryDeclarations.unknownSources,{path:file.path,reason:'Source exceeds static metadata budgets or is not UTF-8'});continue;}
    const parsed=parseCSharp(text,{fileName:file.path});
    if(!parsed.supported){record(libraryDeclarations.unknownSources,{path:file.path,reason:parsed.reason??parsed.limitations.join(' ')});continue;}
    const assembly=definitions.find(definition=>file.path.startsWith(definition.dir+'/'))?.name??null;
    for(const type of parsed.types)record(libraryDeclarations.types,{fullName:type.fullName,assembly,path:file.path});
  }
  const seenGuids=new Set();
  for(const file of packageFiles.filter(file=>file.path.toLowerCase().endsWith('.meta'))) {
    const text=await sourceText(file);
    try {
      if(text===null)throw Error('Metadata exceeds static inspection budgets or is not UTF-8');
      const document=parseDocument(text,{schema:'failsafe',uniqueKeys:true,strict:true});
      if(document.errors.length||document.warnings.length)throw Error('Malformed or ambiguous YAML metadata');
      let nodes=0;
      visit(document,(_key,node,ancestors)=>{
        if(++nodes>50000||ancestors.length>64)throw Error('Metadata YAML exceeds structural limits');
        if(isAlias(node)||node?.anchor)throw Error('Metadata aliases and anchors are unsupported');
      });
      const metadata=document.toJS({maxAliasCount:0}),guid=metadata?.guid;
      if(!plain(metadata)||typeof guid!=='string'||!/^[a-f0-9]{32}$/i.test(guid))throw Error('Missing or malformed GUID metadata');
      const normalized=guid.toLowerCase();
      if(seenGuids.has(normalized))throw Error('Duplicate GUID in existing package metadata');
      seenGuids.add(normalized);record(libraryDeclarations.guids,{guid:normalized,path:file.path.slice(0,-5)});
    }catch(error){record(libraryDeclarations.unknownMetadata,{path:file.path,reason:error.message});}
  }
  return {...graph,packageManifestRequirements,installedPackageMetadata,packageMetadataLimitations,libraryDeclarations};
}
