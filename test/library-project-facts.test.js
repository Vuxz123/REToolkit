import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {indexUnityProject} from '../src/assets/graph.js';
import {fingerprint} from '../src/state.js';

const api=()=>import('../src/libraries/project-facts.js');
async function fixture(t,files={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'retk-library-facts-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  for(const [relative,bytes]of Object.entries({'Assets/Main.txt':'fixture','ProjectSettings/ProjectVersion.txt':'m_EditorVersion: 2022.3.62f1\n',...files})) {
    await fs.mkdir(path.dirname(path.join(directory,relative)),{recursive:true});await fs.writeFile(path.join(directory,relative),typeof bytes==='string'?bytes:JSON.stringify(bytes));
  }
  return {directory,graph:await indexUnityProject(directory,{binding:{build:'fixture'}})};
}

test('empty project facts remain explicit and preserve graph identity without mutation',async t=>{
  const f=await fixture(t),before=structuredClone(f.graph),{enrichLibraryGraph}=await api(),graph=await enrichLibraryGraph(f.directory,f.graph);
  assert.deepEqual(graph.packageManifestRequirements,[]);assert.deepEqual(graph.installedPackageMetadata,[]);
  assert.equal(graph.revision,before.revision);assert.deepEqual(graph.files,before.files);assert.deepEqual(f.graph,before);assert.notEqual(graph,f.graph);
});

test('project and embedded package dependencies become content-bound requirements with metadata separate from installation proof',async t=>{
  const f=await fixture(t,{'Packages/manifest.json':{dependencies:{'com.example.a':'^1.2.0'}},'Packages/com.example.embedded/package.json':{name:'com.example.embedded',version:'2.0.0',dependencies:{'com.example.b':'~3.1.0'}}}),{enrichLibraryGraph}=await api();
  const graph=await enrichLibraryGraph(f.directory,f.graph);
  assert.deepEqual(graph.packageManifestRequirements.map(({id,version,source})=>({id,version,source})),[{id:'com.example.a',version:'^1.2.0',source:'project-manifest'},{id:'com.example.b',version:'~3.1.0',source:'project-manifest'}]);
  for(const requirement of graph.packageManifestRequirements) {
    assert.equal(requirement.evidence.length,1);const evidence=requirement.evidence[0],inventory=f.graph.files.find(file=>file.path===evidence.path);
    assert.equal(evidence.sha256,inventory.sha256);assert.equal(evidence.size,inventory.size);assert.equal(evidence.kind,'project-package-manifest');
  }
  assert.equal(graph.installedPackageMetadata.length,1);assert.equal(graph.installedPackageMetadata[0].id,'com.example.embedded');assert.equal(graph.installedPackageMetadata[0].version,'2.0.0');
  assert.equal(graph.installedPackageMetadata[0].contentsVerified,false);
});

test('package lock is metadata evidence and cannot create an import requirement or prove satisfaction',async t=>{
  const f=await fixture(t,{'Packages/packages-lock.json':{dependencies:{'com.example.locked':{version:'1.2.3',depth:0,source:'registry',dependencies:{}}}}}),{enrichLibraryGraph}=await api(),graph=await enrichLibraryGraph(f.directory,f.graph);
  assert.deepEqual(graph.packageManifestRequirements,[]);assert.equal(graph.installedPackageMetadata[0].id,'com.example.locked');assert.equal(graph.installedPackageMetadata[0].contentsVerified,false);
});

test('local Git and unsupported version sources are preserved as blocking requirements without following external paths',async t=>{
  const f=await fixture(t,{'Packages/manifest.json':{dependencies:{'com.example.git':'https://example.invalid/repo.git#main','com.example.local':'file:../../outside','com.example.latest':'latest'}}}),{enrichLibraryGraph}=await api(),graph=await enrichLibraryGraph(f.directory,f.graph),{createLibraryPlan}=await import('../src/libraries/resolver.js');
  const catalog={kind:'retoolkit-library-catalog',schemaVersion:1,state:'indexed',revision:fingerprint('catalog'),packages:[],limitations:[]};
  const plan=createLibraryPlan({graph,catalog});assert.equal(plan.requirements.length,3);assert.equal(plan.state,'blocked');assert.ok(plan.issues.every(issue=>issue.code==='unsupported_version_range'));
});

