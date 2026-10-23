import test from 'node:test';
import assert from 'node:assert/strict';

const api=()=>import('../src/desktop/project-model.js');
const snapshot={workspaces:[{name:'A',platform:'arm64-v8a',state:'available',steps:{dump:'succeeded'}},{name:'B',state:'busy'}],jobs:[]};
test('project activity never inherits another project or global operation results',async()=>{
 const {mergeProjectJobs}=await api();
 const rows=mergeProjectJobs([{id:'a',payload:{name:'A'},state:'succeeded'},{id:'b',payload:{name:'B'},state:'running'},{id:'global',payload:{},state:'running'}],'A',{name:'A',jobs:[{id:'worker',jobId:'worker',source:'durable',name:'A',state:'running'}]});
 assert.deepEqual(rows.map(x=>x.id).sort(),['a','worker']);
 assert.equal(mergeProjectJobs([],'B',{name:'A',jobs:[{id:'stale',name:'A'}]}).length,0);
});
test('available lock and successful process do not attest project verification',async()=>{
 const {buildProjectModel}=await api();const model=buildProjectModel(snapshot,'A',{inputs:{name:'A',state:'selected'},activity:{name:'A',jobs:[],lock:{state:'available'}}});
 assert.equal(model.name,'A');assert.ok(model.verification.every(x=>x.state==='unverified'));
 assert.notEqual(model.next.action,'agent');
});
test('uncertain source write takes priority over new preparation or retries',async()=>{
 const {buildProjectModel}=await api();const model=buildProjectModel({...snapshot,jobs:[{id:'write',operation:'reconstruct.apply',payload:{name:'A'},state:'unknown'}]},'A',{});
 assert.equal(model.next.action,'activity');assert.equal(model.next.jobKey,'desktop:write');assert.equal(model.next.tone,'warn');
});
test('current worker precedes missing inputs and unknown observations stay explicit',async()=>{
 const {buildProjectModel}=await api();let model=buildProjectModel(snapshot,'A',{inputs:{name:'A',state:'missing-input'},activity:{name:'A',jobs:[{id:'j',name:'A',source:'durable',state:'running',operation:'workspace.prepare'}],warnings:[]}});
 assert.equal(model.next.action,'activity');assert.equal(model.running,1);
 model=buildProjectModel(snapshot,'A',{inputs:{name:'A',state:'missing-input'}});assert.equal(model.next.action,'inputs');
});
test('stale preparation cannot promote ready compilation and binding claims',async()=>{
 const {buildProjectModel}=await api();const inputs={name:'A',state:'selected'},preparation={name:'A',state:'succeeded',freshness:'stale',readiness:{compilation:{state:'succeeded'},bindings:{state:'ready'}}};
 let model=buildProjectModel(snapshot,'A',{inputs,preparation});assert.ok(model.verification.every(x=>x.state==='unverified'));assert.notEqual(model.next.action,'agent');
 preparation.freshness='current';model=buildProjectModel(snapshot,'A',{inputs,preparation});assert.equal(model.next.action,'agent');assert.equal(model.verification.find(x=>x.id==='compilation').state,'verified');assert.equal(model.verification.find(x=>x.id==='gameplay').state,'unverified');
});
test('only exact job linkage deduplicates an enqueue and worker',async()=>{
 const {mergeProjectJobs}=await api();const desktop=[{id:'enqueue',state:'succeeded',payload:{name:'A'},result:{jobId:'real-worker'}},{id:'similar',state:'succeeded',payload:{name:'A'},operation:'workspace.prepare'}];
 const rows=mergeProjectJobs(desktop,'A',{name:'A',jobs:[{id:'real-worker',jobId:'real-worker',name:'A',source:'durable',state:'running'}]});assert.equal(rows.length,2);assert.equal(rows.find(x=>x.id==='real-worker').desktopId,'enqueue');assert.ok(rows.find(x=>x.id==='similar'));
});
test('ownership blocks a new preparation recommendation while keeping observation available',async()=>{
 const {buildProjectModel}=await api();const m=buildProjectModel(snapshot,'A',{inputs:{name:'A',state:'selected'},activity:{name:'A',jobs:[],lock:{state:'busy',workspaceBusy:true}}});assert.equal(m.next.action,'activity');assert.equal(m.next.tone,'warn');
});

test('verification preserves coverage and the time of the explicit evidence check',async()=>{
 const {buildProjectModel}=await api();const preparation={name:'A',state:'succeeded',freshness:'current',freshnessCheckedAt:'2026-10-23T08:00:00.000Z',readiness:{bindings:{state:'partial',coverage:{requestedAssets:50,completedAssets:17},scope:{assetIds:['asset:1']}}}};
 const model=buildProjectModel(snapshot,'A',{preparation}),binding=model.verification.find(x=>x.id==='bindings');assert.deepEqual(binding.coverage,{requestedAssets:50,completedAssets:17});assert.deepEqual(binding.scope,{assetIds:['asset:1']});assert.equal(model.evidenceCheckedAt,preparation.freshnessCheckedAt);
 preparation.freshness='stale';assert.equal(buildProjectModel(snapshot,'A',{preparation}).evidenceCheckedAt,null);
});

test('ownership guard keeps session export and shutdown usable while blocking conflicting writes',async()=>{
 const {conflictsWithOwnership}=await api(),model={project:{state:'busy'},lock:{workspaceBusy:true}};
 assert.equal(conflictsWithOwnership(model,'reconstruct.validate'),true);assert.equal(conflictsWithOwnership(model,'workspace.prepare'),true);
 for(const operation of ['assets.export','assets.stop','assets.index','assets.list','workspace.status','doctor'])assert.equal(conflictsWithOwnership(model,operation),false,operation);
 assert.equal(conflictsWithOwnership({project:{state:'available'},lock:{workspaceBusy:false}},'reconstruct.apply'),false);
});
