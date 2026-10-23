import test from 'node:test';
import assert from 'node:assert/strict';

const api = await import('../src/desktop/result-model.js').catch(() => ({}));
const build = (...args) => {
  assert.equal(typeof api.buildResultModel, 'function', 'pure result model must be exported');
  return api.buildResultModel(...args);
};
const done = result => ({id:'fixture-job', operation:'assets.index', state:'succeeded', exitCode:0, result});
test('workspace previews show step and ABI tables directly without nested JSON inspectors',()=>{
 const model=build({operation:'workspace.add',state:'succeeded',storedResult:'C:/saved/result.json',result:{kind:'retoolkit-workspace-preview',schemaVersion:1,name:'Game',steps:{extract:{state:'succeeded'},scan:{state:'awaiting-user'}},inputSelection:{state:'needs-selection',binaries:[{path:'lib/arm64-v8a/libil2cpp.so',abi:'arm64-v8a'},{path:'lib/armeabi-v7a/libil2cpp.so',abi:'armeabi-v7a'}],metadata:[{path:'assets/global-metadata.dat'}],selection:{}},nextSteps:['Choose ABI']}});
 assert.equal(model.status.tone,'warn');assert.equal(model.sections.find(section=>section.title==='Binary / ABI').node.kind,'table');assert.equal(model.sections.find(section=>section.title==='Binary / ABI').node.rows.length,2);assert.equal(model.sections.find(section=>section.title==='Trạng thái các bước').node.kind,'table');assert.equal(model.sections.find(section=>section.title==='Bước tiếp theo').node.kind,'list');
});
test('project intake gaps remain warnings instead of successful readiness',()=>{
 const model=build({operation:'project.create',state:'succeeded',result:{state:'needs-input',analysisReady:false,issue:{code:'input_selection_required',message:'Missing binary'}}});
 assert.equal(model.status.tone,'warn');
});
test('partial full-package capture cannot show a green complete status',()=>{
 const model=build({...done({state:'partial',capture:{applicationData:{coverage:'partial'}}}),operation:'adb.capture'});assert.equal(model.status.tone,'warn');assert.match(model.status.label,/chưa đủ/i);
 assert.equal(build({...done({state:'partial'}),state:'failed',exitCode:1}).status.tone,'bad');
});
const nodes = model => {
  const found=[];
  const visit=node=>{
    found.push(node);
    if(node.fields) for(const field of node.fields) visit(field.node);
    if(node.items) node.items.forEach(visit);
    if(node.rows) for(const row of node.rows){row.cells.forEach(visit);if(row.details)visit(row.details);}
  };
  model.sections.forEach(section=>visit(section.node));
  return found;
};

test('successful command has an explicit command-only status and preserves its envelope',()=>{
  const job=done({ok:true, customField:'value'}), before=structuredClone(job);
  const model=build(job,{operationLabel:'Lập graph asset'});
  assert.equal(model.title,'Lập graph asset');
  assert.equal(model.status.label,'Lệnh hoàn tất');
  assert.match(model.status.description,/game|gameplay|hành vi/i);
  assert.deepEqual(JSON.parse(model.raw),job);
  assert.deepEqual(job,before);
  assert.ok(nodes(model).some(node=>node.value==='value'));
});

test('domain blocked and ok:false override exit zero',()=>{
  for(const result of [{state:'blocked',reason:'Missing library'},{ok:false,error:{code:'DEPENDENCY',message:'Missing tool'}},{valid:false}]){
    const model=build(done(result));
    assert.notEqual(model.status.tone,'good');
    assert.notEqual(model.status.label,'Lệnh hoàn tất');
  }
});

test('reconstruction metrics distinguish compilation, bindings and gameplay without inference',()=>{
  const model=build(done({compileReady:true,bindingsVerified:false,behavior:'unverified'}));
  const metrics=Object.fromEntries(model.metrics.map(metric=>[metric.label,metric]));
  assert.equal(metrics['Biên dịch'].tone,'good');
  assert.notEqual(metrics['Liên kết'].tone,'good');
  assert.match(metrics['Gameplay'].value,/chưa|unverified/i);
  assert.equal(model.status.tone,'warn');
  const unknown=build({...done({}),operation:'reconstruct.verify'});
  assert.equal(unknown.metrics.filter(metric=>/Biên dịch|Liên kết|Gameplay/.test(metric.label)).length,3);
  assert.ok(unknown.metrics.every(metric=>metric.tone!=='good'));
});

test('coverage metrics retain zero counts and missing reference warnings',()=>{
  const model=build(done({coverage:{assets:0,nodes:12,edges:8,missingReferences:3}}));
  assert.ok(model.metrics.some(metric=>metric.label==='Asset'&&metric.value==='0'));
  assert.ok(model.metrics.some(metric=>metric.label==='Node'&&metric.value==='12'));
  assert.ok(model.metrics.some(metric=>metric.label==='Edge'&&metric.value==='8'));
  assert.ok(model.metrics.some(metric=>/thiếu/i.test(metric.label)&&metric.value==='3'&&metric.tone==='warn'));
});

