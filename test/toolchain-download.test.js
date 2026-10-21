import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {cachedArchive} from '../src/toolchain/archive-io.js';

const bytes=Buffer.from('a fixture archive with enough bytes to resume');
const sha=value=>createHash('sha256').update(value).digest('hex');
const source={url:'https://example.invalid/v1/archive.zip',size:bytes.length,sha256:sha(bytes)};
const policy={backoffMs:0,maxBackoffMs:0,attemptTimeoutMs:2000};
async function cache(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-download-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
function interrupted(prefix=bytes.subarray(0,5)){
 return new Response(new ReadableStream({start(controller){controller.enqueue(prefix);setTimeout(()=>controller.error(new Error('connection reset')),30);}}));
}

test('transient transport failures retry within the attempt cap, then cache verified bytes',async t=>{
 const root=await cache(t);let attempts=0;
 const file=await cachedArchive(source,root,async()=>{if(++attempts<3)throw Error('offline');return new Response(bytes);},policy);
 assert.equal(attempts,3);assert.deepEqual(await fs.readFile(file),bytes);assert.deepEqual(await fs.readdir(root),[`${source.sha256}.zip`]);
 await cachedArchive(source,root,()=>{throw Error('cache miss');},policy);
});

for(const status of [408,429,500,503])test(`HTTP ${status} retries before publication`,async t=>{
 const root=await cache(t);let attempts=0;
 await cachedArchive(source,root,async()=>++attempts===1?new Response('',{status}):new Response(bytes),policy);
 assert.equal(attempts,2);
});

test('interrupted streams resume only their written prefix with an exact Range response',async t=>{
 const root=await cache(t);let attempts=0;const progress=[];
 const file=await cachedArchive(source,root,async(url,init)=>{
  assert.equal(url,source.url);if(++attempts===1)return interrupted();
  assert.equal(init.headers.Range,'bytes=5-');
  return new Response(bytes.subarray(5),{status:206,headers:{'Content-Range':`bytes 5-${bytes.length-1}/${bytes.length}`}});
 },{...policy,onProgress:event=>progress.push(event)});
 assert.equal(attempts,2);assert.deepEqual(await fs.readFile(file),bytes);
 assert.ok(progress.some(event=>event.attempt===2&&event.resumed===true));
 assert.ok(progress.every(event=>Object.keys(event).sort().join(',')==='attempt,received,resumed,total'&&event.total===bytes.length&&event.received<=bytes.length));
});

test('a server ignoring Range restarts the private file rather than appending',async t=>{
 const root=await cache(t);let attempts=0;
 const file=await cachedArchive(source,root,async(url,init)=>{if(++attempts===1)return interrupted();assert.equal(init.headers.Range,'bytes=5-');return new Response(bytes);},policy);
 assert.deepEqual(await fs.readFile(file),bytes);assert.equal(attempts,2);
});

for(const range of [null,`bytes 4-${bytes.length-1}/${bytes.length}`,`bytes 5-${bytes.length-1}/${bytes.length+1}`,`bytes 5-${bytes.length-2}/${bytes.length}`])test(`invalid resumed Content-Range ${range} is terminal`,async t=>{
 const root=await cache(t);let attempts=0;
 await assert.rejects(cachedArchive(source,root,async()=>++attempts===1?interrupted():new Response(bytes.subarray(5),{status:206,headers:range?{'Content-Range':range}:{}}),policy),{code:'TOOLCHAIN_DOWNLOAD_FAILED'});
 assert.equal(attempts,2);assert.deepEqual(await fs.readdir(root),[]);
});

for(const content of [Buffer.from('short'),Buffer.alloc(bytes.length+1),Buffer.alloc(bytes.length)])test(`size or checksum failure (${content.length} bytes) is terminal and unpublished`,async t=>{
 const root=await cache(t);let attempts=0;
 await assert.rejects(cachedArchive(source,root,async()=>{attempts++;return new Response(content);},policy),{code:'TOOLCHAIN_INTEGRITY'});
 assert.equal(attempts,1);assert.deepEqual(await fs.readdir(root),[]);
});

for(const location of ['http://example.invalid/archive.zip','https://user:secret@example.invalid/archive.zip','https://['])test(`unsafe redirect ${location} is terminal`,async t=>{
 const root=await cache(t);let attempts=0;
 await assert.rejects(cachedArchive(source,root,async()=>{attempts++;return new Response(null,{status:302,headers:{location}});},policy),{code:'TOOLCHAIN_DOWNLOAD_FAILED'});
 assert.equal(attempts,1);assert.deepEqual(await fs.readdir(root),[]);
});

test('HTTPS redirects are manual, bounded, and preserve the attempt signal',async t=>{
 const root=await cache(t);let requests=0;let signal;
 await assert.rejects(cachedArchive(source,root,async(url,init)=>{assert.equal(init.redirect,'manual');signal??=init.signal;assert.equal(init.signal,signal);requests++;return new Response(null,{status:302,headers:{location:'/again.zip'}});},policy),{code:'TOOLCHAIN_DOWNLOAD_FAILED'});
 assert.equal(requests,6);assert.deepEqual(await fs.readdir(root),[]);
});

test('HTTP client errors are terminal and body aborts use a stable download code',async t=>{
 const root=await cache(t);let requests=0;
 await assert.rejects(cachedArchive(source,root,async()=>{requests++;return new Response('',{status:404});},policy),{code:'TOOLCHAIN_DOWNLOAD_FAILED'});assert.equal(requests,1);
 requests=0;await assert.rejects(cachedArchive(source,root,async()=>{requests++;throw new DOMException('aborted','AbortError');},{...policy,maxAttempts:2}),{code:'TOOLCHAIN_DOWNLOAD_FAILED'});assert.equal(requests,2);assert.deepEqual(await fs.readdir(root),[]);
});

test('attempt timeouts abort a stalled body and retry within configured bounds',async t=>{
 const root=await cache(t);let requests=0;const signals=[];
 await assert.rejects(cachedArchive(source,root,async(url,init)=>{requests++;signals.push(init.signal);return new Response(new ReadableStream());},{...policy,attemptTimeoutMs:20,maxAttempts:2}),{code:'TOOLCHAIN_DOWNLOAD_FAILED'});
 assert.equal(requests,2);assert.ok(signals.every(signal=>signal.aborted));assert.deepEqual(await fs.readdir(root),[]);
});

test('attempt cap cannot exceed three and progress callbacks cannot break downloads',async t=>{
 const root=await cache(t);let requests=0;
 await assert.rejects(cachedArchive(source,root,async()=>{requests++;throw Error('offline');},{...policy,maxAttempts:100}),{code:'TOOLCHAIN_DOWNLOAD_FAILED'});assert.equal(requests,3);
 const file=await cachedArchive(source,root,async()=>new Response(bytes),{...policy,onProgress(){throw Error('observer failed');}});assert.deepEqual(await fs.readFile(file),bytes);
});

test('private partials from earlier invocations are never reused or removed',async t=>{
 const root=await cache(t);const orphan=path.join(root,'.retk-download-orphan.tmp');await fs.writeFile(orphan,'old owned elsewhere');
 await cachedArchive(source,root,async(url,init)=>{assert.equal(init.headers?.Range,undefined);return new Response(bytes);},policy);
 assert.equal(await fs.readFile(orphan,'utf8'),'old owned elsewhere');
});

test('resumed archive identity is checked across the complete file',async t=>{
 const root=await cache(t);let requests=0;
 await assert.rejects(cachedArchive(source,root,async()=>++requests===1?interrupted(Buffer.from('wrong')):new Response(bytes.subarray(5),{status:206,headers:{'Content-Range':`bytes 5-${bytes.length-1}/${bytes.length}`}}),policy),{code:'TOOLCHAIN_INTEGRITY'});
 assert.equal(requests,2);assert.deepEqual(await fs.readdir(root),[]);
});

test('a transient HTTP failure preserves only the current invocation partial',async t=>{
 const root=await cache(t);let requests=0;
 const file=await cachedArchive(source,root,async(url,init)=>{
  if(++requests===1)return interrupted();assert.equal(init.headers.Range,'bytes=5-');
  return requests===2?new Response('',{status:503}):new Response(bytes.subarray(5),{status:206,headers:{'Content-Range':`bytes 5-${bytes.length-1}/${bytes.length}`}});
 },policy);
 assert.equal(requests,3);assert.deepEqual(await fs.readFile(file),bytes);
});

test('unsolicited partial response is terminal',async t=>{
 const root=await cache(t);let requests=0;
 await assert.rejects(cachedArchive(source,root,async()=>{requests++;return new Response(bytes,{status:206,headers:{'Content-Range':`bytes 0-${bytes.length-1}/${bytes.length}`}});},policy),{code:'TOOLCHAIN_DOWNLOAD_FAILED'});
 assert.equal(requests,1);assert.deepEqual(await fs.readdir(root),[]);
});

test('attempt timeout also bounds a transport which ignores AbortSignal',async t=>{
 const root=await cache(t);let requests=0;
 await assert.rejects(cachedArchive(source,root,async()=>{requests++;return new Promise(()=>{});},{...policy,attemptTimeoutMs:10,maxAttempts:2}),{code:'TOOLCHAIN_DOWNLOAD_FAILED'});
 assert.equal(requests,2);assert.deepEqual(await fs.readdir(root),[]);
});
