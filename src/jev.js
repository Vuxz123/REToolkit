import {fingerprint} from './state.js';
import {artifactError} from './artifacts.js';

export const TYPESAFE_ENDPOINT='https://api.typesafe.ai/v1/systemone';
export const MAX_REQUEST_BYTES=32*1024*1024;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function invalid(message){throw artifactError('jev_request_invalid',message);}
function content(value,depth=0,ancestors=new Set()){
  if(depth>64)invalid('JSON nesting depth exceeds 64');
  if(value===null||typeof value==='string'||typeof value==='boolean')return;
  if(typeof value==='number'){if(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value))invalid('Use finite numbers and strings for exact large integers');return;}
  if(typeof value!=='object'||ancestors.has(value))invalid('Expected acyclic JSON content');
  ancestors.add(value);for(const child of Object.values(value))content(child,depth+1,ancestors);ancestors.delete(value);
}
function description(value,nullable=false){if(value===null&&nullable)return;if(typeof value!=='string'&&!record(value)&&!Array.isArray(value))invalid('Question descriptions must be text, object or array');content(value);}
export function validateJevRequest(request){
  if(!record(request)||Object.keys(request).some(key=>!['model','state','questions'].includes(key)))invalid('Request must contain only model, state and questions');
  if(typeof request.model!=='string'||!/^[A-Za-z0-9._-]{1,128}$/.test(request.model))invalid('A valid model ID or alias is required');
  if(typeof request.state!=='string'&&!record(request.state)&&!Array.isArray(request.state))invalid('State must be a string, object or array');
  content(request.state);
  if(!record(request.questions)||Object.keys(request.questions).length===0)invalid('Provide at least one typed question');
  for(const [id,question] of Object.entries(request.questions)){
    if(!id||!record(question)||Object.keys(question).some(key=>!['type','instructions','criteria'].includes(key)))invalid('Each named question requires a supported type and instructions');
    description(question.instructions);
    if(question.type==='choice'){
      if(!record(question.criteria)||Object.keys(question.criteria).length<1||Object.keys(question.criteria).length>255)invalid('Choice requires 1..255 options');
      for(const value of Object.values(question.criteria))description(value,true);
    }else if(question.type==='score'){
      if(!Array.isArray(question.criteria)||question.criteria.length<2||question.criteria.length>10)invalid('Score requires 2..10 ordered levels');
      for(const value of question.criteria)description(value);
    }else if(question.type==='noul'){
      if(question.criteria!==undefined){if(!record(question.criteria)||Object.keys(question.criteria).some(key=>!['true','false'].includes(key)))invalid('Noul criteria may describe only true and false');for(const value of Object.values(question.criteria))description(value);}
    }else invalid('Adapter supports choice, score and noul questions');
  }
  content(request.questions);
  if(Buffer.byteLength(JSON.stringify(request))>MAX_REQUEST_BYTES)invalid('TypeSafe request exceeds 32 MiB');
  return request;
}
export async function buildJevRequest(bundle,{against,questions,files=[],model='jev-latest',maxStateBytes=65536}){
  if(!Number.isSafeInteger(maxStateBytes)||maxStateBytes<1||maxStateBytes>MAX_REQUEST_BYTES)invalid('State byte budget must be 1..33554432');
  if(!Array.isArray(files)||files.some(file=>typeof file!=='string')||new Set(files).size!==files.length)invalid('Select unique relative inventory paths');
  const {readHandoff}=await import('./handoff.js');
  const artifacts=[];let declaredBytes=0;
  const state={kind:'retoolkit-jev-state',schemaVersion:1,dataTrust:'untrusted-target-content',artifacts,
    limitations:['Only selected text and verified manifest facts are included','Metadata and pseudocode are not original source','Byte budgets do not guarantee the model token context limit']};
  for(const [label,source] of [['primary',bundle],...(against?[['against',against]]:[])]){
    let loaded;try{loaded=await readHandoff(source);}catch{throw artifactError('handoff_verification_failed','Handoff verification failed; run handoff verify before building a request');}const {manifest}=loaded;
    const allowed=new Set(['metadata','notes','pseudocode','references','observations']);
    const selected=files.length?files.map(file=>{const entry=manifest.files.find(item=>item.path===file);if(!entry)invalid(`Selected inventory path is absent: ${file}`);return entry;}):manifest.files.filter(file=>['notes','pseudocode','references','observations'].includes(file.classification));
    const included=[];
    artifacts.push({label,manifestFingerprint:fingerprint(manifest),build:manifest.build,steps:manifest.steps,tools:manifest.tools,
      files:included,omittedFileCount:manifest.files.length-selected.length,limitations:manifest.limitations});
    let encodedBytes=Buffer.byteLength(JSON.stringify(state));
    for(const file of selected){declaredBytes+=file.size+Buffer.byteLength(JSON.stringify({path:file.path,classification:file.classification,sha256:file.sha256,text:''}));if(declaredBytes>maxStateBytes)throw artifactError('jev_state_too_large','Combined selected text exceeds state byte budget; select fewer files');}
    if(encodedBytes>maxStateBytes)throw artifactError('jev_state_too_large','Manifest context exceeds state byte budget');
    for(const file of selected){
      if(!allowed.has(file.classification))invalid('Only declared metadata/evidence text can enter a Jev request');
      if(file.size>maxStateBytes)throw artifactError('jev_state_too_large','Selected text exceeds state byte budget; capture narrower evidence or select fewer files');
      const bytes=await loaded.readFile(file.path);let text;
      try{text=new TextDecoder('utf8',{fatal:true}).decode(bytes);}catch{invalid('Selected file is not valid UTF-8 text');}
      const selectedFile={path:file.path,classification:file.classification,sha256:file.sha256,text};
      encodedBytes+=Buffer.byteLength(JSON.stringify(selectedFile))+(included.length?1:0);
      if(encodedBytes>maxStateBytes)throw artifactError('jev_state_too_large','Encoded text exceeds state byte budget; select fewer files');
      included.push(selectedFile);
    }
  }
  if(Buffer.byteLength(JSON.stringify(state))>maxStateBytes)throw artifactError('jev_state_too_large','Combined state exceeds byte budget; choose fewer files or narrower evidence');
  return validateJevRequest({model,state,questions});
}
function responseInvalid(){throw artifactError('jev_response_invalid','TypeSafe returned an invalid typed answer; no result was published');}
function probability(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1;}
function distribution(values,keys){return record(values)&&Object.keys(values).length===keys.length&&keys.every(key=>Object.hasOwn(values,key)&&probability(values[key]))&&Math.abs(Object.values(values).reduce((sum,value)=>sum+value,0)-1)<0.001;}
function validateResponse(value,request){
  if(!record(value)||typeof value.model!=='string'||!value.model||!record(value.answers)||!record(value.usage)||
    !Number.isSafeInteger(value.usage.input_tokens)||value.usage.input_tokens<0||!Number.isSafeInteger(value.usage.output_tokens)||value.usage.output_tokens<0||
    Object.keys(value.answers).length!==Object.keys(request.questions).length)responseInvalid();
  for(const [id,question] of Object.entries(request.questions)){
    const answer=value.answers[id];if(!record(answer)||answer.type!==question.type)responseInvalid();
    if(question.type==='noul'){if(!probability(answer.noul))responseInvalid();}
    else if(question.type==='choice'){
      const keys=Object.keys(question.criteria);if(!keys.includes(answer.choice)||!distribution(answer.probabilities,keys)||!probability(answer.confidence))responseInvalid();
    }else{
      const keys=question.criteria.map((_,index)=>String(index));if(typeof answer.score!=='number'||!Number.isFinite(answer.score)||answer.score<0||answer.score>keys.length-1||!distribution(answer.probabilities,keys)||!probability(answer.confidence)||!record(answer.legend)||Object.keys(answer.legend).length!==keys.length||keys.some(key=>typeof answer.legend[key]!=='string'))responseInvalid();
    }
  }
  return {model:value.model,answers:value.answers,usage:value.usage};
}
async function readResponse(response){
  if(!response.body?.getReader)responseInvalid();const reader=response.body.getReader();let size=0;const chunks=[];
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4*1024*1024){await reader.cancel();throw artifactError('jev_response_invalid','TypeSafe response exceeds the 4 MiB client limit');}chunks.push(Buffer.from(value));}}
  catch(error){if(error.code==='jev_response_invalid')throw error;throw artifactError('jev_connection_failed','TypeSafe response transfer failed; request was not automatically retried');}
  finally{reader.releaseLock();}
  try{return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{responseInvalid();}
}
export async function runJevRequest(request,{apiKey,timeoutMs=60000,fetchImpl=fetch}={}){
  validateJevRequest(request);
  if(typeof apiKey!=='string'||!apiKey.trim())throw artifactError('jev_auth_missing','Set TYPESAFE_API_KEY before explicitly running the request');
  if(/[\s\x00-\x1f\x7f]/.test(apiKey))throw artifactError('jev_auth_invalid','TYPESAFE_API_KEY contains invalid header characters');
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>300000)invalid('HTTP timeout must be 1..300000ms');
  const controller=new AbortController();let timer;
  const operation=async()=>{
    let response;try{response=await fetchImpl(TYPESAFE_ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify(request),redirect:'error',signal:controller.signal});}
    catch{throw artifactError('jev_connection_failed','TypeSafe connection failed; request was not automatically retried');}
    if(!response.ok){await response.body?.cancel().catch(()=>{});const status=response.status;
      const code=({401:'jev_auth_failed',413:'jev_request_too_large',422:'jev_validation_failed',429:'jev_rate_limited',529:'jev_overloaded'})[status]??'jev_http_error';
      throw Object.assign(artifactError(code,`TypeSafe returned HTTP ${status}; inspect request or retry explicitly`),{status});
    }
    return validateResponse(await readResponse(response),request);
  };
  try{return await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>{reject(artifactError('jev_timeout','TypeSafe request timed out; it was not automatically retried'));controller.abort();},timeoutMs);})]);}
  finally{clearTimeout(timer);}
}
