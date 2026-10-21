import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {MAX_PACKAGE_BYTES,assertNoLinks,toolchainError} from './manifest.js';

const bounded=(value,fallback,min,max)=>Number.isFinite(value)?Math.max(min,Math.min(max,Math.floor(value))):fallback;
const failure=(message,retryable=false,cause)=>Object.assign(toolchainError('TOOLCHAIN_DOWNLOAD_FAILED',message,cause),{retryable});
const integrity=()=>toolchainError('TOOLCHAIN_INTEGRITY','Downloaded archive checksum or size does not match lock.');
function cancel(response){try{Promise.resolve(response?.body?.cancel()).catch(()=>{});}catch{}}
async function request(fetchImpl,url,init){
 const {signal}=init;
 if(signal.aborted)throw signal.reason;
 let abort;
 const pending=Promise.resolve().then(()=>fetchImpl(url,init));
 // A test transport may ignore AbortSignal. Do not let it defeat the deadline,
 // and release any response which arrives after that deadline.
 pending.then(response=>{if(signal.aborted)cancel(response);},()=>{});
 try{return await Promise.race([pending,new Promise((resolve,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});})]);}
 catch(error){throw failure('Archive download failed.',true,error);}
 finally{signal.removeEventListener('abort',abort);}
}
async function responseFor(source,offset,fetchImpl,signal){
 let url=source.url;
 for(let redirects=0;;redirects++){
  let parsed;try{parsed=new URL(url);}catch{throw failure('Unsafe archive download redirect.');}
  if(parsed.protocol!=='https:'||!parsed.hostname||parsed.username||parsed.password)throw failure('Unsafe archive download redirect.');
  const headers={'Accept-Encoding':'identity'};if(offset)headers.Range=`bytes=${offset}-`;
  const response=await request(fetchImpl,url,{redirect:'manual',signal,headers});
  if(![301,302,303,307,308].includes(response.status))return response;
  cancel(response);
  if(redirects>=5)throw failure('Too many archive download redirects.');
  const location=response.headers.get('location');if(!location)throw failure('Unsafe archive download redirect.');
  try{url=new URL(location,url).href;}catch{throw failure('Unsafe archive download redirect.');}
 }
}
function verifyRange(response,offset,total){
 const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')??'');
 if(!offset||!match||Number(match[1])!==offset||Number(match[2])!==total-1||Number(match[3])!==total)throw failure('Invalid archive download range response.');
}
async function verifyFile(file,source){
 await assertNoLinks(file);const handle=await fs.open(file,'r');
 try{
  const stat=await handle.stat();if(!stat.isFile()||stat.size!==source.size)throw integrity();
  const hash=createHash('sha256');for await(const chunk of handle.createReadStream({autoClose:false}))hash.update(chunk);
  if(hash.digest('hex')!==source.sha256)throw integrity();
 }finally{await handle.close();}
}

// The caller owns this unique private pathname. No partial survives publication
// or cleanup, and no other invocation's partial is discovered or trusted.
export async function fetchArchive(source,file,fetchImpl,options={}){
 const maxAttempts=bounded(options.maxAttempts,3,1,3);
 const attemptTimeoutMs=bounded(options.attemptTimeoutMs,600000,1,600000);
 const maxBackoffMs=bounded(options.maxBackoffMs,2000,0,2000);
 const backoffMs=bounded(options.backoffMs,250,0,maxBackoffMs);
 if(!Number.isSafeInteger(source.size)||source.size<1||source.size>MAX_PACKAGE_BYTES)throw integrity();
 await assertNoLinks(file);const initial=await fs.open(file,'wx');await initial.close();
 let offset=0,lastProgress=0;
 function progress(received,attempt,resumed,force=false){
  if(typeof options.onProgress!=='function'||(!force&&Date.now()-lastProgress<250))return;
  lastProgress=Date.now();
  try{Promise.resolve(options.onProgress({received,total:source.size,attempt,resumed})).catch(()=>{});}catch{}
 }
 for(let attempt=1;attempt<=maxAttempts;attempt++){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(new DOMException('Archive download attempt timed out.','TimeoutError')),attemptTimeoutMs);
  let response;
  try{
   response=await responseFor(source,offset,fetchImpl,controller.signal);
   if(response.status!==200&&response.status!==206)throw failure(`Archive download failed (HTTP ${response.status}).`,[408,429].includes(response.status)||(response.status>=500&&response.status<=599));
   if(response.status===206)verifyRange(response,offset,source.size);
   else if(offset){await assertNoLinks(file);await fs.truncate(file,0);offset=0;}
   if(!response.body)throw failure('Archive download response has no body.');
   const resumed=offset>0;let received=offset;progress(received,attempt,resumed,true);
   const limit=new Transform({transform(chunk,encoding,callback){
    received+=chunk.length;
    if(received>source.size||received>MAX_PACKAGE_BYTES){callback(integrity());return;}
    progress(received,attempt,resumed);callback(null,chunk);
   }});
   await assertNoLinks(file);
   // pipeline settles only after its file stream closes, including on errors.
   const input=Readable.fromWeb(response.body),output=createWriteStream(file,{flags:'r+',start:offset});let origin;
   input.once('error',()=>{origin??='transport';});output.once('error',()=>{origin??='file';});
   try{await pipeline(input,limit,output,{signal:controller.signal});}
   catch(error){
    if(typeof error.code==='string'&&error.code.startsWith('TOOLCHAIN_'))throw error;
    throw failure('Archive download failed.',controller.signal.aborted||origin==='transport',error);
   }
   if(received!==source.size)throw integrity();
   await verifyFile(file,source);progress(received,attempt,resumed,true);return;
  }catch(error){
   cancel(response);
   const known=typeof error.code==='string'&&error.code.startsWith('TOOLCHAIN_');
   if(!error.retryable||attempt===maxAttempts){if(known)throw error;throw failure('Archive download failed.',false,error);}
  }finally{clearTimeout(timer);controller.abort();}
  // Read only our own closed file, never a cross-process partial. A completely
  // received but interrupted body is restarted so the next Range is satisfiable.
  await assertNoLinks(file);const stat=await fs.lstat(file);
  if(!stat.isFile()||stat.size>source.size)throw integrity();
  offset=stat.size;
  if(offset===source.size){await fs.truncate(file,0);offset=0;}
  await delay(Math.min(maxBackoffMs,backoffMs*2**(attempt-1)));
 }
}
