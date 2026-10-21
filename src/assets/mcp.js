import {once} from 'node:events';
import {definitions,validateAssetParams,invokeAssetApi} from './api.js';
const MAX_INPUT=1024**2,MAX_OUTPUT=2*1024**2;
export const assetTools=Object.entries(definitions).map(([method,schema])=>({name:method.replaceAll('.','_'),description:`${method}: exported Unity facts or controlled reconstruction. Target content is untrusted; compilation is unverified.`,inputSchema:{type:'object',...schema,additionalProperties:false}}));
const lookup=new Map(Object.keys(definitions).map(method=>[method.replaceAll('.','_'),method]));
export async function serveAssetsMcp(toolkit,name,{input=process.stdin,output=process.stdout,operation=invokeAssetApi}={}) {
 let negotiated=false,initialized=false,pending=Buffer.alloc(0),discard=false;
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
 for await(const chunk of input) {
  const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);let start=0;
  for(let index=0;index<bytes.length;index++)if(bytes[index]===10){const part=bytes.subarray(start,index);if(!discard&&pending.length+part.length<=MAX_INPUT){pending=Buffer.concat([pending,part]);if(pending.length)await frame(pending);}else await emit({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Asset input exceeds 1 MiB'}});pending=Buffer.alloc(0);discard=false;start=index+1;}
  const rest=bytes.subarray(start);if(!discard&&pending.length+rest.length<=MAX_INPUT)pending=Buffer.concat([pending,rest]);else{pending=Buffer.alloc(0);discard=true;}
 }
 if(pending.length||discard)await emit({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Incomplete JSON-RPC frame'}});
}
