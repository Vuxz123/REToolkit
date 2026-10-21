import fs from 'node:fs';
import {isSqliteGraph} from '../assets/graph-storage.js';
import {createUnitySourceFacts} from '../assets/source-facts.js';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileIdentity,fingerprint,ownsWorkspaceLock} from '../state.js';
import {assertAssetPath,assetPaths,assetError,selectedAssetBinding} from '../assets/context.js';
import {indexUnityProject,verifyGraphFiles} from '../assets/graph.js';
import {extractChecked,privateArchive} from '../toolchain/archive-io.js';
import {safeRelative} from '../toolchain/manifest.js';
import {assertPortablePackages,resolveUnityEditor,validateUnityProject} from '../unity/validation.js';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/,MiB=1024**2;
const check=(ok,message,code='library_import_invalid')=>{if(!ok)throw assetError(code,message);};
const helperRoot='Assets/REToolkitLibraryImport';
const limitations=['Imported only into a disposable staging project.','Package resolution does not establish compilation, bindings or UI correctness.','Unitypackage inner archives are unsupported.'];
function writeJson(file,value){assertAssetPath(file);const bytes=JSON.stringify(value,null,2)+'\n';check(Buffer.byteLength(bytes)<=128*MiB,'Import artifact exceeds metadata budget');fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});}
function readJson(file,limit=128*MiB){assertAssetPath(file);const stat=fs.lstatSync(file);check(stat.isFile()&&stat.size<=limit,'Invalid import artifact');const bytes=fs.readFileSync(file);check(bytes.length<=limit,'Import artifact exceeds metadata budget');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
function identity(file){assertAssetPath(file);return fileIdentity(file);}
function relativeFile(root,relative){check(safeRelative(relative),'Unsafe library payload path');return assertAssetPath(path.join(root,...relative.split('/')),root);}
function sameFile(file,expected,code='library_import_stale'){const actual=identity(file);check(actual.size===expected.size&&actual.sha256===expected.sha256,`Library import bytes changed: ${expected.path??path.basename(file)}`,code);return actual;}
function checkOriginalStageFile(args,paths,file,normalizations){
 const target=relativeFile(paths.stagingProject,file.path),actual=identity(target);
 if(actual.size===file.size&&actual.sha256===file.sha256)return;
 if(file.path==='ProjectSettings/ProjectVersion.txt'&&file.size<=1024&&actual.size<=1024){
  const version=args.graph.unityVersion.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const canonical=new RegExp(`^m_EditorVersion: ${version}\\r?\\n(?:m_EditorVersionWithRevision: ${version} \\([0-9a-f]{7,64}\\)\\r?\\n?)?$`);
  const original=fs.readFileSync(relativeFile(args.projectDir,file.path),'utf8'),staged=fs.readFileSync(target,'utf8');
  if(canonical.test(original)&&canonical.test(staged)){
   normalizations.push({path:file.path,reason:'unity-editor-version-revision',sourceSha256:file.sha256,stagedSha256:actual.sha256});return;
  }
 }
 throw assetError('library_import_stale',`Library import bytes changed: ${file.path}`);
}
function context({toolkit,name,plan}){
 const paths=assetPaths(toolkit,name);check(ownsWorkspaceLock(paths.workspace),'Library import requires the workspace lease','asset_lease_required');
 check(uuid.test(plan?.operationId),'Invalid library operation UUID');
 const directory=assertAssetPath(path.join(paths.base,'library-imports',plan.operationId),paths.workspace);
 return {...paths,directory,stagingProject:path.join(directory,'project'),receiptFile:path.join(directory,'receipt.json')};
}
function summary(receipt,paths){const {stageInventory,receiptSha256,artifactHashes,...rest}=receipt;return {...rest,storedReceipt:path.relative(paths.workspace,paths.receiptFile).split(path.sep).join('/')};}
async function verifyInputs(args){
 assertAssetPath(args.projectDir);await verifyGraphFiles(args.projectDir,args.graph);
 check(fingerprint(selectedAssetBinding(args.toolkit,args.name).binding)===fingerprint(args.graph.binding),'Source build changed','library_import_stale');
 const archives=new Map(args.catalog.archives.map(a=>[a.path,a]));
 for(const pkg of args.plan.selected){
  check(typeof pkg.archivePath==='string'&&path.isAbsolute(pkg.archivePath)&&digest.test(pkg.archiveSha256),'Invalid selected source archive');
  const archive=archives.get(pkg.archivePath);check(archive&&archive.sha256===pkg.archiveSha256,'Selected source is absent from catalog');
  sameFile(pkg.archivePath,archive);
 }
}
async function validateIntent(args){
 const {validateLibraryPlan}=await import('./resolver.js');validateLibraryPlan(args.plan,args.graph,args.catalog);
 await verifyInputs(args);
}
function artifactHashes(directory,names){return names.filter(name=>fs.existsSync(path.join(directory,name))).map(name=>({path:name,...(({size,sha256})=>({size,sha256}))(identity(path.join(directory,name)))}));}
function saveReceipt(args,paths,partial){
 const receipt={kind:'retoolkit-library-import',schemaVersion:1,operationId:args.plan.operationId,graphRevision:args.graph.revision,binding:args.graph.binding,catalogRevision:args.catalog.revision,planSha256:fingerprint(args.plan),
  state:'blocked',stagingProject:null,imported:[],compileReady:false,bindingsVerified:false,uiVerified:false,limitations,...partial};
 const stored={...receipt,receiptSha256:fingerprint(receipt)};writeJson(paths.receiptFile,stored);return summary(stored,paths);
}
async function existingReceipt(args,paths){
 check(fs.existsSync(paths.receiptFile),'Prior library operation did not finish; use a fresh plan','library_import_stale');
 const receipt=readJson(paths.receiptFile),{receiptSha256,...payload}=receipt;
 check(receipt.kind==='retoolkit-library-import'&&receipt.schemaVersion===1&&receipt.operationId===args.plan.operationId&&receiptSha256===fingerprint(payload),'Invalid library import receipt','library_import_stale');
 check(receipt.graphRevision===args.graph.revision&&receipt.catalogRevision===args.catalog.revision&&receipt.planSha256===fingerprint(args.plan)&&fingerprint(receipt.binding)===fingerprint(args.graph.binding),'Library import belongs to an old plan','library_import_stale');
 for(const file of receipt.artifactHashes??[])sameFile(relativeFile(paths.directory,file.path),file);
 if(receipt.stagingProject){
  check(receipt.stagingProject===paths.stagingProject&&Array.isArray(receipt.stageInventory),'Invalid staging project receipt','library_import_stale');
  try{await verifyGraphFiles(paths.stagingProject,{files:receipt.stageInventory});}catch{throw assetError('library_import_stale','Library staging project bytes changed');}
 }
 return receipt;
}
function claimPath(claims,relative){
 check(safeRelative(relative),'Unsafe staged path');const parts=relative.split('/');
 for(let i=1;i<=parts.length;i++){
  const spelling=parts.slice(0,i).join('/'),key=spelling.toLowerCase(),type=i===parts.length?'file':'directory',old=claims.get(key);
  check(!old||(type==='directory'&&old.type==='directory'&&old.spelling===spelling),`Library target path collision: ${relative}`,'library_import_collision');
  claims.set(key,{type,spelling});
 }
}
async function stagePayloads(args,paths){
 const {packagePayloadMappings}=await import('./resolver.js');
 const payloadRoot=path.join(paths.directory,'payloads');fs.mkdirSync(payloadRoot);const budget={entries:0,total:0},archives=new Map(),mappings=[],claims=new Map(),sourceFiles=new Map(args.graph.files.map(file=>[file.path.toLowerCase(),file])),libraryTargets=new Set();
 for(const file of args.graph.files)claimPath(claims,file.path);
 for(const pkg of args.plan.selected){
  check(pkg.recognition==='confirmed'&&['upm','assets'].includes(pkg.format),'Only confirmed UPM and Assets payloads support staging','library_import_unsupported');
  check(safeRelative(pkg.root,{empty:true})&&Array.isArray(pkg.payloadFiles)&&pkg.payloadFiles.length>0,'Invalid library payload manifest');
  check(!pkg.payloadFiles.some(file=>/\.unitypackage$/i.test(file.path)),'Unitypackage inner tar/GUID/path analysis is unsupported','library_import_unsupported');
  let extracted=archives.get(pkg.archiveSha256);
  if(!extracted){
   const archive=args.catalog.archives.find(a=>a.path===pkg.archivePath&&a.sha256===pkg.archiveSha256);check(archive,'Archive was not catalogued');
   const snapshot=path.join(payloadRoot,pkg.archiveSha256+'.zip');await privateArchive(pkg.archivePath,snapshot,archive);
   extracted=path.join(payloadRoot,pkg.archiveSha256);await extractChecked(snapshot,extracted,{budget});sameFile(pkg.archivePath,archive);archives.set(pkg.archiveSha256,extracted);
  }
  const actualFiles=packageInventory(pkg.root?relativeFile(extracted,pkg.root):extracted).map(file=>({...file,path:pkg.root?pkg.root+'/'+file.path:file.path}));
  const declaredFiles=[...pkg.payloadFiles].sort((a,b)=>a.path.localeCompare(b.path));
  check(fingerprint(actualFiles)===fingerprint(declaredFiles),'Catalog payload does not exactly cover its extracted package root');
  const mapped=packagePayloadMappings(pkg);check(mapped.length===pkg.payloadFiles.length,'Library mapping excludes payload files');
  const seen=new Set();
  for(const file of mapped){
   const declared=pkg.payloadFiles.find(p=>p.path===file.path);check(declared&&declared.sha256===file.sha256&&declared.size===file.size&&!seen.has(file.path),'Mapped payload differs from catalog');seen.add(file.path);
   check(digest.test(file.sha256)&&Number.isSafeInteger(file.size)&&file.size>=0,'Invalid payload identity');
   check(pkg.root===''||file.path.startsWith(pkg.root+'/'),'Payload escapes package root');
   check(pkg.format==='upm'?file.targetPath.startsWith(`Packages/${pkg.identity.packageId}/`):file.targetPath.startsWith('Assets/'),'Unexpected library target path');
   check(!file.targetPath.toLowerCase().startsWith(helperRoot.toLowerCase()+'/'),'Library collides with reserved importer helper','library_import_collision');
   const key=file.targetPath.toLowerCase(),existing=sourceFiles.get(key);check(!libraryTargets.has(key),'Library payloads share a target file','library_import_collision');libraryTargets.add(key);
   if(existing)check(existing.path===file.targetPath&&existing.sha256===file.sha256&&existing.size===file.size,'Existing library payload differs','library_import_collision');
   else claimPath(claims,file.targetPath);
   const source=relativeFile(extracted,file.path);sameFile(source,file);mappings.push({...file,source,pkg,alreadyPresent:Boolean(existing)});
  }
 }
 claimPath(claims,'Packages/retk-libraries.lock.json');
 check(!args.graph.files.some(f=>new RegExp('^'+helperRoot+'(?:/|\\.|$)','i').test(f.path)),'Reserved library import helper directory exists','library_import_collision');
 const temporary=path.join(paths.directory,'.project-'+randomUUID());fs.mkdirSync(temporary);
 for(const file of args.graph.files){const target=relativeFile(temporary,file.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(relativeFile(args.projectDir,file.path),target,fs.constants.COPYFILE_EXCL);sameFile(target,file);}
 for(const file of mappings){const target=relativeFile(temporary,file.targetPath);if(!file.alreadyPresent){fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(file.source,target,fs.constants.COPYFILE_EXCL);}sameFile(target,file);}
 await verifyInputs(args);fs.renameSync(temporary,paths.stagingProject);
 return mappings;
}
function packageInventory(root){
 const files=[];let entries=0,bytes=0;function walk(dir,prefix='',depth=0){
  check(depth<=64,'Managed package nesting exceeds 64');assertAssetPath(dir,root);
  for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){check(++entries<=100000,'Managed package entry count exceeds 100000');const relative=prefix+entry.name;bytes+=Buffer.byteLength(relative)+160;check(bytes<=128*MiB,'Managed package inventory exceeds metadata budget');const absolute=relativeFile(root,relative),stat=fs.lstatSync(absolute);if(stat.isDirectory())walk(absolute,relative+'/',depth+1);else{check(stat.isFile(),'Nonregular managed package file');const {size,sha256}=identity(absolute);files.push({path:relative,size,sha256});}}
 }walk(root);return files.sort((a,b)=>a.path.localeCompare(b.path));
}
function managedLock(args,paths,mappings,{afterEditor=false}={}){
 const packages=args.plan.selected.filter(p=>p.format==='upm').map(pkg=>{
  const root=`Packages/${pkg.identity.packageId}`,files=mappings.filter(f=>f.pkg.id===pkg.id).map(f=>({path:f.targetPath.slice(root.length+1),size:f.size,sha256:f.sha256}));
  if(afterEditor){
   const observed=packageInventory(relativeFile(paths.stagingProject,root));const originals=new Map(files.map(f=>[f.path.toLowerCase(),f]));
   for(const file of observed){const original=originals.get(file.path.toLowerCase());check(original?original.path===file.path&&original.sha256===file.sha256&&original.size===file.size:file.path.endsWith('.meta')&&observed.some(other=>other.path===file.path.slice(0,-5)||other.path.startsWith(file.path.slice(0,-5)+'/')),'Editor modified managed package payload','library_import_stale');}
   check(files.every(file=>observed.some(actual=>actual.path===file.path&&actual.sha256===file.sha256&&actual.size===file.size)),'Editor removed managed package payload','library_import_stale');files.splice(0,files.length,...observed);
  }
  return {id:pkg.identity.packageId,version:pkg.version,libraryId:pkg.libraryId,catalogPackageId:pkg.id,archiveSha256:pkg.archiveSha256,root,files};
 });
 return {kind:'retoolkit-managed-libraries',schemaVersion:1,operationId:args.plan.operationId,catalogRevision:args.catalog.revision,packages};
}
function validateObservation(value,request){
 check(value?.kind==='retoolkit-library-import-observation'&&value.schemaVersion===1&&value.operationId===request.operationId&&typeof value.complete==='boolean'&&typeof value.success==='boolean','Invalid bound library import observation');
 check(Object.keys(value).every(key=>['kind','schemaVersion','operationId','complete','success','packages','diagnostics'].includes(key)),'Unknown import observation fields');
 check(Array.isArray(value.packages)&&value.packages.length===request.packages.length&&Array.isArray(value.diagnostics)&&value.diagnostics.length<=1000,'Invalid library import observation entries');
 check(value.packages.every((p,i)=>p.id===request.packages[i].id&&p.version===request.packages[i].version&&Object.keys(p).every(k=>['id','version'].includes(k))),'Resolved package identities differ from request');
 check(value.diagnostics.every(d=>d&&Object.keys(d).every(key=>['severity','message'].includes(key))&&['error','warning','info'].includes(d.severity)&&typeof d.message==='string'&&d.message.length<=8192),'Invalid import diagnostics');return value;
}

export async function importLibraryPlan(args,dependencies={}){
 const paths=context(args);await validateIntent(args);
 if(fs.existsSync(paths.directory))return summary(await existingReceipt(args,paths),paths);
 fs.mkdirSync(paths.directory,{recursive:true});
 if(args.plan.state!=='ready')return saveReceipt(args,paths,{state:args.plan.state==='satisfied'?'satisfied':'blocked',code:args.plan.state==='satisfied'?null:'library_plan_blocked'});
 const selected=selectedAssetBinding(args.toolkit,args.name),editor=Object.hasOwn(dependencies,'editor')?dependencies.editor:resolveUnityEditor(args.graph.unityVersion,selected.project);
 if(!editor)return saveReceipt(args,paths,{code:'unity_editor_missing'});
 assertAssetPath(editor);const editorIdentity=identity(editor),mappings=await stagePayloads(args,paths);
 const lockFile=path.join(paths.stagingProject,'Packages/retk-libraries.lock.json');fs.mkdirSync(path.dirname(lockFile),{recursive:true});writeJson(lockFile,managedLock(args,paths,mappings));
 const preflightGraph=await (isSqliteGraph(args.graph)?createUnitySourceFacts(paths.stagingProject,{binding:args.graph.binding}):indexUnityProject(paths.stagingProject,{binding:args.graph.binding,graphLimitBytes:args.graph.profile?.limits?.maxGraphBytes}));assertPortablePackages(paths.stagingProject,preflightGraph.files);
 const helperDir=path.join(paths.stagingProject,helperRoot,'Editor');fs.mkdirSync(helperDir,{recursive:true});
 const helper=assertAssetPath(path.join(args.toolkit.root,'templates/Unity/REToolkitLibraryImport.cs')),helperIdentity=identity(helper);
 fs.copyFileSync(helper,path.join(helperDir,'REToolkitLibraryImport.cs'),fs.constants.COPYFILE_EXCL);
 writeJson(path.join(helperDir,'REToolkit.LibraryImport.Editor.asmdef'),{name:'REToolkit.LibraryImport.Editor',includePlatforms:['Editor'],autoReferenced:false});
 const request={kind:'retoolkit-library-import-request',schemaVersion:1,operationId:args.plan.operationId,unityVersion:args.graph.unityVersion,packages:args.plan.selected.filter(p=>p.format==='upm').map(p=>({id:p.identity.packageId,version:p.version}))};
 const requestFile=path.join(paths.directory,'request.json'),reportFile=path.join(paths.directory,'observation.json');writeJson(requestFile,request);const requestIdentity=identity(requestFile);
 const {runUnityEditor}=await import('../unity/runner.js'),run=dependencies.runEditor??runUnityEditor;
 const processResult=await run({purpose:'library-import',editor,projectDir:paths.stagingProject,requestFile,reportFile,lockDirectory:path.join(paths.workspace,'.retk-lock'),toolkitRoot:args.toolkit.root,timeoutSeconds:600});
 if(processResult.closed!==true)throw Object.assign(assetError('unity_recovery_required','Unity child closure is unconfirmed; preserve ownership gates'),{preserveToolchainGate:true});
 await verifyInputs(args);sameFile(editor,editorIdentity);sameFile(helper,helperIdentity);sameFile(requestFile,requestIdentity);sameFile(path.join(helperDir,'REToolkitLibraryImport.cs'),helperIdentity);
 for(const file of mappings)sameFile(relativeFile(paths.stagingProject,file.targetPath),file);
 const normalizations=[];for(const file of args.graph.files){if(!/^Packages\/packages-lock\.json$/i.test(file.path))checkOriginalStageFile(args,paths,file,normalizations);}
 const finalLock=managedLock(args,paths,mappings,{afterEditor:true});assertAssetPath(lockFile,paths.stagingProject);check(fs.lstatSync(lockFile).isFile(),'Managed lock is no longer a regular file','library_import_stale');fs.writeFileSync(lockFile,JSON.stringify(finalLock,null,2)+'\n');
 // Only the fixed generated helper subtree is removed; all paths were reserved
 // before publication and checked for links again after the Editor closed.
 const helperTree=assertAssetPath(path.join(paths.stagingProject,helperRoot),paths.stagingProject);packageInventory(helperTree);fs.rmSync(helperTree,{recursive:true});
 const helperMeta=assertAssetPath(helperTree+'.meta',paths.stagingProject);if(fs.existsSync(helperMeta)){check(fs.lstatSync(helperMeta).isFile(),'Invalid generated helper metadata');fs.unlinkSync(helperMeta);}
 let observation=null,reportError=null;try{observation=validateObservation(readJson(reportFile,16*MiB),request);}catch(error){reportError=error.code??'library_import_report_missing';}
 const success=processResult.exitCode===0&&!processResult.timedOut&&observation?.complete===true&&observation.success===true&&!observation.diagnostics.some(d=>d.severity==='error');
 const stageGraph=await (isSqliteGraph(args.graph)?createUnitySourceFacts(paths.stagingProject,{binding:args.graph.binding}):indexUnityProject(paths.stagingProject,{binding:args.graph.binding,graphLimitBytes:args.graph.profile?.limits?.maxGraphBytes}));await verifyInputs(args);
 return saveReceipt(args,paths,{state:success?'imported':'import_failed',stagingProject:paths.stagingProject,imported:success?args.plan.selected.map(p=>p.libraryId):[],stageInventory:stageGraph.files,stageRevision:stageGraph.revision,
  process:{exitCode:processResult.exitCode,closed:true,timedOut:processResult.timedOut},reportError,normalizations,diagnostics:observation?.diagnostics.slice(0,20)??[],artifactHashes:artifactHashes(paths.directory,['request.json','observation.json']),editor:editorIdentity,helperSha256:helperIdentity.sha256});
}

export async function verifyLibraryImport(args,dependencies={}){
 const paths=context(args);await validateIntent(args);const receipt=await existingReceipt(args,paths);
 check(receipt.state==='imported'&&receipt.stagingProject,'Library import has no successful staging result','library_import_not_ready');
 const stageGraph=await (isSqliteGraph(args.graph)?createUnitySourceFacts(paths.stagingProject,{binding:args.graph.binding}):indexUnityProject(paths.stagingProject,{binding:args.graph.binding,graphLimitBytes:args.graph.profile?.limits?.maxGraphBytes}));
 const validate=dependencies.validateEditor??validateUnityProject;
 const result=await validate({...args,projectDir:paths.stagingProject,graph:stageGraph},dependencies);
 await verifyInputs(args);await existingReceipt(args,paths);
 const verification={kind:'retoolkit-library-verification',schemaVersion:1,operationId:args.plan.operationId,verificationId:randomUUID(),state:result.state,stagingProject:paths.stagingProject,
  graphRevision:args.graph.revision,stageRevision:stageGraph.revision,catalogRevision:args.catalog.revision,compileReady:result.compileReady===true,bindingsVerified:result.compileReady===true&&result.bindingsVerified===true,uiVerified:false,validation:result};
 const reportFile=path.join(paths.directory,'verification-'+verification.verificationId+'.json');writeJson(reportFile,{...verification,reportSha256:fingerprint(verification)});
 return {...verification,storedReport:path.relative(paths.workspace,reportFile).split(path.sep).join('/')};
}
