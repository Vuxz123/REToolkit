import test from 'node:test';import assert from 'node:assert/strict';
import {fakeDocument,flush} from './helpers/desktop-dom.js';
const runId='12345678-1234-4123-8123-123456789abc';
test('Android discovery offers bounded explicit choices without selecting a target',async t=>{
 const {createPreparationOptions}=await import('../src/desktop/preparation-view.js');const previous={document:globalThis.document,window:globalThis.window};const document=fakeDocument(),calls=[];
 globalThis.document=document;globalThis.window={retk:{preparation:{devices:async()=>({devices:[{serial:'emulator-5554',state:'device'}]}),packages:async serial=>{calls.push(serial);return {packages:[{packageName:'com.example.game'}]};}}}};t.after(()=>Object.assign(globalThis,previous));
 const options=createPreparationOptions();document.querySelector('#preparation-devices').click();await flush();assert.equal(document.querySelector('#preparation-serial').value,'');assert.match(options.element.textContent,/emulator-5554/);
 document.querySelector('#preparation-packages').click();await flush();assert.equal(calls.length,0);document.querySelector('#preparation-serial').value='emulator-5554';document.querySelector('#preparation-packages').click();await flush();assert.deepEqual(calls,['emulator-5554']);assert.equal(document.querySelector('#preparation-packageName').value,'');assert.match(options.element.textContent,/com.example.game/);
 options.load({serial:'emulator-5554'});options.load({});assert.equal(document.querySelector('#preparation-serial').value,'');
});
test('preparation card reconnects to durable stages and resumes only on click',async t=>{
 const {createPreparationView}=await import('../src/desktop/preparation-view.js');
 const previous={document:globalThis.document,window:globalThis.window};const document=fakeDocument();let calls=0;const submitted=[];
 const report={name:'Game',runId,state:'running',updatedAt:'2026-10-22T01:00:00Z',stages:[{id:'analyze',state:'running',startedAt:'2026-10-22T00:00:00Z'}],readiness:{nativeAnalysis:'running',gameplay:'unverified',downloadedData:{coverage:'partial'}},options:{profile:'native',symbols:'plan',serial:'emulator-5554',packageName:'com.example.game'},handoffPath:'04_Notes/handoff.md',blockers:[]};
 globalThis.document=document;globalThis.window={retk:{preparation:{inspect:async()=>{calls++;return report;}},run:async(op,payload)=>{submitted.push({op,payload});return {id:'local-job'};}}};
 t.mock.timers.enable({apis:['setTimeout']});const view=createPreparationView();t.after(()=>{view.update({workspaces:[],jobs:[]},'');Object.assign(globalThis,previous);});
 const snapshot={workspaces:[{name:'Game'}],jobs:[]};view.update(snapshot,'Game');await flush();const panel=document.querySelector('#preparation');assert.equal(calls,1);assert.equal(submitted.length,0);assert.match(panel.textContent,/Phân tích Ghidra/);assert.match(panel.textContent,/Gameplay/);assert.match(panel.textContent,/Chưa xác minh/);assert.equal(panel.querySelectorAll('progress').length,1);
 assert.equal(document.querySelector('#preparation-start').disabled,true);assert.equal(document.querySelector('#preparation-serial').value,'emulator-5554');assert.doesNotMatch(panel.textContent,/undefined/);
 report.state='partial';report.stages[0]={id:'analyze',state:'failed',error:{message:'<img onerror=attack()>'}};report.blockers=[{stage:'analyze',code:'ENGINE_MISSING',message:'Install exact Ghidra'}];
 t.mock.timers.tick(2000);await flush();assert.equal(calls,2);assert.equal(panel.querySelectorAll('img').length,0);assert.match(panel.textContent,/<img/);assert.match(panel.textContent,/ENGINE_MISSING/);assert.match(panel.textContent,/04_Notes\/handoff.md/);
 document.querySelector('#preparation-resume').click();await flush();assert.equal(submitted[0].op,'workspace.prepare');assert.equal(submitted[0].payload.resumeRunId,runId);assert.equal(submitted[0].payload.symbols,'plan');
 view.update(snapshot,'Game',{visible:false});t.mock.timers.tick(10000);await flush();assert.equal(panel.hidden,true);
});
test('a late preparation response cannot replace the newly selected project',async t=>{
 const {createPreparationView}=await import('../src/desktop/preparation-view.js');const previous={document:globalThis.document,window:globalThis.window};const document=fakeDocument();let release;
 globalThis.document=document;globalThis.window={retk:{preparation:{inspect:name=>name==='Old'?new Promise(resolve=>release=resolve):Promise.resolve({name,state:'not-started',stages:[]})}}};t.mock.timers.enable({apis:['setTimeout']});
 const view=createPreparationView(),snapshot={workspaces:[{name:'Old'},{name:'New'}],jobs:[]};t.after(()=>{view.update({workspaces:[],jobs:[]},'');Object.assign(globalThis,previous);});view.update(snapshot,'Old');view.update(snapshot,'New');await flush();release({name:'Old',state:'partial',stages:[{id:'OLD_RESULT',state:'failed'}]});await flush();assert.doesNotMatch(document.querySelector('#preparation').textContent,/OLD_RESULT/);
});
test('a queued durable preparation job remains pending after its CLI child exits',async t=>{
 const {createPreparationView}=await import('../src/desktop/preparation-view.js');const previous={document:globalThis.document,window:globalThis.window},document=fakeDocument();globalThis.document=document;globalThis.window={retk:{preparation:{inspect:async()=>({name:'Game',state:'not-started',stages:[],job:{jobId:runId,state:'queued',stage:'queued'}})}}};t.mock.timers.enable({apis:['setTimeout']});const view=createPreparationView();t.after(()=>{view.update({workspaces:[],jobs:[]},'');Object.assign(globalThis,previous);});view.update({workspaces:[{name:'Game'}],jobs:[]},'Game');await flush();assert.equal(document.querySelector('#preparation-start').disabled,true);assert.match(document.querySelector('#preparation').textContent,/Đang chờ/);assert.equal(document.querySelector('#preparation').querySelectorAll('progress').length,1);
});
test('automatic preparation observation is cheap and manual refresh verifies freshness',async t=>{
 const {createPreparationView}=await import('../src/desktop/preparation-view.js');const previous={document:globalThis.document,window:globalThis.window},document=fakeDocument(),calls=[];globalThis.document=document;
 globalThis.window={retk:{preparation:{inspect:async(name,runId,verifyFreshness)=>{calls.push({name,runId,verifyFreshness});return {name,state:'succeeded',stages:[],freshness:verifyFreshness?'stale':'not-rechecked',readiness:{nativeAnalysis:{state:'unverified'}},recordedReadiness:{nativeAnalysis:{state:'ready'}}};}}}};
 t.mock.timers.enable({apis:['setTimeout']});const view=createPreparationView();t.after(()=>{view.update({workspaces:[],jobs:[]},'');Object.assign(globalThis,previous);});view.update({workspaces:[{name:'Game'}],jobs:[]},'Game');await flush();assert.equal(calls[0].verifyFreshness,false);assert.match(document.querySelector('#preparation').textContent,/Đã ghi nhận, chưa kiểm tra lại/);
 t.mock.timers.tick(2000);await flush();assert.equal(calls[1].verifyFreshness,false);document.querySelector('#preparation-refresh').click();await flush();assert.equal(calls[2].verifyFreshness,true);assert.match(document.querySelector('#preparation').textContent,/đã thay đổi/);assert.match(document.querySelector('#preparation').textContent,/Chưa xác minh/);
});
