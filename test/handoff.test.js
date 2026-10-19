import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { createToolkit } from '../src/toolkit.js';
import { fileIdentity, outputManifest, setStep } from '../src/state.js';
import { stepFingerprint } from '../src/inputs.js';
import { runtimePaths } from '../src/ghidra/runtime.js';

const api = () => import('../src/handoff.js');
const sha = value => createHash('sha256').update(value).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'retk-handoff-'));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const toolkit = createToolkit(root,{log:()=>{}}); await toolkit.init('Game');
  const workspace=toolkit.workspace('Game');
  const write=async(relative,value='fixture')=>{const file=path.join(workspace,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,value);return file;};
  const native=await write('01_Extracted/libil2cpp.so','synthetic-native');
  const metadata=await write('01_Extracted/global-metadata.dat','synthetic-metadata');
  const p=toolkit.read('Game');p.nativeBinary=native;p.metadata=metadata;p.ghidraProgramName='libil2cpp.so';
  p.identities={native:{...fileIdentity(native),abi:'unknown'},metadata:fileIdentity(metadata)};
  await write('02_Il2CppDumperOutput/dump.cs','// metadata skeleton');await write('02_Il2CppDumperOutput/script.json','{}');
  await write('04_Notes/notes.md','Analysis remains unverified.');
  await write('04_Notes/.engine-runtime/token.txt','PRIVATE');await write('04_Notes/session.log','PRIVATE');await write('04_Notes/tokens.txt','PRIVATE');
  await write('00_OriginalBuild/game.apk','PRIVATE');await write('02_Il2CppDumperOutput/DummyDll/Assembly.dll');await write('05_ReconstructedSource/Assets/scene.txt');
  setStep(p,'dump','succeeded',stepFingerprint(p,'dump',toolkit.tools,root),outputManifest([p.il2cppDumperOutput]));
  await toolkit.save('Game',p);
  return {root,toolkit,workspace,write};
}
async function zip(file, entries) {
  const archive=new yazl.ZipFile();const done=pipeline(archive.outputStream,sync.createWriteStream(file));
  for(const [name,value] of entries)archive.addBuffer(Buffer.from(value),name);archive.end();await done;
}

test('handoff defaults are portable, lightweight and byte verified after moving',async t=>{
  const f=await fixture(t);const {createHandoff,verifyHandoff,readHandoff}=await api();
  const result=await createHandoff(f.toolkit,'Game');
  assert.equal(result.manifest.kind,'retoolkit-handoff');assert.equal(result.manifest.schemaVersion,1);
  assert.equal(result.manifest.build.native.sha256,sha('synthetic-native'));assert.equal('path' in result.manifest.build.native,false);
  assert.deepEqual(result.manifest.files.map(x=>x.path).sort(),['dump/dump.cs','dump/script.json','notes/notes.md']);
  assert.equal(result.manifest.artifacts.find(x=>x.name==='dump').state,'valid');
  const moved=path.join(f.root,'moved');await fs.rename(result.path,moved);assert.equal((await verifyHandoff(moved)).ok,true);
  const reader=await readHandoff(moved);assert.equal((await reader.readFile('notes/notes.md')).toString(),'Analysis remains unverified.');
  await fs.writeFile(path.join(moved,'notes/notes.md'),'tampered');assert.equal((await verifyHandoff(moved)).ok,false);
  await assert.rejects(reader.readFile('notes/notes.md'),/hash|size|changed/i);
});

test('opt-in payloads work for ZIP and reject undeclared reads',async t=>{
  const f=await fixture(t);const {createHandoff,verifyHandoff,readHandoff}=await api();
  const result=await createHandoff(f.toolkit,'Game',{out:path.join(f.root,'bundle.zip'),includeDummyDll:true,includeAssets:true,includeBinaries:true});
  assert.equal((await verifyHandoff(result.path)).ok,true);
  assert.deepEqual(new Set(result.manifest.files.map(x=>x.classification)),new Set(['metadata','notes','reconstructed','assets','binary']));
  assert.equal(result.manifest.files.some(x=>x.path.endsWith('.apk')),false);
  const read=await readHandoff(result.path);await assert.rejects(read.readFile('../secret'),/inventory|unsafe/i);
  assert.equal((await read.readFile('dump/dump.cs')).toString(),'// metadata skeleton');
});

test('missing or stale output does not prevent notes-only export or claim validity',async t=>{
  const f=await fixture(t);const {createHandoff}=await api();
  await fs.writeFile(path.join(f.workspace,'01_Extracted/libil2cpp.so'),'changed input');
  let result=await createHandoff(f.toolkit,'Game');assert.equal(result.manifest.artifacts.find(x=>x.name==='dump').state,'stale');
  assert.equal(result.manifest.build.native.sha256,sha('changed input'));
  await fs.rm(path.join(f.workspace,'02_Il2CppDumperOutput'),{recursive:true});
  result=await createHandoff(f.toolkit,'Game');assert.equal(result.manifest.artifacts.find(x=>x.name==='dump').state,'missing');
  assert.deepEqual(result.manifest.files.map(x=>x.path),['notes/notes.md']);
});

