import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {TYPESAFE_ENDPOINT} from '../src/jev.js';
const settings={kind:'retoolkit-jev-settings',schemaVersion:1,endpoint:TYPESAFE_ENDPOINT,model:'jev-latest',apiKeyEnv:'JEV_TEST_KEY'};
const secret='fixture-token-never-output';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-jev-settings-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
const api=()=>import('../src/jev-settings.js');
const response=()=>new Response(JSON.stringify({model:'jev-1.14.0',answers:{connectivity:{type:'noul',noul:0.99}},usage:{input_tokens:12,output_tokens:1}}),{status:200,headers:{'Content-Type':'application/json'}});
test('settings load is offline and side-effect free; save atomically records only references',async t=>{
 const root=fixture(t),{loadJevSettings,saveJevSettings}=await api(),before=fs.readdirSync(root),defaults=loadJevSettings(root,{env:{}});assert.equal(defaults.configured,false);assert.equal(defaults.authentication.present,false);assert.deepEqual(fs.readdirSync(root),before);
 const saved=await saveJevSettings(root,settings,{env:{JEV_TEST_KEY:secret}});assert.equal(saved.configured,true);assert.equal(saved.authentication.present,true);assert.equal(saved.authentication.valid,true);assert.equal(saved.network,'not-sent');assert.equal(saved.settingsSha256.length,64);assert.equal(saved.storedSettings,'config/jev.json');
 assert.equal(JSON.stringify(saved).includes(secret),false);assert.equal(fs.readFileSync(path.join(root,'config/jev.json'),'utf8').includes(secret),false);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'config/jev.json'))),settings);
 const next=await saveJevSettings(root,{...settings,model:'jev-1.14.0'},{env:{}});assert.equal(next.settings.model,'jev-1.14.0');assert.equal(fs.readdirSync(path.join(root,'config')).length,1);
});
test('settings reject raw keys, alternate endpoints, malformed models/env and corrupt local config without echo',async t=>{
 const root=fixture(t),{saveJevSettings,loadJevSettings}=await api();for(const mutate of [s=>s.apiKey=secret,s=>s.endpoint='https://attacker.invalid/v1/systemone',s=>s.endpoint='https://api.typesafe.ai/v1/systemone?token='+secret,s=>s.endpoint='http://api.typesafe.ai/v1/systemone',s=>s.model='unsafe model',s=>s.apiKeyEnv='KEY=value',s=>s.schemaVersion=2,s=>delete s.apiKeyEnv]){const value={...settings};mutate(value);await assert.rejects(saveJevSettings(root,value),e=>e.code==='jev_settings_invalid'&&!e.message.includes(secret));}
 fs.mkdirSync(path.join(root,'config'),{recursive:true});fs.writeFileSync(path.join(root,'config/jev.json'),'{"apiKey":"'+secret+'"');assert.throws(()=>loadJevSettings(root),e=>e.code==='jev_settings_invalid'&&!e.message.includes(secret));
});
test('test sends exactly a tiny synthetic request through existing typed response validation',async t=>{
 const root=fixture(t),{saveJevSettings,testJevSettings}=await api();await saveJevSettings(root,settings);let calls=0;
 const result=await testJevSettings(root,{env:{JEV_TEST_KEY:secret},fetchImpl:async(url,options)=>{calls++;assert.equal(url,TYPESAFE_ENDPOINT);assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+secret);const body=JSON.parse(options.body);assert.equal(body.model,settings.model);assert.equal(body.questions.connectivity.type,'noul');assert.ok(options.body.length<1024);assert.equal(options.body.includes(secret),false);assert.match(JSON.stringify(body.state),/synthetic/i);return response();}});
 assert.equal(result.ok,true);assert.equal(result.network,'sent');assert.equal(result.typedResponseVerified,true);assert.equal(result.authenticationVerified,true);assert.equal(result.content,'synthetic-only');assert.equal(calls,1);assert.equal(JSON.stringify(result).includes(secret),false);
});
test('missing/invalid auth never sends, and failed or invalid responses stay explicit without secrets',async t=>{
 const root=fixture(t),{saveJevSettings,testJevSettings}=await api();await saveJevSettings(root,settings);let calls=0;const fetchImpl=async()=>{calls++;return response();};
 for(const env of [{},{JEV_TEST_KEY:'  '},{JEV_TEST_KEY:'unsafe\r\nheader'}]){const result=await testJevSettings(root,{env,fetchImpl});assert.equal(result.ok,false);assert.equal(result.network,'not-sent');assert.equal(result.authenticationVerified,false);}assert.equal(calls,0);
 for(const [fetchImpl,expected] of [[async()=>new Response(secret,{status:401}),'jev_auth_failed'],[async()=>new Response('{}',{status:200}),'jev_response_invalid'],[async()=>{throw Error(secret);},'jev_connection_failed']]){const result=await testJevSettings(root,{env:{JEV_TEST_KEY:secret},fetchImpl});assert.equal(result.ok,false);assert.equal(result.error.code,expected);assert.equal(JSON.stringify(result).includes(secret),false);}
});
test('configured request runs preserve request bytes and fail closed on model mismatch before network',async t=>{
 const root=fixture(t),{saveJevSettings,runConfiguredJevRequest}=await api();await saveJevSettings(root,settings);const request={model:'jev-latest',state:'selected user evidence',questions:{connectivity:{type:'noul',instructions:'Is this selected evidence?'}}},before=JSON.stringify(request);let calls=0;
 await runConfiguredJevRequest(root,request,{env:{JEV_TEST_KEY:secret},fetchImpl:async(url,options)=>{calls++;assert.equal(options.body,before);return response();}});assert.equal(JSON.stringify(request),before);
 await assert.rejects(runConfiguredJevRequest(root,{...request,model:'jev-other'},{env:{JEV_TEST_KEY:secret},fetchImpl:async()=>{calls++;return response();}}),e=>e.code==='jev_settings_mismatch');assert.equal(calls,1);
});
test('settings CLI is strict, handles save/show/test and emits no secrets',async t=>{
 const root=fixture(t),{parseJevSettingsArgs,isJevSettingsCommand,runJevSettingsCli}=await import('../src/jev-settings-cli.js');assert.equal(isJevSettingsCommand(['--root',root,'jev-settings','show']),true);assert.equal(parseJevSettingsArgs(['jev-settings','show','--json']).action,'show');
 for(const argv of [['jev-settings','save'],['jev-settings','show','--request','x'],['jev-settings','test','--key',secret],['jev-settings','save','--request','x','--request','y'],['jev-settings','test','extra'],['jev-settings','--json=true','--help']])assert.throws(()=>parseJevSettingsArgs(argv));
 const requestFile=path.join(root,'settings-request.json');fs.writeFileSync(requestFile,JSON.stringify(settings));const lines=[];await runJevSettingsCli(['jev-settings','save','--request',requestFile,'--root',root,'--json'],root,{write:s=>lines.push(s),env:{JEV_TEST_KEY:secret}});assert.equal(JSON.parse(lines.pop()).configured,true);
 const shown=await runJevSettingsCli(['jev-settings','show'],root,{write:s=>lines.push(s),env:{JEV_TEST_KEY:secret}});assert.equal(shown.authentication.present,true);assert.equal(lines.pop().includes(secret),false);
});

