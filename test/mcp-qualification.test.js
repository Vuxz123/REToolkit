import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {qualifyMcpTransport} from './helpers/mcp-handshake.mjs';
const fixture=fileURLToPath(new URL('./fixtures/mcp-qualification-engine.mjs',import.meta.url));
test('qualification only initializes and lists every tool page, then confirms close',async()=>{
 const r=await qualifyMcpTransport({file:process.execPath,args:[fixture,'good']});assert.deepEqual(r.tools,['first','second']);assert.deepEqual(r.requests,['initialize','notifications/initialized','tools/list','tools/list']);assert.equal(r.closed,true);assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('qualification rejects broken protocol, early exits and deadlines with sanitized bounded errors',async()=>{
 for(const mode of ['hang','exit','malformed','oversized']){const start=Date.now();await assert.rejects(qualifyMcpTransport({file:process.execPath,args:[fixture,mode]},{timeoutMs:150}),e=>e.code?.startsWith('MCP_')&&!e.message.includes('SECRET'));assert.ok(Date.now()-start<2000);}
 await assert.rejects(qualifyMcpTransport({file:'missing-executable',args:[]},{timeoutMs:150}),{code:'MCP_START_FAILED'});
});

for(const mode of ['stderr-limit','combined-output-limit']){
 test(`qualification bounds ${mode} at 4 MiB`,async()=>{
  await assert.rejects(qualifyMcpTransport({file:process.execPath,args:[fixture,mode]},{timeoutMs:1500}),error=>error.code==='MCP_PROTOCOL_INVALID'&&!error.message.includes('SECRET'));
 });
}

test('qualification accepts exactly eight tool pages and rejects a ninth',async()=>{
 const result=await qualifyMcpTransport({file:process.execPath,args:[fixture,'eight-pages']});
 assert.deepEqual(result.tools,Array.from({length:8},(_,page)=>`tool-${page+1}`));
 assert.equal(result.requests.filter(method=>method==='tools/list').length,8);
 await assert.rejects(qualifyMcpTransport({file:process.execPath,args:[fixture,'nine-pages']}),{code:'MCP_PROTOCOL_INVALID'});
});

test('qualification accepts 4096 tools on each page and rejects 4097 on one page',async()=>{
 const result=await qualifyMcpTransport({file:process.execPath,args:[fixture,'4096-tools']});
 assert.equal(result.tools.length,8192);
 assert.equal(result.tools[0],'tool-0');
 assert.equal(result.tools.at(-1),'tool-8191');
 assert.equal(result.requests.filter(method=>method==='tools/list').length,2);
 await assert.rejects(qualifyMcpTransport({file:process.execPath,args:[fixture,'4097-tools']}),{code:'MCP_PROTOCOL_INVALID'});
});

for(const mode of ['duplicate-tools','duplicate-tools-across-pages','repeated-cursor','cyclic-cursors']){
 test(`qualification rejects ${mode}`,async()=>{
  await assert.rejects(qualifyMcpTransport({file:process.execPath,args:[fixture,mode]}),{code:'MCP_PROTOCOL_INVALID'});
 });
}

function fakeChild(write){
 const child=new EventEmitter();
 child.stdout=new PassThrough();
 child.stderr=new PassThrough();
 child.stdin=new Writable({write(chunk,encoding,callback){write(child,chunk,callback);}});
 child.kill=()=>false;
 child.unref=()=>{};
 return child;
}

test('qualification accepts exactly 4 MiB across stdout and discarded stderr',async()=>{
 const responses=[
  {jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-03-26',serverInfo:{name:'fixture',version:'1'}}},
  {jsonrpc:'2.0',id:2,result:{tools:[]}}
 ].map(response=>Buffer.from(JSON.stringify(response)+'\n'));
 const stdoutBytes=responses.reduce((sum,response)=>sum+response.length,0);
 const child=fakeChild((child,chunk,callback)=>{
  const request=JSON.parse(chunk.toString());
  callback();
  if(request.id===undefined)return;
  queueMicrotask(()=>{
   if(request.id===1)child.stderr.write(Buffer.alloc(4*1024**2-stdoutBytes,120));
   child.stdout.write(responses[request.id-1]);
  });
 });
 child.stdin.on('finish',()=>queueMicrotask(()=>child.emit('close',0,null)));
 const result=await qualifyMcpTransport({file:'owned-fixture',args:[]},{spawnImpl:()=>child});
 assert.deepEqual(result.tools,[]);
 assert.equal(result.closed,true);
});

test('qualification rejects broken stdin promptly without retaining its error text',async()=>{
 const child=fakeChild((child,chunk,callback)=>callback(Object.assign(new Error('SECRET broken input'),{code:'EPIPE'})));
 child.stdin.on('error',()=>queueMicrotask(()=>child.emit('close',1,null)));
 const start=Date.now();
 await assert.rejects(qualifyMcpTransport({file:'owned-fixture',args:[]},{spawnImpl:()=>child,timeoutMs:1500}),error=>error.code==='MCP_INPUT_CLOSED'&&!error.message.includes('SECRET')&&!error.preserveToolchainGate);
 assert.ok(Date.now()-start<1000);
});

test('qualification preserves runtime ownership when owned child close remains unconfirmed', {timeout:4000},async()=>{
 const child=fakeChild((child,chunk,callback)=>{
  const request=JSON.parse(chunk.toString());
  callback();
  if(request.id===undefined)return;
  const result=request.method==='initialize'?{protocolVersion:'2025-03-26',serverInfo:{name:'fixture',version:'1'}}:{tools:[]};
  queueMicrotask(()=>child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n'));
 });
 const killed=[];let unreferenced=false;
 child.kill=signal=>{killed.push(signal);return false;};
 child.unref=()=>{unreferenced=true;};
 const start=Date.now();
 await assert.rejects(qualifyMcpTransport({file:'owned-fixture',args:[]},{spawnImpl:()=>child,timeoutMs:2000}),{code:'MCP_CHILD_UNCERTAIN',preserveToolchainGate:true});
 assert.ok(Date.now()-start>=900,'must allow the bounded graceful and forced close windows');
 assert.ok(Date.now()-start<3000,'unconfirmed close must not hang');
 assert.deepEqual(killed,[undefined,'SIGKILL']);
 assert.equal(unreferenced,true);
 for(const stream of [child.stdin,child.stdout,child.stderr])assert.equal(stream.destroyed,true);
});

test('qualification refuses an unsupported negotiated protocol before any tools request',async()=>{
 const methods=[];const child=fakeChild((child,chunk,callback)=>{const q=JSON.parse(chunk.toString());methods.push(q.method);callback();if(q.id===undefined)return;queueMicrotask(()=>child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result:q.method==='initialize'?{protocolVersion:'nonsense',serverInfo:{version:'1'}}:{tools:[]}})+'\n'));});child.stdin.on('finish',()=>queueMicrotask(()=>child.emit('close',0,null)));await assert.rejects(qualifyMcpTransport({file:'fixture'},{spawnImpl:()=>child}),{code:'MCP_PROTOCOL_INVALID'});assert.deepEqual(methods,['initialize']);
});
test('qualification refuses unterminated trailing stdout even after valid tool results',async()=>{
 const child=fakeChild((child,chunk,callback)=>{const q=JSON.parse(chunk.toString());callback();if(q.id===undefined)return;queueMicrotask(()=>{child.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result:q.method==='initialize'?{protocolVersion:'2025-03-26',serverInfo:{version:'1'}}:{tools:[]}})+'\n');if(q.method==='tools/list')child.stdout.write('SECRET unterminated bytes');});});child.stdin.on('finish',()=>queueMicrotask(()=>child.emit('close',0,null)));await assert.rejects(qualifyMcpTransport({file:'fixture'},{spawnImpl:()=>child}),e=>e.code==='MCP_PROTOCOL_INVALID'&&!e.message.includes('SECRET'));
});
