import fs from 'node:fs';
import path from 'node:path';
import {binaryAbi,within,inputPolicy,recommendInputs} from './inputs.js';
import {fingerprint} from './state.js';
import {rejectOutputLinks} from './artifacts.js';

export const inputError=(code,message)=>Object.assign(new Error(message),{code});
export const isInputSelectionError=error=>/^(Ambiguous (binary|metadata);|No IL2CPP (binary|metadata) found|Selected (binary|metadata) is not a candidate)/.test(error?.message??'');
const relative=(root,file)=>path.relative(root,file).split(path.sep).join('/');
export function emptyDirectory(directory){
 rejectOutputLinks(directory);
 return !fs.existsSync(directory)||(fs.lstatSync(directory).isDirectory()&&fs.readdirSync(directory).length===0);
}
export function hasPriorInputs(project,workspace){
 return Boolean(project.nativeBinary||project.metadata||project.selection?.binary||project.selection?.metadata||project.identities?.native||project.identities?.metadata||
  (project.steps?.scan?.state&&!['pending','awaiting-user','failed'].includes(project.steps.scan.state))||
  ['dump','import','analyze','symbols','assetripper'].some(name=>['succeeded','unknown'].includes(project.steps?.[name]?.state)||(project.steps?.[name]?.outputs?.length??0)>0)||
  ['02_Il2CppDumperOutput','03_GhidraProject','05_ReconstructedSource'].some(name=>!emptyDirectory(path.join(workspace,name))));
}
export function validateStage(workspace,stage){
 if(typeof stage!=='string'||!path.isAbsolute(stage)||path.dirname(path.resolve(stage))!==path.resolve(workspace)||!/^\.extract-[A-Za-z0-9_.-]+$/.test(path.basename(stage)))return null;
 rejectOutputLinks(stage);
 if(!fs.existsSync(stage)||!fs.lstatSync(stage).isDirectory()||!within(fs.realpathSync(stage),fs.realpathSync(workspace)))return null;
 return path.resolve(stage);
}
function inventory(root){
 const binaries=[],metadata=[],facts=[];let visited=0;
 function visit(directory,depth){
  if(depth>128)throw inputError('INPUT_INVENTORY_LIMIT','Input inventory directory depth exceeds 128');
  for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
   if(++visited>200000)throw inputError('INPUT_INVENTORY_LIMIT','Input inventory exceeds 200000 entries');
   const file=path.join(directory,entry.name),stat=fs.lstatSync(file);
   if(stat.isSymbolicLink())throw inputError('INPUT_LINK','Linked paths/junctions are unsupported in input candidates');
   if(stat.isDirectory()){visit(file,depth+1);continue;}
   if(!stat.isFile())continue;
   const isBinary=/^(libil2cpp\.so|GameAssembly\.dll)$/i.test(entry.name),isMetadata=/^global-metadata\.dat$/i.test(entry.name);
   if(!isBinary&&!isMetadata)continue;
   if(binaries.length+metadata.length>=512)throw inputError('INPUT_INVENTORY_LIMIT','Input candidate count exceeds 512');
   const item={path:relative(root,file)};if(isBinary)item.abi=binaryAbi(file);
   (isBinary?binaries:metadata).push(item);
   const header=Buffer.alloc(64),fd=fs.openSync(file,'r');let count;try{count=fs.readSync(fd,header,0,header.length,0);}finally{fs.closeSync(fd);}
   facts.push({...item,size:stat.size,mtime:stat.mtimeMs,ctime:stat.ctimeMs,ino:stat.ino,header:header.subarray(0,count).toString('hex')});
  }
 }
 visit(root,0);return {binaries,metadata,facts};
}
export function inspectInputSelection({name,project,workspace,policy}){
 policy=inputPolicy(policy??project.inputPolicy);
 rejectOutputLinks(workspace);
 const canonical=path.join(workspace,'01_Extracted');let source={path:project.nativeBinary&&project.metadata&&project.extractedPath?path.resolve(project.extractedPath):canonical,location:'canonical'},legacy=false;
 const pending=project.pendingExtraction;
 if(pending?.stage){const stage=validateStage(workspace,pending.stage);if(stage)source={path:stage,location:'staging'};}
 else if(!project.nativeBinary&&!project.metadata&&project.steps?.extract?.state==='failed'&&/^(Ambiguous (binary|metadata);|No IL2CPP (binary|metadata) found)/.test(project.steps.extract.error??'')){
  const match=/; staging: ([^\r\n]+)$/.exec(project.steps.extract.error??'');
  const stage=match&&validateStage(workspace,match[1]);if(stage){source={path:stage,location:'staging'};legacy=true;}
 }
 rejectOutputLinks(source.path);
 const exists=fs.existsSync(source.path)&&fs.lstatSync(source.path).isDirectory();
 const found=exists?inventory(source.path):{binaries:[],metadata:[],facts:[]};
 const selection={};
 if(project.nativeBinary&&found.binaries.some(item=>path.resolve(source.path,item.path)===path.resolve(project.nativeBinary)))selection.binary=relative(source.path,project.nativeBinary);
 if(project.metadata&&found.metadata.some(item=>path.resolve(source.path,item.path)===path.resolve(project.metadata)))selection.metadata=relative(source.path,project.metadata);
 if(selection.binary){selection.abi=found.binaries.find(item=>item.path===selection.binary).abi;selection.reason=project.selection?.reason??'current';selection.policy=project.selection?.policy??policy;}
 const state=!exists?'unavailable':!found.binaries.length||!found.metadata.length?'missing-input':selection.binary&&selection.metadata?'selected':'needs-selection';
 const canRecover=Boolean(legacy&&emptyDirectory(canonical)&&!hasPriorInputs(project,workspace));
 const revision=fingerprint({source,facts:found.facts,selection,policy,extractRun:project.steps?.extract?.runId,extractState:project.steps?.extract?.state,pending:pending??null,canRecover});
 const remembered=source.location==='staging'?Object.fromEntries(Object.entries(project.selection??{}).filter(([key])=>['binary','metadata'].includes(key)).map(([key,value])=>[key,String(value).split('\\').join('/')])):selection;
 const recommendation=recommendInputs(found.binaries,found.metadata,remembered,policy);
 if(source.location==='staging'&&((remembered.binary&&!found.binaries.some(item=>item.path===remembered.binary))||(remembered.metadata&&!found.metadata.some(item=>item.path===remembered.metadata)))){
  recommendation.resolvable=false;recommendation.reason='prior-selection-unavailable';
 }
 return {kind:'retoolkit-input-selection',schemaVersion:1,name,state,source,revision,policy,recommendation,binaries:found.binaries,metadata:found.metadata,selection,canRecover,canSelect:Boolean(exists&&found.binaries.length&&found.metadata.length&&!legacy)};
}

