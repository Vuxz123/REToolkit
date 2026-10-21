import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint } from '../src/state.js';

const api = () => import('../src/libraries/resolver.js');
const sha = value => fingerprint(value);
function pkg(libraryId, version = '1.0.0', changes = {}) {
  return { id:sha({libraryId,version,changes}),libraryId,version,format:'upm',recognition:'confirmed',
    archiveSha256:sha(libraryId),archivePath:'C:/readonly/vendor.zip',root:libraryId,
    payloadFiles:[{path:`${libraryId}/package.json`,size:5,sha256:sha(libraryId+version)}],
    identity:{packageId:libraryId,assemblies:[],namespaces:[],types:[]},dependencies:{},
    compatibility:{unity:null,platforms:[]},evidence:[],limitations:[],guidInventory:[],...changes };
}
function fixture(packages = [pkg('com.test.lib')]) {
  return {graph:{kind:'retoolkit-asset-graph',schemaVersion:1,revision:sha('graph'),binding:{build:'fixture'},unityVersion:'2022.3.62f1',files:[],assets:[],nodes:[],edges:[],limitations:[]},
    catalog:{kind:'retoolkit-library-catalog',schemaVersion:1,state:'indexed',revision:sha(packages),roots:['C:/readonly'],archives:[],packages,limitations:[]},requirements:[{id:'com.test.lib',version:'1.0.0'}]};
}
const codes = plan => plan.issues.map(i=>i.code);

test('unique exact library plans bind project and catalog with no verification claims',async()=>{
  const {createLibraryPlan,validateLibraryPlan}=await api(),f=fixture(),plan=createLibraryPlan(f);
  assert.equal(plan.kind,'retoolkit-library-plan');assert.equal(plan.schemaVersion,1);
  assert.match(plan.operationId,/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/);
  assert.equal(plan.state,'ready');assert.equal(plan.graphRevision,f.graph.revision);
  assert.deepEqual(plan.binding,f.graph.binding);assert.equal(plan.catalogRevision,f.catalog.revision);
  assert.deepEqual(plan.selected,[f.catalog.packages[0]]);assert.deepEqual(plan.issues,[]);
  for(const key of ['compileReady','bindingsVerified','uiVerified'])assert.equal(plan[key],false);
  const {payloadSha256,...payload}=plan;assert.equal(payloadSha256,fingerprint(payload));
  assert.equal(validateLibraryPlan(plan,f.graph,f.catalog),true);
});

test('dependency closure is dependency-first and rejects conflicting requirements',async()=>{
  const {createLibraryPlan}=await api(),a=pkg('com.test.lib','1.0.0',{dependencies:{'com.test.dep':'^2.1.0'}}),b=pkg('com.test.dep','2.1.3');
  const f=fixture([a,b]);assert.deepEqual(createLibraryPlan(f).selected.map(p=>p.libraryId),['com.test.dep','com.test.lib']);
  f.requirements.push({id:'com.test.dep',version:'1.0.0'});assert.equal(createLibraryPlan(f).state,'blocked');
});

test('later transitive constraints narrow an initially ambiguous dependency to one exact version',async()=>{
  const {createLibraryPlan}=await api(),a=pkg('com.test.lib','1.0.0',{dependencies:{'com.test.b':'^1.0.0','com.test.c':'1.0.0'}}),b0=pkg('com.test.b','1.0.0'),b1=pkg('com.test.b','1.1.0'),c=pkg('com.test.c','1.0.0',{dependencies:{'com.test.b':'1.1.0'}});
  const plan=createLibraryPlan(fixture([a,b0,b1,c]));assert.equal(plan.state,'ready');assert.deepEqual(plan.issues,[]);
  assert.deepEqual(plan.selected.map(p=>[p.libraryId,p.version]),[['com.test.b','1.1.0'],['com.test.c','1.0.0'],['com.test.lib','1.0.0']]);
});

