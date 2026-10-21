import {createHash} from 'node:crypto';
import {fingerprint} from '../state.js';
import {validateEvidence} from '../evidence-schema.js';
import {verifyGraphFiles} from '../assets/graph.js';
import {scriptBindings} from './bindings.js';

const sha = value => createHash('sha256').update(value).digest('hex');
const fail = message => {throw Object.assign(new Error(message),{code:'reconstruction_invalid'});};
function sameBuild(a,b){return ['native','metadata'].every(k=>a?.[k]?.sha256===b?.[k]?.sha256&&Number.isSafeInteger(a?.[k]?.size)&&a[k].size===b?.[k]?.size);}
function dumpTypes(text){
  const images=[...text.matchAll(/^\/\/ Image \d+: (.+?)\.dll - (\d+)\s*$/gm)].map(m=>({assembly:m[1],start:Number(m[2])})).sort((a,b)=>a.start-b.start);
  const types=[];let namespace='',type=null,rva=null;
  for(const line of text.split(/\r?\n/)){
    const ns=line.match(/^\/\/ Namespace:\s*(.*)$/);if(ns){namespace=ns[1].trim();type=null;}
    const cls=line.match(/^\s*(?:public|private|internal|protected|abstract|sealed|static|partial|\s)*\b(class|struct|enum|interface)\s+([\w`]+)[^\r\n]*\/\/ TypeDefIndex:\s*(\d+)/);
    if(cls){const index=Number(cls[3]),image=images.findLast(i=>i.start<=index);type={assembly:image?.assembly??null,fullName:namespace?`${namespace}.${cls[2]}`:cls[2],methods:[]};types.push(type);rva=null;}
    const address=line.match(/\/\/ RVA:\s*(0x[0-9a-fA-F]+)/);if(address)rva=address[1];
    const method=line.match(/^\s*(?!\/\/)(?:[\w.<>,?\[\]]+\s+)+([\w]+)\s*\(([^)]*)\)/);
    if(type&&method){type.methods.push({name:method[1],signature:line.trim().replace(/\s*\{.*$/,''),rva,provenance:'il2cpp-metadata-declaration'});rva=null;}
  }
  return types;
}

/** Metadata declarations and observed native pseudocode are separate evidence. */
export async function buildScriptMap(graph,{projectDir,dump,evidence=[],scriptIds}={}){
  if(graph?.kind!=='retoolkit-asset-graph'||graph.schemaVersion!==1)fail('Invalid asset graph');
  if(projectDir)await verifyGraphFiles(projectDir,graph);
  if(!Array.isArray(evidence)||evidence.length>10000)fail('Invalid evidence list');
  let metadata=[],verified=false;
  if(dump){
    if(typeof dump.text!=='string'||Buffer.byteLength(dump.text)>128*1024*1024||sha(dump.text)!==dump.sha256)fail('Invalid dump text/hash');
    verified=dump.verified===true&&sameBuild(dump.build,graph.binding);
    if(dump.verified===true&&!verified)fail('Dump build binding does not match graph');
    if(verified)metadata=dumpTypes(dump.text);
  }
  const selected=graph.binding.programIdentity??graph.binding;
  const observed=evidence.map(value=>{
    if(!selected.program||!selected.projectName)fail('Evidence requires exact selected Program identity');
    validateEvidence(value,{build:graph.binding,program:selected.program,projectName:selected.projectName});
    if(selected.programPath&&value.programIdentity.programPath!==selected.programPath)fail('Evidence selected Program path mismatch');
    return {id:fingerprint(value),value};
  });
  if(scriptIds!==undefined&&(!Array.isArray(scriptIds)||scriptIds.length>1000||scriptIds.some(id=>typeof id!=='string')))fail('Invalid script scope');
  const scripts=graph.assets.filter(a=>(a.script||/\.(?:cs|dll)$/i.test(a.path))&&(!scriptIds||scriptIds.includes(a.id))).map(asset=>{
    const info=asset.script,types=info?.types??[],type=types.length===1?types[0]:null;
    const identity={assembly:info?.assembly??null,fullName:type?.fullName??null};
    const duplicateIdentity=type&&graph.assets.filter(a=>a.script?.assembly===identity.assembly&&a.script.types?.some(t=>t.fullName===identity.fullName)).length>1;
    const candidates=metadata.filter(t=>t.assembly===identity.assembly&&t.fullName===identity.fullName);
    const match=candidates.length===1?candidates[0]:null;
    const {components,unresolvedBindings}=scriptBindings(graph,asset);
    const methods=(match?.methods??[]).map(method=>{
      const matches=observed.filter(({value:e})=>{
        if(e.query.method!=='functions.decompile'||!method.rva)return false;
        try{return BigInt(e.result.address.split(':').at(-1))===BigInt(e.programIdentity.imageBase.split(':').at(-1))+BigInt(method.rva);}catch{return false;}
      }).map(({id,value})=>({id,kind:'native-pseudocode',runId:value.runId,revision:value.revision,programIdentity:value.programIdentity,query:value.query}));
      return {...method,evidence:matches};
    });
    return {scriptId:asset.id,guid:asset.guid,path:asset.path,identity,components,unresolvedBindings,serializedFields:(type?.fields??[]).filter(f=>f.serialized),state:{identity:!asset.guid?'opaque':types.length>1||duplicateIdentity?'ambiguous':!info?.supported||!type?'unsupported':'resolved',bindings:unresolvedBindings.length?'unresolved':components.length?'resolved':'unreferenced',metadata:!verified?'unverified':candidates.length>1?'ambiguous':match?'matched':'unmatched',logic:'unverified',source:'exported-stub'},methods,evidence:methods.flatMap(m=>m.evidence),limitations:[...info?.limitations??[],...(unresolvedBindings.length?['Unresolved local fileID script bindings prevent source replacement']:[]),...(!asset.path.endsWith('.cs')?['DLL replacement requires a separate migration']:[])]};
  });
  return {kind:'retoolkit-script-map',schemaVersion:1,graphRevision:graph.revision,binding:structuredClone(graph.binding),scripts,limitations:['Native pseudocode is untrusted evidence, not original C# source.','Compilation and behavior have not been verified.']};
}