test('runtime record arrays become bounded tables and retain nested unknown facts',()=>{
  const rows=[{name:'dotnet',version:'9',path:'C:\\runtime\\dotnet.exe',a:1,b:2,c:3,d:4,unknownNested:{deep:['fact']}},{name:'java',ok:false}];
  const model=build({...done({runtimes:rows}),operation:'doctor'});
  const table=nodes(model).find(node=>node.kind==='table');
  assert.ok(table);
  assert.ok(table.columns.length<=6);
  assert.equal(table.rows.length,2);
  assert.ok(table.rows[0].details);
  assert.ok(nodes(model).some(node=>node.value==='fact'));
  assert.ok(nodes(model).some(node=>node.kind==='path'&&node.value==='C:\\runtime\\dotnet.exe'));
  assert.ok(table.columns.every(column=>typeof column.label==='string'));
});

test('source and hostile strings remain literal data and identifiers stay copyable',()=>{
  const hostile='<img src=x onerror=alert(1)>',source='public class A {\n // '+hostile+'\n}';
  const model=build(done({source,ids:['asset:1','asset:2'],message:hostile,empty:null}));
  assert.ok(nodes(model).some(node=>node.kind==='text'&&node.text===source));
  assert.ok(nodes(model).some(node=>node.value===hostile));
  assert.ok(nodes(model).some(node=>node.kind==='list'&&node.items.length===2));
  assert.ok(nodes(model).some(node=>node.value==='asset:1'));
  assert.match(model.raw,/<img src=x onerror=alert\(1\)>/);
});

test('Jev missing key gives a readable state and both job/result errors survive',()=>{
  const job={...done({error:{code:'jev_auth_missing',message:'Set TYPESAFE_API_KEY'}}),state:'failed',error:{code:'DESKTOP_COMMAND_FAILED',message:'Exit failed'}};
  const model=build(job);
  assert.equal(model.status.tone,'bad');
  assert.match(model.status.description,/API key/i);
  const text=JSON.stringify(model.sections);
  assert.match(text,/DESKTOP_COMMAND_FAILED/);
  assert.match(text,/jev_auth_missing/);
  assert.deepEqual(JSON.parse(model.raw),job);
});

test('running and queued jobs expose progress and bounded diagnostic logs',()=>{
  const running=build({state:'running',operation:'doctor',progress:'Loading…',diagnostics:'Earlier log',logs:['first','second']});
  assert.equal(running.status.tone,'info');
  assert.match(running.logs,/Loading/);
  assert.match(running.logs,/Earlier log/);
  assert.match(running.logs,/first/);
  assert.match(build({state:'queued'}).status.label,/chờ/i);
  assert.equal(build({state:'unverified',exitCode:0}).status.tone,'warn');
});

test('unknown interrupted commands retain diagnostics without asserting failure or success',()=>{
 const job={id:'interrupted',operation:'reconstruct.apply',state:'unknown',exitCode:1,error:{code:'DESKTOP_INTERRUPTED',message:'Completion was not observed'},diagnostics:'Saved diagnostic evidence',result:{state:'unknown',error:{code:'worker_unverified',message:'Inspect receipt'}}};
 const model=build(job);
 assert.equal(model.status.tone,'warn');assert.equal(model.status.label,'Cần kiểm tra kết quả');
 assert.match(model.status.description,/chưa xác định|chưa xác minh/i);assert.match(model.status.description,/receipt/i);
 assert.match(JSON.stringify(model.sections),/DESKTOP_INTERRUPTED/);assert.match(JSON.stringify(model.sections),/worker_unverified/);assert.match(model.logs,/Saved diagnostic evidence/);assert.deepEqual(JSON.parse(model.raw),job);
 assert.equal(build({...job,error:{code:'job_worker_unverified',message:'Owner exited'}}).status.tone,'warn');
 assert.equal(build({...job,state:'succeeded',exitCode:0,result:{ok:true}}).status.tone,'warn');
});

test('unknown and unverified Agent session envelopes never show completed or failed status',()=>{
 for(const state of ['unknown','unverified']){
  const model=build({id:'agent-observation',operation:'agent.session',state,exitCode:1,error:{code:'AGENT_LAUNCH_OBSERVATION',message:'Inspect saved process observation'},result:{state,mcpState:'unverified',resumed:false}});
  assert.equal(model.status.tone,'warn',state);assert.equal(model.status.label,'Cần kiểm tra kết quả',state);assert.match(JSON.stringify(model.sections),/AGENT_LAUNCH_OBSERVATION/);
 }
 const failed=build({id:'failed-agent',operation:'agent.session',state:'failed',exitCode:1,error:{code:'AGENT_LAUNCH_FAILED',message:'Executable failed'},result:{state:'failed'}});
 assert.equal(failed.status.tone,'bad');assert.match(JSON.stringify(failed.sections),/AGENT_LAUNCH_FAILED/);
});

