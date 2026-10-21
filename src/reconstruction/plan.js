import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fingerprint} from '../state.js';
import {verifyGraphFiles,UNITY_PROJECT_LIMITS} from '../assets/graph.js';
import {parseCSharp} from '../assets/csharp.js';
import {scriptBindings} from './bindings.js';

const MiB=1024*1024,hash=value=>createHash('sha256').update(value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function check(value,message,code='reconstruction_invalid'){if(!value)throw Object.assign(new Error(message),{code});}
function shape(value,keys,required=keys){check(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&Object.keys(value).every(k=>keys.includes(k))&&required.every(k=>Object.hasOwn(value,k)),'Invalid reconstruction request/plan shape');}
function rel(value){check(typeof value==='string'&&value.length<2048&&!/[\\:\x00-\x1f]/.test(value)&&!value.startsWith('/')&&value.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Invalid relative reconstruction path');return value;}
async function safe(root,relative){
  const resolved=path.resolve(root);check((await fs.realpath(resolved)).toLowerCase()===resolved.toLowerCase(),'Linked project/journal root is unsupported');
  let current=resolved;for(const part of rel(relative).split('/')){current=path.join(current,part);const stat=await fs.lstat(current);check(!stat.isSymbolicLink(),'Linked reconstruction path is unsupported');}
  return current;
}
async function read(root,relative){const name=await safe(root,relative),stat=await fs.stat(name);check(stat.isFile()&&stat.size<=MiB,'Source file too large or unsupported');return fs.readFile(name);}
function declarations(type){return {fullName:type.fullName,kind:type.kind,baseTypes:type.baseTypes,serializedFields:type.fields.filter(f=>f.serialized).map(f=>({name:f.name,type:f.type,serialized:true}))};}
// Preserve imports/class attributes and exact serialized declarations. The parser's
// field DTO alone cannot distinguish SerializeReference from SerializeField.
function declarationContext(source,names){
  const tokens=source.match(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|@"(?:""|[^"])*"|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|@?[\p{L}_][\p{L}\p{N}_]*|[^\s]/gu)?.filter(t=>!t.startsWith('//')&&!t.startsWith('/*'))??[];
  const start=tokens.findIndex(t=>t==='class'||t==='struct');check(start>=0,'Unsupported declaration context');
  let p=tokens.indexOf('{',start),segment=[],round=0,square=0,curly=0;const fields=[];
  for(p++;p<tokens.length;p++){
    const t=tokens[p];if(t==='}'&&!curly&&!round&&!square)break;
    if(t==='{'&&!curly&&!round&&!square&&!segment.includes('=')){
      let depth=1;while(++p<tokens.length&&depth){if(tokens[p]==='{')depth++;if(tokens[p]==='}')depth--;}
      p--;segment=[];continue;
    }
    if(t==='(')round++;if(t===')')round--;if(t==='[')square++;if(t===']')square--;if(t==='{')curly++;if(t==='}')curly--;
    segment.push(t);if(t===';'&&!round&&!square&&!curly){if(segment.some(v=>names.has(v.replace(/^@/,''))))fields.push(segment);segment=[];}
  }
  return {prefix:tokens.slice(0,start),fields};
}
function sameContext(before,after,declaration){const names=new Set(declaration.serializedFields.map(f=>f.name));check(fingerprint(declarationContext(before,names))===fingerprint(declarationContext(after,names)),'Replacement changes declaration context or serialized field attributes');}
function currentDeclaration(bytes,c){const parsed=parseCSharp(bytes.toString('utf8'),{fileName:path.posix.basename(c.path)});const {assembly,...expected}=c.identity;check(parsed.supported&&parsed.types.length===1&&fingerprint(declarations(parsed.types[0]))===fingerprint(expected),'Current source identity/field declarations do not match graph');sameContext(bytes.toString('utf8'),c.source,expected);}
function target(graph,scriptId){
  const matches=graph.assets.filter(a=>a.id===scriptId);check(matches.length===1,'Ambiguous or missing script identity');const a=matches[0];
  check(a.guid&&a.path.startsWith('Assets/')&&a.path.endsWith('.cs')&&!a.path.split('/').some(p=>p.toLowerCase()==='editor')&&a.script?.supported&&a.script.types?.length===1,'Unsupported, Editor, DLL or ambiguous script identity');
  check(a.script.assembly&&!/editor/i.test(a.script.assembly),'Editor assembly is unsupported');
  check(scriptBindings(graph,a).unresolvedBindings.length===0,'Unsupported or unresolved component script local fileID binding');
  check(graph.assets.filter(other=>other.script?.assembly===a.script.assembly&&other.script.types?.some(t=>t.fullName===a.script.types[0].fullName)).length===1,'Ambiguous exported assembly/full type identity');return a;
}
function candidate(graph,scriptId,source){
  check(typeof source==='string'&&Buffer.byteLength(source)>0&&Buffer.byteLength(source)<=MiB,'Invalid replacement source size');
  const asset=target(graph,scriptId),parsed=parseCSharp(source,{fileName:path.posix.basename(asset.path)});
  check(parsed.supported&&parsed.types.length===1,`Unsupported C# syntax/declaration: ${parsed.reason??parsed.limitations?.join(', ')??''}`);
  const before=declarations(asset.script.types[0]),after=declarations(parsed.types[0]);
  check(fingerprint(before)===fingerprint(after),'Replacement changes full type/base identity or serialized field declarations');
  return {asset,declaration:before};
}
function inventory(files){
  check(Array.isArray(files)&&files.length<=UNITY_PROJECT_LIMITS.maxFiles,'Invalid inventory');const seen=new Set();
  for(const f of files){shape(f,['path','sha256','size']);rel(f.path);check(!seen.has(f.path)&&Number.isSafeInteger(f.size)&&f.size>=0&&typeof f.sha256==='string'&&/^[a-f0-9]{64}$/.test(f.sha256),'Invalid inventory identity');seen.add(f.path);}
}
const payload=p=>{const {payloadSha256,...rest}=p;return fingerprint(rest);};
function changedFiles(plan){const replacements=new Map(plan.changes.map(c=>[c.path,c]));return plan.inventory.map(f=>replacements.has(f.path)?{...f,sha256:replacements.get(f.path).afterSha256,size:replacements.get(f.path).afterSize}:f);}

export async function createReconstructionPlan({projectDir,graph,scriptMap,request}){
  shape(request,['kind','schemaVersion','graphRevision','changes']);check(Buffer.byteLength(JSON.stringify(request))<=32*MiB,'Reconstruction request exceeds limit');
  check(request.kind==='retoolkit-reconstruction-request'&&request.schemaVersion===1&&request.graphRevision===graph.revision,'Invalid or stale reconstruction request revision');
  check(scriptMap?.kind==='retoolkit-script-map'&&scriptMap.graphRevision===graph.revision&&fingerprint(scriptMap.binding)===fingerprint(graph.binding),'Stale script map binding/revision');
  check(Array.isArray(request.changes)&&request.changes.length>0&&request.changes.length<=16,'Invalid reconstruction changes limit');
  await verifyGraphFiles(projectDir,graph);inventory(graph.files);const seen=new Set(),changes=[];
  for(const change of request.changes){
    shape(change,['scriptId','source','evidenceIds'],['scriptId','source']);check(typeof change.scriptId==='string'&&!seen.has(change.scriptId),'Duplicate or invalid script ID');seen.add(change.scriptId);
    const {asset,declaration}=candidate(graph,change.scriptId,change.source),mapped=scriptMap.scripts.find(s=>s.scriptId===asset.id);
    check(mapped,'Script is missing from map');const evidenceIds=change.evidenceIds??[];check(Array.isArray(evidenceIds)&&evidenceIds.length<=1000&&new Set(evidenceIds).size===evidenceIds.length&&evidenceIds.every(id=>typeof id==='string'&&mapped.evidence.some(e=>e.id===id)),'Unknown evidence IDs');
    const before=await read(projectDir,asset.path),metaPath=asset.path+'.meta',meta=await read(projectDir,metaPath);
    sameContext(before.toString('utf8'),change.source,declaration);
    check(fingerprint(declarations(parseCSharp(before.toString('utf8'),{fileName:path.posix.basename(asset.path)}).types[0]))===fingerprint(declaration),'Current source identity is unsupported');
    changes.push({scriptId:asset.id,path:asset.path,guid:asset.guid,identity:{assembly:asset.script.assembly,...declaration},source:change.source,beforeSha256:hash(before),beforeSize:before.length,afterSha256:hash(change.source),afterSize:Buffer.byteLength(change.source),meta:{path:metaPath,sha256:hash(meta),size:meta.length},evidenceIds});
  }
  const plan={kind:'retoolkit-reconstruction-plan',schemaVersion:1,operationId:randomUUID(),graphRevision:graph.revision,binding:structuredClone(graph.binding),inventory:structuredClone(graph.files),changes,compileReady:false,logic:'unverified'};
  return {...plan,payloadSha256:payload(plan)};
}
function validatePlan(plan,graph){
  check(Buffer.byteLength(JSON.stringify(plan))<=64*MiB,'Plan exceeds limit');shape(plan,['kind','schemaVersion','operationId','graphRevision','binding','inventory','changes','compileReady','logic','payloadSha256']);
  check(plan.kind==='retoolkit-reconstruction-plan'&&plan.schemaVersion===1&&uuid(plan.operationId)&&plan.compileReady===false&&plan.logic==='unverified'&&plan.payloadSha256===payload(plan),'Invalid plan payload/hash');
  check(plan.graphRevision===graph.revision&&fingerprint(plan.binding)===fingerprint(graph.binding),'Stale graph revision/binding','stale_graph');inventory(plan.inventory);
  check(fingerprint(plan.inventory)===fingerprint(graph.files),'Stale plan inventory','stale_graph');
  check(Array.isArray(plan.changes)&&plan.changes.length>0&&plan.changes.length<=16,'Invalid plan changes');const seen=new Set();
  for(const c of plan.changes){
    shape(c,['scriptId','path','guid','identity','source','beforeSha256','beforeSize','afterSha256','afterSize','meta','evidenceIds']);
    const {asset,declaration}=candidate(graph,c.scriptId,c.source);check(!seen.has(c.scriptId),'Duplicate plan script');seen.add(c.scriptId);
    check(c.path===asset.path&&c.guid===asset.guid&&fingerprint(c.identity)===fingerprint({assembly:asset.script.assembly,...declaration}),'Plan target identity changed');
    shape(c.meta,['path','sha256','size']);const before=graph.files.find(f=>f.path===c.path),meta=graph.files.find(f=>f.path===c.path+'.meta');
    check(before&&meta&&c.beforeSha256===before.sha256&&c.beforeSize===before.size&&c.meta.path===meta.path&&c.meta.sha256===meta.sha256&&c.meta.size===meta.size&&c.afterSha256===hash(c.source)&&c.afterSize===Buffer.byteLength(c.source),'Invalid plan source/meta hashes');
    check(Array.isArray(c.evidenceIds)&&c.evidenceIds.length<=1000&&c.evidenceIds.every(id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id)),'Invalid plan evidence IDs');
  }
}
function receiptFor(plan){const receipt={kind:'retoolkit-reconstruction-receipt',schemaVersion:1,operationId:plan.operationId,payloadSha256:plan.payloadSha256,graphRevision:plan.graphRevision,binding:plan.binding,files:changedFiles(plan),changes:plan.changes.map(c=>({scriptId:c.scriptId,path:c.path,sha256:c.afterSha256})),compileReady:false,logic:'unverified'};return {...receipt,receiptSha256:fingerprint(receipt)};}
function validateReceipt(receipt){
  shape(receipt,['kind','schemaVersion','operationId','payloadSha256','graphRevision','binding','files','changes','compileReady','logic','receiptSha256']);const {receiptSha256,...rest}=receipt;
  check(receipt.kind==='retoolkit-reconstruction-receipt'&&receipt.schemaVersion===1&&uuid(receipt.operationId)&&receipt.compileReady===false&&receipt.logic==='unverified'&&receiptSha256===fingerprint(rest),'Invalid reconstruction receipt');inventory(receipt.files);
}
async function syncDirectory(directory){try{const handle=await fs.open(directory,'r');try{await handle.sync();}finally{await handle.close();}}catch(error){if(!['EPERM','EACCES','EINVAL','ENOTSUP','EISDIR'].includes(error.code))throw error;}}
async function durableWrite(file,bytes,flag='w'){const handle=await fs.open(file,flag);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}await syncDirectory(path.dirname(file));}
async function atomicJournal(file,bytes){const temporary=file+'.new';await durableWrite(temporary,bytes);await fs.rename(temporary,file);await syncDirectory(path.dirname(file));}
/** Caller owns the workspace lease for this entire transaction and callbacks. */
export async function applyReconstructionPlan({projectDir,graph,plan,journalDir,onEvent=async()=>{}}){
  validatePlan(plan,graph);check(typeof journalDir==='string','Journal directory required');
  await fs.mkdir(journalDir,{recursive:true});await safe(journalDir,'.sentinel').catch(e=>{if(e.code!=='ENOENT')throw e;});
  const operationDir=path.join(journalDir,plan.operationId),receiptFile=path.join(operationDir,'receipt.json'),expectedReceipt=receiptFor(plan);
  try{
    const stat=await fs.lstat(operationDir);check(stat.isDirectory()&&!stat.isSymbolicLink(),'Unsafe reconstruction journal');
    let saved;try{saved=JSON.parse(await fs.readFile(receiptFile,'utf8'));}catch{check(false,'Incomplete reconstruction journal requires recovery','reconstruction_recovery_required');}
    validateReceipt(saved);check(fingerprint(saved)===fingerprint(expectedReceipt),'Repeated operation receipt does not match plan');
    const report=await verifyReconstruction({projectDir,receipt:saved});check(report.valid,'Repeated operation receipt files changed','stale_graph');return saved;
  }catch(error){if(error.code!=='ENOENT')throw error;}
  await verifyGraphFiles(projectDir,graph);await fs.mkdir(operationDir);const published=[],backups=new Map(),expected=structuredClone(graph.files);
  const event=async(phase,extra={})=>onEvent({phase,operationId:plan.operationId,...extra});
  const journal={kind:'retoolkit-reconstruction-journal',schemaVersion:1,operationId:plan.operationId,payloadSha256:plan.payloadSha256,state:'staging',published:[]};
  const save=()=>atomicJournal(path.join(operationDir,'journal.json'),JSON.stringify(journal,null,2));
  try{
    await durableWrite(path.join(operationDir,'plan.json'),JSON.stringify(plan),'wx');await save();
    for(const [index,c] of plan.changes.entries()){
      const bytes=await read(projectDir,c.path);check(hash(bytes)===c.beforeSha256,'Source changed before staging','stale_graph');backups.set(c.path,bytes);
      currentDeclaration(bytes,c);
      await durableWrite(path.join(operationDir,`${index}.before`),bytes,'wx');await durableWrite(path.join(operationDir,`${index}.stage`),c.source,'wx');
    }
    journal.state='staged';await save();await event('staged');await verifyGraphFiles(projectDir,{...graph,files:expected});
    for(const [index,c] of plan.changes.entries()){
      await event('before-publish',{path:c.path,index});await verifyGraphFiles(projectDir,{...graph,files:expected});
      const destination=await safe(projectDir,c.path),staged=path.join(operationDir,`${index}.stage`);
      check(hash(await fs.readFile(staged))===c.afterSha256,'Staged source changed');
      // A sibling temporary supports same-volume atomic replacement across journal volumes.
      const sibling=path.join(path.dirname(destination),`.retk-${plan.operationId}-${index}.tmp`);
      await durableWrite(sibling,await fs.readFile(staged),'wx');try{check(hash(await fs.readFile(destination))===c.beforeSha256,'Source changed before publication','stale_graph');await fs.rename(sibling,destination);published.push(c);await syncDirectory(path.dirname(destination));}finally{await fs.rm(sibling,{force:true});}
      Object.assign(expected.find(f=>f.path===c.path),{sha256:c.afterSha256,size:c.afterSize});
      journal.published.push(c.path);journal.state='publishing';await save();await event('published',{path:c.path,index});
    }
    await verifyGraphFiles(projectDir,{...graph,files:expected});await event('before-receipt');
    await verifyGraphFiles(projectDir,{...graph,files:expected});journal.state='complete';await save();await durableWrite(receiptFile,JSON.stringify(expectedReceipt,null,2),'wx');return expectedReceipt;
  }catch(error){
    let uncertain=false;
    for(const c of published.toReversed())try{
      const destination=await safe(projectDir,c.path),bytes=await fs.readFile(destination);
      if(hash(bytes)===c.beforeSha256)continue;
      if(hash(bytes)!==c.afterSha256){uncertain=true;continue;}
      const original=backups.get(c.path);check(original&&hash(original)===c.beforeSha256,'Backup changed');
      const sibling=destination+`.retk-${plan.operationId}.rollback`;await durableWrite(sibling,original,'wx');
      try{check(hash(await fs.readFile(destination))===c.afterSha256,'Published source externally changed');await fs.rename(sibling,destination);await syncDirectory(path.dirname(destination));}finally{await fs.rm(sibling,{force:true});}
    }catch{uncertain=true;}
    journal.state=uncertain?'recovery-required':'rolled-back';journal.error=String(error.message).slice(0,2000);try{await save();}catch{uncertain=true;}
    if(uncertain)throw Object.assign(new Error('Reconstruction rollback is uncertain; preserve workspace ownership and journal for recovery'),{code:'reconstruction_recovery_required',cause:error});
    throw error;
  }
}

export async function verifyReconstruction({projectDir,receipt}){
  validateReceipt(receipt);try{await verifyGraphFiles(projectDir,{files:receipt.files});return {valid:true,operationId:receipt.operationId,compileReady:false,logic:'unverified'};}
  catch(error){return {valid:false,operationId:receipt.operationId,compileReady:false,logic:'unverified',reason:error.message};}
}
