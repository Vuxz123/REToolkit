import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const fixture=fileURLToPath(new URL('./fixtures/mcp-diagnostic-engine.mjs',import.meta.url));
const run=async(mode,extra={})=>{
  const {probeMcp}=await import('../src/mcp-probe.js');
  return probeMcp({tools:{bridge:'unused'},root:process.cwd(),env:process.env},{project:'Game',program:'libil2cpp.so',timeoutMs:1500,launch:{file:process.execPath,args:[fixture,mode]},...extra});
};
test('MCP discovery never promotes matching names to verified native identity',async()=>{
  const result=await run('matching');
  assert.equal(result.state,'unknown');assert.equal(result.code,'MCP_IDENTITY_UNVERIFIED');
  assert.deepEqual(result.evidence.tools,['list_instances']);
  assert.equal(result.evidence.instances[0].project,'Game');
  assert.doesNotMatch(JSON.stringify(result),/SECRET|token|stderr/);
});
test('MCP exact project selection rejects substring matches',async()=>{
  const result=await run('wrong-project');assert.equal(result.code,'MCP_PROJECT_MISMATCH');assert.equal(result.state,'blocked');
});
test('MCP distinguishes wrong current program from missing instance',async()=>{
  assert.equal((await run('wrong-program')).code,'MCP_PROGRAM_MISMATCH');
  assert.equal((await run('empty')).code,'MCP_INSTANCE_NOT_RUNNING');
});
test('MCP only calls advertised discovery and cannot query target content',async()=>{
  assert.equal((await run('unsupported')).code,'MCP_DISCOVERY_UNAVAILABLE');
});
test('MCP child has bounded deadline and protocol output',async()=>{
  const start=Date.now();assert.equal((await run('hang',{timeoutMs:100})).code,'MCP_PROBE_TIMEOUT');assert.ok(Date.now()-start<2000);
  assert.equal((await run('oversized')).code,'MCP_PROTOCOL_ERROR');
  assert.equal((await run('malformed')).code,'MCP_PROTOCOL_ERROR');
});
test('MCP child launch failure is sanitized',async()=>{
  const result=await run('matching',{launch:{file:'nonexistent-mcp-diagnostic-executable-SECRET',args:[]}});
  assert.equal(result.code,'MCP_BRIDGE_START_FAILED');assert.doesNotMatch(JSON.stringify(result),/SECRET/);
});
test('MCP premature child exit is bounded and sanitized',async()=>{
 assert.equal((await run('exit')).code,'MCP_BRIDGE_EXITED');
});
