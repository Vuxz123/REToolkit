import {createHash} from 'node:crypto';
import {fingerprint} from '../state.js';
import {validateEvidence} from '../evidence-schema.js';
import {dumpEventDefinitions} from './dump-events.js';
import {dumpImageRanges} from './dump-images.js';
const sha=value=>createHash('sha256').update(value).digest('hex');
const check=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{code:'reconstruction_invalid'});};
const sameBuild=(a,b)=>['native','metadata'].every(k=>a?.[k]?.sha256===b?.[k]?.sha256&&Number.isSafeInteger(a?.[k]?.size)&&a[k].size===b?.[k]?.size);
const compact=s=>s.replace(/\s+/g,'');
const cg=attrs=>attrs.filter(a=>a==='CompilerGenerated'||a==='CompilerGeneratedAttribute'||a==='System.Runtime.CompilerServices.CompilerGenerated'||a==='System.Runtime.CompilerServices.CompilerGeneratedAttribute').length===1;
export function eventStorageDeclarations(change){
 const values=change.events;check(Array.isArray(values)&&values.length>0&&values.length<=32,'Event storage requires 1..32 explicit event declarations');const seen=new Set();
 for(const value of values){check(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===4&&typeof value.fullName==='string'&&value.fullName.length>0&&value.fullName.length<=2048&&typeof value.name==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,511}$/.test(value.name)&&['addEvidenceId','removeEvidenceId'].every(k=>typeof value[k]==='string'&&/^[a-f0-9]{64}$/.test(value[k])),'Invalid event declaration; expected fullName, name, addEvidenceId and removeEvidenceId only');const key=value.fullName+'\0'+value.name;check(!seen.has(key),'Duplicate event declaration');seen.add(key);}
 return values;
}
// Deliberately narrow Il2CppDumper grammar. No invented offsets, association or
// type aliases. Unknown/extra attributes and non-exact signatures fail closed.
function metadataTypes(dump){
 const images=dumpImageRanges(dump).sort((a,b)=>a.start-b.start),types=[];let namespace='',type=null,attrs=[],rva=null,section=null;
 for(const raw of dump.text.split(/\r?\n/)){
  const line=raw.trim(),ns=line.match(/^\/\/ Namespace:\s*(.*)$/);if(ns){namespace=ns[1];type=null;attrs=[];rva=null;section=null;continue;}
  if(/\b(?:class|struct|enum|interface)\b.*\/\/ TypeDefIndex:/.test(line)){
   type=null;attrs=[];rva=null;section=null;
   const m=line.match(/^(?:(?:public|internal|private|protected|sealed|static|abstract)\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*[A-Za-z_][A-Za-z0-9_.,<> \[\]]*)?\s+\/\/ TypeDefIndex:\s*(\d+)$/);
   if(m){const index=Number(m[2]),matches=images.filter((i,n)=>i.start<=index&&index<(i.count===undefined?(images[n+1]?.start??Infinity):i.start+i.count));type={fullName:namespace?namespace+'.'+m[1]:m[1],typeDefIndex:index,assembly:matches.length===1?matches[0].assembly:null,fields:[],accessors:[]};types.push(type);}continue;
  }
  if(!type)continue;
  const part=line.match(/^\/\/ (Fields|Methods|Properties|Events)$/);if(part){section=part[1];attrs=[];rva=null;continue;}
  const attribute=line.match(/^\[([^\]]+)\]$/);if(attribute){attrs.push(compact(attribute[1]));continue;}
  const addr=line.match(/^\/\/ RVA:\s*(0x[0-9a-fA-F]+)\b/);if(addr){rva=addr[1];continue;}
  if(!line||line==='{'||line==='}'||line.startsWith('//'))continue;
  if(section==='Fields'){
   const m=line.match(/^private\s+(static\s+)?(.+?)\s+([A-Za-z_][A-Za-z0-9_]*);\s*\/\/\s*(0x[0-9a-fA-F]+)$/);
   if(m)type.fields.push({name:m[3],type:compact(m[2]),isStatic:!!m[1],offset:m[4],attributes:attrs,compilerGenerated:cg(attrs),nonserialized:attrs.every(a=>cg([a])||a==='DebuggerBrowsable(0)'||a==='System.Diagnostics.DebuggerBrowsable(0)')});
  }else if(section==='Methods'){
   const m=line.match(/^((?:(?:public|private|protected|internal|static)\s+)*)void\s+(add|remove)_([A-Za-z_][A-Za-z0-9_]*)\((.+)\s+value\)\s*\{\s*\}$/);
   if(m){const mods=m[1].trim().split(/\s+/);type.accessors.push({name:m[2]+'_'+m[3],event:m[3],kind:m[2],type:compact(m[4]),isStatic:mods.includes('static'),accessibility:mods.filter(m=>['public','private','protected','internal'].includes(m)).sort().join(' ')||'private',rva,attributes:attrs,compilerGenerated:cg(attrs)&&attrs.length===1,signature:line.replace(/\s*\{.*$/,'')});}
  }
  attrs=[];rva=null;
 }
 return types;
}
function address(s){const parts=s.split(':');return {space:parts.length===2?parts[0]:'ram',value:BigInt(parts.at(-1))};}
function observedAccessor(value,graph,metadata,dump){
 const selected=graph.binding.programIdentity??graph.binding;check(selected.program&&selected.projectName,'Event storage evidence requires exact selected Program identity');validateEvidence(value,{build:graph.binding,program:selected.program,projectName:selected.projectName});
 for(const key of ['programPath','imageBase','language','compiler','addressSpace','ghidraVersion'])if(selected[key]!==undefined)check(value.programIdentity[key]===selected[key],'Event storage selected Program identity mismatch');
 check(!value.query.params.cursor&&value.result.nextCursor===null&&value.coverage.state==='observed'&&value.result.items.length>0,'Event storage requires a complete observed native accessor envelope');
 const bounded=value.query.method==='instructions.list';check(bounded||value.query.method==='functions.decompile','Unsupported native accessor evidence');
 const base=address(value.programIdentity.imageBase),actual=address(bounded?value.query.params.address:value.result.address),expected=base.value+BigInt(metadata.rva);check(actual.space===base.space&&expected<=0xffffffffffffffffn&&actual.value===expected,'Native accessor evidence is not at exact imageBase + metadata RVA');
 if(!bounded)return null;
 check(value.programIdentity.language==='AARCH64:LE:64:v8A'&&expected%4n===0n,'Bounded event observations require aligned AArch64 instructions');
 // The next dump RVA bounds observation only. It does not establish native
 // ownership, closed control flow, exception behavior or field-use semantics.
 const rvas=[...dump.text.matchAll(/^\s*\/\/ RVA:\s*(0x[0-9a-fA-F]+)\b/gm)].map(m=>BigInt(m[1])).filter(r=>r>BigInt(metadata.rva));
 check(rvas.length>0,'Bounded accessor needs the next verified dump RVA');const next=rvas.reduce((a,b)=>a<b?a:b),end=address(value.query.params.endAddress);
 check(end.space===base.space&&end.value+1n===base.value+next&&end.value>=expected&&end.value-expected<4096n,'Bounded accessor must stop exactly before the next verified dump RVA');
 let cursor=expected;for(const row of value.result.items){const a=address(row.address);check(a.space===base.space&&a.value===cursor&&row.length===4,'Bounded accessor instructions must cover the entire exact window without gaps');cursor+=4n;}
 check(cursor===end.value+1n,'Bounded accessor instruction coverage is incomplete');
 return {kind:'bounded-instructions',address:value.query.params.address,endAddress:value.query.params.endAddress,instructionCount:value.result.items.length,controlFlowComplete:false,semantics:'requires-independent-review'};
}
export function proveEventStorage({change,before,after,originalSource,assembly,graph,dump,evidence=[]}){
 const declarations=eventStorageDeclarations(change);check(before.supported&&after.supported,'Event storage requires supported exact Roslyn syntax');check(fingerprint(before.types)===fingerprint(after.types),'Event storage changes existing type declarations');check(before.eventStorageSha256===after.eventStorageSha256&&typeof before.eventStorageSha256==='string','Event storage changes other declaration, body or initializer tokens');
 check(!/\busing\s+(?:[A-Za-z_]\w*\s*=|static\b)/.test(originalSource),'Event storage does not support source type aliases or static imports');
 check(dump?.verified===true&&typeof dump.text==='string'&&Buffer.byteLength(dump.text)<=128*1024**2&&sha(dump.text)===dump.sha256&&sameBuild(dump.build,graph.binding),'Event storage requires a fresh same-build verified dump');check(Array.isArray(evidence)&&evidence.length<=10000,'Invalid native evidence inventory');
 check(before.eventStorageCompilerFixture?.kind==='source-owned-event-storage-compiler-fixture'&&fingerprint(before.eventStorageCompilerFixture)===fingerprint(after.eventStorageCompilerFixture),'Missing or changed bundled compiler event storage fixture');
 const raw=dumpEventDefinitions(dump),types=metadataTypes(dump),proof=[];
 for(const d of declarations){
  const sourceType=before.types.find(t=>t.fullName===d.fullName);check(sourceType?.kind==='class'&&sourceType.arity===0&&sourceType.topLevel,'Event storage target must be a top-level nongeneric nonpartial class');
  const old=before.events.filter(e=>e.fullName===d.fullName&&e.name===d.name),next=after.events.filter(e=>e.fullName===d.fullName&&e.name===d.name);check(old.length===1&&next.length===1&&old[0].eligible&&next[0].eligible&&old[0].form==='custom'&&next[0].form==='field','Only selected empty compiler-generated custom events may become single field-like events');
  const matches=types.filter(t=>t.assembly===assembly&&t.fullName===d.fullName);check(matches.length===1,'Missing or ambiguous exact assembly/type event metadata');const type=matches[0],rawTypes=raw.types.filter(t=>t.assembly===assembly&&t.fullName===d.fullName&&t.typeDefIndex===type.typeDefIndex);check(rawTypes.length===1&&rawTypes[0].declaringTypeIndex===-1&&rawTypes[0].genericContainerIndex===-1,'Missing, generic, nested or ambiguous exact raw event declaring type');const rawEvents=rawTypes[0].events.filter(e=>e.name===d.name);check(rawEvents.length===1&&rawEvents[0].fields.length===1,'Missing or ambiguous raw event or field identity');const rawEvent=rawEvents[0];check(rawEvent.raiseRelativeIndex===-1,'Standard field-like events cannot have a raw raise method');const fields=type.fields.filter(f=>f.name===d.name);check(fields.length===1,'Missing or ambiguous private event delegate field');const field=fields[0];
  check(field.compilerGenerated&&field.nonserialized&&field.type===old[0].type&&field.isStatic===old[0].isStatic&&/^(?:System\.)?Action(?:<.+>)?$/.test(field.type),'Native event field must be private CompilerGenerated nonserialized exact Action delegate type/static signature');
  const accessors={};for(const kind of ['add','remove']){const values=type.accessors.filter(a=>a.event===d.name&&a.kind===kind);check(values.length===1,'Missing or ambiguous event accessor metadata');const a=values[0];check(a.compilerGenerated&&a.type===field.type&&a.isStatic===field.isStatic&&a.accessibility===old[0].accessibility&&a.rva&&BigInt(a.rva)>0n,'Native event accessor compiler-generated/type/static/accessibility signature mismatch');accessors[kind]=a;}
  check(BigInt(accessors.add.rva)!==BigInt(accessors.remove.rva),'Event accessor RVAs must be distinct');
  for(const kind of ['add','remove']){const a=rawEvent[kind],native=accessors[kind];check(a&&a.name===kind+'_'+d.name&&a.declaringTypeIndex===type.typeDefIndex&&a.parameterCount===1&&a.genericContainerIndex===-1&&a.isStatic===native.isStatic&&a.accessibility===native.accessibility,'Raw event accessor identity/static/accessibility/arity mismatch');}check(rawEvent.add.methodIndex!==rawEvent.remove.methodIndex,'Raw event accessors must be distinct');
  const metadata={assembly,fullName:type.fullName,typeDefIndex:type.typeDefIndex,raw:rawEvent,field,add:accessors.add,remove:accessors.remove};const envelopes={};for(const kind of ['add','remove']){const list=evidence.filter(e=>fingerprint(e)===d[kind+'EvidenceId']);check(list.length===1,'Missing or ambiguous exact native event accessor evidence ID');const observation=observedAccessor(list[0],graph,accessors[kind],dump);if(observation)envelopes[kind+'Observation']=observation;envelopes[kind+'Evidence']=structuredClone(list[0]);}
  proof.push({...d,metadata,...envelopes});
 }
 const result={kind:'retoolkit-event-storage-proof',schemaVersion:1,originalSource,originalTokenSha256:before.tokenSha256,normalizedTokenSha256:before.eventStorageSha256,dump:{sha256:dump.sha256,build:structuredClone({native:dump.build.native,metadata:dump.build.metadata}),imageRangesSha256:dump.imageRanges?fingerprint(dump.imageRanges):null},rawEventDefinitionsSha256:fingerprint(raw),nativeTypeIndexEquivalence:'not-derived;delegate-signatures-from-verified-dump',events:proof,compilerFixture:structuredClone(before.eventStorageCompilerFixture),nativeFieldUse:'requires-independent-review',limitations:['Raw event/field/parameter type indices are recorded distinctly; their semantic equivalence is not derived. Delegate signatures are checked against the verified dump.','Metadata field/accessor name and signature association does not prove native field use or Combine/Remove/CompareExchange semantics.','Complete decompile envelopes are untrusted observations; independent native field-use review and exact-candidate Unity compilation/behavior qualification remain required.']};check(Buffer.byteLength(JSON.stringify(result))<=4*1024**2,'Event storage proof exceeds 4 MiB');return result;
}
