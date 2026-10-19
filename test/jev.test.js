import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createToolkit} from '../src/toolkit.js';
import {createHandoff} from '../src/handoff.js';
import {buildJevRequest,validateJevRequest,runJevRequest,TYPESAFE_ENDPOINT} from '../src/jev.js';
const questions={observed:{type:'noul',instructions:'Is there direct evidence of this behavior?'}};
const request={model:'jev-latest',state:{text:'untrusted evidence'},questions};
const answer={model:'jev-1.13.0',answers:{observed:{type:'noul',noul:0.8}},usage:{input_tokens:10,output_tokens:3}};
async function bundle(t){
 const {createHandoff}=await import('../src/handoff.js');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-jev-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const toolkit=createToolkit(root,{log:()=>{}});
 await toolkit.init('Game');fs.mkdirSync(path.join(root,'input'));fs.writeFileSync(path.join(root,'input/GameAssembly.dll'),'MZowned');fs.writeFileSync(path.join(root,'input/global-metadata.dat'),'metadata');await toolkit.scan('Game',path.join(root,'input'));
 fs.writeFileSync(path.join(toolkit.workspace('Game'),'04_Notes/review.md'),'Observed function entry, not original source.');
 return {root,...await createHandoff(toolkit,'Game',{})};
}
test('offline Jev request uses verified portable evidence and keeps primary/against states explicit',async t=>{
 const item=await bundle(t);const result=await buildJevRequest(item.path,{against:item.path,questions});
 assert.equal(result.model,'jev-latest');assert.deepEqual(result.questions,questions);assert.equal(result.state.artifacts.length,2);
 assert.ok(result.state.artifacts[0].files.some(file=>file.text.includes('Observed function')));
 assert.ok(!JSON.stringify(result.state).includes(item.root));assert.equal(result.state.artifacts[0].label,'primary');assert.equal(result.state.artifacts[1].label,'against');
 await assert.rejects(buildJevRequest(item.path,{questions,maxStateBytes:16}),error=>error.code==='jev_state_too_large');
 const note=item.manifest.files.find(file=>file.path.endsWith('review.md'));fs.appendFileSync(path.join(item.path,note.path),'tampered');
 await assert.rejects(buildJevRequest(item.path,{questions}),/verif|hash|mismatch|invalid/i);
});
test('request validation enforces documented typed questions, depth and exact values',()=>{
 validateJevRequest(request);
 for(const question of [ {type:'chat',instructions:'text'}, {type:'score',instructions:'rate',criteria:['one']},
   {type:'choice',instructions:'choose',criteria:{}}, {type:'noul'}, {type:'noul',instructions:'x',criteria:{maybe:'no'}} ])
   assert.throws(()=>validateJevRequest({...request,questions:{bad:question}}),error=>error.code==='jev_request_invalid');
 assert.throws(()=>validateJevRequest({...request,state:{bad:Infinity}}));
 assert.throws(()=>validateJevRequest({...request,state:{address:9007199254740992}}));
 let deep='leaf';for(let i=0;i<65;i++)deep={deep};assert.throws(()=>validateJevRequest({...request,state:deep}),/depth|nest/i);
});
test('explicit Jev HTTP action uses fixed HTTPS endpoint, bearer auth and validated typed response',async()=>{
 let calls=0;const result=await runJevRequest(request,{apiKey:'test-private-key',fetchImpl:async(url,options)=>{
   calls++;assert.equal(url,TYPESAFE_ENDPOINT);assert.equal(url,'https://api.typesafe.ai/v1/systemone');assert.equal(options.headers.Authorization,'Bearer test-private-key');
   assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),request);return new Response(JSON.stringify(answer),{headers:{'Content-Type':'application/json'}});
 }});assert.equal(calls,1);assert.deepEqual(result,answer);assert.ok(!JSON.stringify(result).includes('test-private-key'));
});
test('Jev fails before network without a key, never retries/errors echo credentials, and rejects invalid answers',async()=>{
 let calls=0;await assert.rejects(runJevRequest(request,{apiKey:'',fetchImpl:async()=>{calls++;}}),error=>error.code==='jev_auth_missing');assert.equal(calls,0);
 for(const status of [401,413,422,429,529]){
  calls=0;await assert.rejects(runJevRequest(request,{apiKey:'test-private-key',fetchImpl:async()=>{calls++;return new Response('{"secret":"test-private-key"}',{status});}}),error=>!error.message.includes('test-private-key')&&error.status===status);assert.equal(calls,1);
 }
 for(const value of [{...answer,answers:{}},{...answer,answers:{observed:{type:'noul',noul:2}}},{...answer,answers:{observed:{type:'choice',choice:'x'}}}])
  await assert.rejects(runJevRequest(request,{apiKey:'key',fetchImpl:async()=>new Response(JSON.stringify(value))}),error=>error.code==='jev_response_invalid');
 await assert.rejects(runJevRequest(request,{apiKey:'key',timeoutMs:20,fetchImpl:async()=>new Promise(()=>{})}),error=>error.code==='jev_timeout');
});
test('response stream failures never expose transport secrets',async()=>{
 await assert.rejects(runJevRequest(request,{apiKey:'private-key',fetchImpl:async()=>new Response(new ReadableStream({start(controller){controller.error(new Error('Bearer private-key'));}}))}),error=>error.code==='jev_connection_failed'&&!error.message.includes('private-key'));
});
test('aggregate declared text budget rejects before decoding selected contents',async t=>{
 const item=await bundle(t);const toolkit=createToolkit(item.root,{log:()=>{}}),notes=path.join(toolkit.workspace('Game'),'04_Notes');
 fs.writeFileSync(path.join(notes,'a.md'),'a'.repeat(4000));fs.writeFileSync(path.join(notes,'b.md'),Buffer.alloc(4000,0xff));
 const larger=await createHandoff(toolkit,'Game',{});
 await assert.rejects(buildJevRequest(larger.path,{questions,maxStateBytes:6000}),error=>error.code==='jev_state_too_large');
});
test('choice and score answers retain typed probabilities and strict legend strings',async()=>{
 const typed={...request,questions:{choice:{type:'choice',instructions:'Select observed behavior',criteria:{a:'A',b:'B'}},score:{type:'score',instructions:'Rate evidence',criteria:['Low','High']}}};
 const response={model:'jev-fixture',answers:{choice:{type:'choice',choice:'a',probabilities:{a:0.7,b:0.3},confidence:0.7},score:{type:'score',score:0.8,probabilities:{0:0.2,1:0.8},confidence:0.8,legend:{0:'Low',1:'High'}}},usage:{input_tokens:10,output_tokens:10}};
 const send=value=>runJevRequest(typed,{apiKey:'key',fetchImpl:async()=>new Response(JSON.stringify(value))});
 assert.deepEqual(await send(response),response);
 for(const legend of [{0:123,1:'High'},{0:'Low',1:{}},{0:'Low',1:'High',extra:'x'}])await assert.rejects(send({...response,answers:{...response.answers,score:{...response.answers.score,legend}}}),error=>error.code==='jev_response_invalid');
});
