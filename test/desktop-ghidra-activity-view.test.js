import test from 'node:test';
import assert from 'node:assert/strict';
import {createGhidraActivityView} from '../src/desktop/ghidra-activity-view.js';

// A deliberately small DOM surface checks text-only rendering and update flow.
class Element extends EventTarget{
 constructor(tag){super();this.tag=tag;this.children=[];this.dataset={};this.value='';this.open=false;this.text='';}
 set textContent(value){this.text=String(value);this.children=[];}
 get textContent(){return this.text+this.children.map(node=>node.textContent).join('');}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.text='';this.children=nodes;}
 setAttribute(){}
 querySelectorAll(tag){return this.children.flatMap(child=>[...(child.tag===tag?[child]:[]),...child.querySelectorAll(tag)]);}
 click(){this.dispatchEvent(new Event('click'));}
}
const flush=async()=>{for(let n=0;n<6;n++)await Promise.resolve();};
test('Ghidra card polls external tasks, safely shows logs and refreshes final state',async t=>{
 const previous={document:globalThis.document,window:globalThis.window};let panel,calls=0;
 const report={state:'observed',workspaceBusy:true,observedAt:new Date().toISOString(),lock:{ownerPid:123,ownerAlive:true,engines:[{pid:124,alive:true}]},tasks:[{id:'analysis',operation:'workspace.analyze',source:'workspace',state:'running',ownerPid:123,ownerAlive:true,startedAt:new Date().toISOString(),elapsedSeconds:600,log:{path:'04_Notes/test.log',bytes:20000000,quiet:true,updatedAt:new Date().toISOString(),tail:'<img onerror=attack()> (GccExceptionAnalyzer)',lastObservedAnalyzer:'GccExceptionAnalyzer'}}]};
 globalThis.document={hidden:false,createElement:tag=>new Element(tag),querySelector:()=>({before:value=>{panel=value;}})};
 globalThis.window={retk:{ghidraActivity:async()=>{calls++;return report;}}};t.mock.timers.enable({apis:['setTimeout']});
 const view=createGhidraActivityView();t.after(()=>{view.update({workspaces:[]},'');Object.assign(globalThis,previous);});
 view.update({workspaces:[{name:'Game'}]},'Game');await flush();assert.equal(panel.hidden,false);assert.equal(calls,1);
 assert.match(panel.textContent,/Auto Analysis/);assert.match(panel.textContent,/GccExceptionAnalyzer/);assert.match(panel.textContent,/5 phút/);assert.match(panel.textContent,/PID 124/);
 assert.equal(panel.querySelectorAll('progress').length,1);assert.equal(panel.querySelectorAll('img').length,0);assert.match(panel.querySelectorAll('pre')[0].textContent,/<img/);
 report.workspaceBusy=false;report.tasks[0].state='succeeded';report.tasks[0].completedAt=new Date().toISOString();report.tasks[0].log.tail='analysis completed';
 t.mock.timers.tick(2000);await flush();assert.equal(calls,2);assert.match(panel.textContent,/Hoàn tất/);assert.match(panel.textContent,/không có khóa/);assert.match(panel.textContent,/analysis completed/);assert.equal(panel.querySelectorAll('progress').length,0);
 view.update({workspaces:[{name:'Game'}]},'Game',{visible:false});t.mock.timers.tick(10000);await flush();assert.equal(calls,2);assert.equal(panel.hidden,true);
});

test('late Ghidra response cannot overwrite the selected project',async t=>{
 const previous={document:globalThis.document,window:globalThis.window};let panel,release;
 globalThis.document={hidden:false,createElement:tag=>new Element(tag),querySelector:()=>({before:value=>{panel=value;}})};
 globalThis.window={retk:{ghidraActivity:name=>name==='Old'?new Promise(resolve=>{release=resolve;}):Promise.resolve({state:'observed',workspaceBusy:false,observedAt:new Date().toISOString(),lock:{},tasks:[]})}};
 t.mock.timers.enable({apis:['setTimeout']});const view=createGhidraActivityView();t.after(()=>{view.update({workspaces:[]},'');Object.assign(globalThis,previous);});
 const snapshot={workspaces:[{name:'Old'},{name:'New'}]};view.update(snapshot,'Old');view.update(snapshot,'New');await flush();
 release({state:'observed',workspaceBusy:true,observedAt:new Date().toISOString(),lock:{ownerPid:999},tasks:[]});await flush();assert.doesNotMatch(panel.textContent,/999/);assert.match(panel.textContent,/không có khóa/);
});
