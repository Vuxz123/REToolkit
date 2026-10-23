import test from 'node:test';
import assert from 'node:assert/strict';

test('initialization freshness rechecks native binding and verified dump after asynchronous analysis',async()=>{
 const api=await import('../src/reconstruction/initialization-context.js').catch(()=>({}));assert.equal(typeof api.initializationContext,'function');
 const binding={native:{sha256:'a'.repeat(64),size:7},metadata:{sha256:'b'.repeat(64),size:9},program:'Game',projectName:'Game'};
 const snapshot={verified:true,sha256:'c'.repeat(64),build:binding};let current=structuredClone(snapshot),selected=structuredClone(binding),reads=0;
 const context=api.initializationContext({changes:[{mode:'initialization'}],dump:snapshot,expectedBinding:binding,readDump:()=>{reads++;return current;},readBinding:()=>selected});
 await context.assertContextCurrent();assert.equal(reads,1);
 current={...snapshot,verified:false};await assert.rejects(async()=>context.assertContextCurrent(),{code:'stale_graph'});
 current={...snapshot,sha256:'d'.repeat(64)};await assert.rejects(async()=>context.assertContextCurrent(),{code:'stale_graph'});
 current=structuredClone(snapshot);selected={...binding,program:'Another'};await assert.rejects(async()=>context.assertContextCurrent(),{code:'stale_graph'});
});

test('body-only operations do not impose constructor dump requirements',async()=>{
 const api=await import('../src/reconstruction/initialization-context.js').catch(()=>({}));assert.equal(typeof api.initializationContext,'function');let reads=0;
 const context=api.initializationContext({changes:[{mode:'bodies'}],readDump:()=>{reads++;throw Error('unavailable');}});
 assert.deepEqual(context,{});assert.equal(reads,0);
});