test('resolution never chooses latest and blocks missing ambiguous unknown and unsupported constraints',async()=>{
  const {createLibraryPlan}=await api();
  for(const [packages,version,code] of [
    [[], '1.0.0','missing_library'],[[pkg('com.test.lib'),pkg('com.test.lib','1.1.0')],'^1.0.0','ambiguous_library'],
    [[pkg('com.test.lib','1.0.0',{recognition:'candidate'})],'1.0.0','unconfirmed_library'],
    [[pkg('com.test.lib','1.0.0',{version:null})],'1.0.0','unknown_version'],
    [[pkg('com.test.lib')],'latest','unsupported_version_range'],[[pkg('com.test.lib')],'>=1.0.0','unsupported_version_range']]) {
    const f=fixture(packages);f.requirements[0].version=version;const plan=createLibraryPlan(f);
    assert.equal(plan.state,'blocked');assert.ok(codes(plan).includes(code),JSON.stringify(plan.issues));
  }
});

test('cycles and unavailable transitive dependencies block the entire plan',async()=>{
  const {createLibraryPlan}=await api(),a=pkg('com.test.lib','1.0.0',{dependencies:{'com.test.dep':'1.0.0'}});
  assert.ok(codes(createLibraryPlan(fixture([a]))).includes('missing_library'));
  const b=pkg('com.test.dep','1.0.0',{dependencies:{'com.test.lib':'1.0.0'}});
  assert.ok(codes(createLibraryPlan(fixture([a,b]))).includes('dependency_cycle'));
});

test('simple caret and tilde use semver boundaries conservatively',async()=>{
  const {createLibraryPlan}=await api();
  for(const [range,version,ready] of [['^0.2.3','0.2.9',true],['^0.2.3','0.3.0',false],['^0.0.3','0.0.4',false],['~1.2.3','1.2.9',true],['~1.2.3','1.3.0',false]]) {
    const f=fixture([pkg('com.test.lib',version)]);f.requirements[0].version=range;
    assert.equal(createLibraryPlan(f).state,ready?'ready':'blocked');
  }
});

test('Unity minimum and platform/pipeline facts constrain compatible candidates',async()=>{
  const {createLibraryPlan}=await api();
  for(const compatibility of [{unity:'2023.1',platforms:[]},{unity:null,platforms:['Android']},{unity:null,platforms:[],renderPipeline:'urp'}]) {
    const f=fixture([pkg('com.test.lib','1.0.0',{compatibility})]);assert.equal(createLibraryPlan(f).state,'blocked');
  }
  const f=fixture([pkg('com.test.lib','1.0.0',{compatibility:{unity:'2022.3',platforms:['Android'],renderPipeline:'urp'}})]);
  f.graph.platform='Android';f.graph.renderPipeline='urp';assert.equal(createLibraryPlan(f).state,'ready');
});

test('requirements DTO is strict and empty roots stay unconfigured',async()=>{
  const {createLibraryPlan}=await api(),f=fixture();
  f.requirements={kind:'retoolkit-library-requirements',schemaVersion:1,packages:f.requirements};assert.equal(createLibraryPlan(f).state,'ready');
  f.requirements.extra=true;assert.throws(()=>createLibraryPlan(f),/requirements/);
  f.requirements=[];f.catalog.state='unconfigured';assert.ok(codes(createLibraryPlan(f)).includes('libraries_unconfigured'));
});

test('identity hints are visible but cannot authorize an import',async()=>{
  const {identifyLibraries,createLibraryPlan}=await api(),p=pkg('com.test.lib','1.0.0',{identity:{packageId:'com.test.lib',assemblies:['Test.Lib'],namespaces:['Test'],types:['Test.Widget']}}),f=fixture([p]);
  f.graph.assets.push({path:'Assets/Stub.cs',kind:'script',script:{assembly:'Assembly-CSharp',types:[{fullName:'Test.Widget',namespace:'Test'}]}});
  const identified=identifyLibraries(f.graph,f.catalog);assert.deepEqual(identified.requirements,[]);assert.equal(identified.candidates.length,1);
  assert.ok(identified.candidates[0].evidence.length);assert.equal(createLibraryPlan({...f,requirements:[]}).state,'blocked');
});

