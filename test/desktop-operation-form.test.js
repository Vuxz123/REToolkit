import test from 'node:test';
import assert from 'node:assert/strict';
import {fakeDocument,flush} from './helpers/desktop-dom.js';
import {desktopOperations} from '../src/desktop/operations.js';

const id='12345678-1234-4123-8123-123456789abc';
async function setup(t,extra={}){
 const previous=globalThis.document,document=fakeDocument();globalThis.document=document;t.after(()=>globalThis.document=previous);
 const {createOperationForm}=await import('../src/desktop/operation-form.js');const host=document.createElement('div'),submitted=[],messages=[];let project='Game';
 const form=createOperationForm({host,choose:async()=>undefined,getProject:()=>project,getOperations:()=>desktopOperations,getActivity:()=>({jobs:[]}),onSubmit:(operation,payload)=>submitted.push({operation,payload}),onMessage:message=>messages.push(message),...extra});
 const fields=()=>[...host.querySelectorAll('input'),...host.querySelectorAll('select'),...host.querySelectorAll('textarea')];
 return {form,host,submitted,messages,field:key=>fields().find(item=>item.dataset.key===key),project:value=>project=value};
}
test('operation form binds read-only workspace identity and resets on project switch',async t=>{
 const {form,field,project,submitted}=await setup(t);form.select('workspace.status');assert.equal(field('name').readOnly,true);assert.equal(field('name').value,'Game');
 field('name').value='Other';await form.submit();assert.equal(submitted[0].payload.name,'Game');project('Next');form.refresh();assert.equal(field('name').value,'Next');
 form.select('project.create');assert.equal(field('name').readOnly,false);
});
test('operation form uses enum, boolean and bounded numeric controls',async t=>{
 const {form,field,submitted}=await setup(t);form.select('workspace.prepare');for(const key of ['profile','symbols','addressMode','autoPull','includeData','baselineValidation'])assert.equal(field(key).tag,'select');
 field('autoPull').value='false';field('symbols').value='plan';await form.submit();assert.equal(submitted[0].payload.autoPull,'false');
 form.select('assets.index');assert.equal(field('storage').tag,'select');assert.equal(field('graphMaxMiB').type,'number');field('graphMaxMiB').value='64';await form.submit();assert.equal(submitted.length,1);
});
test('recovery form distinguishes artifact UUID revision and typed method from input SHA256 and operation UUID',async t=>{
 const {form,field,submitted,messages}=await setup(t);form.select('recovery.run');field('artifactId').value=id;field('artifactRevision').value=id;
 assert.equal(field('method').tag,'select');field('method').value='assets.index';field('paramsFile').value='C:/owned/params.json';await form.submit();
 assert.equal(submitted.length,1,JSON.stringify(messages));assert.equal(submitted[0].payload.method,'assets.index');assert.equal(submitted[0].payload.artifactRevision,id);
});
test('operation scope converts newline IDs and rejects malformed or duplicate JSON before submission',async t=>{
 const {form,field,submitted,messages}=await setup(t);form.select('reconstruct.validate');field('assetIds').value='asset:1\nasset:2';await form.submit();assert.equal(submitted[0].payload.assetIds,'["asset:1","asset:2"]');
 field('assetIds').value='["same","same"]';await form.submit();assert.equal(submitted.length,1);assert.match(messages.at(-1),/assetIds/);
 field('resumeOperationId').value='wrong';await form.submit();assert.equal(submitted.length,1);
});
test('saved operation suggestions require project identity and a compatible exact operation',async t=>{
 const rows=[{name:'Other',operation:'reconstruct.plan',operationId:id},{name:'Game',operation:'visual.compare',operationId:id},{name:'Game',operation:'reconstruct.plan',operationId:id},{name:'Game',operation:'reconstruct.plan',id:'desktop-id'}];
 const {form,host,field}=await setup(t,{getActivity:()=>({jobs:rows})});form.select('reconstruct.apply');assert.equal(host.querySelectorAll('datalist')[0].children.length,1);assert.equal(host.querySelectorAll('datalist')[0].children[0].value,id);assert.equal(field('operation').value,'');
});
test('late file chooser replies cannot populate another operation or workspace',async t=>{
 let release;const {form,host,field,project}=await setup(t,{choose:()=>new Promise(resolve=>release=resolve)});form.select('reconstruct.plan');host.querySelectorAll('button')[0].click();form.select('visual.compare');release('old.json');await flush();assert.equal(field('request').value,'');
 host.querySelectorAll('button')[0].click();project('Next');release('old-project.json');await flush();assert.equal(field('request').value,'');
});
test('metadata and observation labels are rendered as text, never executable HTML',async t=>{
 const {form,host}=await setup(t,{getOperations:()=>[{id:'fixture',required:['<img onerror=attack()>'],optional:[]}]});form.select('fixture');assert.equal(host.querySelectorAll('img').length,0);assert.match(host.textContent,/<img onerror/);
});
test('preparation suggestions use attested run IDs and never substitute worker job IDs',async t=>{
 const run='abcdef12-1234-4123-8123-123456789abc',rows=[{name:'Game',operation:'workspace.prepare',source:'durable',jobId:id},{name:'Game',operation:'workspace.prepare',source:'durable',jobId:id,preparationProgress:{runId:run}}];
 const {form,host}=await setup(t,{getActivity:()=>({jobs:rows})});form.select('workspace.prepare');assert.deepEqual(host.querySelectorAll('datalist')[0].children.map(item=>item.value),[run]);
});
test('late submit failures are silent after a project or operation switch',async t=>{
 let reject;const {form,project,messages}=await setup(t,{onSubmit:()=>new Promise((resolve,fail)=>reject=fail)});form.select('workspace.status');const first=form.submit();project('Next');form.refresh();reject(new Error('Old project failed'));await first;assert.deepEqual(messages,[]);
 const second=form.submit();form.select('assets.list');reject(new Error('Old operation failed'));await second;assert.deepEqual(messages,[]);
 const third=form.submit();reject(new Error('Current failure'));await third;assert.deepEqual(messages,['Current failure']);
});
test('late chooser failures are silent after a project or operation switch',async t=>{
 let reject;const {form,host,project,messages}=await setup(t,{choose:()=>new Promise((resolve,fail)=>reject=fail)});form.select('reconstruct.plan');host.querySelectorAll('button')[0].click();project('Next');reject(new Error('Old project chooser'));await flush();assert.deepEqual(messages,[]);
 form.refresh();host.querySelectorAll('button')[0].click();form.select('visual.compare');reject(new Error('Old operation chooser'));await flush();assert.deepEqual(messages,[]);
 host.querySelectorAll('button')[0].click();reject(new Error('Current chooser'));await flush();assert.deepEqual(messages,['Current chooser']);
});