test('output is outside workspace, no clobber, and busy sessions/leases exclude export',async t=>{
  const f=await fixture(t);const {createHandoff}=await api();
  await assert.rejects(createHandoff(f.toolkit,'Game',{out:path.join(f.workspace,'inside')}),/outside/i);
  const out=path.join(f.root,'occupied');await fs.mkdir(out);await fs.writeFile(path.join(out,'prior'),'keep');
  await assert.rejects(createHandoff(f.toolkit,'Game',{out}),/exist/i);assert.equal(await fs.readFile(path.join(out,'prior'),'utf8'),'keep');
  const paths=runtimePaths(f.toolkit,'Game');await fs.mkdir(paths.base,{recursive:true});await fs.writeFile(paths.current,JSON.stringify({runId:'00000000-0000-0000-0000-000000000000',phase:'ready'}));
  await assert.rejects(createHandoff(f.toolkit,'Game'),/session/i);await fs.rm(paths.current);
  await fs.mkdir(path.join(f.workspace,'.retk-lock'));await assert.rejects(createHandoff(f.toolkit,'Game'),/busy/i);
});

test('verifier rejects extra files, future schema, unsafe paths, case duplicates and oversized manifests',async t=>{
  const f=await fixture(t);const {createHandoff,verifyHandoff}=await api();const result=await createHandoff(f.toolkit,'Game');
  const manifestFile=path.join(result.path,'manifest.json');const original=await fs.readFile(manifestFile,'utf8');
  await fs.writeFile(path.join(result.path,'extra.txt'),'extra');assert.equal((await verifyHandoff(result.path)).ok,false);await fs.rm(path.join(result.path,'extra.txt'));
  for(const mutate of [m=>m.schemaVersion=2,m=>m.files[0].path='../outside',m=>m.files[0].path='file:ads',m=>m.files[0].path='CON.txt',m=>m.files.push({...m.files[0],path:m.files[0].path.toUpperCase()}),m=>m.files[0].classification='source']){
    const m=JSON.parse(original);mutate(m);await fs.writeFile(manifestFile,JSON.stringify(m));assert.equal((await verifyHandoff(result.path)).ok,false);
  }
  await fs.writeFile(manifestFile,Buffer.alloc(32*1024*1024+1,32));assert.equal((await verifyHandoff(result.path)).ok,false);
});

test('ZIP exact inventory and CRC checks fail closed without extraction',async t=>{
  const f=await fixture(t);const {createHandoff,verifyHandoff}=await api();const result=await createHandoff(f.toolkit,'Game');
  const entries=[['manifest.json',JSON.stringify(result.manifest)]];
  for(const file of result.manifest.files)entries.push([file.path,await fs.readFile(path.join(result.path,file.path))]);
  const out=path.join(f.root,'extra.zip');await zip(out,[...entries,['extra.txt','extra']]);assert.equal((await verifyHandoff(out)).ok,false);
  const crc=path.join(f.root,'crc.zip');await zip(crc,entries);const bytes=await fs.readFile(crc);let i=0;while((i=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]),i))>=0){bytes.writeUInt32LE(0,i+16);i+=4;}await fs.writeFile(crc,bytes);assert.equal((await verifyHandoff(crc)).ok,false);
});

test('evidence is accepted only with matching build and exact program identity',async t=>{
  const f=await fixture(t);const {createHandoff}=await api();const dir=path.join(f.root,'evidence');await fs.mkdir(dir);
  const p=f.toolkit.read('Game');const evidence={kind:'retoolkit-evidence',schemaVersion:1,query:{method:'functions.list',params:{limit:1}},build:{native:{sha256:p.identities.native.sha256,size:p.identities.native.size,abi:'unknown'},metadata:{sha256:p.identities.metadata.sha256,size:p.identities.metadata.size}},programIdentity:{program:'libil2cpp.so',sha256:p.identities.native.sha256,projectName:'Game',imageBase:'ram:0x1000'},runId:'11111111-1111-4111-8111-111111111111',revision:4,collectedAt:new Date().toISOString(),result:{items:[],nextCursor:null},coverage:{state:'observed',source:'loaded-program',explanation:'synthetic'},limitations:['synthetic'],dataTrust:'untrusted-target-content'};
  await fs.writeFile(path.join(dir,'functions.json'),JSON.stringify(evidence));
  const result=await createHandoff(f.toolkit,'Game',{evidence:dir});assert.equal(result.manifest.files.find(x=>x.path==='evidence/functions.json').classification,'observations');
  evidence.query.params.config={token:'private'};await fs.writeFile(path.join(dir,'functions.json'),JSON.stringify(evidence));await assert.rejects(createHandoff(f.toolkit,'Game',{evidence:dir}),/evidence/i);delete evidence.query.params.config;
  evidence.build.native.sha256='0'.repeat(64);await fs.writeFile(path.join(dir,'functions.json'),JSON.stringify(evidence));
  await assert.rejects(createHandoff(f.toolkit,'Game',{evidence:dir}),/evidence.*binding|evidence.*match/i);
});