export function inputResolutionSummary(view,project){
 const selected=view.state==='selected';
 const binary=selected?view.binaries.find(item=>item.path===view.selection.binary):null;
 return {kind:'retoolkit-input-resolution',schemaVersion:1,name:view.name,state:selected?'selected':!view.binaries.length||!view.metadata.length?'missing-input':'needs-selection',policy:view.policy,
  source:view.source,revision:view.revision,selection:{binary:selected?view.selection.binary:null,metadata:selected?view.selection.metadata:null,abi:binary?.abi??null,reason:selected?(project.selection?.reason??'current'):view.recommendation.reason},
  recommendation:view.recommendation,canRecover:view.canRecover,candidates:{binaryCount:view.binaries.length,metadataCount:view.metadata.length,binaries:view.binaries.slice(0,8),metadata:view.metadata.slice(0,8),truncated:view.binaries.length>8||view.metadata.length>8}};
}
export function verifyRevision(view,revision){
 if(typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision))throw inputError('INPUT_REVISION_REQUIRED','An exact input candidate revision is required');
 if(view.revision!==revision)throw inputError('INPUT_REVISION_CHANGED','Input candidates changed; inspect and select them again');
}
export function verifyChoice(view,binary,metadata){
 for(const [kind,value,choices]of [['binary',binary,view.binaries],['metadata',metadata,view.metadata]]){
  if(typeof value!=='string'||!value||value.length>4096||/[\\\x00-\x1f]/.test(value)||path.posix.isAbsolute(value)||path.win32.isAbsolute(value)||value.split('/').some(part=>['','..','.'].includes(part))||!choices.some(item=>item.path===value))throw inputError('INPUT_NOT_CANDIDATE',`Selected ${kind} must be an exact relative candidate path`);
 }
}