test('stored results retain a path and an explicit preview notice',()=>{
  const job={...done({notice:'Output exceeds desktop preview.'}),storedResult:'C:\\cache\\result.json'};
  const model=build(job);
  assert.ok(nodes(model).some(node=>node.kind==='path'&&node.value===job.storedResult));
  assert.match(JSON.stringify(model.sections),/bản xem trước|preview/i);
  assert.equal(model.status.tone,'warn');
});

test('limits disclose omitted rows, fields and depth and cap total rendered nodes',()=>{
  let deep={fact:'deepest'};for(let index=0;index<20;index++)deep={next:deep};
  const fields=Object.fromEntries(Array.from({length:80},(_,i)=>['field'+i,'value'+i]));
  const model=build(done({deep,fields,rows:Array.from({length:100},(_,i)=>({id:i,fields})),many:Array.from({length:100},()=>fields)}));
  const all=nodes(model);
  assert.ok(all.length<=1200,`rendered ${all.length} nodes`);
  assert.ok(all.some(node=>node.omitted>0));
  assert.ok(all.filter(node=>node.kind==='table').every(node=>node.rows.length<=50));
  assert.ok(all.filter(node=>node.kind==='object').every(node=>node.fields.length<=40));
  assert.match(JSON.stringify(model.sections),/lược|giới hạn/i);
});

test('large values and UTF8 raw output are bounded with an explicit truncation notice',()=>{
  const huge='😀'.repeat(100000),model=build(done({source:huge,message:huge}));
  assert.ok(new TextEncoder().encode(model.raw).length<=65536);
  assert.match(model.raw,/lược|giới hạn/i);
  assert.ok(nodes(model).filter(node=>node.kind==='text').every(node=>node.text.length<=12000));
  assert.ok(nodes(model).filter(node=>node.kind==='value').every(node=>node.value.length<=4096));
  assert.ok(model.logs.length<=12000);
});

test('unknown field names are humanized and null or primitive results are readable',()=>{
  assert.equal(api.fieldLabel?.('unexpectedHTTPValue'),'Unexpected HTTP Value');
  assert.equal(api.fieldLabel?.('some_new_key'),'Some new key');
  for(const result of [null,false,42,'plain output',[]]){
    const model=build(done(result));
    assert.ok(model.sections.length>0);
    assert.ok(nodes(model).length>0);
  }
});

test('false readiness flags remain unverified unless compilation observation explicitly failed',()=>{
  const model=build({...done({compileReady:false,bindingsVerified:false,behavior:false}),operation:'reconstruct.verify'});
  assert.equal(model.metrics.length,3);
  assert.ok(model.metrics.every(metric=>metric.value==='Chưa xác minh'&&metric.tone==='warn'));
  const failed=build({...done({compileReady:false,compilation:{state:'failed',errors:['CS1002']}}),operation:'reconstruct.validate'});
  assert.equal(failed.metrics.find(metric=>metric.label==='Biên dịch').value,'Chưa đạt');
  assert.equal(failed.status.tone,'bad');
});

test('literal asset fields cannot declare global errors or readiness metrics',()=>{
  const fields={error:'literal field',errors:['asset text'],state:'failed',status:'blocked',success:false,ok:false,valid:false,
    compileReady:false,bindingsVerified:false,behavior:false,coverage:{assets:900,nodes:900,edges:900,missingReferences:900}};
  const job={...done({item:{id:'asset:fixture',fields}}),operation:'assets.get'};
  const model=build(job);
  assert.equal(model.status.label,'Lệnh hoàn tất');
  assert.equal(model.status.tone,'good');
  assert.deepEqual(model.metrics,[]);
  assert.match(JSON.stringify(model.sections),/literal field/);
  const authoritative=build({...done({compileReady:true,bindingsVerified:true,behavior:true,coverage:{assets:2,nodes:3,edges:4,missingReferences:0},item:{fields}}),operation:'reconstruct.verify'});
  assert.equal(authoritative.status.label,'Lệnh hoàn tất');
  assert.ok(authoritative.metrics.filter(metric=>/Biên dịch|Liên kết|Gameplay/.test(metric.label)).every(metric=>metric.tone==='good'));
  assert.equal(authoritative.metrics.find(metric=>metric.label==='Asset').value,'2');
});

