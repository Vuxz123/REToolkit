import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { fileIdentity, fingerprint, reusable, validManifest, withWorkspaceLock } from './state.js';
import { binaryAbi, stepFingerprint } from './inputs.js';
import { assertNoSession } from './ghidra/runtime.js';
import { validateEvidence } from './evidence-schema.js';
import { MAX_MANIFEST, MAX_FILES, safePath, rejectLinks, validateManifest, verifyHandoff, readHandoff } from './handoff-verify.js';

export { verifyHandoff, readHandoff };
function within(file,root) {
  const relative=path.relative(root.toLowerCase(),path.resolve(file).toLowerCase());
  return relative===''||relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);
}
async function exists(file) {try{return await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function prospectivePath(file) {
  let ancestor=path.resolve(file);const suffix=[];
  while(!await exists(ancestor)){suffix.unshift(path.basename(ancestor));const parent=path.dirname(ancestor);if(parent===ancestor)throw new Error('Cannot resolve output ancestor');ancestor=parent;}
  return path.join(await fs.realpath(ancestor),...suffix);
}
async function currentIdentity(file,native=false) {
  if(!file||!await exists(file))return null;
  await rejectLinks(file);const {size,sha256}=fileIdentity(file);
  return native?{size,sha256,abi:binaryAbi(file)}:{size,sha256};
}
async function buildIdentity(project) {return {native:await currentIdentity(project.nativeBinary,true),metadata:await currentIdentity(project.metadata)};}
const excluded = name => name.startsWith('.') || /(?:^|[-_.])(token|tokens|secret|secrets|credential|credentials|password|passwords|backup|backups|cache|logs?|runtime)(?:[-_.]|$)/i.test(name) || /\.(?:bak|log|tmp|old|apk|obb|re)$/i.test(name);
async function collectTree(root,prefix,classification,workspace,filter=()=>true) {
  if(!root||!await exists(root))return [];
  if(workspace&&!within(root,workspace))throw new Error('Artifact source must stay inside workspace');
  await rejectLinks(root);const result=[];
  const visit=async(folder,relative='')=>{
    for(const name of (await fs.readdir(folder)).sort()) {
      if(excluded(name))continue;
      const file=path.join(folder,name),rel=relative?`${relative}/${name}`:name;
      const stat=await fs.lstat(file);if(stat.isSymbolicLink())throw new Error('Artifact symbolic links and junctions are forbidden');
      if(stat.isDirectory())await visit(file,rel);
      else if(stat.isFile()&&filter(rel)) {safePath(`${prefix}/${rel}`);result.push({source:file,path:`${prefix}/${rel}`,classification});}
      else if(!stat.isFile())throw new Error('Unsupported artifact file type');
      if(result.length>MAX_FILES)throw new Error('Too many handoff files');
    }
  };await visit(root);return result;
}
async function selectedSources(project,workspace,options) {
  const selected=[];
  const dump=project.il2cppDumperOutput;
  if(dump) {
    if(!within(dump,workspace))throw new Error('Dump artifacts must stay inside workspace');
    for(const name of ['dump.cs','script.json']) {
      const source=path.join(dump,name);if(!await exists(source))continue;
      await rejectLinks(source);selected.push({source,path:`dump/${name}`,classification:'metadata'});
    }
  }
  selected.push(...await collectTree(path.join(workspace,'04_Notes'),'notes','notes',workspace,p=>/\.(md|txt)$/i.test(p)));
  if(options.includeDummyDll)selected.push(...await collectTree(project.dumperDummyDll??(dump?path.join(dump,'DummyDll'):null),'reconstructed/DummyDll','reconstructed',workspace));
  if(options.includeAssets)selected.push(...await collectTree(project.reconstructedSourceDir,'assets','assets',workspace));
  if(options.includeBinaries)for(const [kind,source] of [['native',project.nativeBinary],['metadata',project.metadata]]) {
    if(!source||!await exists(source))continue;await rejectLinks(source);
    selected.push({source,path:`binaries/${kind}/${path.basename(source)}`,classification:'binary'});
  }
  return selected;
}
async function evidenceSources(folder,workspace,build,project) {
  if(!folder)return [];
  const source=path.resolve(folder);await rejectLinks(source);
  if(within(await fs.realpath(source),workspace))throw new Error('Evidence source must be outside workspace');
  const sources=await collectTree(source,'evidence','observations',null,p=>/\.json$/i.test(p));
  if(!sources.length)throw new Error('Evidence folder contains no evidence JSON');
  for(const file of sources) {
    const stat=await fs.lstat(file.source);if(stat.size>MAX_MANIFEST)throw new Error('Evidence exceeds 32MiB limit');
    file.classification=validateEvidence(JSON.parse(await fs.readFile(file.source,'utf8')),{build,program:project.ghidraProgramName,projectName:project.ghidraProjectName});
  }
  return sources;
}
function artifactState(project,name,paths,build,toolkit) {
  if(!paths.length)return 'missing';const step=project.steps?.[name];if(step?.state==='stale')return 'stale';
  const changed=['native','metadata'].some(kind=>build[kind]?.sha256!==project.identities?.[kind]?.sha256||build[kind]?.size!==project.identities?.[kind]?.size);
  if(changed)return 'stale';if(step?.state!=='succeeded')return 'unknown';
  try {
    let expected;
    if(name==='dump')expected=stepFingerprint(project,'dump',toolkit.tools,toolkit.root);
    else if(name==='notes')expected=fingerprint({native:build.native?.sha256,metadata:build.metadata?.sha256});
    else if(name==='assetripper')expected=fingerprint({source:project.extractedPath,native:build.native?.sha256,metadata:build.metadata?.sha256});
    return expected&&reusable(project,name,expected)?'valid':'stale';
  }catch{return 'unknown';}
}
function observedStepState(project,name,build,toolkit) {
  const step=project.steps[name];if(step.state!=='succeeded')return step.state;
  if(['dump','import','analyze','symbols','notes','assetripper'].includes(name)&&['native','metadata'].some(kind=>!build[kind]||build[kind].sha256!==project.identities?.[kind]?.sha256||build[kind].size!==project.identities?.[kind]?.size))return 'stale';
  try {
    if(['dump','import','analyze','symbols'].includes(name))return reusable(project,name,stepFingerprint(project,name,toolkit.tools,toolkit.root))?'succeeded':'stale';
    if(name==='scan')return reusable(project,name,fingerprint({native:build.native?.sha256,metadata:build.metadata?.sha256}))?'succeeded':'stale';
    if(['notes','assetripper'].includes(name))return artifactState(project,name,['observed'],build,toolkit)==='valid'?'succeeded':'stale';
    return validManifest(step.outputs)?'succeeded':'stale';
  }catch{return 'unknown';}
}
async function copyVerified(file,destination) {
  await rejectLinks(file.source);const before=fileIdentity(file.source);
  await fs.mkdir(path.dirname(destination),{recursive:true});
  let count=0;const hash=createHash('sha256');
  const observer=new Transform({transform(chunk,encoding,callback){count+=chunk.length;hash.update(chunk);callback(count>before.size?new Error('Source changed during handoff snapshot'):null,chunk);}});
  await pipeline(createReadStream(file.source),observer,createWriteStream(destination,{flags:'wx'}));
  const copied=hash.digest('hex');const after=fileIdentity(file.source);
  if(count!==before.size||copied!==before.sha256||after.sha256!==before.sha256||after.size!==before.size)throw new Error('Source changed during handoff snapshot');
  return {path:file.path,size:count,sha256:copied,classification:file.classification};
}
async function createZip(stage,manifest,destination) {
  const zip=new yazl.ZipFile();zip.on('error',error=>zip.outputStream.destroy(error));
  const done=pipeline(zip.outputStream,createWriteStream(destination,{flags:'wx'}));done.catch(()=>{});
  try {zip.addFile(path.join(stage,'manifest.json'),'manifest.json');for(const file of manifest.files)zip.addFile(path.join(stage,file.path),file.path);zip.end();await done;}
  catch(error){zip.outputStream.destroy(error);await done.catch(()=>{});throw error;}
}

/** Copy an observed snapshot only; no analysis, engine start or network work. */
export async function createHandoff(toolkit,name,{out,includeDummyDll=false,includeAssets=false,includeBinaries=false,evidence}={}) {
  const requestedWorkspace=toolkit.workspace(name);await rejectLinks(requestedWorkspace);
  assertNoSession(toolkit,name);
  return withWorkspaceLock(requestedWorkspace,async()=>{
    assertNoSession(toolkit,name);
    const workspace=await fs.realpath(requestedWorkspace),workspaceRoot=await fs.realpath(path.join(toolkit.root,'workspaces'));const project=toolkit.read(name);const runId=randomUUID();
    const requested=path.resolve(out??path.join(toolkit.root,'exports',`handoff-${name}-${runId}`));
    if(within(requested,workspaceRoot)||within(requested,workspace))throw new Error('Handoff output must be outside toolkit workspaces');
    const prospective=await prospectivePath(requested);
    if(within(prospective,workspaceRoot)||within(prospective,workspace))throw new Error('Resolved handoff output must be outside toolkit workspaces');
    await fs.mkdir(path.dirname(requested),{recursive:true});
    const target=path.join(await fs.realpath(path.dirname(requested)),path.basename(requested));
    if(within(target,workspaceRoot)||within(target,workspace))throw new Error('Resolved handoff output must be outside toolkit workspaces');
    if(await exists(target))throw new Error('Handoff output already exists; choose a new path');
    const stage=path.join(path.dirname(target),`.handoff-${runId}.tmp`),zipStage=`${stage}.zip`;
    await fs.mkdir(stage);
    try {
      const projectFile=toolkit.projectPath(name);await rejectLinks(projectFile);const projectHash=fileIdentity(projectFile).sha256;
      const build=await buildIdentity(project);const options={includeDummyDll,includeAssets,includeBinaries};
      const sources=[...await selectedSources(project,workspace,options),...await evidenceSources(evidence,workspace,build,project)];
      const manifest={kind:'retoolkit-handoff',schemaVersion:1,name,runId,createdAt:new Date().toISOString(),build,steps:{},tools:{},files:[],artifacts:[],limitations:['dump.cs is metadata skeleton code; pseudocode and reconstructed files are not original source.','No analysis or source decompilation was run for this export.','A successful bundle verification validates bytes, not analysis readiness or input-pair compatibility.']};
      const names=new Set();
      for(const file of sources) {
        safePath(file.path);const folded=file.path.toLowerCase();if(names.has(folded))throw new Error('Duplicate case-folded artifact path');names.add(folded);
        if(manifest.files.length>=MAX_FILES)throw new Error('Too many handoff files');
        manifest.files.push(await copyVerified(file,path.join(stage,file.path)));
      }
      for(const [step,facts] of Object.entries(project.steps??{}))manifest.steps[step]={state:observedStepState(project,step,build,toolkit),fingerprint:facts.fingerprint??null,runId:facts.runId??null,completedAt:facts.completedAt??null};
      const stepStates=Object.fromEntries(Object.keys(project.steps??{}).map(step=>[step,manifest.steps[step].state]));
      for(const [tool,facts] of Object.entries(project.tools??{}))manifest.tools[tool]={version:String(facts.version??'unknown'),sha256:facts.sha256??null};
      for(const [artifact,step,prefix,enabled] of [['dump','dump','dump/',true],['notes','notes','notes/',true],['dummyDll','dump','reconstructed/',includeDummyDll],['assets','assetripper','assets/',includeAssets],['binaries','scan','binaries/',includeBinaries],['evidence',null,'evidence/',Boolean(evidence)]]) {
        const paths=manifest.files.filter(file=>file.path.startsWith(prefix)).map(file=>file.path);
        const state=!enabled?'excluded':artifact==='evidence'?'valid':artifact==='binaries'?(paths.length===2?'valid':'missing'):artifact==='dump'&&paths.length!==2?'missing':artifactState(project,step,paths,build,toolkit);
        manifest.artifacts.push({name:artifact,state,paths});
        if(state==='stale'&&manifest.steps[step])manifest.steps[step].state='stale';
        if(['missing','stale','unknown'].includes(state))manifest.limitations.push(`${artifact}: ${state}; no unobserved success is implied.`);
      }
      validateManifest(manifest);
      const raw=Buffer.from(JSON.stringify(manifest,null,2)+'\n');if(raw.length>MAX_MANIFEST)throw new Error('Manifest exceeds 32MiB limit');
      await fs.writeFile(path.join(stage,'manifest.json'),raw,{flag:'wx'});
      const assertSnapshot=async()=>{
        const now=[...await selectedSources(project,workspace,options),...await evidenceSources(evidence,workspace,build,project)];
        if(fingerprint(now)!==fingerprint(sources)||fingerprint(await buildIdentity(project))!==fingerprint(build)||fileIdentity(projectFile).sha256!==projectHash)throw new Error('Inputs or project changed during handoff snapshot');
        const currentStates=Object.fromEntries(Object.keys(project.steps??{}).map(step=>[step,observedStepState(project,step,build,toolkit)]));
        if(fingerprint(currentStates)!==fingerprint(stepStates))throw new Error('Step fingerprint or output evidence changed during handoff snapshot');
        for(let index=0;index<sources.length;index++) {
          await rejectLinks(sources[index].source);const actual=fileIdentity(sources[index].source),record=manifest.files[index];
          if(actual.sha256!==record.sha256||actual.size!==record.size)throw new Error('Source changed during handoff snapshot');
        }
      };
      await assertSnapshot();
      const zipped=target.toLowerCase().endsWith('.zip');if(zipped)await createZip(stage,manifest,zipStage);
      const verified=await verifyHandoff(zipped?zipStage:stage);if(!verified.ok)throw new Error(`Staged handoff failed verification: ${verified.errors.join('; ')}`);
      await assertSnapshot();
      if(await exists(target))throw new Error('Handoff output already exists; choose a new path');
      if(zipped){await fs.link(zipStage,target);await fs.unlink(zipStage);}else await fs.rename(stage,target);
      return {path:target,manifest};
    } finally {await fs.rm(stage,{recursive:true,force:true});await fs.rm(zipStage,{force:true});}
  });
}
