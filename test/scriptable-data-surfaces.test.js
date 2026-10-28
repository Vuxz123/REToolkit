import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assetTools} from '../src/assets/mcp.js';
import {validateAssetParams} from '../src/assets/api.js';
import {buildDesktopCommand,desktopOperations} from '../src/desktop/operations.js';
import {fakeDocument} from './helpers/desktop-dom.js';
import {buildResultModel} from '../src/desktop/result-model.js';
import {dataFixture} from './helpers/data-service-fixture.js';
import {EventEmitter} from 'node:events';
import {createDesktopBroker} from '../src/desktop/jobs.js';
test('typed data tools expose exact scope/baseline and desktop entrypoints',()=>{
 for(const name of ['data_capture','data_verify','data_report'])assert(assetTools.some(t=>t.name===name));
 assert.throws(()=>validateAssetParams('data.capture',{assetIds:[]}));assert.throws(()=>validateAssetParams('data.verify',{baselineId:'../../other'}));
 const id=randomUUID();assert.deepEqual(buildDesktopCommand('data.verify',{name:'Game',baselineId:id}),['data','verify','Game','--baseline',id]);
 assert.deepEqual(buildDesktopCommand('data.capture',{name:'Game',assetIds:JSON.stringify(['asset:'+'b'.repeat(32)])}),['data','capture','Game','--asset-ids',JSON.stringify(['asset:'+'b'.repeat(32)])]);
});
test('actual data CLI reads canonical baseline pages without running an Editor',async t=>{
 const f=await dataFixture(t),b=await f.call('capture',{assetIds:f.scope}),cli=fileURLToPath(new URL('../re.js',import.meta.url));
 const result=spawnSync(process.execPath,[cli,'data','report','Game','--operation',b.operationId,'--section','objects','--limit','1','--root',f.root,'--json'],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).items[0].fullName,'Game.Player');assert.equal(f.calls(),1);
 const bad=spawnSync(process.execPath,[cli,'data','capture','Game','--asset-ids','[]','--root',f.root,'--json'],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(bad.status,1);assert.equal(f.calls(),1);
});
test('GUI differentiates saved baseline, changed data and verified preservation',()=>{
 const model=r=>buildResultModel({state:'succeeded',operation:'data.verify',result:{kind:'retoolkit-data-contract',command:'verify',...r}});
 const changed=model({state:'changed',dataPreserved:false,differenceCount:1,differences:[{kind:'value_changed',propertyPath:'items.Array.size'}]});assert.notEqual(changed.status.tone,'good');assert(changed.sections.some(s=>s.title==='Dữ liệu ScriptableObject'));assert(changed.sections.some(s=>s.title==='Khác biệt dữ liệu'));
 const verified=model({state:'verified',dataPreserved:true});assert.equal(verified.status.tone,'good');
 const baseline=model({command:'capture',state:'captured',dataCaptureComplete:true,dataPreserved:false});assert.notEqual(baseline.status.tone,'good');
 const nested=buildResultModel({state:'succeeded',operation:'recovery.run',result:{artifactId:randomUUID(),operation:'data.verify',result:{kind:'retoolkit-data-contract',command:'verify',state:'changed',dataPreserved:false}}});assert.notEqual(nested.status.tone,'good');assert(nested.sections.some(s=>s.title==='Dữ liệu ScriptableObject'));
});
test('data forms validate baseline UUIDs and expose report section choices',async t=>{
 const previous=globalThis.document,document=fakeDocument();globalThis.document=document;t.after(()=>globalThis.document=previous);const {createOperationForm}=await import('../src/desktop/operation-form.js'),host=document.createElement('div'),submitted=[];
 const form=createOperationForm({host,choose:async()=>undefined,getProject:()=> 'Game',getOperations:()=>desktopOperations,onSubmit:(op,p)=>submitted.push(p),onMessage:()=>{}}),field=key=>[...host.querySelectorAll('input'),...host.querySelectorAll('select')].find(f=>f.dataset.key===key);
 form.select('data.verify');field('baselineId').value='not-a-uuid';await form.submit();assert.equal(submitted.length,0);field('baselineId').value=randomUUID();await form.submit();assert.equal(submitted.length,1);
 form.select('data.report');assert.equal(field('section').tag,'select');
});
test('large desktop data results retain exact baseline and negative preservation result',async t=>{
 const f=await dataFixture(t);let child;const broker=createDesktopBroker(f.root,{spawnImpl:()=>{child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;}}),baselineId=randomUUID();broker.submit('data.verify',{name:'Game',baselineId});
 const differences=Array.from({length:300},()=>({kind:'value_changed',propertyPath:'items.'+'x'.repeat(2000),before:{value:{preview:'a'.repeat(512)}},after:{value:{preview:'b'.repeat(512)}}}));
 child.stdout.emit('data',Buffer.from(JSON.stringify({kind:'retoolkit-data-contract',command:'verify',operationId:randomUUID(),baselineId,state:'changed',dataPreserved:false,dataCaptureComplete:true,differenceCount:300,differences})));child.emit('close',0);
 const result=broker.snapshot().jobs[0];assert.equal(result.result.baselineId,baselineId);assert.equal(result.result.dataPreserved,false);assert.equal(result.result.differenceCount,300);assert(Buffer.byteLength(JSON.stringify(result))<=16384);
});
test('desktop data capture keeps scoped Unity progress while the worker is running',async t=>{
 const f=await dataFixture(t);let child;const broker=createDesktopBroker(f.root,{spawnImpl:()=>{child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;}});broker.submit('data.capture',{name:'Game',assetIds:JSON.stringify(f.scope)});
 child.stderr.emit('data',Buffer.from(JSON.stringify({kind:'unity-validation-progress',operationId:randomUUID(),requestedAssets:2,completedAssets:1,pendingAssets:1,currentAsset:'Assets/Level.asset'})+'\n'));
 assert.equal(broker.snapshot().jobs[0].validationProgress?.completedAssets,1);child.stdout.emit('data',Buffer.from('{}'));child.emit('close',0);
});