test('identification caps per-package hints and aggregate observations while preserving explicit candidates',async()=>{
  const {identifyLibraries}=await api(),packages=Array.from({length:300},(_,index)=>pkg(`com.test.lib${index}`,'1.0.0',{identity:{packageId:`com.test.lib${index}`,assemblies:[],namespaces:['Test'],types:['Test.Widget']}})),f=fixture(packages);
  f.graph.assets=Array.from({length:1000},(_,index)=>({path:`Assets/${'LongPath/'.repeat(300)}Widget${index}.cs`,kind:'script',script:{supported:true,assembly:'Assembly-CSharp',types:[{fullName:'Test.Widget',namespace:'Test'}]}}));
  const result=identifyLibraries(f.graph,f.catalog,{requirements:[{id:'com.test.lib299',version:'1.0.0'}]});
  assert.ok(result.candidates.some(candidate=>candidate.libraryId==='com.test.lib299'));
  let generatedBytes=0;
  for(const candidate of result.candidates) {
    const hints=candidate.evidence.filter(evidence=>evidence.kind.endsWith('-hint'));assert.ok(hints.length<=20);assert.equal(candidate.hintEvidenceCount,hints.length);
    const bytes=hints.reduce((sum,hint)=>sum+Buffer.byteLength(JSON.stringify(hint)),0);assert.ok(bytes<=64*1024);generatedBytes+=bytes;
  }
  assert.ok(generatedBytes<=1024**2);assert.ok(result.candidates.some(candidate=>candidate.hintsTruncated));assert.ok(result.limitations.some(message=>/hint.*trunc/i.test(message)));
});

test('only exact payload inventory proves installed and satisfied',async()=>{
  const {createLibraryPlan,identifyLibraries,packagePayloadMappings}=await api(),f=fixture(),p=f.catalog.packages[0];
  f.graph.packages=[{name:p.libraryId,version:p.version}];assert.equal(createLibraryPlan(f).state,'ready');
  f.graph.files=packagePayloadMappings(p).map(({targetPath,size,sha256})=>({path:targetPath,size,sha256}));
  assert.equal(createLibraryPlan(f).state,'satisfied');assert.equal(identifyLibraries(f.graph,f.catalog).installed.length,1);
  f.graph.files[0].sha256=sha('changed');assert.equal(createLibraryPlan(f).state,'blocked');
});

test('path GUID type assembly and source DLL overlaps require a separate migration',async()=>{
  const {createLibraryPlan}=await api();
  for(const mode of ['path','guid','type','assembly','dll']) {
    const p=pkg('com.test.lib','1.0.0',{identity:{packageId:'com.test.lib',assemblies:['Test.Lib'],namespaces:['Test'],types:['Test.Widget']},guidInventory:[{path:'com.test.lib/Widget.cs',guid:'a'.repeat(32)}]}),f=fixture([p]);
    if(mode==='path')f.graph.files.push({path:'packages/COM.TEST.LIB/package.json',size:2,sha256:sha('other')});
    if(mode==='guid')f.graph.assets.push({path:'Assets/Other.cs',guid:'a'.repeat(32),kind:'script'});
    if(mode==='type')f.graph.assets.push({path:'Assets/Stub.cs',kind:'script',script:{assembly:'Assembly-CSharp',types:[{fullName:'Test.Widget'}]}});
    if(mode==='assembly')f.graph.assets.push({path:'Assets/Stub.cs',kind:'script',script:{assembly:'Test.Lib',types:[]}});
    if(mode==='dll')f.graph.assets.push({path:'Assets/Plugins/Test.Lib.dll',kind:'assembly'});
    const plan=createLibraryPlan(f);assert.equal(plan.state,'blocked',mode);assert.ok(plan.issues.some(i=>/collision|migration|duplicate/.test(i.code)),mode);
  }
});

