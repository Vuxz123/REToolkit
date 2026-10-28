import { randomUUID } from 'node:crypto';
import { fingerprint } from '../state.js';

export const VERSION=1;
export const REQUEST_LIMIT=64*1024;
export const RESPONSE_LIMIT=2*1024*1024;
export const methods=new Set(['session.status','session.stop','control.attach','control.heartbeat',
  'functions.list','functions.get','functions.decompile','instructions.list','references.list',
  'strings.search','memory.read','functions.rename','comments.set','symbols.plan','symbols.apply','analysis.ensure']);
export class BridgeError extends Error {
  constructor(code,message,details={}) {super(message); this.name='BridgeError'; this.code=code; Object.assign(this,details);}
}
export function createFrameDecoder(receive,limit=RESPONSE_LIMIT) {
  let pending=Buffer.alloc(0);
  return data=>{
    pending=Buffer.concat([pending,data]); let newline;
    while((newline=pending.indexOf(10))!==-1) {
      if(newline>limit) throw new BridgeError('response_limit','NDJSON frame exceeds limit');
      const frame=pending.subarray(0,newline); pending=pending.subarray(newline+1);
      if(frame.length===0) continue;
      let value; try {value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(frame));}
      catch {throw new BridgeError('protocol_mismatch','Invalid UTF-8 JSON response');}
      if(!value||typeof value!=='object'||Array.isArray(value)) throw new BridgeError('protocol_mismatch','Expected a JSON object');
      receive(value);
    }
    if(pending.length>limit) throw new BridgeError('response_limit','NDJSON frame exceeds limit');
  };
}
export function requestFrame(binding,id,method,params={}) {
  if(!methods.has(method)) throw new BridgeError('protocol_mismatch',`Unsupported bridge method ${method}`);
  const frame=JSON.stringify({version:VERSION,id,runId:binding.runId,token:binding.token,method,params})+'\n';
  if(Buffer.byteLength(frame)-1>REQUEST_LIMIT) throw new BridgeError('request_limit','Request exceeds 64 KiB limit; use a disk plan');
  return frame;
}
export function mutationHash(method,params) {
  const {operationId,payloadHash,...payload}=params;
  return fingerprint({method,params:payload});
}
export function mutationParams(method,params,preview,operationId=randomUUID()) {
  const result={...params,dryRun:false,expectedRevision:preview.revision,
    expectedOld:preview.result.before,operationId};
  result.payloadHash=mutationHash(method,result); return result;
}
