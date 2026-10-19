// Read-only handshake with an existing installed Python bridge. No target queries.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=process.argv[2]; if(!root) throw Error('Usage: node test/real-mcp.mjs <installed-toolkit>');
const child=spawn(process.execPath,[fileURLToPath(new URL('../re.js',import.meta.url)),'mcp','--root',root],{stdio:['pipe','pipe','pipe'],windowsHide:true});
let stderr=''; child.stderr.on('data',data=>stderr+=data);
const pending=new Map(); let protocolError;
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{
  try { const message=JSON.parse(line); if(pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } }
  catch(error) { protocolError=error; child.stdin.end(); }
});
const timer=setTimeout(()=>{ for(const resolve of pending.values()) resolve({error:{message:`MCP handshake timed out: ${stderr}`}}); child.stdin.end(); },12000);
const call=(id,method,params)=>new Promise(resolve=>{ pending.set(id,resolve); child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n'); });
try {
  const init=await call(1,'initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'retk-readonly-smoke',version:'1'}});
  assert.ok(init.result,JSON.stringify(init.error));
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const listed=await call(2,'tools/list',{}); assert.ok(Array.isArray(listed.result?.tools),JSON.stringify(listed.error));
  assert.equal(protocolError,undefined);
  console.log(`Real MCP initialization and tools/list passed (${listed.result.tools.length} advertised tools); no target was queried.`);
} finally {
  clearTimeout(timer); child.stdin.end();
  await new Promise(resolve=>child.once('close',resolve)); lines.close();
}
