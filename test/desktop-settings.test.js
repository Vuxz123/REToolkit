import test from 'node:test';import assert from 'node:assert/strict';import {createSettingsController} from '../src/desktop/settings.js';
test('Jev settings keep a GUI session key out of settings DTO, history and returned status',async()=>{
 const env={},settings={apiKeyEnv:'TYPESAFE_API_KEY'},calls=[];
 const c=createSettingsController('.', {env,load:(_r,{env:effective})=>({settings,authentication:{present:!!effective.TYPESAFE_API_KEY}}),save:(_r,v)=>{calls.push(v);return {};},test:async(_r,{env:effective})=>{assert.equal(effective.TYPESAFE_API_KEY,'private-secret');return {connected:true};},canModify:()=>true});
 await c.save({settings,apiKey:'private-secret'});assert.equal(env.TYPESAFE_API_KEY,undefined);assert.deepEqual(calls,[settings]);assert.ok(!JSON.stringify(c.get()).includes('private-secret'));assert.equal(c.get().authentication.present,true);assert.deepEqual(await c.test(),{connected:true});assert.equal(c.busy(),false);
 await assert.rejects(c.save({settings:{apiKeyEnv:'NODE_OPTIONS'},apiKey:'danger'}));assert.equal(env.NODE_OPTIONS,undefined);
});
test('only the selected Jev credential enters an explicit Jev child environment',async()=>{
 const env={TYPESAFE_API_KEY:'host-key',JEV_OLD_KEY:'old-key',OPENAI_API_KEY:'agent-auth',PATH:'retained'};let settings={apiKeyEnv:'TYPESAFE_API_KEY'};
 const c=createSettingsController('.',{env,load:(_r,{env:effective})=>({settings,authentication:{present:!!effective[settings.apiKeyEnv]}}),save:(_r,value)=>{settings=value;},test:()=>({})});
 await c.save({settings,apiKey:'gui-private-key'});
 const selected=c.jevEnvironment();assert.equal(selected.TYPESAFE_API_KEY,'gui-private-key');assert.equal(selected.JEV_OLD_KEY,undefined);assert.equal(selected.OPENAI_API_KEY,'agent-auth');assert.equal(env.TYPESAFE_API_KEY,'host-key');
 await c.save({settings:{apiKeyEnv:'JEV_OTHER_KEY'}});assert.equal(c.jevEnvironment().TYPESAFE_API_KEY,undefined);assert.equal(c.jevEnvironment().JEV_OTHER_KEY,undefined);
});
test('Settings snapshots preserve Windows case-insensitive inherited credential lookup',async()=>{
 const values={typesafe_api_key:'owned-host-key'},env=new Proxy(values,{get:(target,key)=>typeof key==='string'?target[Object.keys(target).find(name=>name.toLowerCase()===key.toLowerCase())]:target[key]});
 const settings={apiKeyEnv:'TYPESAFE_API_KEY'},controller=createSettingsController('.',{env,load:(_root,{env:effective})=>({settings,authentication:{present:!!effective[settings.apiKeyEnv]}}),save:()=>({}),test:(_root,{env:effective})=>({present:!!effective.TYPESAFE_API_KEY})});
 assert.equal(env.TYPESAFE_API_KEY,'owned-host-key');assert.equal(controller.get().authentication.present,true);assert.equal(controller.jevEnvironment().TYPESAFE_API_KEY,'owned-host-key');
 await controller.save({settings,apiKey:'owned-private-key'});assert.equal(controller.jevEnvironment().TYPESAFE_API_KEY,'owned-private-key');assert.equal(values.typesafe_api_key,'owned-host-key');
});
test('real Settings save and broker wiring keep the session key private and preserve explicit Jev send',async t=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path'),{EventEmitter}=await import('node:events');
 const {DEFAULT_JEV_SETTINGS}=await import('../src/jev-settings.js'),{createDesktopBroker}=await import('../src/desktop/jobs.js');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-private-jev-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const env={PATH:'retained'};
 const controller=createSettingsController(root,{env});await controller.save({settings:{...DEFAULT_JEV_SETTINGS},apiKey:'owned-fixture-private-key'});
 assert.equal(env.TYPESAFE_API_KEY,undefined);assert.equal(controller.get().authentication.present,true);assert(!fs.readFileSync(path.join(root,'config/jev.json'),'utf8').includes('owned-fixture-private-key'));
 let received,child;const broker=createDesktopBroker(root,{jevEnvironment:()=>controller.jevEnvironment(),spawnImpl:(_file,_args,options)=>{received=options.env;child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;}});
 broker.submit('jev.run',{request:'fixture.json',out:'new-result.json'});assert.equal(received.TYPESAFE_API_KEY,'owned-fixture-private-key');child.stdout.emit('data',Buffer.from('{"ok":true}'));child.emit('close',0);
 broker.submit('doctor');assert.equal(received.TYPESAFE_API_KEY,undefined);child.emit('close',0);assert(!JSON.stringify(broker.snapshot()).includes('owned-fixture-private-key'));
});
test('Jev settings refuse active CLI jobs and retain close ownership during connection testing',async()=>{
 let release;const c=createSettingsController('.', {load:()=>({}),save:()=>({}),test:()=>new Promise(r=>release=r),canModify:()=>true});const task=c.test();assert.equal(c.busy(),true);await assert.rejects(c.save({settings:{apiKeyEnv:'JEV_API_KEY'}}));release({connected:true});await task;assert.equal(c.busy(),false);
 const active=createSettingsController('.',{canModify:()=>false});await assert.rejects(active.save({settings:{apiKeyEnv:'JEV_API_KEY'}}));
});
