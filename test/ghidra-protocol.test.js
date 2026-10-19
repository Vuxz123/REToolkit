import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createFrameDecoder, requestFrame, mutationHash, BridgeError } from '../src/ghidra/protocol.js';
import { connectClient } from '../src/ghidra/client.js';

test('NDJSON decodes fragmented UTF8 and rejects oversized/malformed frames',()=>{
  const results=[]; const decode=createFrameDecoder(value=>results.push(value),64);
  const data=Buffer.from('{"text":"Tiếng Việt"}\n');
  for(const byte of data) decode(Buffer.from([byte]));
  assert.deepEqual(results,[{text:'Tiếng Việt'}]);
  assert.throws(()=>decode(Buffer.from('x'.repeat(65))),/limit/);
  assert.throws(()=>createFrameDecoder(()=>{})(Buffer.from('{oops}\n')),/JSON/);
});
test('request allowlist, exact addresses and canonical mutation hash',()=>{
  const binding={runId:'run',token:'secret'};
  assert.equal(JSON.parse(requestFrame(binding,'1','memory.read',{address:'0xffffffffffffffff',length:1})).params.address,'0xffffffffffffffff');
  assert.throws(()=>requestFrame(binding,'1','eval',{}),/method/);
  assert.equal(mutationHash('functions.rename',{name:'X',address:'0x1',operationId:'one'}),mutationHash('functions.rename',{address:'0x1',name:'X',operationId:'two'}));
  assert.throws(()=>requestFrame(binding,'1','comments.set',{text:'x'.repeat(65536)}),/limit/);
});
test('TCP client authenticates and rejects response binding mismatch without replay',async()=>{
  let calls=0;
  const server=net.createServer(socket=>{
    const decode=createFrameDecoder(request=>{
      calls++; assert.equal(request.token,'secret');
      socket.write(JSON.stringify({version:1,id:request.id,runId:'other',ok:true,result:{}})+'\n');
    }); socket.on('data',decode);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const client=await connectClient({host:'127.0.0.1',port:server.address().port,runId:'run',token:'secret'});
  try { await assert.rejects(client.request('session.status',{}),error=>error instanceof BridgeError&&error.code==='protocol_mismatch'); assert.equal(calls,1); }
  finally {client.close(); await new Promise(resolve=>server.close(resolve));}
});
test('client preserves structured engine error and enforces request deadline',async()=>{
  const server=net.createServer(socket=>{socket.on('data',createFrameDecoder(request=>{
    if(request.method==='session.status') socket.write(JSON.stringify({version:1,id:request.id,runId:'run',ok:false,error:{code:'needs_recovery',message:'inspect receipt'}})+'\n');
  }));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const client=await connectClient({host:'127.0.0.1',port:server.address().port,runId:'run',token:'secret'});
  try {
    await assert.rejects(client.request('session.status'),error=>error.code==='needs_recovery');
    await assert.rejects(client.request('control.heartbeat',{}, {timeoutMs:50}),error=>error.code==='request_timeout');
  } finally {client.close(); await new Promise(resolve=>server.close(resolve));}
});
