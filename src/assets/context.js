import fs from 'node:fs';
import path from 'node:path';
import {fileIdentity,fingerprint} from '../state.js';
import {within} from '../inputs.js';
import {measurePhaseSync,countPhaseWork} from '../workflow/metrics.js';

export function assetError(code,message) {return Object.assign(new Error(message),{code});}

// Only an internally constructed toolkit can select an artifact. Neither a DTO
// nor project.re.json can redirect these paths into another export or workspace.
const scopes=new WeakMap();
export function createArtifactToolkit(toolkit,name,{base,projectDir,readState,saveState}) {
  const workspace=assertAssetPath(toolkit.workspace(name)),parent=assertAssetPath(path.join(workspace,'04_Notes/recovery/artifacts'),workspace);
  base=assertAssetPath(base,parent);projectDir=assertAssetPath(projectDir,base);
  const scoped=Object.create(toolkit);
  scoped.read=selected=>{
    if(selected!==name)throw assetError('recovery_scope_invalid','Artifact belongs to another workspace');
    return {...toolkit.read(name),reconstructedSourceDir:projectDir,assetReconstruction:readState()};
  };
  scoped.save=async(selected,project)=>{
    if(selected!==name)throw assetError('recovery_scope_invalid','Artifact belongs to another workspace');
    await saveState(project.assetReconstruction);
  };
  scopes.set(scoped,{name,base,projectDir});return scoped;
}
export function assetProjectPath(toolkit,name,selected) {
  const scope=scopes.get(toolkit);
  if(scope){if(scope.name!==name)throw assetError('recovery_scope_invalid','Artifact workspace mismatch');return assertAssetPath(scope.projectDir,scope.base);}
  return safeAssetExportPath(selected.workspace,selected.project.reconstructedSourceDir??path.join(selected.workspace,'05_ReconstructedSource'),selected.inputPath);
}

// Inspect every existing ancestor, including dangling links. Never use existsSync
// as a link guard: it follows links and hides dangling ones.
export function assertAssetPath(target,parent) {
  target=path.resolve(target);
  if(parent&&!within(target,parent))throw assetError('asset_path_invalid','Asset path must stay inside the selected workspace');
  const {root}=path.parse(target);let current=root;
  for(const part of target.slice(root.length).split(path.sep).filter(Boolean)) {
    current=path.join(current,part);let stat;
    try {stat=fs.lstatSync(current);}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(stat.isSymbolicLink())throw assetError('asset_path_invalid','Linked asset paths are unsupported');
    if(current!==target&&!stat.isDirectory())throw assetError('asset_path_invalid','Asset path ancestor is not a directory');
  }
  return target;
}

export function assetPaths(toolkit,name) {
  const workspace=assertAssetPath(toolkit.workspace(name));
  const scope=scopes.get(toolkit);
  if(scope&&scope.name!==name)throw assetError('recovery_scope_invalid','Artifact workspace mismatch');
  const base=assertAssetPath(scope?path.join(scope.base,'assets'):path.join(workspace,'04_Notes/assets'),workspace);
  return {workspace,base,graphFile:assertAssetPath(path.join(base,'graph.json'),workspace),
    mapFile:assertAssetPath(path.join(base,'scripts.json'),workspace),
    reconstructionDir:assertAssetPath(path.join(base,'reconstruction'),workspace)};
}

export function safeAssetExportPath(workspace,directory=path.join(workspace,'05_ReconstructedSource'),inputPath) {
  const exportBase=assertAssetPath(path.join(workspace,'05_ReconstructedSource'),workspace);
  const result=assertAssetPath(directory,exportBase);
  if(inputPath&&(within(result,inputPath)||within(inputPath,result)))throw assetError('asset_path_invalid','Export directory overlaps selected inputs');
  return result;
}

function stableIdentity(file) {
  assertAssetPath(file);const before=fs.lstatSync(file);
  if(!before.isFile())throw assetError('asset_input_invalid','Expected a regular asset input');
  const identity=fileIdentity(file),after=fs.lstatSync(file);
  countPhaseWork('input.verify',identity.size,1);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino)
    throw assetError('asset_input_stale','Asset inputs changed while hashing');
  return {size:identity.size,sha256:identity.sha256};
}

export function selectedAssetBinding(toolkit,name) {
  return measurePhaseSync('input.verify',()=>selectAssetBinding(toolkit,name));
}
function selectAssetBinding(toolkit,name) {
  const paths=assetPaths(toolkit,name),project=toolkit.read(name);
  if(!project.extractedPath||!project.nativeBinary||!project.metadata)
    throw assetError('asset_input_missing','Scan the selected IL2CPP inputs before using assets');
  const inputPath=assertAssetPath(project.extractedPath);
  if(!fs.lstatSync(inputPath).isDirectory())throw assetError('asset_input_invalid','Asset input must be a directory');
  if(within(paths.base,inputPath)||within(path.join(paths.workspace,'05_ReconstructedSource'),inputPath))
    throw assetError('asset_input_invalid','Asset inputs must exclude generated notes and exported projects');
  const files=[],directories=[];let entries=0,metadataBytes=0,totalBytes=0;
  const walk=(directory,prefix='',depth=0)=>{
    if(depth>128)throw assetError('asset_input_limit','Asset input directory nesting exceeds the limit');
    const before=fs.lstatSync(directory);
    for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)) {
      if(++entries>100000)throw assetError('asset_input_limit','Asset input inventory exceeds 100000 entries');
      const relative=prefix+entry.name,absolute=assertAssetPath(path.join(directory,entry.name),inputPath);
      const stat=fs.lstatSync(absolute);
      if(stat.isDirectory()){directories.push(relative);walk(absolute,relative+'/',depth+1);}
      else if(stat.isFile()) {
        const identity=stableIdentity(absolute);files.push({path:relative,...identity});totalBytes+=identity.size;
        if(totalBytes>64*1024**3)throw assetError('asset_input_limit','Asset inputs exceed 64 GiB');
      } else throw assetError('asset_input_invalid','Asset input contains a nonregular entry');
      metadataBytes+=Buffer.byteLength(relative)+160;
      if(metadataBytes>128*1024**2)throw assetError('asset_input_limit','Asset inventory metadata exceeds 128 MiB');
    }
    const after=fs.lstatSync(directory);
    if(before.mtimeMs!==after.mtimeMs||before.ino!==after.ino)throw assetError('asset_input_stale','Asset directory changed while hashing');
  };
  walk(inputPath);
  const binding={};
  for(const [kind,file] of [['native',project.nativeBinary],['metadata',project.metadata]]) {
    assertAssetPath(file,inputPath);const actual=stableIdentity(file),recorded=project.identities?.[kind];
    const relative=path.relative(inputPath,file).split(path.sep).join('/');
    const manifest=files.find(entry=>entry.path===relative);
    if(!recorded||recorded.sha256!==actual.sha256||recorded.size!==actual.size||!manifest||manifest.sha256!==actual.sha256)
      throw assetError('asset_input_stale','Selected IL2CPP inputs changed; scan them again');
    binding[kind]=actual;
  }
  const sourceManifest={files,directories};binding.assetsSha256=fingerprint(sourceManifest);
  binding.program=project.ghidraProgramName??path.basename(project.nativeBinary);
  binding.projectName=project.ghidraProjectName??name;
  return {project,workspace:paths.workspace,inputPath,binding,sourceManifest};
}
