import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import YAML from 'yaml';
import {fingerprint} from '../state.js';
import {assertAssetPath} from '../assets/context.js';
import {verifyGraphFiles} from '../assets/graph.js';

const hash=v=>createHash('sha256').update(v).digest('hex'),MiB=1024**2;
const id=/^-?(?:0|[1-9]\d*)$/,guid=/^[a-f0-9]{32}$/;
const scalarTypes=new Set(['Integer','Boolean','Float','String','Enum','ObjectReference']);
function check(ok,message,code='migration_invalid'){if(!ok)throw Object.assign(Error(message),{code});}
function shape(v,keys,required=keys){check(v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v))&&Object.keys(v).every(k=>keys.includes(k))&&required.every(k=>Object.hasOwn(v,k)),'Invalid migration request/plan shape');}
function relative(v){check(typeof v==='string'&&v.length<2048&&!/[\\:\x00-\x1f]/.test(v)&&!v.startsWith('/')&&v.split('/').every(s=>s&&s!=='.'&&s!=='..')&&/^(Assets|Packages|ProjectSettings)\//.test(v),'Invalid migration relative path');return v;}
function identity(v){shape(v,['assembly','fullName','guid','fileID']);check(['assembly','fullName'].every(k=>typeof v[k]==='string'&&v[k].length>0&&v[k].length<2048)&&guid.test(v.guid)&&typeof v.fileID==='string'&&id.test(v.fileID)&&v.fileID.length<=20&&BigInt(v.fileID)>=-(1n<<63n)&&BigInt(v.fileID)<(1n<<63n),'Invalid script identity');return v;}
const same=(a,b)=>fingerprint(a)===fingerprint(b);
function scriptIdentity(s){return {assembly:s.assembly,fullName:s.fullName,guid:s.guid,fileID:s.fileID};}
function observedScript(observations,wanted){identity(wanted);const found=observations.scripts.filter(s=>same(scriptIdentity(s),wanted));check(found.length===1,'Missing or ambiguous observed script identity');const s=found[0];relative(s.path);check(Array.isArray(s.fields)&&s.fields.length<=10000&&new Set(s.fields.map(f=>f.name)).size===s.fields.length,'Ambiguous observed field identity');return s;}
function normalize(v,type){if(type==='System.Boolean'&&(v===0||v===1))return v===1;if(v&&typeof v==='object'&&!Array.isArray(v)&&Object.hasOwn(v,'fileID'))return {fileID:String(v.fileID),...(v.guid?{guid:v.guid}: {})};return v;}
function observationsValid(o,graph){check(o&&Buffer.byteLength(JSON.stringify(o))<=32*MiB&&o.kind==='retoolkit-migration-observation'&&o.schemaVersion===1&&o.complete===true&&o.compilation?.state==='succeeded'&&o.graphRevision===graph.revision&&o.inventorySha256===fingerprint(graph.files)&&o.unityVersion===graph.unityVersion&&Array.isArray(o.scripts)&&o.scripts.length<=20000&&Array.isArray(o.components)&&o.components.length<=200000,'Invalid, incomplete or stale Editor observation inventory');}
function nodeFor(graph,componentId){const nodes=graph.nodes.filter(n=>n.id===componentId);check(nodes.length===1&&nodes[0].classID===114&&nodes[0].scriptRef,'Missing or unsupported component identity');const node=nodes[0],asset=graph.assets.find(a=>a.id===node.assetId);check(asset?.guid&&['scene','prefab','asset'].includes(asset.kind),'Unsupported binary or missing serialized asset identity');check(!JSON.stringify(node.fields).match(/"(?:managedReferences?|references)"\s*:/i),'Unsupported managed-reference serialization');return {node,asset};}
function astDocuments(text){
 const headers=[...text.matchAll(/^--- !u!\d+ &(-?(?:0|[1-9]\d*))(?: stripped)?\s*\r?$/gm)];check(headers.length>0,'Unsupported binary or mixed serialized asset');const result=new Map();
 for(let i=0;i<headers.length;i++){
  const h=headers[i],start=text.indexOf('\n',h.index)+1,end=headers[i+1]?.index??text.length;check(start>0&&!result.has(h[1]),'Invalid or ambiguous YAML document identity');
  const doc=YAML.parseDocument(text.slice(start,end),{intAsBigInt:true,keepSourceTokens:true,uniqueKeys:true,strict:true,maxAliasCount:0});check(!doc.errors.length&&!doc.warnings.length&&YAML.isMap(doc.contents)&&doc.contents.items.length===1,'Unsupported serialized YAML document');
  const visit=(v,depth=0)=>{check(depth<=100&&!YAML.isAlias(v)&&!v?.anchor&&!v?.tag,'Unsupported YAML alias/tag');if(YAML.isMap(v))for(const p of v.items){visit(p.key,depth+1);visit(p.value,depth+1);}else if(YAML.isSeq(v))for(const c of v.items)visit(c,depth+1);};visit(doc.contents);
  const fields=doc.contents.items[0].value;check(YAML.isMap(fields),'Unsupported serialized component fields');result.set(h[1],{start,fields});
 }return result;
}
function pair(map,key){check(YAML.isMap(map),'Unsupported serialized field shape');const matches=map.items.filter(p=>YAML.isScalar(p.key)&&p.key.value===key);check(matches.length===1,`Missing or ambiguous serialized field ${key}`);return matches[0];}
function astValue(node,key=''){
 if(YAML.isMap(node))return Object.fromEntries(node.items.map(p=>[p.key.value,astValue(p.value,p.key.value)]));if(YAML.isSeq(node))return node.items.map(n=>astValue(n));if(node===null)return null;check(YAML.isScalar(node),'Unsupported source YAML value');
 if(key==='guid'||key==='fileID')return node.type==='PLAIN'?node.source:node.value;const v=node.value;return typeof v==='bigint'?(v<=BigInt(Number.MAX_SAFE_INTEGER)&&v>=BigInt(Number.MIN_SAFE_INTEGER)?Number(v):String(v)):v;
}
function patchScalar(patches,document,node,replacement){check(YAML.isScalar(node)&&node.type==='PLAIN'&&node.range&&typeof replacement==='string','Unsupported scalar token');patches.push({start:document.start+node.range[0],end:document.start+node.range[1],replacement});}
function supportedValue(value,propertyType){if(propertyType==='ObjectReference')return value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.fileID==='string'&&id.test(value.fileID)&&Object.keys(value).every(k=>['fileID','guid','type'].includes(k));return value===null?false:['string','number','boolean'].includes(typeof value);}
async function buildChanges({projectDir,graph,observations,request}){
 shape(request,['kind','schemaVersion','graphRevision','rebindings','fieldRenames','removeAssemblies'],['kind','schemaVersion','graphRevision','rebindings','fieldRenames']);check(Buffer.byteLength(JSON.stringify(request))<=8*MiB&&request.kind==='retoolkit-migration-request'&&request.schemaVersion===1&&request.graphRevision===graph.revision,'Invalid or stale migration request');
 check(request.removeAssemblies===undefined||Array.isArray(request.removeAssemblies)&&request.removeAssemblies.length===0,'DLL removal/conversion unsupported: complete type and dependency coverage is not established','migration_coverage_required');
 check(Array.isArray(request.rebindings)&&Array.isArray(request.fieldRenames)&&request.rebindings.length+request.fieldRenames.length>0&&request.rebindings.length+request.fieldRenames.length<=1000,'Invalid migration operation limit');observationsValid(observations,graph);await verifyGraphFiles(projectDir,graph);
 const documents=new Map(),edits=new Map(),rebindings=new Map(),renames=new Map();
 async function document(componentId){const {node,asset}=nodeFor(graph,componentId);if(!documents.has(asset.path)){relative(asset.path);const bytes=await fs.readFile(assertAssetPath(path.join(projectDir,asset.path),projectDir));check(bytes.length<=16*MiB,'Serialized asset exceeds limit');const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);check(!text.includes('\0'),'Unsupported binary serialized asset');documents.set(asset.path,{text,docs:astDocuments(text),bytes});edits.set(asset.path,[]);}const source=documents.get(asset.path),doc=source.docs.get(node.fileID);check(doc,'Missing exact serialized object identity');return {node,asset,source,doc,patches:edits.get(asset.path)};}
 for(const r of request.rebindings){shape(r,['componentId','from','to']);check(!rebindings.has(r.componentId),'Duplicate component rebinding');const {node,asset,doc,patches}=await document(r.componentId),from=observedScript(observations,r.from),to=observedScript(observations,r.to);
  check(node.scriptRef.guid===r.from.guid&&node.scriptRef.fileID===r.from.fileID,'Source script identity assertion failed');check(!same(r.from,r.to),'Rebinding must change script identity');
  const sourceAsset=graph.assets.find(a=>a.guid===r.from.guid),target=graph.assets.find(a=>a.guid===r.to.guid);check(sourceAsset?.path===from.path&&target?.path===to.path&&target.path.endsWith('.cs')&&target.script?.supported&&target.script.types.length===1&&target.script.types[0].fullName===r.to.fullName&&target.script.assembly===r.to.assembly,'Target source/assembly/full type identity assertion failed');
  check(!target.path.split('/').some(part=>part.toLowerCase()==='editor')&&!/editor/i.test(r.to.assembly),'Unsupported Editor-only target source/assembly');
  if(sourceAsset.path.endsWith('.cs'))check(sourceAsset.script?.types?.length===1&&sourceAsset.script.types[0].fullName===r.from.fullName&&sourceAsset.script.assembly===r.from.assembly,'Source full type identity assertion failed');
  check(observations.scripts.filter(s=>s.fullName===to.fullName).length===1,'Duplicate full type identity; retained DLL/source creates ambiguous binding');
  const script=pair(doc.fields,'m_Script').value;check(YAML.isMap(script),'Unsupported mixed script reference');const actual=astValue(script);check(actual.fileID===r.from.fileID&&actual.guid?.toLowerCase()===r.from.guid,'Source YAML script identity assertion failed');patchScalar(patches,doc,pair(script,'fileID').value,r.to.fileID);patchScalar(patches,doc,pair(script,'guid').value,r.to.guid);rebindings.set(r.componentId,{from,to,asset});
 }
 for(const r of request.fieldRenames){shape(r,['componentId','from','to','type','expectedValue']);check(typeof r.from==='string'&&typeof r.to==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.from)&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(r.to)&&!r.from.startsWith('m_')&&!r.to.startsWith('m_')&&r.from!==r.to,'Unsupported field name migration');const key=r.componentId+'\0'+r.from;check(!renames.has(key),'Duplicate field migration');
  check(![...renames.values()].some(previous=>previous.componentId===r.componentId&&previous.to===r.to),'Destination field collision');
  const {node,doc,patches}=await document(r.componentId);check(Object.hasOwn(node.fields,r.from)&&!Object.hasOwn(node.fields,r.to)&&!doc.fields.items.some(p=>p.key.value===r.to),'Missing source field or destination field collision');check(same(node.fields[r.from],r.expectedValue)&&same(astValue(pair(doc.fields,r.from).value),r.expectedValue),'Serialized source YAML field value assertion failed');
  const binding=rebindings.get(r.componentId);const from=binding?.from??observedScript(observations,scriptIdentity(observations.scripts.find(s=>s.guid===node.scriptRef.guid&&s.fileID===node.scriptRef.fileID)??{})),to=binding?.to??from;
  const old=from.fields.find(f=>f.name===r.from),next=to.fields.find(f=>f.name===r.to);check(old&&next&&old.type===r.type&&next.type===r.type&&old.propertyType===next.propertyType&&scalarTypes.has(old.propertyType)&&supportedValue(node.fields[r.from],old.propertyType),'Unsupported field type conversion or serialized shape');
  const rows=observations.components.filter(c=>c.componentId===r.componentId);check(rows.length===1&&Array.isArray(rows[0].fields),'Missing observed component field identity');const values=rows[0].fields.filter(f=>f.name===r.from);check(values.length===1&&values[0].type===r.type&&values[0].propertyType===old.propertyType,'Missing observed serialized field identity');let observed;try{observed=JSON.parse(values[0].valueJson);}catch{check(false,'Invalid observed field value');}check(same(normalize(observed,r.type),normalize(r.expectedValue,r.type)),'Editor serialized field value assertion failed');
  patchScalar(patches,doc,pair(doc.fields,r.from).key,r.to);renames.set(key,r);
 }
 for(const [componentId,{from,to}] of rebindings)for(const field of from.fields){check(scalarTypes.has(field.propertyType),'Unsupported complex or managed-reference field in rebinding');const renamed=renames.get(componentId+'\0'+field.name),target=to.fields.find(f=>f.name===(renamed?.to??field.name));check(target&&target.type===field.type&&target.propertyType===field.propertyType,'Rebinding would discard or convert an observed serialized field');}
 const changes=[];
 for(const [name,patches] of edits){const source=documents.get(name),ordered=patches.sort((a,b)=>a.start-b.start);check(ordered.every((p,i)=>!i||p.start>=ordered[i-1].end),'Colliding migration patches');let after=source.text;for(const p of ordered.toReversed())after=after.slice(0,p.start)+p.replacement+after.slice(p.end);changes.push({path:name,beforeSha256:hash(source.bytes),beforeSize:source.bytes.length,afterSha256:hash(after),afterSize:Buffer.byteLength(after),after,patches:ordered});}
 return changes.sort((a,b)=>a.path.localeCompare(b.path));
}
const payload=p=>{const {payloadSha256,...rest}=p;return fingerprint(rest);};
export async function createMigrationPlan(options){const changes=await buildChanges(options),{graph,observations,request}=options;const plan={kind:'retoolkit-migration-plan',schemaVersion:1,operationId:randomUUID(),graphRevision:graph.revision,binding:structuredClone(graph.binding),inventory:structuredClone(graph.files),observationsSha256:fingerprint(observations),request:structuredClone(request),changes,compileReady:false,bindingsVerified:false,migratedValuesVerified:false,behavior:'unverified'};return {...plan,payloadSha256:payload(plan)};}
async function durable(file,value){assertAssetPath(file);await fs.mkdir(path.dirname(file),{recursive:true});const handle=await fs.open(file,'wx');try{await handle.writeFile(value);await handle.sync();}finally{await handle.close();}}
async function journal(file,value){const next=file+'.new';await durable(next,JSON.stringify(value,null,2));await fs.rename(next,file);}
function overlap(a,b){const r=path.relative(a,b);return r===''||!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);}
/** Caller retains the workspace lease through staging and any subsequent Editor run. */
export async function applyMigrationPlan({projectDir,graph,observations,plan,runDir,onEvent=async()=>{}}){
 check(plan?.kind==='retoolkit-migration-plan'&&plan.schemaVersion===1&&/^[a-f0-9-]{36}$/.test(plan.operationId)&&payload(plan)===plan.payloadSha256,'Invalid migration plan/hash');check(plan.observationsSha256===fingerprint(observations),'Migration observations changed');
 const rebuilt=await createMigrationPlan({projectDir,graph,observations,request:plan.request});check(same({...rebuilt,operationId:plan.operationId,payloadSha256:undefined},{...plan,payloadSha256:undefined}),'Migration plan patches/inventory changed');
 check(typeof runDir==='string'&&path.isAbsolute(runDir),'An absolute fresh staging runDir is required');projectDir=assertAssetPath(projectDir);runDir=assertAssetPath(runDir);check(!overlap(projectDir,runDir)&&!overlap(runDir,projectDir),'Migration staging overlaps original project');
 const stage=path.join(runDir,'.project.stage'),published=path.join(runDir,'project'),journalFile=path.join(runDir,'journal.json');const state={kind:'retoolkit-migration-journal',schemaVersion:1,operationId:plan.operationId,payloadSha256:plan.payloadSha256,state:'staging'};let didPublish=false;
 const files=plan.inventory.map(f=>{const c=plan.changes.find(c=>c.path===f.path);return c?{...f,sha256:c.afterSha256,size:c.afterSize}:f;});
 const receiptPayload={kind:'retoolkit-migration-receipt',schemaVersion:1,operationId:plan.operationId,payloadSha256:plan.payloadSha256,sourceGraphRevision:plan.graphRevision,binding:plan.binding,unityVersion:graph.unityVersion,files,request:plan.request,observationsSha256:plan.observationsSha256,compileReady:false,bindingsVerified:false,migratedValuesVerified:false,behavior:'unverified'};const receipt={...receiptPayload,receiptSha256:fingerprint(receiptPayload)};
 await fs.mkdir(path.dirname(runDir),{recursive:true});try{await fs.mkdir(runDir);}catch(e){if(e.code!=='EEXIST')throw e;
  let saved;try{saved=JSON.parse(await fs.readFile(assertAssetPath(path.join(runDir,'receipt.json')),'utf8'));}catch{check(false,'Migration staging must be fresh; incomplete existing operation requires recovery');}
  check(same(saved,receipt),'Occupied migration staging receipt does not match the plan');await verifyGraphFiles(published,{files});return saved;
 }
 try{await journal(journalFile,state);await durable(path.join(runDir,'plan.json'),JSON.stringify(plan,null,2));await fs.mkdir(stage);
  for(const f of plan.inventory){relative(f.path);const bytes=await fs.readFile(assertAssetPath(path.join(projectDir,f.path),projectDir));check(hash(bytes)===f.sha256&&bytes.length===f.size,'Source changed during migration staging','stale_graph');await durable(path.join(stage,f.path),bytes);}
  for(const c of plan.changes){const destination=assertAssetPath(path.join(stage,c.path),stage),before=await fs.readFile(destination);await durable(path.join(runDir,'backups',c.path),before);const temporary=destination+'.retk-new';await durable(temporary,c.after);await fs.rename(temporary,destination);}
  state.state='staged';await journal(journalFile,state);await onEvent({phase:'staged',operationId:plan.operationId});await verifyGraphFiles(projectDir,graph);await verifyGraphFiles(stage,{files});
  await onEvent({phase:'before-publish',operationId:plan.operationId});await verifyGraphFiles(projectDir,graph);await verifyGraphFiles(stage,{files});await fs.rename(stage,published);didPublish=true;state.state='published';await journal(journalFile,state);
  await onEvent({phase:'before-receipt',operationId:plan.operationId});await verifyGraphFiles(projectDir,graph);await verifyGraphFiles(published,{files});await durable(path.join(runDir,'receipt.json'),JSON.stringify(receipt,null,2));state.state='complete';await journal(journalFile,state);return receipt;
 }catch(error){
  if(didPublish){try{await verifyGraphFiles(published,{files});await fs.rename(published,stage);}catch(cause){state.state='recovery-required';state.error=String(error.message).slice(0,2000);try{await journal(journalFile,state);}catch{}throw Object.assign(Error('Migration rollback uncertain; retain staging, journal and workspace ownership'),{code:'migration_recovery_required',preserveToolchainGate:true,cause});}}
  state.state='rolled-back';state.error=String(error.message).slice(0,2000);await journal(journalFile,state);throw error;
 }
}
export async function verifyMigration({projectDir,receipt,observations}){
 const {receiptSha256,...rest}=receipt??{};check(receipt?.kind==='retoolkit-migration-receipt'&&receipt.schemaVersion===1&&receiptSha256===fingerprint(rest),'Invalid migration receipt/hash');const result={valid:false,operationId:receipt.operationId,compileReady:false,bindingsVerified:false,migratedValuesVerified:false,behavior:'unverified'};
 try{await verifyGraphFiles(projectDir,{files:receipt.files});result.valid=true;if(!observations)return result;
  const revision=hash(JSON.stringify({binding:receipt.binding,files:receipt.files}));observationsValid(observations,{revision,files:receipt.files,unityVersion:receipt.unityVersion});result.compileReady=true;
  result.bindingsVerified=receipt.request.rebindings.every(r=>{observedScript(observations,r.to);const rows=observations.components.filter(c=>c.componentId===r.componentId);return rows.length===1&&rows[0].script&&same(rows[0].script,r.to);});
  result.migratedValuesVerified=receipt.request.fieldRenames.every(r=>{const rows=observations.components.filter(c=>c.componentId===r.componentId),fields=rows.length===1?rows[0].fields?.filter(f=>f.name===r.to)??[]:[];return fields.length===1&&fields[0].type===r.type&&same(normalize(JSON.parse(fields[0].valueJson),r.type),normalize(r.expectedValue,r.type));});return result;
 }catch(error){result.reason=error.message;return result;}
}
