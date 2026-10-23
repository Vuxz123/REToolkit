import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {createToolkit} from '../src/toolkit.js';
import {startJob,executeJob} from '../src/jobs/service.js';
import {serveAssetsMcp} from '../src/assets/mcp.js';

test('MCP ping/get stay responsive while jobs_wait awaits the same durable job',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-mcp-wait-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Game');
 const job=await startJob(toolkit,'Game',{operation:'workspace.status',params:{}},{spawn:()=>({pid:process.pid,once(){return this;},unref(){}})});let release;const gate=new Promise(resolve=>release=resolve);
 const worker=executeJob(toolkit,'Game',job.jobId,{invoke:async()=>{await gate;return {done:true};}}),input=new PassThrough(),output=new PassThrough();let wire='';output.on('data',bytes=>wire+=bytes);const server=serveAssetsMcp(toolkit,'Game',{input,output});
 const send=value=>input.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');
 send({id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'wait-fixture',version:'1'}}});send({method:'notifications/initialized'});
 await delay(10);send({id:2,method:'tools/call',params:{name:'jobs_wait',arguments:{jobId:job.jobId,timeoutSeconds:1}}});send({id:3,method:'ping'});send({id:4,method:'tools/call',params:{name:'jobs_get',arguments:{jobId:job.jobId}}});
 let ping,observed;try{for(let i=0;i<30;i++){const replies=wire.trim().split('\n').filter(Boolean).map(JSON.parse);ping=replies.find(r=>r.id===3);observed=replies.find(r=>r.id===4);if(ping&&observed)break;await delay(10);}assert(ping&&observed,'A wait must not block independent ping/status calls');assert.equal(JSON.parse(observed.result.content[0].text).state,'running');assert(!wire.includes('"id":2,'),'Wait should still be pending');}
 finally{release();await worker;input.end();await server;}
 const completion=wire.trim().split('\n').map(JSON.parse).find(r=>r.id===2);assert.equal(JSON.parse(completion.result.content[0].text).wait.state,'terminal');
});
