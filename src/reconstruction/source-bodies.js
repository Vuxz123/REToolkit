import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertAssetPath} from '../assets/context.js';
import {fingerprint} from '../state.js';
import {scriptBindings} from './bindings.js';
import {readUnitySourceMetadata,describeUnitySourceScript} from '../assets/graph.js';
import {initializationDeclarations,proveInitialization} from './source-initialization.js';

const fail=message=>{throw Object.assign(new Error(message),{code:'reconstruction_invalid'});};
const check=(value,message)=>{if(!value)fail(message);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const afterPath=file=>'__retk_after__/'+file;
const preservedContract=contract=>({kind:contract.kind,schemaVersion:contract.schemaVersion,parser:contract.parser,skeletonSha256:contract.skeletonSha256,types:contract.types});
function eligible(graph,id){
 const matches=graph.assets.filter(a=>a.id===id);check(matches.length===1,'Ambiguous or missing body source identity');const asset=matches[0];
 check(asset.path.startsWith('Assets/')&&asset.path.endsWith('.cs')&&!asset.path.split('/').some(p=>p.toLowerCase()==='editor'),'Body replacement supports existing non-Editor C# sources only');
 check(asset.script?.assembly&&!/editor/i.test(asset.script.assembly),'Body replacement requires an exact non-Editor assembly identity');
 const definition=asset.script.assemblyDefinition;
 check(!definition||['includePlatforms','excludePlatforms','defineConstraints'].every(key=>Array.isArray(definition[key])&&definition[key].length===0),'Constrained assembly requires compiler scope validation');
 check(scriptBindings(graph,asset).unresolvedBindings.length===0,'Unsupported or unresolved component script local fileID binding');return asset;
}
async function readSource(projectDir,file){
 const target=assertAssetPath(path.join(projectDir,file),projectDir),stat=await fs.lstat(target);check(stat.isFile()&&stat.size<=1024**2,'Body source exceeds 1 MiB or is unsupported');
 const bytes=await fs.readFile(target);check(bytes.length<=1024**2,'Body source exceeds 1 MiB');return {bytes,source:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)};
}

/** Re-derived from complete source files, never authorized by a saved hash alone.
 * Unknown assembly scopes cannot silently hide an overlapping type identity.
 * This attests syntax/declaration preservation, not compilation or behavior. */