test('selected packages also reject mutual path type assembly and GUID collisions',async()=>{
  const {createLibraryPlan}=await api(),p=pkg('com.test.lib','1.0.0',{identity:{packageId:'com.test.lib',types:['Test.Widget'],assemblies:[],namespaces:[]},dependencies:{'com.test.dep':'1.0.0'}}),q=pkg('com.test.dep','1.0.0',{identity:{packageId:'com.test.dep',types:['Test.Widget'],assemblies:[],namespaces:[]}});
  assert.ok(codes(createLibraryPlan(fixture([p,q]))).includes('type_collision'));
});

test('payload mappings preserve Assets and package roots and reject unsafe or mixed paths',async()=>{
  const {packagePayloadMappings}=await api();
  const p=pkg('com.test.lib');assert.equal(packagePayloadMappings(p)[0].targetPath,'Packages/com.test.lib/package.json');
  p.format='assets';p.root='bundle';p.payloadFiles=[{path:'bundle/Assets/Lib/A.cs',size:1,sha256:sha('a')}];assert.equal(packagePayloadMappings(p)[0].targetPath,'Assets/Lib/A.cs');
  for(const file of ['../Assets/a.cs','bundle/README.md','bundle/Assets/../a.cs','bundle/Assets/CON.cs','bundle/Assets/a.cs:stream','bundle/Assets/a?.cs',`bundle/Assets/${'dir/'.repeat(65)}a.cs`]) {p.payloadFiles[0].path=file;assert.throws(()=>packagePayloadMappings(p),/payload|path|unsupported/i);}
});

test('catalog Assets roots map from the actual Assets directory',async()=>{
  const {packagePayloadMappings}=await api(),p=pkg('com.test.lib','1.0.0',{format:'assets',root:'bundle/Assets',payloadFiles:[{path:'bundle/Assets/Lib/A.cs',size:1,sha256:sha('a')}]});
  assert.equal(packagePayloadMappings(p)[0].targetPath,'Assets/Lib/A.cs');
  p.root='bundle/assets';p.payloadFiles[0].path='bundle/assets/Lib/A.cs';assert.equal(packagePayloadMappings(p)[0].targetPath,'Assets/Lib/A.cs');
});

test('file directory collisions and existing DLLs with unknown type metadata block source imports',async()=>{
  const {createLibraryPlan}=await api(),p=pkg('com.test.lib','1.0.0',{format:'assets',root:'Assets',payloadFiles:[{path:'Assets/Lib/Widget.cs',size:1,sha256:sha('a')}],identity:{packageId:null,assemblies:[],namespaces:['Test'],types:['Test.Widget']}});
  for(const existing of ['Assets/Lib','Assets/Lib/Widget.cs/child']) {
    const f=fixture([p]);f.graph.files.push({path:existing,size:1,sha256:sha('other')});assert.equal(createLibraryPlan(f).state,'blocked');
  }
  for(const extension of ['dll','winmd']) {const f=fixture([p]);f.graph.assets.push({path:`Assets/Unknown.${extension}`,kind:'assembly'});assert.equal(createLibraryPlan(f).state,'blocked');}
});

test('source declarations unproven by catalog block automatic import',async()=>{
  const {createLibraryPlan}=await api(),p=pkg('com.test.lib','1.0.0',{payloadFiles:[{path:'com.test.lib/package.json',size:5,sha256:sha('json')},{path:'com.test.lib/Runtime/A.cs',size:1,sha256:sha('a')}],limitations:['Unsupported source declarations: Runtime/A.cs']});
  assert.ok(codes(createLibraryPlan(fixture([p]))).includes('unknown_source_identity'));
  p.identity.types=['Known.Type'];p.limitations=[];p.evidence=[{kind:'unsupported-source-declarations',path:'com.test.lib/Runtime/A.cs',value:'Nested type'}];
  assert.ok(codes(createLibraryPlan(fixture([p]))).includes('unknown_source_identity'));
});

