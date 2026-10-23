import {createHash} from 'node:crypto';
import {fingerprint} from '../state.js';
import {validateEvidence} from '../evidence-schema.js';
import {dumpImageRanges} from './dump-images.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
const check=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'reconstruction_invalid'});};
const sameBuild=(a,b)=>['native','metadata'].every(k=>a?.[k]?.sha256===b?.[k]?.sha256&&Number.isSafeInteger(a?.[k]?.size)&&a[k].size===b?.[k]?.size);

export function initializationDeclarations(change){
 const values=change.constructors;
 check(Array.isArray(values)&&values.length>0&&values.length<=32,'Initialization requires 1..32 explicit constructor declarations');
 const seen=new Set();
 for(const value of values){
  check(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===3&&typeof value.fullName==='string'&&value.fullName.length>0&&value.fullName.length<=2048&&['static','instance'].includes(value.kind)&&typeof value.evidenceId==='string'&&/^[a-f0-9]{64}$/.test(value.evidenceId),'Invalid constructor declaration; expected fullName, kind and evidenceId only');
  const key=value.fullName+'\0'+value.kind;check(!seen.has(key),'Duplicate constructor declaration');seen.add(key);
 }
 return values;
}

/** Il2CppDumper emits dotted nested names and explicit .ctor/.cctor methods.
 * No name/pseudocode inference or request-supplied address authorizes a change. */