export async function prepareBodyCandidates({projectDir,graph,changes,editorPath,dump,evidence=[]}){
 const requested=changes.filter(change=>['bodies','initialization'].includes(change.mode));if(!requested.length)return new Map();
 for(const change of requested)if(change.mode==='initialization')initializationDeclarations(change);
 check(requested.every(change=>typeof change.source==='string'&&Buffer.byteLength(change.source)>0&&Buffer.byteLength(change.source)<=1024**2),'Invalid body replacement source size');
 const targets=requested.map(change=>({change,asset:eligible(graph,change.scriptId)})),assemblies=new Set(targets.map(({asset})=>asset.script.assembly));
 // Re-derive compiler membership from the complete file inventory. A forged
 // graph's omitted script row must not hide another declaration of this type.
 const metadataFiles=graph.files.filter(file=>file.path.endsWith('.asmdef')||file.path.endsWith('.asmref')||file.path.endsWith('.cs.meta'));
 const metadata=await readUnitySourceMetadata(projectDir,metadataFiles),sources=[],sourceReads=new Map(),sourceFiles=graph.files.filter(file=>file.path.startsWith('Assets/')&&file.path.endsWith('.cs'));let sourceBytes=0;
 check(sourceFiles.length<=10000,'Body declaration inventory exceeds 10000 files');
 for(const file of sourceFiles){
  const current=await readSource(projectDir,file.path),sha256=hash(current.bytes),replacement=targets.find(target=>target.asset.path===file.path)?.change;
  sourceBytes+=current.bytes.length;check(sourceBytes<=64*1024**2,'Body declaration inventory exceeds 64 MiB');
  // A repeated saved operation reads its already-published body bytes. The
  // receipt verifier below the caller's journal gate still checks every file.
  const published=replacement?.afterSha256===sha256&&replacement?.afterSize===current.bytes.length&&sha256===hash(replacement.source);
  check(sha256===file.sha256&&current.bytes.length===file.size||published,'Source inventory changed during declaration analysis');
  if(replacement?.mode==='initialization'&&replacement.initializationProof){
   const baseline=replacement.initializationProof.originalSource;
   check(typeof baseline==='string'&&Buffer.byteLength(baseline)<=1024**2&&hash(baseline)===file.sha256&&Buffer.byteLength(baseline)===file.size,'Initialization proof original source is not the graph inventory source');
   current.source=baseline;
  }
  const script=await describeUnitySourceScript(projectDir,{...file,sha256,size:current.bytes.length},metadata),source={path:file.path,guid:metadata.metas.get(file.path)??null,script};sourceReads.set(file.path,current);
  if(!script.assembly||assemblies.has(script.assembly))sources.push(source);
 }
 for(const {asset} of targets){const actual=sources.find(source=>source.path===asset.path);check(actual&&actual.guid===asset.guid&&actual.script.assembly===asset.script.assembly,'Body source metadata or assembly declaration identity changed');
  const definition=actual.script.assemblyDefinition;check(!definition||['includePlatforms','excludePlatforms','defineConstraints'].every(key=>definition[key]?.length===0),'Constrained compiler assembly declaration identity changed');}
 check(sources.length<=10000,'Body declaration inventory exceeds 10000 files');
 const documents=[],current=new Map();
 for(const asset of sources){const item=sourceReads.get(asset.path);current.set(asset.path,item);documents.push({path:asset.path,source:item.source});}
 for(const {change,asset} of targets)documents.push({path:afterPath(asset.path),source:change.source,...(change.mode==='initialization'?{omitConstructors:change.constructors.map(({fullName,kind})=>({fullName,kind}))}:{})});
 const {analyzeSourceContracts}=await import('./source-contract.js');
 const analysis=await analyzeSourceContracts({projectDir,documents,editorPath}),results=new Map(analysis.documents.map(doc=>[doc.path,{...doc,parser:analysis.parser}])),candidates=new Map();
 for(const {change,asset} of targets){
  const before=results.get(asset.path),after=results.get(afterPath(asset.path));
  check(before?.supported&&after?.supported,`Unsupported body declaration contract: ${before?.reason??after?.reason??'parser result missing'}`);
  const contract={...preservedContract(before),...(change.mode==='initialization'?{tokenSha256:before.tokenSha256}:{})};
  let initializationProof;
  if(change.mode==='initialization'){
   const saved=change.initializationProof;
   initializationProof=proveInitialization({change,before,after,originalSource:current.get(asset.path).source,assembly:asset.script.assembly,graph,dump,evidence:saved?saved.constructors?.map(c=>c.evidence):evidence});
   if(saved)check(fingerprint(saved)===fingerprint(initializationProof),'Initialization proof metadata, native evidence or syntax contract changed');
  }else check(fingerprint(contract)===fingerprint(preservedContract(after)),'Body replacement changes a declaration, field initializer or accessor contract');
  const types=before.types;check(Array.isArray(types)&&types.length>0&&new Set(types.map(t=>t.fullName)).size===types.length,'Ambiguous or missing compiler declaration identity');
  const names=new Set(types.map(t=>t.name)),fullNames=new Set(types.map(t=>t.fullName));
  for(const other of sources){
   if(other.path===asset.path||other.script.assembly&&other.script.assembly!==asset.script.assembly)continue;
   const observed=results.get(other.path);check(observed,'Incomplete compiler declaration inventory');
   if(observed.identitiesComplete===false)check(!observed.identityUncertain&&Array.isArray(observed.identityNames)&&!observed.identityNames.some(name=>names.has(name)),'Uncertain declaration inventory may hide an ambiguous target type');
   check(!observed.types?.some(t=>fullNames.has(t.fullName)),'Ambiguous exported assembly/full type identity');
  }
  const meta=graph.files.find(file=>file.path===asset.path+'.meta');
  if(!asset.guid){
   const top=types.filter(type=>type.topLevel);
   check(!meta&&top.length>0&&top.every(type=>type.kind==='class'&&type.arity>0),'A source without meta must declare only existing open generic top-level classes');
  }else check(meta,'Body source GUID requires its existing meta identity');
  const bytes=current.get(asset.path).bytes;
  candidates.set(change.scriptId,{asset,beforeSha256:hash(bytes),identity:{assembly:asset.script.assembly,targetKind:asset.guid?'asset-source':'generic-source',contract},...(initializationProof?{initializationProof}:{})});
 }
 return candidates;
}