test('partially missing dump and added empty bundle directories are reported',async t=>{
  const f=await fixture(t);const {createHandoff,verifyHandoff}=await api();await fs.rm(path.join(f.workspace,'02_Il2CppDumperOutput/script.json'));
  const result=await createHandoff(f.toolkit,'Game');assert.equal(result.manifest.artifacts.find(x=>x.name==='dump').state,'missing');
  await fs.mkdir(path.join(result.path,'undeclared'));assert.equal((await verifyHandoff(result.path)).ok,false);
});

test('linked notes and output aliases into the workspace are rejected',async t=>{
  const f=await fixture(t);const {createHandoff,verifyHandoff}=await api();
  const external=path.join(f.root,'external');await fs.mkdir(external);await fs.writeFile(path.join(external,'hidden.md'),'private');
  const link=path.join(f.workspace,'04_Notes','linked');await fs.symlink(external,link,'junction');
  await assert.rejects(createHandoff(f.toolkit,'Game'),/link|junction/i);await fs.rm(link);
  const alias=path.join(f.root,'alias');await fs.symlink(f.workspace,alias,'junction');
  await assert.rejects(createHandoff(f.toolkit,'Game',{out:path.join(alias,'unexpected','bundle')}),/outside/i);
  assert.equal(sync.existsSync(path.join(f.workspace,'unexpected')),false);
  const result=await createHandoff(f.toolkit,'Game');await fs.symlink(external,path.join(result.path,'notes','link'),'junction');assert.equal((await verifyHandoff(result.path)).ok,false);
});

test('snapshot detects selected input changes during ZIP publication and cleans staging',async t=>{
  const f=await fixture(t);const {createHandoff}=await api();const original=yazl.ZipFile.prototype.addFile;let changed=false;
  yazl.ZipFile.prototype.addFile=function(...args){if(!changed){changed=true;sync.writeFileSync(path.join(f.workspace,'01_Extracted/libil2cpp.so'),'racing update');}return original.apply(this,args);};
  t.after(()=>{yazl.ZipFile.prototype.addFile=original;});const out=path.join(f.root,'racing.zip');
  await assert.rejects(createHandoff(f.toolkit,'Game',{out}),/changed/i);assert.equal(sync.existsSync(out),false);
  assert.equal((await fs.readdir(f.root)).some(name=>name.startsWith('.handoff-')),false);
});

test('ZIP case duplicates, forged sizes, unsafe entry names and symlinks fail closed',async t=>{
  const f=await fixture(t);const {createHandoff,verifyHandoff}=await api();const result=await createHandoff(f.toolkit,'Game');
  const entries=[['manifest.json',JSON.stringify(result.manifest)]];for(const file of result.manifest.files)entries.push([file.path,await fs.readFile(path.join(result.path,file.path))]);
  const dup=path.join(f.root,'duplicate.zip');await zip(dup,[...entries,['NOTES/NOTES.MD','duplicate']]);assert.equal((await verifyHandoff(dup)).ok,false);
  for(const mode of ['size','unsafe','symlink']) {
    const file=path.join(f.root,`${mode}.zip`);await zip(file,entries);const bytes=await fs.readFile(file);let at=bytes.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
    if(mode==='size')bytes.writeUInt32LE(1,at+24);
    if(mode==='unsafe')bytes.write('../nifest.json',at+46,'ascii');
    if(mode==='symlink')bytes.writeUInt32LE((0o120777<<16)>>>0,at+38);
    await fs.writeFile(file,bytes);assert.equal((await verifyHandoff(file)).ok,false);
  }
});

