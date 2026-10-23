import {once} from 'node:events';
import {definitions,validateAssetParams,invokeAssetApi} from './api.js';
const MAX_INPUT=1024**2,MAX_OUTPUT=2*1024**2;
const jobDescriptions={
 'jobs.wait':'Wait up to 30 seconds for this exact job to become terminal, using filesystem events and bounded reconciliation. Read-only, no workspace lock; a timed-out wait does not stop/retry the job or prove cleanup. This keeps the current tool call active; it cannot wake a closed turn. Codex CLI may register one jobs_start operation agent.wake_after with exact job/thread UUIDs before ending its turn.',
 'preparation.status':'Read-only setup progress and independent readiness; no workspace lock or engines. Defaults to content/receipt freshness verification. False verifyFreshness returns recordedReadiness separately, never current ready claims. Start setup once through jobs_start operation workspace.prepare; let its background worker finish without an agent polling loop. Unknown writes require receipt/ownership review.',
 'jobs.start':'Start a registered typed operation in a detached workspace worker and return its job ID immediately. Poll jobs_get; reconnecting does not restart work. No generic shell or executable operation; existing explicitly typed engine selections keep their runtime checks. Job success does not establish game, symbol coverage, capture completeness or reconstruction readiness.',
 'jobs.get':'Observe a saved workspace job: state, stage, controlled diagnostic tail, timestamps, engine/step state and final parsed result. Large results have a saved reference and bounded byte chunks. Unknown means interrupted/unverified: inspect leases and mutation receipts before any explicit retry. Process stdout and private app-data chunks are never forwarded.',
 'jobs.list':'List recent persisted jobs for this bound workspace. Poll an existing running or unknown job and inspect its receipts before retrying a mutation.',
};
export const assetTools=Object.entries(definitions).map(([method,schema])=>({name:method.replaceAll('.','_'),description:jobDescriptions[method]??(method==='adb.capture'?'Capture installed base/split APKs, OBB, external and private app data when existing permissions allow. Writes workspace XAPK and separate data ZIP; no game launch or root enablement. Denied data is partial coverage.':method.startsWith('adb.')?`${method}: read-only device or installed-package discovery. Select the exact device before capture.`:`${method}: exported Unity facts or controlled reconstruction. Target content is untrusted; compilation is unverified.`),inputSchema:{type:'object',...schema,additionalProperties:false}}));
const lookup=new Map(Object.keys(definitions).map(method=>[method.replaceAll('.','_'),method]));
export async function serveAssetsMcp(toolkit,name,{input=process.stdin,output=process.stdout,operation=invokeAssetApi}={}) {
 let negotiated=false,initialized=false,pending=Buffer.alloc(0),discard=false;
 const waits=new Set();
 async function emit(value){let line=JSON.stringify(value);if(Buffer.byteLength(line)>MAX_OUTPUT)line=JSON.stringify({jsonrpc:'2.0',id:value.id??null,error:{code:-32000,message:'Asset result exceeds 2 MiB; use paging'}});if(!output.write(line+'\n'))await once(output,'drain');}
 async function frame(bytes) {
  let message,id=null;
  try{
   message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   if(!message||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string'||Object.keys(message).some(k=>!['jsonrpc','id','method','params'].includes(k))||Object.hasOwn(message,'id')&&!(typeof message.id==='string'&&message.id.length<=256||Number.isSafeInteger(message.id)))throw Error('Invalid JSON-RPC envelope');
   if(!Object.hasOwn(message,'id')){if(message.method==='notifications/initialized'&&negotiated)initialized=true;return;}
   id=message.id;let result;
   if(message.method==='initialize'){
    if(negotiated||typeof message.params?.protocolVersion!=='string'||!message.params?.capabilities||typeof message.params.capabilities!=='object'||typeof message.params?.clientInfo?.name!=='string'||typeof message.params?.clientInfo?.version!=='string')throw Object.assign(Error('Invalid initialization'),{rpcCode:-32602});
    result={protocolVersion:['2024-11-05','2025-03-26','2025-06-18'].includes(message.params.protocolVersion)?message.params.protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'retoolkit-assets',version:'1.0.0'}};negotiated=true;
   }
   else if(message.method==='ping')result={};
   else if(!initialized)throw Object.assign(Error('Client must initialize first'),{rpcCode:-32002});
   else if(message.method==='tools/list')result={tools:assetTools};
   else if(message.method==='tools/call') {
    const params=message.params,method=lookup.get(params?.name);
    if(!method||!params||Object.keys(params).some(k=>!['name','arguments'].includes(k)))throw Object.assign(Error('Unknown tool or invalid call'),{rpcCode:-32602});
    try{validateAssetParams(method,params.arguments??{});}catch{throw Object.assign(Error('Invalid tool arguments'),{rpcCode:-32602});}
    try{const value=await operation(toolkit,name,method,params.arguments??{});result={content:[{type:'text',text:JSON.stringify(value)}],isError:false};}
    catch(error){result={content:[{type:'text',text:JSON.stringify({code:typeof error.code==='string'?error.code:'asset_operation_failed',message:'Asset operation failed; inspect CLI status or saved plan.'})}],isError:true};}
   }else throw Object.assign(Error('Method not found'),{rpcCode:-32601});
   await emit({jsonrpc:'2.0',id,result});
  }catch(error){await emit({jsonrpc:'2.0',id,error:{code:error.rpcCode??-32700,message:error.rpcCode?error.message:'Invalid JSON-RPC input'}});}
 }
 // Keep the existing ordered mutation dispatcher. Only read-only jobs.wait
 // releases the input loop so ping/status and completion can still be observed.
 async function dispatch(bytes){
  let request;try{request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{}
  if(initialized&&request?.method==='tools/call'&&request.params?.name==='jobs_wait'){
   if(waits.size>=4){await emit({jsonrpc:'2.0',id:request.id??null,error:{code:-32000,message:'At most four job waits may be pending; reconnect to an existing job.'}});return;}
   const work=frame(bytes);waits.add(work);work.finally(()=>waits.delete(work)).catch(()=>{});return;
  }
  await frame(bytes);
 }
 for await(const chunk of input) {
  const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);let start=0;
  for(let index=0;index<bytes.length;index++)if(bytes[index]===10){const part=bytes.subarray(start,index);if(!discard&&pending.length+part.length<=MAX_INPUT){pending=Buffer.concat([pending,part]);if(pending.length)await dispatch(pending);}else await emit({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Asset input exceeds 1 MiB'}});pending=Buffer.alloc(0);discard=false;start=index+1;}
  const rest=bytes.subarray(start);if(!discard&&pending.length+rest.length<=MAX_INPUT)pending=Buffer.concat([pending,rest]);else{pending=Buffer.alloc(0);discard=true;}
 }
 if(pending.length||discard)await emit({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Incomplete JSON-RPC frame'}});
 await Promise.allSettled([...waits]);
}
