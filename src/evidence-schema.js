import {fingerprint} from './state.js';

const methods={'functions.decompile':'pseudocode','references.list':'references','functions.list':'observations'};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const integer=(value,min=0,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const text=value=>typeof value==='string';
const nonempty=value=>text(value)&&value.length>0;
const uuid=value=>text(value)&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const address=value=>text(value)&&/^(?:[A-Za-z_][\w.-]*:)?0x[0-9a-fA-F]{1,16}$/.test(value);
const abi=new Set(['unknown','arm64-v8a','armeabi-v7a','x86_64','x86','windows-x64','windows-x86','windows-arm64']);
function check(condition,message='Invalid evidence schema') {if(!condition)throw Object.assign(new Error(message),{code:'evidence_invalid'});}
function object(value,allowed,required=allowed) {
  check(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
  check(Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key)));
}
function query(value) {
  object(value,['method','params']);check(Object.hasOwn(methods,value.method),'Invalid evidence query method');
  const params=value.params;
  if(value.method==='functions.decompile') {
    object(params,['selector','limit','cursor','timeoutSeconds'],['selector','limit']);check(nonempty(params.selector));
    if(Object.hasOwn(params,'timeoutSeconds'))check(integer(params.timeoutSeconds,1,300));
  } else if(value.method==='references.list') {
    object(params,['address','direction','limit','cursor'],['address','direction','limit']);check(address(params.address)&&['to','from'].includes(params.direction));
  } else {object(params,['query','limit','cursor'],['limit']);if(Object.hasOwn(params,'query'))check(text(params.query));}
  check(integer(params.limit,1,1000));
  if(Object.hasOwn(params,'cursor'))check(nonempty(params.cursor));
}
function cursor(value,evidence) {
  check(nonempty(value)&&value.length<=65536&&/^[A-Za-z0-9_-]+$/.test(value),'Invalid evidence paging cursor');
  let decoded;
  try {const bytes=Buffer.from(value,'base64url');check(bytes.toString('base64url')===value);decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{check(false,'Invalid evidence paging cursor');}
  object(decoded,['runId','method','revision','offset','binding']);
  const {cursor:ignored,limit,...binding}=evidence.query.params;
  check(decoded.runId===evidence.runId&&decoded.method===evidence.query.method&&decoded.revision===evidence.revision&&integer(decoded.offset,1,2147483647)&&fingerprint(decoded.binding)===fingerprint(binding),'Invalid evidence paging cursor binding');
  return decoded.offset;
}
function result(value,evidence) {
  const method=evidence.query.method;
  object(value,method==='functions.decompile'?['items','nextCursor','address']:['items','nextCursor']);
  check(Array.isArray(value.items)&&value.items.length<=evidence.query.params.limit);
  if(value.nextCursor!==null)cursor(value.nextCursor,evidence);
  if(method==='functions.decompile')check(address(value.address));
  const offset=evidence.query.params.cursor?cursor(evidence.query.params.cursor,evidence):0;
  for(const [index,row] of value.items.entries()) {
    if(method==='functions.decompile') {
      object(row,['line','text']);check(integer(row.line,1,2147483647)&&row.line===offset+index+1&&text(row.text));
    } else if(method==='references.list') {
      object(row,['from','to','type']);check(address(row.from)&&address(row.to)&&nonempty(row.type));
    } else {
      object(row,['address','name','qualifiedName','signature','bodySize','comments']);
      check(address(row.address)&&nonempty(row.name)&&nonempty(row.qualifiedName)&&nonempty(row.signature)&&integer(row.bodySize));
      object(row.comments,['eol','pre','post','plate','repeatable']);check(Object.values(row.comments).every(value=>value===null||text(value)));
    }
  }
}

/** Validate only observed query envelopes emitted by the native Java provider. */
export function validateEvidence(value,{build,program,projectName}={}) {
  object(value,['kind','schemaVersion','query','build','programIdentity','runId','revision','collectedAt','result','coverage','limitations','dataTrust']);
  check(value.kind==='retoolkit-evidence'&&value.schemaVersion===1);query(value.query);
  object(value.build,['native','metadata']);
  for(const kind of ['native','metadata']) {
    const identity=value.build[kind];object(identity,kind==='native'?['sha256','size','abi']:['sha256','size']);
    check(hash(identity.sha256)&&integer(identity.size)&&(kind!=='native'||abi.has(identity.abi)));
    if(build)check(build[kind]&&identity.sha256===build[kind].sha256&&identity.size===build[kind].size,'Evidence build binding does not match current selected inputs');
  }
  const identity=value.programIdentity;
  object(identity,['program','projectName','sha256','imageBase','programPath','language','compiler','addressSpace','ghidraVersion','analysisStatus'],['program','projectName','sha256','imageBase']);
  check(nonempty(identity.program)&&nonempty(identity.projectName)&&hash(identity.sha256)&&identity.sha256===value.build.native.sha256&&address(identity.imageBase));
  for(const key of ['program','projectName'])check(!/[\\/\x00-\x1f]/.test(identity[key]));
  for(const key of ['language','compiler','addressSpace','ghidraVersion'])if(Object.hasOwn(identity,key))check(nonempty(identity[key])&&!/[\x00-\x1f]/.test(identity[key]));
  if(Object.hasOwn(identity,'addressSpace'))check(/^[A-Za-z_][\w.-]*$/.test(identity.addressSpace)&&identity.imageBase.startsWith(`${identity.addressSpace}:`));
  if(Object.hasOwn(identity,'analysisStatus'))check(identity.analysisStatus==='unknown');
  if(Object.hasOwn(identity,'programPath'))check(text(identity.programPath)&&identity.programPath.startsWith('/')&&!identity.programPath.includes('\\')&&identity.programPath.slice(1).split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[\x00-\x1f]/.test(part))&&identity.programPath.endsWith(`/${identity.program}`));
  if(program!==undefined||projectName!==undefined)check(identity.program===program&&identity.projectName===projectName,'Evidence program identity does not match selected program/build binding');
  check(uuid(value.runId)&&integer(value.revision)&&text(value.collectedAt)&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.collectedAt)&&Number.isFinite(Date.parse(value.collectedAt))&&new Date(value.collectedAt).toISOString()===value.collectedAt);
  check(Array.isArray(value.limitations)&&value.limitations.every(text)&&value.dataTrust==='untrusted-target-content');
  result(value.result,value);
  object(value.coverage,['state','source','explanation']);
  check(value.coverage.state===(value.result.nextCursor===null?'observed':'partial')&&value.coverage.source==='loaded-program'&&nonempty(value.coverage.explanation),'Invalid evidence coverage; query observation cannot claim analysis completeness');
  return methods[value.query.method];
}
