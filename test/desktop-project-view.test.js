import test from 'node:test';import assert from 'node:assert/strict';
import {fakeDocument,flush} from './helpers/desktop-dom.js';import {createProjectView} from '../src/desktop/project-view.js';
test('create-and-prepare queues one durable pipeline only after a preserved intake',async t=>{
 const previous={document:globalThis.document,window:globalThis.window};const document=fakeDocument(),calls=[];
 globalThis.document=document;globalThis.window={retk:{agents:{list:async()=>[]},run:async(op,payload)=>{calls.push({op,payload});return {id:op==='project.create'?'create-job':'prepare-job'};}}};t.after(()=>Object.assign(globalThis,previous));
 const view=createProjectView({onCreated:()=>{},onMessage:()=>{}});await flush();document.querySelector('#new-project-name').value='Game';document.querySelector('#new-project-input').value='source.apk';
 assert.equal(document.querySelector('#new-project-prepare').checked,true);
 document.querySelector('#new-project-dialog').children[0].dispatchEvent(new Event('submit',{cancelable:true}));await flush();assert.equal(calls.length,1);
 const snapshot={workspaces:[{name:'Game'}],jobs:[{id:'create-job',state:'succeeded',result:{kind:'retoolkit-project-intake',name:'Game',state:'needs-input',receipt:'retained.json'}}]};
 assert.equal(view.pendingSelection(snapshot),'Game');view.pendingSelection(snapshot);await flush();assert.equal(calls.length,2);assert.equal(calls[1].op,'workspace.prepare');assert.equal(calls[1].payload.symbols,'plan');assert.equal(calls[1].payload.name,'Game');
 view.trackCreated({id:'invalid'},'Bad',{profile:'native'});view.pendingSelection({workspaces:[{name:'Bad'}],jobs:[{id:'invalid',state:'succeeded',result:{name:'Bad',state:'failed',receipt:'failed.json'}}]});await flush();assert.equal(calls.length,2);
});

test('intake wizard reviews actual source and policy without starting an inspection',async t=>{
 const previous={document:globalThis.document,window:globalThis.window},document=fakeDocument(),calls=[];
 globalThis.document=document;globalThis.window={retk:{agents:{list:async()=>[]},run:async(op,payload)=>{calls.push({op,payload});return {id:'create'};}}};t.after(()=>Object.assign(globalThis,previous));
 createProjectView({onCreated:()=>{},onMessage:()=>{}});await flush();document.querySelector('#new-project').click();
 assert.equal(document.querySelector('#new-project-step-source').hidden,false);document.querySelector('#new-project-next').click();assert.equal(document.querySelector('#new-project-step-source').hidden,false);
 document.querySelector('#new-project-name').value='Game';document.querySelector('#new-project-input').value='<img onerror=attack()>.apk';document.querySelector('#new-project-next').click();assert.equal(document.querySelector('#new-project-step-policy').hidden,false);
 document.querySelector('#new-project-next').click();const review=document.querySelector('#new-project-step-review');assert.equal(review.hidden,false);assert.match(review.textContent,/Game/);assert.match(review.textContent,/<img/);assert.equal(review.querySelectorAll('img').length,0);assert.match(review.textContent,/Chưa quét/);assert.equal(calls.length,0);
 document.querySelector('#new-project-dialog').children[0].dispatchEvent(new Event('submit',{cancelable:true}));await flush();assert.equal(calls[0].op,'project.create');
});

test('intake retains submitted preparation policy and ignores a chooser after cancellation',async t=>{
 const previous={document:globalThis.document,window:globalThis.window},document=fakeDocument(),calls=[];let release,choose;
 globalThis.document=document;globalThis.window={retk:{agents:{list:async()=>[]},choose:()=>new Promise(resolve=>choose=resolve),run:(op,payload)=>{calls.push({op,payload});return op==='project.create'?new Promise(resolve=>release=resolve):Promise.resolve({id:'prepared'});}}};t.after(()=>Object.assign(globalThis,previous));
 const view=createProjectView({onCreated:()=>{},onMessage:()=>{}});await flush();document.querySelector('#new-project').click();document.querySelector('#new-project-browse').click();document.querySelector('#new-project-dialog').dispatchEvent(new Event('cancel'));choose('late.apk');await flush();assert.equal(document.querySelector('#new-project-input').value,'');
 document.querySelector('#new-project-name').value='Game';document.querySelector('#new-project-input').value='source.apk';document.querySelector('#new-project-dialog').children[0].dispatchEvent(new Event('submit',{cancelable:true}));document.querySelector('#new-project-symbols').value='skip';release({id:'created'});await flush();view.pendingSelection({workspaces:[{name:'Game'}],jobs:[{id:'created',result:{name:'Game',state:'created',receipt:'receipt.json'}}]});await flush();assert.equal(calls[1].payload.symbols,'plan');
});

test('late Agent launch observations cannot label the newly selected project',async t=>{
 const previous={document:globalThis.document,window:globalThis.window},document=fakeDocument();let release;
 globalThis.document=document;globalThis.window={retk:{agents:{list:async()=>[{id:'codex',label:'Codex',available:true}],launch:()=>new Promise(resolve=>release=resolve)}}};t.after(()=>Object.assign(globalThis,previous));
 const view=createProjectView({onCreated:()=>{},onMessage:()=>{}});await flush();const snapshot={workspaces:[{name:'Old'},{name:'New'}],jobs:[]};view.update(snapshot,'Old');document.querySelector('#open-agent').click();view.update(snapshot,'New');release({workspace:'old-workspace'});await flush();assert.doesNotMatch(document.querySelector('#agent-status').textContent,/old-workspace|Đang chuẩn bị context/);
});

test('GUI defaults to reconstruction and passes an exact resume session selection',async t=>{
 const previousGlobals={document:globalThis.document,window:globalThis.window},document=fakeDocument(),calls=[];
 globalThis.document=document;globalThis.window={retk:{agents:{list:async()=>[{id:'codex',label:'Codex',available:true}],sessions:async()=>[{id:'launch',sessionId:'019a30bb-f351-77ab-9e17-38b5755db88e',createdAt:'2026-10-29'}],launch:async(...args)=>{calls.push(args);return {workspace:'Game'};}}}};
 t.after(()=>Object.assign(globalThis,previousGlobals));const view=createProjectView({onCreated:()=>{},onMessage:()=>{}});await flush();view.update({workspaces:[{name:'Game'}],jobs:[]},'Game');
 document.querySelector('#open-agent').click();await flush();assert.deepEqual(calls[0],['Game','codex',{mode:'reconstruct'}]);
 const mode=document.querySelector('#agent-mode');mode.value='resume';mode.dispatchEvent(new Event('change'));await flush();assert.equal(document.querySelector('#agent-session-id').value,'019a30bb-f351-77ab-9e17-38b5755db88e');
 document.querySelector('#open-agent').click();await flush();assert.equal(calls[1][2].mode,'resume');assert.equal(calls[1][2].sessionId,'019a30bb-f351-77ab-9e17-38b5755db88e');
});
