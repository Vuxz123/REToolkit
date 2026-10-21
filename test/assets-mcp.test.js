import test from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {serveAssetsMcp,assetTools} from '../src/assets/mcp.js';
test('assets MCP has typed schemas and clean bounded JSON-RPC dispatch',async()=>{
  const input=new PassThrough(),output=new PassThrough();let stdout='';output.on('data',bytes=>stdout+=bytes);
  const calls=[];const done=serveAssetsMcp({},'Game',{input,output,operation:async(...args)=>{calls.push(args);return {revision:'a'.repeat(64),items:[]};}});
  for(const message of [{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'test',version:'1'}}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'assets_list',arguments:{limit:5}}},{jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'assets_list',arguments:{url:'http://foreign'}}}])input.write(JSON.stringify(message)+'\n');input.end();await done;
  const responses=stdout.trim().split('\n').map(JSON.parse);assert.equal(responses.length,4);assert.equal(calls.length,1);assert.equal(responses.at(-1).error.code,-32602);
  assert(assetTools.every(t=>t.inputSchema.additionalProperties===false));assert(assetTools.some(t=>t.name==='reconstruct_apply'));
  assert(assetTools.some(t=>t.name==='reconstruct_validate'));assert(assetTools.some(t=>t.name==='reconstruct_validation'));
  assert(assetTools.some(t=>t.name==='libraries_import'));assert(!assetTools.some(t=>t.name==='libraries_roots_add'));
});
test('MCP rejects initialized-before-initialize and drains oversized frames',async()=>{
 const input=new PassThrough(),output=new PassThrough();let stdout='';output.on('data',bytes=>stdout+=bytes);let calls=0;
 const done=serveAssetsMcp({},'Game',{input,output,operation:async()=>{calls++;return {};}});
 input.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 input.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'assets_index',arguments:{}}})+'\n');
 input.write('x'.repeat(1024**2+1)+'\n');
 input.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'ping'})+'\n');input.end();await done;
 const responses=stdout.trim().split('\n').map(JSON.parse);assert.equal(calls,0);assert.equal(responses[0].error.code,-32002);assert.equal(responses[1].error.code,-32600);assert.deepEqual(responses[2].result,{});
});