test('unsupported existing source declarations block incoming source without claiming duplicate identity proof',async()=>{
  const {createLibraryPlan}=await api(),p=pkg('com.test.lib','1.0.0',{payloadFiles:[{path:'com.test.lib/package.json',size:5,sha256:sha('json')},{path:'com.test.lib/Runtime/Widget.cs',size:1,sha256:sha('a')}],identity:{packageId:'com.test.lib',assemblies:[],namespaces:['Test'],types:['Test.Widget']}});
  for(const script of [{supported:false,types:[]},{types:[]},null]) {
    const f=fixture([p]);f.graph.assets.push({path:'Assets/ConditionalWidget.cs',kind:'script',...(script?{script}:{})});
    assert.ok(codes(createLibraryPlan(f)).includes('unknown_source_collision'));
  }
  const f=fixture([p]);f.graph.assets.push({path:'Assets/Helper.cs',kind:'script',script:{supported:true,assembly:'Assembly-CSharp',types:[]}});
  assert.equal(createLibraryPlan(f).state,'ready');
});

test('uninspected native plugin formats block regardless project content or filename hints',async()=>{
  const {createLibraryPlan}=await api();
  for(const extension of ['.so','.dylib','.a','.aar','.bundle','.jar','.lib','.framework','.xcframework']) {
    const p=pkg('com.test.lib','1.0.0',{payloadFiles:[{path:'com.test.lib/package.json',size:5,sha256:sha('json')},{path:`com.test.lib/Plugins/Plugin${extension}`,size:1,sha256:sha('native')}]}),f=fixture([p]);
    assert.ok(codes(createLibraryPlan(f)).includes('unsupported_native_plugin'));
  }
  const bundle=pkg('com.test.lib','1.0.0',{payloadFiles:[{path:'com.test.lib/package.json',size:5,sha256:sha('json')},{path:'com.test.lib/Plugins/Foo.bundle/Contents/MacOS/Foo',size:1,sha256:sha('native')}]});
  assert.ok(codes(createLibraryPlan(fixture([bundle]))).includes('unsupported_native_plugin'));
  const p=pkg('com.test.lib','1.0.0',{evidence:[{kind:'unsupported-native-plugin',path:'com.test.lib/Plugins/Plugin',value:'Unknown ABI'}]});
  assert.ok(codes(createLibraryPlan(fixture([p]))).includes('unsupported_native_plugin'));
});

test('provided opaque GUID metadata blocks import while missing new metadata remains allowed',async()=>{
  const {createLibraryPlan}=await api(),p=pkg('com.test.lib','1.0.0',{evidence:[{kind:'unsupported-guid-inventory',path:'com.test.lib/Widget.cs.meta',value:'Malformed GUID'}]});
  assert.ok(codes(createLibraryPlan(fixture([p]))).includes('unknown_guid_inventory'));
});

test('incoming provided GUIDs remain blocked when existing package metadata is opaque',async()=>{
  const {createLibraryPlan}=await api(),p=pkg('com.test.lib','1.0.0',{guidInventory:[{path:'com.test.lib/Widget.cs',guid:'a'.repeat(32)}]}),f=fixture([p]);
  f.graph.libraryDeclarations={types:[],assemblies:[],guids:[],unknownSources:[],unknownAssemblies:[],unknownMetadata:[{path:'Packages/com.existing/A.cs.meta',reason:'Opaque'}]};
  assert.ok(codes(createLibraryPlan(f)).includes('unknown_guid_collision'));
  p.guidInventory=[];assert.equal(createLibraryPlan(f).state,'ready');
});

test('unknown embedded package source and assemblies block incoming source even outside graph assets',async()=>{
  const {createLibraryPlan}=await api(),p=pkg('com.test.lib','1.0.0',{payloadFiles:[{path:'com.test.lib/package.json',size:5,sha256:sha('json')},{path:'com.test.lib/Runtime/Widget.cs',size:1,sha256:sha('a')}],identity:{packageId:'com.test.lib',assemblies:[],namespaces:['Test'],types:['Test.Widget']}});
  for(const [field,code]of [['unknownSources','unknown_source_collision'],['unknownAssemblies','unknown_assembly_collision']]) {
    const f=fixture([p]);f.graph.libraryDeclarations={types:[],assemblies:[],unknownSources:[],unknownAssemblies:[],[field]:[{path:'Packages/com.existing/Unknown.cs',reason:'Unsupported'}]};assert.ok(codes(createLibraryPlan(f)).includes(code));
  }
  const f=fixture([p]);f.graph.files.push({path:'Packages/com.existing/Unparsed.cs',size:1,sha256:sha('unknown')});assert.ok(codes(createLibraryPlan(f)).includes('unknown_source_collision'));
});

