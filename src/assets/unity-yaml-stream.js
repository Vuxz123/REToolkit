import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const UNITY_SERIALIZED_LIMITS=Object.freeze({maxDocumentBytes:16*1024**2,maxPreambleBytes:64*1024,chunkBytes:64*1024});
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
function fail(code,file,detail){throw Object.assign(new Error(`${code}: ${file.path}${detail?`: ${detail}`:''}`),{code});}
function documentLimit(file){fail('unity_document_byte_limit',file,`A single Unity YAML document exceeds ${UNITY_SERIALIZED_LIMITS.maxDocumentBytes} bytes. Split the serialized object or reduce its payload; changing graph storage does not raise the document budget.`);}

// Always attest the complete source bytes and the open descriptor as well as
// its pathname. Consumers must exhaust this iterator before publishing a graph.
async function* verifiedBytes(absolute,file,before,noLinks){
 await noLinks(absolute);const handle=await fs.open(absolute,'r');
 try{
  if(!sameFile(before,await handle.stat()))fail('stale_graph',file,'Source changed before serialized read');
  const hash=createHash('sha256');let size=0;
  for await(const bytes of handle.createReadStream({autoClose:false,highWaterMark:UNITY_SERIALIZED_LIMITS.chunkBytes})){
   size+=bytes.length;if(size>file.size)fail('stale_graph',file,'Source grew during serialized read');hash.update(bytes);yield bytes;
  }
  await noLinks(absolute);const after=await handle.stat(),current=await fs.lstat(absolute);
  if(size!==file.size||hash.digest('hex')!==file.sha256||!current.isFile()||!sameFile(before,after)||!sameFile(before,current))fail('stale_graph',file,'Source changed during serialized read');
 }finally{await handle.close();}
}

async function* lines(bytes,file,hasDocument){
 const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});let parts=[],size=0,first=true;
 function decode(){const raw=parts.length===1?parts[0]:Buffer.concat(parts,size);let text;try{text=decoder.decode(raw);}catch{fail('invalid_unity_encoding',file,'Unity YAML must contain valid UTF-8');}if(raw.includes(0))fail('invalid_unity_encoding',file,'NUL in Unity YAML');if(first){text=text.replace(/^\uFEFF/,'');first=false;}const result={text,bytes:size};parts=[];size=0;return result;}
 for await(const chunk of bytes){let start=0;while(start<chunk.length){const newline=chunk.indexOf(10,start),end=newline===-1?chunk.length:newline+1,part=chunk.subarray(start,end);size+=part.length;if(hasDocument()){if(size>UNITY_SERIALIZED_LIMITS.maxDocumentBytes)documentLimit(file);}else if(size>UNITY_SERIALIZED_LIMITS.maxPreambleBytes)fail('unity_preamble_byte_limit',file,'Unity preamble line exceeds 64KiB');parts.push(part);if(newline!==-1)yield decode();start=end;}}
 if(size)yield decode();
}

/** null for opaque input, otherwise an async sequence of complete documents. */
export async function readUnityYamlStream(root,file,{noLinks,parseDocument}){
 const absolute=path.join(root,file.path);await noLinks(absolute);const before=await fs.lstat(absolute);if(!before.isFile()||before.size!==file.size)fail('stale_graph',file,'Source identity changed');
 const handle=await fs.open(absolute,'r');let prefix;
 try{if(!sameFile(before,await handle.stat()))fail('stale_graph',file,'Source changed before format detection');const buffer=Buffer.alloc(Math.min(file.size,UNITY_SERIALIZED_LIMITS.maxPreambleBytes)),{bytesRead}=await handle.read(buffer,0,buffer.length,0);prefix=buffer.subarray(0,bytesRead).toString('utf8').replace(/^\uFEFF/,'');}finally{await handle.close();}
 const bytes=()=>verifiedBytes(absolute,file,before,noLinks);
 if(!/^\s*(?:%YAML|--- !u!)/.test(prefix)){
  const trimmed=prefix.trimStart();if(file.size>=UNITY_SERIALIZED_LIMITS.maxPreambleBytes&&(!trimmed||'%YAML'.startsWith(trimmed)||'--- !u!'.startsWith(trimmed)))fail('unity_preamble_byte_limit',file,'No Unity header within the 64KiB preamble budget');
  for await(const _chunk of bytes()){}return null;
 }
 return (async function*(){
  let active=null,preambleBytes=0;
  for await(const raw of lines(bytes(),file,()=>active!==null)){
   const line=raw.text.replace(/\r?\n$/,'');
   if(line.startsWith('%')){if(!/^%YAML 1\.[12]$/.test(line)&&line!=='%TAG !u! tag:unity3d.com,2011:')fail('unsupported_yaml_directive',file);if(active){active.bytes+=raw.bytes;if(active.bytes>UNITY_SERIALIZED_LIMITS.maxDocumentBytes)documentLimit(file);}else{preambleBytes+=raw.bytes;if(preambleBytes>UNITY_SERIALIZED_LIMITS.maxPreambleBytes)fail('unity_preamble_byte_limit',file,'Unity preamble exceeds 64KiB');}continue;}
   if(line.startsWith('---')){
    const match=/^--- !u!(\d+) &(-?(?:0|[1-9]\d*))(?: stripped)?\s*$/.exec(line);if(!match)fail('invalid_unity_header',file);const classID=Number(match[1]);if(!Number.isSafeInteger(classID))fail('invalid_class_id',file);
    if(active)yield parseDocument(active);active={classID,fileID:match[2],lines:[],bytes:raw.bytes};
   }else if(active){active.bytes+=raw.bytes;if(active.bytes>UNITY_SERIALIZED_LIMITS.maxDocumentBytes)documentLimit(file);active.lines.push(raw.text);}
   else{preambleBytes+=raw.bytes;if(preambleBytes>UNITY_SERIALIZED_LIMITS.maxPreambleBytes)fail('unity_preamble_byte_limit',file,'Unity preamble exceeds 64KiB');if(line.trim())fail('invalid_unity_yaml',file);}
  }
  if(!active)fail('invalid_unity_yaml',file);yield parseDocument(active);
 })();
}