test('verified ZIP readers reject later manifest replacement',async t=>{
  const f=await fixture(t);const {createHandoff,readHandoff}=await api();const result=await createHandoff(f.toolkit,'Game',{out:path.join(f.root,'mutable.zip')});const reader=await readHandoff(result.path);
  result.manifest.files.find(x=>x.path==='notes/notes.md').sha256=sha('replacement');result.manifest.files.find(x=>x.path==='notes/notes.md').size=11;
  const entries=[['manifest.json',JSON.stringify(result.manifest)]];for(const file of result.manifest.files)entries.push([file.path,file.path==='notes/notes.md'?'replacement':await reader.readFile(file.path)]);
  await zip(path.join(f.root,'replacement.zip'),entries);await fs.rm(result.path);await fs.rename(path.join(f.root,'replacement.zip'),result.path);
  await assert.rejects(reader.readFile('notes/notes.md'),/hash/i);
});

test('changed inputs mark saved dependent step success stale without rewriting project',async t=>{
  const f=await fixture(t);const {createHandoff}=await api();const project=f.toolkit.read('Game');
  for(const name of ['import','analyze','symbols','notes','assetripper'])setStep(project,name,'succeeded','a'.repeat(64),[]);
  await f.toolkit.save('Game',project);const before=await fs.readFile(f.toolkit.projectPath('Game'),'utf8');
  await fs.writeFile(project.metadata,'new metadata');const result=await createHandoff(f.toolkit,'Game');
  for(const name of ['dump','import','analyze','symbols','notes','assetripper'])assert.equal(result.manifest.steps[name].state,'stale',name);
  assert.equal(await fs.readFile(f.toolkit.projectPath('Game'),'utf8'),before);
});

test('export preserves actual decompile evidence coverage and historical revision',async t=>{
  const f=await fixture(t);const {createHandoff,readHandoff}=await api();const p=f.toolkit.read('Game');const dir=path.join(f.root,'evidence');await fs.mkdir(dir);
  const evidence={kind:'retoolkit-evidence',schemaVersion:1,query:{method:'functions.decompile',params:{selector:'ram:0x00100000',limit:100}},build:{native:{sha256:p.identities.native.sha256,size:p.identities.native.size,abi:'unknown'},metadata:{sha256:p.identities.metadata.sha256,size:p.identities.metadata.size}},programIdentity:{program:p.ghidraProgramName,sha256:p.identities.native.sha256,projectName:p.ghidraProjectName,imageBase:'ram:0x00100000'},runId:'11111111-1111-4111-8111-111111111111',revision:2,collectedAt:'2026-10-01T00:00:00.000Z',result:{address:'ram:0x00100000',items:[{line:1,text:'void f() {}'}],nextCursor:null},coverage:{state:'observed',source:'loaded-program',explanation:'one function'},limitations:['analysis unverified'],dataTrust:'untrusted-target-content'};
  await fs.writeFile(path.join(dir,'decompile.json'),JSON.stringify(evidence));const result=await createHandoff(f.toolkit,'Game',{evidence:dir});
  assert.equal(result.manifest.files.find(x=>x.path==='evidence/decompile.json').classification,'pseudocode');const reader=await readHandoff(result.path);
  assert.deepEqual(JSON.parse(await reader.readFile('evidence/decompile.json')),evidence);
});

test('snapshot revalidates saved output manifests even for files excluded from payload',async t=>{
  const f=await fixture(t);const {createHandoff}=await api();const original=yazl.ZipFile.prototype.addFile;let changed=false;
  yazl.ZipFile.prototype.addFile=function(...args){if(!changed){changed=true;sync.writeFileSync(path.join(f.workspace,'02_Il2CppDumperOutput/DummyDll/Assembly.dll'),'changed while exporting');}return original.apply(this,args);};
  t.after(()=>{yazl.ZipFile.prototype.addFile=original;});const out=path.join(f.root,'output-race.zip');
  await assert.rejects(createHandoff(f.toolkit,'Game',{out}),/changed/i);assert.equal(sync.existsSync(out),false);
});

test('handoff cannot write into another workspace or a resolved alias to it',async t=>{
  const f=await fixture(t);const {createHandoff}=await api();await f.toolkit.init('Other');
  const out=path.join(f.toolkit.workspace('Other'),'unexpected','bundle');await assert.rejects(createHandoff(f.toolkit,'Game',{out}),/outside.*workspace/i);
  assert.equal(sync.existsSync(path.dirname(out)),false);
  const alias=path.join(f.root,'other-alias');await fs.symlink(f.toolkit.workspace('Other'),alias,'junction');
  await assert.rejects(createHandoff(f.toolkit,'Game',{out:path.join(alias,'unexpected','bundle')}),/outside.*workspace/i);
  assert.equal(sync.existsSync(path.dirname(out)),false);
});
test('portable inventory rejects excessive nesting before directory-prefix expansion',async()=>{
  const {safePath}=await import('../src/handoff-verify.js');
  assert.throws(()=>safePath(Array.from({length:65},()=> 'a').join('/')),/depth|nest|path/i);
  assert.equal(safePath('notes/review.md'),'notes/review.md');
});