function dumpConstructors(text,images){
 images=[...images].sort((a,b)=>a.start-b.start);
 const types=[];let namespace='',type=null,rva=null;
 for(const line of text.split(/\r?\n/)){
  const ns=line.match(/^\/\/ Namespace:\s*(.*)$/);if(ns){namespace=ns[1].trim();type=null;rva=null;}
  if(/\b(?:class|struct|enum|interface)\b.*\/\/ TypeDefIndex:/.test(line)){type=null;rva=null;}
  const cls=line.match(/^\s*(?:(?:public|private|internal|protected|abstract|sealed|static|partial)\s+)*(class|struct|enum|interface)\s+([^\s:{]+)[^\r\n]*\/\/ TypeDefIndex:\s*(\d+)\s*$/);
  if(cls&&!/[<>`]/.test(cls[2])){const typeDefIndex=Number(cls[3]),ranges=images.filter((i,index)=>i.start<=typeDefIndex&&typeDefIndex<(i.count===undefined?(images[index+1]?.start??Infinity):i.start+i.count)),assembly=ranges.length===1?ranges[0].assembly:null;type={assembly,fullName:namespace?namespace+'.'+cls[2]:cls[2],typeDefIndex,kind:cls[1],constructors:[]};types.push(type);rva=null;}
  const address=line.match(/^\s*\/\/ RVA:\s*(0x[0-9a-fA-F]+)\b/);if(address)rva=address[1];
  // Any following method consumes the RVA so an unrelated declaration cannot
  // leave a stale method address attached to a constructor.
  if(type&&!line.trimStart().startsWith('//')&&line.includes('(')){
   const ctor=line.match(/^\s*((?:(?:public|private|internal|protected|static|extern|unsafe)\s+)*)void\s+(\.cctor|\.ctor)\s*\(([^)]*)\)\s*\{/);
   if(ctor)type.constructors.push({kind:ctor[2]==='.cctor'?'static':'instance',parameterless:ctor[3].trim()==='',rva,signature:line.trim().replace(/\s*\{.*$/,''),modifiers:ctor[1].trim().split(/\s+/).filter(Boolean)});
   rva=null;
  }
 }
 return types;
}
function address(value){const parts=value.split(':');return {space:parts.length===2?parts[0]:null,value:BigInt(parts.at(-1))};}
function observedConstructor(value,graph,metadata){
 const selected=graph.binding.programIdentity??graph.binding;
 check(selected.program&&selected.projectName,'Initialization evidence requires the exact selected Program identity');
 validateEvidence(value,{build:graph.binding,program:selected.program,projectName:selected.projectName});
 for(const key of ['programPath','imageBase','language','compiler','addressSpace','ghidraVersion'])if(selected[key]!==undefined)check(value.programIdentity[key]===selected[key],'Initialization evidence selected Program identity mismatch');
 check(value.query.method==='functions.decompile'&&!value.query.params.cursor&&value.result.nextCursor===null&&value.coverage.state==='observed'&&value.result.items.length>0,'Initialization requires a complete observed native function envelope');
 const base=address(value.programIdentity.imageBase),actual=address(value.result.address),expected=base.value+BigInt(metadata.rva);
 check(actual.space===base.space&&expected<=0xffffffffffffffffn&&actual.value===expected,'Native constructor evidence is not at exact imageBase + metadata RVA');
}

export function proveInitialization({change,before,after,originalSource,assembly,graph,dump,evidence=[]}){
 const declarations=initializationDeclarations(change);
 check(before.supported&&after.supported,'Initialization requires supported exact Roslyn syntax');
 check(fingerprint(before.types)===fingerprint(after.types),'Initialization changes existing type declarations');
 check(before.tokenSha256===after.initializationSha256,'Initialization changes existing declaration, body or field initializer tokens');
 check(after.constructors.length===before.constructors.length+declarations.length,'Initialization must add only the declared constructors');
 check(dump?.verified===true&&typeof dump.text==='string'&&Buffer.byteLength(dump.text)<=128*1024**2&&sha(dump.text)===dump.sha256&&sameBuild(dump.build,graph.binding),'Initialization requires a fresh same-build verified dump');
 check(Array.isArray(evidence)&&evidence.length<=10000,'Invalid native evidence inventory');
 const types=dumpConstructors(dump.text,dumpImageRanges(dump)),proof=[];
 for(const declaration of declarations){
  const type=before.types.find(t=>t.fullName===declaration.fullName);
  check(type?.kind==='class','Initialization target must be an existing nonpartial class');
  check(!before.constructors.some(c=>c.fullName===declaration.fullName&&c.kind===declaration.kind&&c.parameterCount===0),'Requested constructor already exists');
  const additions=after.constructors.filter(c=>c.fullName===declaration.fullName&&c.kind===declaration.kind&&c.parameterCount===0);
  check(additions.length===1&&additions[0].eligible,'Only parameterless block constructors without attributes or base/this initializers are supported');
  const matches=types.filter(t=>t.assembly===assembly&&t.kind==='class'&&t.fullName===declaration.fullName.replace(/\+/g,'.'));
  check(matches.length===1,'Missing or ambiguous exact assembly/type constructor metadata');
  const constructors=matches[0].constructors.filter(c=>c.kind===declaration.kind&&c.parameterless);
  check(constructors.length===1&&constructors[0].rva&&BigInt(constructors[0].rva)>0n,'Missing or ambiguous native parameterless constructor metadata RVA');
  const native=constructors[0];check(native.modifiers.includes('static')===(declaration.kind==='static'),'Native constructor static signature mismatch');
  const access=native.modifiers.filter(m=>['public','private','protected','internal'].includes(m)).sort().join(' ')||'private';
  check(additions[0].accessibility===access,'Added constructor accessibility differs from same-build native metadata');
  const metadata={assembly,fullName:matches[0].fullName,typeDefIndex:matches[0].typeDefIndex,kind:native.kind,rva:native.rva,signature:native.signature};
  const envelopes=evidence.filter(value=>fingerprint(value)===declaration.evidenceId);
  check(envelopes.length===1,'Missing or ambiguous exact native constructor evidence ID');observedConstructor(envelopes[0],graph,metadata);
  proof.push({...declaration,metadata,evidence:structuredClone(envelopes[0])});
 }
 const result={kind:'retoolkit-initialization-proof',schemaVersion:1,originalSource,originalTokenSha256:before.tokenSha256,dump:{sha256:dump.sha256,build:structuredClone({native:dump.build.native,metadata:dump.build.metadata}),imageRangesSha256:dump.imageRanges?fingerprint(dump.imageRanges):null},constructors:proof};
 check(Buffer.byteLength(JSON.stringify(result))<=4*1024**2,'Initialization proof exceeds 4 MiB');return result;
}
