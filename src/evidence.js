import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileIdentity} from './state.js';
import {querySession} from './ghidra/provider.js';
import {artifactError,externalOutput,publishJson} from './artifacts.js';
import {validateEvidence} from './evidence-schema.js';

const identity=file=>{const {size,sha256}=fileIdentity(file);return {size,sha256};};
const address=/^(?:[A-Za-z_][\w.-]*:)?0x[0-9a-fA-F]+$/;
function selectedBuild(project){
  if(!project.nativeBinary||!project.metadata)throw artifactError('input_missing','Scan selected native and metadata before collecting evidence');
  const build={native:{...identity(project.nativeBinary),abi:project.identities.native?.abi??'unknown'},metadata:identity(project.metadata)};
  if(build.native.sha256!==project.identities.native?.sha256||build.metadata.sha256!==project.identities.metadata?.sha256)throw artifactError('input_changed','Selected inputs changed; scan/import the matching build');
  return build;
}
export async function captureEvidence(toolkit,name,{kind,selector,endAddress,direction='to',limit=100,out},{query=querySession}={}){
  const project=toolkit.read(name);const folder=externalOutput(toolkit,out??path.join(toolkit.root,'exports/evidence',name));
  if(!Number.isInteger(limit)||limit<1||limit>1000)throw artifactError('invalid_argument','Evidence limit must be 1..1000');
  let method,params;
  if(kind==='decompile'){if(typeof selector!=='string'||!selector)throw artifactError('invalid_argument','Decompile requires a selector');method='functions.decompile';params={selector,limit};}
  else if(kind==='xrefs'){if(!address.test(selector??'')||!['to','from'].includes(direction))throw artifactError('invalid_argument','Xrefs require a hex address and direction to|from');method='references.list';params={address:selector,direction,limit};}
  else if(kind==='functions'){method='functions.list';params={limit,...(selector?{query:selector}:{})};}
  else if(kind==='instructions'){
    if(!address.test(selector??'')||!address.test(endAddress??''))throw artifactError('invalid_argument','Instruction evidence requires exact --selector and --end-address');
    const parse=v=>{const p=v.split(':');return {space:p.length===2?p[0]:'ram',value:BigInt(p.at(-1))};},a=parse(selector),b=parse(endAddress);
    if(a.space!==b.space||b.value<a.value||b.value-a.value>=65536n)throw artifactError('invalid_argument','Instruction evidence requires an inclusive range of 1..65536 bytes');
    method='instructions.list';params={address:selector,endAddress,limit};
  }
  else throw artifactError('invalid_argument','Evidence kind must be decompile|xrefs|functions|instructions');
  if(kind!=='instructions'&&endAddress!==undefined)throw artifactError('invalid_argument','endAddress is only supported for instruction evidence');
  const build=selectedBuild(project);
  const response=await query(toolkit,name,method,params);
  if(response?.ok!==true||!response.result||!Number.isSafeInteger(response.revision)||response.revision<0||
    !/^[a-f0-9-]{36}$/i.test(response.runId??'')||response.programIdentity?.sha256!==build.native.sha256||
    response.programIdentity?.program!==project.ghidraProgramName||response.programIdentity?.projectName!==project.ghidraProjectName)
    throw artifactError('program_mismatch','Evidence response did not prove the selected Program/input binding');
  const after=selectedBuild(project);
  if(after.native.sha256!==build.native.sha256||after.metadata.sha256!==build.metadata.sha256)throw artifactError('input_changed','Inputs changed while evidence was collected');
  const programIdentity=Object.fromEntries(['program','programPath','projectName','sha256','imageBase','language','compiler','addressSpace','ghidraVersion','analysisStatus'].filter(key=>response.programIdentity[key]!==undefined).map(key=>[key,response.programIdentity[key]]));
  const evidence={kind:'retoolkit-evidence',schemaVersion:1,query:{method,params},build,programIdentity,
    runId:response.runId,revision:response.revision,collectedAt:new Date().toISOString(),result:response.result,
    coverage:{state:response.result.nextCursor?'partial':'observed',source:'loaded-program',
      explanation:response.result.nextCursor?'More results are available through a session-bound cursor':'Only this query was observed; analysis completeness is not inferred'},
    limitations:[...(response.limitations??[]),'Pseudocode is reconstructed output, not original source','Evidence is tied to the recorded run/revision'],dataTrust:'untrusted-target-content'};
  validateEvidence(evidence,{build,program:project.ghidraProgramName,projectName:project.ghidraProjectName});
  const file=path.join(folder,`${kind}-${randomUUID()}.json`);publishJson(file,evidence,{maxBytes:4*1024*1024});
  return {path:file,evidence};
}
