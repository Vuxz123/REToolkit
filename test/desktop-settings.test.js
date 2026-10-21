import test from 'node:test';import assert from 'node:assert/strict';import {createSettingsController} from '../src/desktop/settings.js';
test('Jev settings keep a GUI session key out of settings DTO, history and returned status',async()=>{
 const env={},settings={apiKeyEnv:'TYPESAFE_API_KEY'},calls=[];
 const c=createSettingsController('.', {env,load:()=>({settings,authentication:{present:!!env.TYPESAFE_API_KEY}}),save:(_r,v)=>{calls.push(v);return {};},test:async()=>({connected:true}),canModify:()=>true});
 await c.save({settings,apiKey:'private-secret'});assert.equal(env.TYPESAFE_API_KEY,'private-secret');assert.deepEqual(calls,[settings]);assert.ok(!JSON.stringify(c.get()).includes('private-secret'));assert.deepEqual(await c.test(),{connected:true});assert.equal(c.busy(),false);
 await assert.rejects(c.save({settings:{apiKeyEnv:'NODE_OPTIONS'},apiKey:'danger'}));assert.equal(env.NODE_OPTIONS,undefined);
});
test('Jev settings refuse active CLI jobs and retain close ownership during connection testing',async()=>{
 let release;const c=createSettingsController('.', {load:()=>({}),save:()=>({}),test:()=>new Promise(r=>release=r),canModify:()=>true});const task=c.test();assert.equal(c.busy(),true);await assert.rejects(c.save({settings:{apiKeyEnv:'JEV_API_KEY'}}));release({connected:true});await task;assert.equal(c.busy(),false);
 const active=createSettingsController('.',{canModify:()=>false});await assert.rejects(active.save({settings:{apiKeyEnv:'JEV_API_KEY'}}));
});
