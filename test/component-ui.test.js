import test from 'node:test';
import assert from 'node:assert/strict';
import {fakeDocument} from './helpers/desktop-dom.js';
import {desktopOperations,buildDesktopCommand} from '../src/desktop/operations.js';
import {buildResultModel} from '../src/desktop/result-model.js';
test('component form offers multiline scope and UUID controls without file pickers',async t=>{
 const previous=globalThis.document,document=fakeDocument();globalThis.document=document;t.after(()=>globalThis.document=previous);const {createOperationForm}=await import('../src/desktop/operation-form.js');const host=document.createElement('div'),submitted=[];
 const form=createOperationForm({host,choose:async()=>assert.fail('not a path'),getProject:()=> 'Game',getOperations:()=>desktopOperations,onSubmit:(id,payload)=>submitted.push({id,payload})});form.select('components.observe');
 const field=key=>[...host.querySelectorAll('input'),...host.querySelectorAll('textarea')].find(n=>n.dataset.key===key);assert.equal(field('componentIds').tag,'textarea');assert.equal(host.querySelectorAll('button').length,0);
 field('componentIds').value='object:'+'a'.repeat(32)+':1\nobject:'+'a'.repeat(32)+':2';await form.submit();assert.equal(JSON.parse(submitted[0].payload.componentIds).length,2);
});
test('component result explains incomplete mapping and never labels it gameplay success',()=>{
 const model=buildResultModel({operation:'components.plan',state:'succeeded',exitCode:0,result:{kind:'retoolkit-component-operation',command:'plan',state:'blocked',counts:{conflict:1},blockers:[{componentId:'object:example',code:'duplicate-full-type'}],gameplay:'unverified'}});
 assert.equal(model.status.tone,'warn');assert.ok(model.sections.some(s=>s.title==='Mapping component'));assert.ok(!model.metrics.some(m=>m.label==='Gameplay'&&m.tone==='good'));
});
