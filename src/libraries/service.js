import fs from 'node:fs';
import {isSqliteGraph,verifyStoredGraph} from '../assets/graph-storage.js';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fingerprint,withWorkspaceLock} from '../state.js';
import {assertAssetPath,assetPaths,selectedAssetBinding,assetError,assetProjectPath} from '../assets/context.js';
import {indexUnityProject,locateUnityProject,verifyGraphFiles} from '../assets/graph.js';
import {acquireToolchainRead} from '../toolchain/lease.js';
import {assertNoSession} from '../ghidra/runtime.js';

const fail=(code,message)=>{throw assetError(code,message);};
const defaultConfig=()=>({schemaVersion:1,libraryRoots:[],libraryImportPolicy:'auto-staging-on-unique-match'});
const paths=toolkit=>({base:assertAssetPath(path.join(toolkit.root,'.cache/libraries'),toolkit.root),config:assertAssetPath(path.join(toolkit.root,'.retk-libraries.json'),toolkit.root)});
function read(file,max=128*1024**2){assertAssetPath(file);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>max)fail('library_payload_limit','Library artifact size is invalid');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file)));}
function write(file,value,{exclusive=false}={}){assertAssetPath(file);const bytes=JSON.stringify(value,null,2)+'\n';if(Buffer.byteLength(bytes)>128*1024**2)fail('library_payload_limit','Library artifact exceeds 128 MiB');fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp-'+randomUUID();try{fs.writeFileSync(temp,bytes,{flag:'wx',mode:0o600});if(exclusive)fs.linkSync(temp,file);else fs.renameSync(temp,file);}finally{fs.rmSync(temp,{force:true});}}
export function readLibraryConfig(toolkit){
 const file=paths(toolkit).config;if(!fs.existsSync(file))return defaultConfig();const value=read(file,1024**2);
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['schemaVersion','libraryRoots','libraryImportPolicy'].includes(k))||value.schemaVersion!==1||value.libraryImportPolicy!=='auto-staging-on-unique-match'||!Array.isArray(value.libraryRoots)||value.libraryRoots.length>16||value.libraryRoots.some(p=>typeof p!=='string'||!path.isAbsolute(p)||p.length>32768))fail('library_config_invalid','Invalid library roots configuration');
 for(const root of value.libraryRoots)assertAssetPath(root);return value;
}
export function addLibraryRoot(toolkit,directory){
 const root=assertAssetPath(path.resolve(directory));if(!fs.lstatSync(root).isDirectory())fail('library_root_invalid','Library root must be a directory');
 const gate=paths(toolkit).config+'.lock';try{fs.mkdirSync(gate);}catch(error){if(error.code==='EEXIST')fail('library_config_busy','Another library configuration edit is active');throw error;}
 try{
 const config=readLibraryConfig(toolkit),same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
 if(!config.libraryRoots.some(p=>same(p,root)))config.libraryRoots.push(root);
 if(config.libraryRoots.length>16)fail('library_config_invalid','At most 16 library roots are supported');write(paths(toolkit).config,config);return config;
 }finally{fs.rmdirSync(gate);}
}
export async function readLibraryCatalog(toolkit){
 const p=paths(toolkit),config=readLibraryConfig(toolkit),file=path.join(p.base,'catalog.json');
 if(!fs.existsSync(file)){if(config.libraryRoots.length)fail('library_catalog_missing','Run libraries scan to index configured roots');const {scanLibraries}=await import('./catalog.js');return scanLibraries({roots:[],cacheDir:p.base});}
 const value=read(file),roots=value.roots;
 if(value.kind!=='retoolkit-library-catalog'||value.schemaVersion!==1||!Array.isArray(roots)||roots.length!==config.libraryRoots.length||roots.some(root=>!config.libraryRoots.includes(root)))fail('library_catalog_stale','Library roots changed; run libraries scan');
 const {revision,...payload}=value;if(revision!==createHash('sha256').update(JSON.stringify(payload)).digest('hex'))fail('library_catalog_stale','Catalog metadata changed; run libraries scan');return value;
}
async function verifyCatalogSources(toolkit,index){
 const p=paths(toolkit),config=readLibraryConfig(toolkit),{scanLibraries}=await import('./catalog.js');
 // A cached JSON hash only detects accidental edits. Re-derive identities from
 // source ZIPs before Editor execution so rehashed metadata cannot grant import.
 const fresh=await scanLibraries({roots:config.libraryRoots,cacheDir:p.base});
 if(fresh.revision!==index.revision)fail('library_catalog_stale','Library sources or catalog metadata changed; rescan and create a fresh plan');
}
function paramsShape(params,allowed){if(!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(k=>!allowed.includes(k)))fail('library_params_invalid','Invalid library operation parameters');}
function requirements(value){
 if(value===undefined)return undefined;
 if(!value||value.kind!=='retoolkit-library-requirements'||value.schemaVersion!==1||Object.keys(value).some(k=>!['kind','schemaVersion','packages'].includes(k))||!Array.isArray(value.packages)||value.packages.length>64||value.packages.some(p=>!p||Object.keys(p).some(k=>!['id','version'].includes(k))||typeof p.id!=='string'||p.id.length<1||p.id.length>256||typeof p.version!=='string'||p.version.length<1||p.version.length>128))fail('library_requirements_invalid','Expected bounded library requirements with package IDs and versions');return value.packages;
}
function packageSummary(item){return {id:item.id,libraryId:item.libraryId,version:item.version,format:item.format,recognition:item.recognition,archiveSha256:item.archiveSha256,payloadFileCount:item.payloadFiles?.length??0,guidCount:item.guidInventory?.length??0};}
function compactPackage(item){
 const preview=values=>(values??[]).slice(0,20).map(value=>String(value).slice(0,512));
 return {...packageSummary(item),identity:{packageId:item.identity?.packageId??null,assemblies:preview(item.identity?.assemblies),namespaces:preview(item.identity?.namespaces),types:preview(item.identity?.types)},limitations:preview(item.limitations),evidenceCount:item.evidence?.length??0,hintEvidenceCount:item.hintEvidenceCount??0,hintsTruncated:item.hintsTruncated===true,metadataTruncated:true};
}
function page(items,params,binding){
 const limit=params.limit??100;if(!Number.isSafeInteger(limit)||limit<1||limit>1000||params.query!==undefined&&(typeof params.query!=='string'||params.query.length>2048))fail('library_params_invalid','Invalid library query');
 const signature=fingerprint({binding,query:params.query??''});let offset=0;
 if(params.cursor!==undefined){try{if(typeof params.cursor!=='string'||params.cursor.length>65536)throw Error();const c=JSON.parse(Buffer.from(params.cursor,'base64url').toString());if(c.signature!==signature||!Number.isSafeInteger(c.offset)||c.offset<0)throw Error();offset=c.offset;}catch{fail('library_cursor_invalid','Invalid or stale library cursor');}}
 const rows=params.query?items.filter(item=>JSON.stringify(item).toLowerCase().includes(params.query.toLowerCase())):items;const result=[];let bytes=0;
 for(const item of rows.slice(offset,offset+limit)){const size=Buffer.byteLength(JSON.stringify(JSON.stringify(item)));if(result.length&&bytes+size>1024**2)break;if(size>1024**2)fail('library_output_limit','Library row exceeds response budget');result.push(item);bytes+=size;}
 const next=offset+result.length;return {items:result,nextCursor:next<rows.length?Buffer.from(JSON.stringify({signature,offset:next})).toString('base64url'):null};
}
async function projectFacts(toolkit,name){
 const selected=selectedAssetBinding(toolkit,name),projectDir=await locateUnityProject(assetProjectPath(toolkit,name,selected));
 const configured=selected.project.assetReconstruction,graphLimitBytes=configured?.binding&&fingerprint(configured.binding)===fingerprint(selected.binding)?configured.graphLimitBytes:undefined;
 let sourceGraph;
 if(configured?.graphStorage==='sqlite'){const graphFile=assetPaths(toolkit,name).graphFile;sourceGraph=read(graphFile);if(!isSqliteGraph(sourceGraph)||fingerprint(sourceGraph.binding)!==fingerprint(selected.binding))fail('stale_graph','Saved SQLite graph binding changed');verifyStoredGraph(sourceGraph,graphFile);await verifyGraphFiles(projectDir,sourceGraph);}
 else sourceGraph=await indexUnityProject(projectDir,{binding:selected.binding,graphLimitBytes});
 const {enrichLibraryGraph}=await import('./project-facts.js');const graph=await enrichLibraryGraph(projectDir,sourceGraph);return {...selected,projectDir,graph};
}
const methods=new Set(['libraries.scan','libraries.list','libraries.identify','libraries.plan','libraries.import','libraries.verify']);
export async function runLibraryOperation(toolkit,name,method,params={},dependencies={}){
 if(method.startsWith('libraries.runtime.')){const {runRuntimeProviderOperation}=await import('./runtime-provider.js');return runRuntimeProviderOperation(toolkit,name,method.slice('libraries.runtime.'.length),params,dependencies);}
 if(!methods.has(method))fail('library_method_invalid','Unknown library operation');
 if(method==='libraries.scan'){
  paramsShape(params,[]);const p=paths(toolkit),config=readLibraryConfig(toolkit);fs.mkdirSync(p.base,{recursive:true});
  return withWorkspaceLock(p.base,async()=>{const {scanLibraries}=await import('./catalog.js');const value=await scanLibraries({roots:config.libraryRoots,cacheDir:p.base});write(path.join(p.base,'catalog.json'),value);return {state:value.state,revision:value.revision,archiveCount:value.archives.length,packageCount:value.packages.length,limitations:value.limitations};});
 }
 const index=await readLibraryCatalog(toolkit);
 if(method==='libraries.list'){paramsShape(params,['query','limit','cursor']);return {state:index.state,revision:index.revision,...page(index.packages.map(compactPackage),params,index.revision),limitations:index.limitations};}
 const p=assetPaths(toolkit,name),lease=acquireToolchainRead(toolkit.root);let uncertain=false;
 try{
  assertNoSession(toolkit,name);const {hasAssetSession}=await import('../assets/session.js');if(hasAssetSession(toolkit,name))fail('asset_session_active','Stop AssetRipper before running library workspace operations');
  return await withWorkspaceLock(p.workspace,async()=>{
   try{
    const facts=await projectFacts(toolkit,name),{graph,projectDir}=facts;
    if(method==='libraries.identify'){
     paramsShape(params,['requirements','section','query','limit','cursor']);const section=params.section??'candidates';if(!['candidates','installed','requirements'].includes(section))fail('library_params_invalid','Invalid identification section');
     const {identifyLibraries}=await import('./resolver.js');const identification=identifyLibraries(graph,index,{requirements:requirements(params.requirements)});
     write(path.join(p.base,'libraries-identification.json'),identification);
     const rows=section==='requirements'?identification.requirements.map(({id,version,source})=>({id,version,source})):identification[section].map(compactPackage);
     return {kind:identification.kind,graphRevision:graph.revision,catalogRevision:index.revision,section,counts:{requirements:identification.requirements.length,installed:identification.installed.length,candidates:identification.candidates.length},...page(rows,params,{graph:graph.revision,catalog:index.revision,section}),limitations:identification.limitations.slice(0,10),storedIdentification:path.relative(p.workspace,path.join(p.base,'libraries-identification.json')).split(path.sep).join('/')};
    }
    const directory=assertAssetPath(path.join(p.base,'library-plans'),p.workspace);fs.mkdirSync(directory,{recursive:true});
    if(method==='libraries.plan'){
     paramsShape(params,['requirements']);const {createLibraryPlan}=await import('./resolver.js');const plan=createLibraryPlan({graph,catalog:index,requirements:requirements(params.requirements)});
     // Import re-derives the entire graph and semantic intent from source; the
     // saved audit record need not duplicate hundreds of MiB of scene payloads.
     const graphSnapshot={kind:'retoolkit-library-graph-snapshot',schemaVersion:1,revision:graph.revision,binding:graph.binding,unityVersion:graph.unityVersion,profile:graph.profile,inventorySha256:fingerprint(graph.files),coverage:graph.coverage};write(path.join(directory,plan.operationId+'.json'),{plan,graphSnapshot},{exclusive:true});
     return {...plan,selected:plan.selected.map(packageSummary),requirements:plan.requirements.map(({id,version,source})=>({id,version,source})),issues:plan.issues.slice(0,30).map(issue=>({...issue,message:issue.message.slice(0,2048)})),issueCount:plan.issues.length,storedPlan:path.relative(p.workspace,path.join(directory,plan.operationId+'.json')).split(path.sep).join('/')};
    }
    paramsShape(params,['operationId']);if(typeof params.operationId!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(params.operationId))fail('library_params_invalid','Expected a saved library plan UUID');
    const saved=read(path.join(directory,params.operationId+'.json'));if(saved.plan?.operationId!==params.operationId)fail('library_plan_invalid','Saved library plan identity changed');
    await verifyCatalogSources(toolkit,index);
    const {importLibraryPlan,verifyLibraryImport}=await import('./importer.js');const action=method==='libraries.import'?importLibraryPlan:verifyLibraryImport;
    const result=await action({toolkit,name,projectDir,graph,catalog:index,plan:saved.plan},dependencies);
    await verifyGraphFiles(projectDir,graph);if(fingerprint(selectedAssetBinding(toolkit,name).binding)!==fingerprint(facts.binding))fail('stale_graph','Selected source changed during library operation');return result;
   }catch(error){uncertain=['unity_recovery_required','library_recovery_required'].includes(error.code);throw error;}
  });
 }finally{if(!uncertain)lease.release();}
}