test('namespace restrictions protect executable environment and strict CLI never infers a missing action',async t=>{
 const root=fixture(t),{saveJevSettings}=await api(),{parseJevSettingsArgs}=await import('../src/jev-settings-cli.js');
 for(const apiKeyEnv of ['NODE_OPTIONS','PATH','TYPESAFE_','JEV_lower','JEV_KEY=secret','JEV_'+('A'.repeat(97))])await assert.rejects(saveJevSettings(root,{...settings,apiKeyEnv}),e=>e.code==='jev_settings_invalid');
 for(const argv of [['jev-settings','--request','x'],['jev-settings'],['jev-settings','show','--root='],['jev-settings','test','--root','x','--root=y']])assert.throws(()=>parseJevSettingsArgs(argv));
});
test('connection test bounds time, settings changes and error details without publishing a false success',async t=>{
 const root=fixture(t),{saveJevSettings,testJevSettings}=await api();await saveJevSettings(root,settings);
 const timeout=await testJevSettings(root,{env:{JEV_TEST_KEY:secret},timeoutMs:5,fetchImpl:async()=>new Promise(()=>{})});assert.equal(timeout.ok,false);assert.equal(timeout.error.code,'jev_timeout');
 const stale=await testJevSettings(root,{env:{JEV_TEST_KEY:secret},fetchImpl:async()=>{await saveJevSettings(root,{...settings,model:'jev-1.14.0'});return response();}});assert.equal(stale.ok,false);assert.equal(stale.error.code,'jev_settings_stale');assert.equal(stale.authenticationVerified,false);assert.equal(JSON.stringify(stale).includes(secret),false);
});
test('linked settings ancestors and oversized or non-UTF8 JSON are refused without output paths',async t=>{
 const root=fixture(t),outside=fixture(t),{loadJevSettings,saveJevSettings}=await api();fs.symlinkSync(outside,path.join(root,'config'),process.platform==='win32'?'junction':'dir');assert.throws(()=>loadJevSettings(root));await assert.rejects(saveJevSettings(root,settings));assert.deepEqual(fs.readdirSync(outside),[]);
 const other=fixture(t);fs.mkdirSync(path.join(other,'config'));for(const bytes of [Buffer.alloc(16385,32),Buffer.from([0xff,0xfe,0xff])]){fs.writeFileSync(path.join(other,'config/jev.json'),bytes);assert.throws(()=>loadJevSettings(other),e=>e.code==='jev_settings_invalid');}
});
test('connection summaries whitelist numeric usage rather than echoing server extension fields',async t=>{
 const root=fixture(t),{saveJevSettings,testJevSettings}=await api();await saveJevSettings(root,settings);const result=await testJevSettings(root,{env:{JEV_TEST_KEY:secret},fetchImpl:async()=>new Response(JSON.stringify({model:secret,answers:{connectivity:{type:'noul',noul:0.99,echo:secret}},usage:{input_tokens:1,output_tokens:2,echo:secret}}))});assert.equal(result.ok,true);assert.deepEqual(result.usage,{input_tokens:1,output_tokens:2});assert.equal(JSON.stringify(result).includes(secret),false);
});