test('result error has its own visible section before generic result data',()=>{
  const error={code:'jev_auth_missing',message:'Set TYPESAFE_API_KEY'};
  const model=build({...done({error,items:[{literal:'data'}]}),error:{code:'DESKTOP_COMMAND_FAILED',message:'Command failed'}});
  const specific=model.sections.findIndex(section=>section.title==='Lỗi kết quả');
  const generic=model.sections.findIndex(section=>section.title==='Kết quả');
  assert.ok(specific>=0&&specific<generic);
  assert.equal(model.sections[specific].node.kind,'object');
  assert.ok(model.sections[specific].node.fields.some(field=>field.key==='code'&&field.node.value==='jev_auth_missing'));
  assert.match(model.status.description,/API key/);
});

test('known field displays use Vietnamese while unrelated evidence and raw stay literal',()=>{
  const result={state:'indexed',status:'ready',items:[{state:'blocked'},{state:'prepared'},{state:'unverified'},{state:'failed'},{state:'succeeded'}],
    kind:'fixture-kind',guid:'ready-guid',storage:'sqlite',authentication:{network:'not-sent'},behavior:'unverified',logic:'unverified',
    compileReady:false,bindingsVerified:false,behaviorVerified:false,customField:'indexed',source:'state = "indexed";',path:'C:\\ready\\indexed.json'};
  const job=done(result),model=build(job);
  const fields=nodes(model).flatMap(node=>node.fields??[]);
  const display=key=>fields.find(field=>field.key===key);
  assert.equal(display('state').node.value,'Đã lập graph');
  assert.equal(display('status').node.value,'Sẵn sàng');
  assert.equal(display('items').label,'Danh sách');
  assert.equal(display('kind').label,'Loại');
  assert.equal(display('guid').label,'GUID');
  assert.equal(display('storage').label,'Lưu trữ');
  assert.equal(display('authentication').label,'Xác thực');
  assert.equal(display('network').label,'Kết nối mạng');
  assert.equal(display('network').node.value,'Chưa gửi yêu cầu');
  for(const key of ['compileReady','bindingsVerified','behaviorVerified','behavior','logic'])assert.equal(display(key).node.value,'Chưa xác minh');
  for(const text of ['Thiếu điều kiện','Đã chuẩn bị','Chưa xác minh','Chưa đạt','Hoàn tất'])assert.ok(nodes(model).some(node=>node.value===text));
  assert.equal(display('customField').node.value,'indexed');
  assert.equal(display('source').node.text,result.source);
  assert.equal(display('guid').node.value,result.guid);
  assert.equal(display('path').node.value,result.path);
  assert.deepEqual(JSON.parse(model.raw),job);
});

test('only known root bookkeeping moves into a collapsed technical section',()=>{
  const technical={kind:'fixture-result',schemaVersion:1,settingsSha256:'settings-hash',payloadSha256:'payload-hash',
    receiptSha256:'receipt-hash',requestSha256:'request-hash',graphSha256:'graph-hash',revision:'revision-id',graphRevision:'graph-revision'};
  const job=done({...technical,path:'Assets/Main.unity',guid:'asset-guid',scriptId:'script:fixture',unknownFact:'retained',
    item:{kind:'MonoBehaviour',revision:'asset-revision'},error:{code:'ACTIONABLE_CODE',message:'Actionable message'}});
  const model=build(job),ordinary=model.sections.find(section=>section.title==='Kết quả'),details=model.sections.find(section=>section.title==='Thông tin kỹ thuật');
  assert.equal(details?.collapsed,true);
  assert.equal(details.node.kind,'object');
  assert.deepEqual(details.node.fields.map(field=>field.key),Object.keys(technical));
  assert.ok(ordinary.node.fields.every(field=>!Object.hasOwn(technical,field.key)));
  assert.deepEqual(ordinary.node.fields.map(field=>field.key),['path','guid','scriptId','unknownFact','item','error']);
  assert.ok(nodes(model).some(node=>node.value==='asset-revision'));
  assert.ok(model.sections.find(section=>section.title==='Lỗi kết quả').node.fields.some(field=>field.key==='code'&&field.node.value==='ACTIONABLE_CODE'));
  assert.deepEqual(JSON.parse(model.raw),job);
});

test('nested bookkeeping data cannot consume the main result budget while collapsed',()=>{
  const fields=Object.fromEntries(Array.from({length:40},(_,i)=>[String(i),0]));
  const job=done({kind:Array.from({length:50},()=>fields),message:'PRIMARY_EVIDENCE'});
  const model=build(job),ordinary=model.sections.find(section=>section.title==='Kết quả');
  assert.ok(ordinary);
  assert.ok(ordinary.node.fields.some(field=>field.key==='kind'));
  assert.ok(nodes(model).some(node=>node.omitted>0));
  assert.equal(model.sections.some(section=>section.title==='Thông tin kỹ thuật'),false);
  assert.deepEqual(JSON.parse(model.raw),job);
});
