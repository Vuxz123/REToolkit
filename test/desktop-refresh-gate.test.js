import test from 'node:test';
import assert from 'node:assert/strict';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
const gate=async read=>(await import('../src/desktop/refresh-gate.js')).createRefreshGate(read);

test('refresh coalesces overlapping callers and waits for a fresh trailing read',async()=>{
 const first=deferred(),last=deferred();let count=0,done=false;
 const refresh=await gate(()=>++count===1?first.promise:last.promise),active=refresh();await flush();assert.equal(count,1);
 assert.equal(refresh(),active);assert.equal(refresh(),active);active.then(()=>done=true);first.resolve('stale snapshot');await flush();assert.equal(count,2);assert.equal(done,false);
 last.resolve('terminal snapshot');assert.equal(await active,'terminal snapshot');assert.equal(count,2);
});
test('a refresh arriving during the trailing read gets another fresh read without overlap',async()=>{
 const reads=[deferred(),deferred(),deferred()];let count=0,inflight=0,max=0;
 const refresh=await gate(async()=>{const index=count++;max=Math.max(max,++inflight);try{return await reads[index].promise;}finally{inflight--;}}),active=refresh();await flush();refresh();reads[0].resolve(1);await flush();assert.equal(count,2);assert.equal(refresh(),active);reads[1].resolve(2);await flush();assert.equal(count,3);reads[2].resolve(3);assert.equal(await active,3);assert.equal(max,1);
});
test('a queued refresh still runs after an active read fails',async()=>{
 const first=deferred();let count=0;const refresh=await gate(()=>++count===1?first.promise:Promise.resolve('recovered')),active=refresh();await flush();refresh();first.reject(new Error('transient'));assert.equal(await active,'recovered');assert.equal(count,2);
});
test('failure rejects all active callers and a later refresh can retry',async()=>{
 let count=0;const refresh=await gate(()=>{if(++count===1)throw new Error('snapshot unavailable');return 'retry';});await assert.rejects(refresh(),/snapshot unavailable/);assert.equal(await refresh(),'retry');assert.equal(count,2);
});