test('uninspected incoming managed DLLs cannot duplicate existing source implementations',async()=>{
  const {createLibraryPlan}=await api(),p=pkg('com.test.lib','1.0.0',{payloadFiles:[{path:'com.test.lib/package.json',size:5,sha256:sha('json')},{path:'com.test.lib/Plugins/Library.dll',size:1,sha256:sha('dll')}]}),f=fixture([p]);
  f.graph.assets.push({path:'Assets/Stub.cs',kind:'script',script:{assembly:'Assembly-CSharp',types:[{fullName:'Unknown.LibraryType'}]}});
  assert.ok(codes(createLibraryPlan(f)).includes('unknown_assembly_identity'));
});

test('uninspected DLLs and malformed assembly definitions block even without project source',async()=>{
  const {createLibraryPlan}=await api();
  for(const kind of ['unsupported-managed-metadata','unsupported-assembly-definition']) {
    const p=pkg('com.test.lib','1.0.0',{payloadFiles:[{path:'com.test.lib/package.json',size:5,sha256:sha('json')},{path:'com.test.lib/Plugins/Renamed.dll',size:1,sha256:sha('dll')}],evidence:[{kind,path:'com.test.lib/Plugins/Renamed.dll',value:'Unproven'}]}),f=fixture([p]);
    f.graph.assets.push({path:'Assets/Plugins/Original.dll',kind:'assembly'});
    assert.equal(createLibraryPlan(f).state,'blocked');
  }
});

test('satisfied packages reject extra unproven files within their embedded root',async()=>{
  const {createLibraryPlan,packagePayloadMappings}=await api(),f=fixture();
  f.graph.files=packagePayloadMappings(f.catalog.packages[0]).map(({targetPath,size,sha256})=>({path:targetPath,size,sha256}));
  f.graph.files.push({path:'Packages/com.test.lib/Stub.cs',size:1,sha256:sha('stub')});
  assert.equal(createLibraryPlan(f).state,'blocked');
});

test('incoming packages collide with already satisfied packages metadata',async()=>{
  const {createLibraryPlan,packagePayloadMappings}=await api(),p=pkg('com.test.lib','1.0.0',{identity:{packageId:'com.test.lib',assemblies:[],namespaces:[],types:['Test.Widget']},dependencies:{'com.test.dep':'1.0.0'}}),q=pkg('com.test.dep','1.0.0',{identity:{packageId:'com.test.dep',assemblies:[],namespaces:[],types:['Test.Widget']}}),f=fixture([p,q]);
  f.graph.files=packagePayloadMappings(q).map(({targetPath,size,sha256})=>({path:targetPath,size,sha256}));
  assert.ok(codes(createLibraryPlan(f)).includes('type_collision'));
});

test('rehashing forged plans cannot authorize altered selection state flags or binding',async()=>{
  const {createLibraryPlan,validateLibraryPlan}=await api(),f=fixture(),original=createLibraryPlan(f);
  for(const change of [p=>p.selected[0].payloadFiles[0].path='../outside',p=>p.selected=[],p=>p.state='satisfied',p=>p.compileReady=true,p=>p.binding={other:true},p=>p.issues.push({code:'invented',message:'forged'})]) {
    const plan=structuredClone(original);change(plan);const {payloadSha256,...rest}=plan;plan.payloadSha256=fingerprint(rest);
    assert.throws(()=>validateLibraryPlan(plan,f.graph,f.catalog),/plan|stale|binding/i);
  }
  const changed=structuredClone(f.catalog);changed.packages[0].version='9.0.0';assert.throws(()=>validateLibraryPlan(original,f.graph,changed),/plan|stale/i);
});