test('facts refuse changed inventory bytes malformed JSON invalid dependency records and excessive metadata',async t=>{
  const {enrichLibraryGraph}=await api();
  for(const manifest of ['{malformed',JSON.stringify({dependencies:[]}),JSON.stringify({dependencies:{'com.example.bad':{version:'1.0.0'}}}),JSON.stringify({dependencies:{'com.example.bad':'x'.repeat(129)}}),' '.repeat(1024**2+1)]) {
    const f=await fixture(t,{'Packages/manifest.json':manifest});await assert.rejects(enrichLibraryGraph(f.directory,f.graph),/package|metadata|manifest/i);
  }
  const f=await fixture(t,{'Packages/manifest.json':{dependencies:{'com.example.a':'1.0.0'}}});await fs.appendFile(path.join(f.directory,'Packages/manifest.json'),' ');
  await assert.rejects(enrichLibraryGraph(f.directory,f.graph),/stale|changed/i);
});

test('added unindexed manifests and junctions are rejected',async t=>{
  const {enrichLibraryGraph}=await api(),f=await fixture(t);
  await fs.mkdir(path.join(f.directory,'Packages'));await fs.writeFile(path.join(f.directory,'Packages/manifest.json'),'{}');
  await assert.rejects(enrichLibraryGraph(f.directory,f.graph),/stale|inventory/i);
  await fs.unlink(path.join(f.directory,'Packages/manifest.json'));
  const outside=await fs.mkdtemp(path.join(os.tmpdir(),'retk-library-facts-target-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));
  await fs.writeFile(path.join(outside,'package.json'),JSON.stringify({name:'com.example.external',version:'1.0.0'}));
  await fs.symlink(outside,path.join(f.directory,'Packages/com.example.link'),'junction');
  await assert.rejects(enrichLibraryGraph(f.directory,{...f.graph,files:[...f.graph.files,{path:'Packages/com.example.link/package.json',size:0,sha256:createHash('sha256').update('').digest('hex')}]}),/link|path/i);
});

test('resolver defaults to verified manifest facts while explicit requirements stay explicit',async t=>{
  const f=await fixture(t,{'Packages/manifest.json':{dependencies:{'com.example.a':'1.0.0'}}}),{enrichLibraryGraph}=await api(),graph=await enrichLibraryGraph(f.directory,f.graph),{createLibraryPlan,identifyLibraries}=await import('../src/libraries/resolver.js');
  const catalog={kind:'retoolkit-library-catalog',schemaVersion:1,state:'indexed',revision:fingerprint('catalog'),packages:[],limitations:[]};
  assert.equal(createLibraryPlan({graph,catalog}).requirements[0].source,'project-manifest');assert.equal(identifyLibraries(graph,catalog).requirements.length,1);
  assert.deepEqual(createLibraryPlan({graph,catalog,requirements:[]}).requirements,[]);
});

test('embedded package declarations expose type and assembly collisions without installation claims',async t=>{
  const f=await fixture(t,{'Packages/com.example.existing/package.json':{name:'com.example.existing',version:'1.0.0'},'Packages/com.example.existing/Runtime/Existing.asmdef':{name:'Existing.Assembly'},'Packages/com.example.existing/Runtime/Existing.cs':'namespace Shared { public class Widget {} }','Packages/com.example.existing/Editor/Tools.asmdef':{name:'Existing.Editor',includePlatforms:['Editor'],defineConstraints:['ENABLE_TOOLS']}}),{enrichLibraryGraph}=await api(),graph=await enrichLibraryGraph(f.directory,f.graph),{createLibraryPlan}=await import('../src/libraries/resolver.js');
  assert.deepEqual(graph.libraryDeclarations.types,[{fullName:'Shared.Widget',assembly:'Existing.Assembly',path:'Packages/com.example.existing/Runtime/Existing.cs'}]);
  assert.deepEqual(graph.libraryDeclarations.assemblies,[{name:'Existing.Editor',path:'Packages/com.example.existing/Editor/Tools.asmdef'},{name:'Existing.Assembly',path:'Packages/com.example.existing/Runtime/Existing.asmdef'}]);
  assert.deepEqual(graph.libraryDeclarations.unknownAssemblies,[]);
  const p={id:fingerprint('package'),libraryId:'com.example.new',version:'1.0.0',format:'upm',recognition:'confirmed',root:'',archiveSha256:fingerprint('archive'),archivePath:'C:/libraries/fixture.zip',payloadFiles:[{path:'package.json',size:1,sha256:fingerprint('manifest')},{path:'Widget.cs',size:1,sha256:fingerprint('source')}],identity:{packageId:'com.example.new',assemblies:['Different.Assembly'],namespaces:['Shared'],types:['Shared.Widget']},dependencies:{},compatibility:{unity:null,platforms:[]},guidInventory:[],evidence:[],limitations:[]};
  const catalog={kind:'retoolkit-library-catalog',schemaVersion:1,state:'indexed',revision:fingerprint('catalog'),packages:[p],limitations:[]};
  const plan=createLibraryPlan({graph,catalog,requirements:[{id:p.libraryId,version:p.version}]});assert.ok(plan.issues.some(issue=>issue.code==='type_collision'));assert.equal(plan.state,'blocked');
  assert.deepEqual(graph.libraryDeclarations.unknownSources,[]);assert.equal(graph.installedPackageMetadata[0].contentsVerified,false);
});

test('unsupported embedded source declarations and DLLs remain explicit blocking unknowns',async t=>{
  const f=await fixture(t,{'Packages/com.example.existing/package.json':{name:'com.example.existing',version:'1.0.0'},'Packages/com.example.existing/Conditional.cs':'#if FLAG\nnamespace Shared { public class Widget {} }\n#endif','Packages/com.example.existing/Original.dll':'opaque','Packages/com.example.existing/Unknown.asmref':'{}'}),{enrichLibraryGraph}=await api(),graph=await enrichLibraryGraph(f.directory,f.graph);
  assert.equal(graph.libraryDeclarations.unknownSources.length,1);assert.equal(graph.libraryDeclarations.unknownAssemblies.length,2);assert.deepEqual(graph.libraryDeclarations.types,[]);
});

test('existing package GUID metadata participates in collisions at different source paths',async t=>{
  const guid='1'.repeat(32),f=await fixture(t,{'Packages/com.example.existing/package.json':{name:'com.example.existing',version:'1.0.0'},'Packages/com.example.existing/A.cs':'namespace Existing { public class A {} }','Packages/com.example.existing/A.cs.meta':`fileFormatVersion: 2\nguid: ${guid}\n`}),{enrichLibraryGraph}=await api(),graph=await enrichLibraryGraph(f.directory,f.graph),{createLibraryPlan}=await import('../src/libraries/resolver.js');
  assert.deepEqual(graph.libraryDeclarations.guids,[{guid,path:'Packages/com.example.existing/A.cs'}]);assert.deepEqual(graph.libraryDeclarations.unknownMetadata,[]);
  const p={id:fingerprint('package'),libraryId:'com.example.new',version:'1.0.0',format:'upm',recognition:'confirmed',root:'',archiveSha256:fingerprint('archive'),archivePath:'C:/libraries/fixture.zip',payloadFiles:[{path:'package.json',size:1,sha256:fingerprint('manifest')},{path:'B.cs',size:1,sha256:fingerprint('source')},{path:'B.cs.meta',size:1,sha256:fingerprint('meta')}],identity:{packageId:'com.example.new',assemblies:[],namespaces:['New'],types:['New.B']},dependencies:{},compatibility:{unity:null,platforms:[]},guidInventory:[{guid,path:'B.cs'}],evidence:[],limitations:[]};
  const catalog={kind:'retoolkit-library-catalog',schemaVersion:1,state:'indexed',revision:fingerprint('catalog'),packages:[p],limitations:[]};
  const plan=createLibraryPlan({graph,catalog,requirements:[{id:p.libraryId,version:p.version}]});assert.equal(plan.state,'blocked');assert.ok(plan.issues.some(issue=>issue.code==='guid_collision'));
});

test('opaque malformed duplicate and alias-bearing package metadata stays unknown',async t=>{
  const {enrichLibraryGraph}=await api();
  for(const meta of ['guid: bad\n',`guid: ${'a'.repeat(32)}\nguid: ${'b'.repeat(32)}\n`,`guid: &identity ${'a'.repeat(32)}\ncopy: *identity\n`,'{broken',`guid: ${'c'.repeat(32)}\nother: !custom value\n`,' '.repeat(1024**2+1)]) {
    const f=await fixture(t,{'Packages/com.example.existing/A.cs.meta':meta}),graph=await enrichLibraryGraph(f.directory,f.graph);
    assert.deepEqual(graph.libraryDeclarations.guids,[]);assert.equal(graph.libraryDeclarations.unknownMetadata.length,1);
  }
});
