import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('Unity validation helper compiles against installed Editor API references without launching it',async t=>{
 const data='C:/Program Files/Unity/Hub/Editor/2022.3.62f2/Editor/Data';
 const dotnet=path.join(data,'NetCoreRuntime/dotnet.exe');
 try{await fs.access(dotnet);}catch{return t.skip('exact installed Unity bundled compiler unavailable');}
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'retk-helper-api-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const managed=path.join(data,'Managed'),engine=path.join(managed,'UnityEngine');
 const refs=[path.join(data,'NetStandard/ref/2.1.0/netstandard.dll'),...(await fs.readdir(managed)).filter(name=>/^UnityEditor.*\.dll$/.test(name)).map(name=>path.join(managed,name)),...(await fs.readdir(engine)).filter(name=>/\.dll$/.test(name)).map(name=>path.join(engine,name))];
 const result=spawnSync(dotnet,[path.join(data,'DotNetSdkRoslyn/csc.dll'),'-nologo','-noconfig','-target:library','-nostdlib+',`-out:${path.join(directory,'Helper.dll')}`,...refs.map(file=>`-r:${file}`),path.resolve('templates/Unity/REToolkitValidation.cs')],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4*1024**2});
 assert.equal(result.status,0,result.stdout+result.stderr);
});

// Executes the actual helper against an owned, deliberately small Unity API fixture.
// This is C# behavior/compilation coverage, not an actual Editor acceptance run.
test('Unity helper bounds each asset, skips only safe payloads, checkpoints and classifies compiler sources', async t => {
  const compiler = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';
  if (process.platform !== 'win32') return t.skip('owned C# fixture requires Windows Framework compiler');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'retk-helper-fixture-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = (await fs.readFile(new URL('../templates/Unity/REToolkitValidation.cs', import.meta.url), 'utf8'))
    .replace('MaxObjects = 200000', 'MaxObjects = 20').replace('MaxProperties = 2000000', 'MaxProperties = 30');
  const helper = path.join(directory, 'Helper.cs');
  await fs.writeFile(helper, source);
  const executable = path.join(directory, 'fixture.exe');
  const compilation = spawnSync(compiler, ['/nologo', '/out:' + executable, helper, path.resolve('test/fixtures/unity-helper/Fixture.cs')], { encoding: 'utf8' });
  assert.equal(compilation.status, 0, compilation.stdout + compilation.stderr);
  for (const scenario of ['payloads', 'limits', 'classes', 'error', 'logerror','data','data-errors','data-missing-script','data-limits','data-capture','data-capture-unsupported','data-capture-limits','data-capture-floats']) {
    const runDirectory = path.join(directory, scenario);
    await fs.mkdir(path.join(runDirectory, 'project', 'Assets'), { recursive: true });
    const reportFile = path.join(runDirectory, 'report.json');
    const requestFile = path.join(runDirectory, 'request.json');
    await fs.writeFile(requestFile, '{}');
    const run = spawnSync(executable, [scenario, runDirectory, '-retkRequest', requestFile, '-retkReport', reportFile], { encoding: 'utf8' });
    assert.equal(run.status, 0, scenario + ': ' + run.stdout + run.stderr);
    const report = JSON.parse(await fs.readFile(reportFile, 'utf8'));
    assert.equal(report.schemaVersion, 1);
    assert.deepEqual(report.traversal, { policy: 'reference-scan-v2' });
    assert.equal(report.compilation.state, 'succeeded');
    if(scenario.startsWith('data-capture')){
      const data=report.assets[0].data;assert.equal(data.policy,'scriptable-data-v2');
      if(scenario==='data-capture-limits'){assert.equal(report.complete,false);assert.equal(data.complete,false);}
      else{assert.equal(report.complete,true);assert.equal(data.complete,scenario!=='data-capture-unsupported');assert.equal(data.objects.length,3);assert.equal(data.objects[1].properties[0].value,'hidden value');assert.equal(data.objects[0].properties.find(p=>p.path==='scores.Array.data[1]').value,'9');assert(BigInt(data.objects[0].fileID)>BigInt(Number.MAX_SAFE_INTEGER));assert.equal(data.unsupportedProperties,scenario==='data-capture-unsupported'?1:0);}
      if(scenario==='data-capture-floats'){const fields=new Map(data.objects[0].properties.map(p=>[p.path,p.value]));assert.equal(fields.get('negativeFloat'),'f32:80000000');assert.equal(fields.get('negativeDouble'),'f64:8000000000000000');assert.equal(fields.get('largeIntVector'),'2147483647;-2147483648;16777217');}
    } else if (scenario === 'data') {
      assert.equal(report.complete,true);assert.equal(report.assets.length,2);assert.ok(report.assets.every(a=>a.kind==='asset'&&a.traversal.complete));assert.equal(report.assets[0].traversal.objects,3);assert.equal(report.assets[0].missingReferences,2);assert.equal(report.assets[1].traversal.objects,1);
    } else if (scenario === 'data-errors') {
      assert.equal(report.complete,false);assert.ok(report.assets.slice(0,3).every(a=>!a.traversal.complete&&a.traversal.stopReason==='asset_error'));assert.equal(report.assets[3].traversal.complete,true);
    } else if (scenario === 'data-missing-script') {
      assert.equal(report.complete,true);assert.equal(report.assets[0].missingScripts,1);assert.equal(report.assets[0].missingReferences,0);assert.equal(report.assets[1].missingScripts,0);
    } else if (scenario === 'data-limits') {
      assert.equal(report.complete,false);assert.equal(report.assets[0].traversal.stopReason,'property_limit');assert.equal(report.assets[0].traversal.properties,30);assert.equal(report.assets[1].traversal.stopReason,'object_limit');assert.equal(report.assets[1].traversal.objects,20);assert.equal(report.assets[2].traversal.complete,true);
    } else if (scenario === 'payloads') {
      assert.equal(report.complete, true);
      assert.equal(report.assets[0].missingReferences, 5, 'reference arrays, nested/primitive-named structs and IDs scoped to each component stay traversable');
      assert.equal(report.assets[0].traversal.complete, true);
      assert.equal(report.assets[0].traversal.skippedSubtrees, 9, 'string, primitive arrays, object references and repeated managed ID are skipped');
    } else if (scenario === 'limits') {
      assert.equal(report.complete, false);
      assert.equal(report.assets.length, 3);
      assert.equal(report.assets[0].traversal.stopReason, 'property_limit');
      assert.equal(report.assets[0].traversal.properties, 30);
      assert.equal(report.assets[1].traversal.stopReason, 'object_limit');
      assert.equal(report.assets[1].traversal.objects, 20);
      assert.equal(report.assets[2].traversal.complete, true, 'later assets get a fresh budget');
      assert.equal(report.assets[2].traversal.stopReason, '');
      assert.ok(report.assets[0].traversal.propertyPath);
      assert.equal(report.assets[0].traversal.objectPath.length, 2048);
      assert.doesNotMatch(report.assets[0].traversal.objectPath, /[\u0000-\u001f\u007f]/);
    } else if (scenario === 'classes') {
      assert.equal(report.complete, true);
      assert.deepEqual(report.scripts.map(row => row.classification), ['attachable', 'non-attachable', 'non-attachable', 'non-attachable', 'compiled-source', 'unresolved']);
      assert.equal(report.scripts[4].resolved, false);
      assert.equal(report.scripts[4].fullName, null);
      assert.equal(report.scripts[4].assembly, 'FixtureAssembly');
      assert.equal(report.scripts[5].assembly, null, 'unknown source is not compiler-backed');
      assert.deepEqual(report.scripts[0].nonAttachableTypes, []);
      assert.deepEqual(report.scripts[1].nonAttachableTypes, ['AbstractComponent']);
      assert.deepEqual(report.scripts[2].nonAttachableTypes, ['GenericComponent`1']);
      assert.deepEqual(report.scripts[3].nonAttachableTypes, ['PlainClass','PlainClass+AbstractNested','PlainClass+GenericNested`1','PlainClass+PlainNested','PlainClass+PlainNested+Deep']);
      assert.equal(Object.hasOwn(report.scripts[4],'nonAttachableTypes'),false);
      assert.equal(Object.hasOwn(report.scripts[5],'nonAttachableTypes'),false);
    } else {
      assert.equal(report.complete, false);
      assert.equal(report.assets[0].traversal.stopReason, 'asset_error');
      assert.equal(report.assets[1].traversal.complete, true);
    }
    assert.ok(run.stdout.includes('checkpoint verified'), scenario + ': checkpoint observed before every asset');
    assert.deepEqual((await fs.readdir(runDirectory)).filter(name => name.endsWith('.tmp')), []);
  }
  await fs.writeFile(helper, source.replace('MaxObservationMilliseconds = 240000', 'MaxObservationMilliseconds = 0'));
  const interruptedExecutable = path.join(directory, 'interrupted.exe');
  const interruptedCompilation = spawnSync(compiler, ['/nologo', '/out:' + interruptedExecutable, helper, path.resolve('test/fixtures/unity-helper/Fixture.cs')], { encoding: 'utf8' });
  assert.equal(interruptedCompilation.status, 0, interruptedCompilation.stdout + interruptedCompilation.stderr);
  const runDirectory = path.join(directory, 'limits');
  const interrupted = spawnSync(interruptedExecutable, ['limits', runDirectory, '-retkRequest', path.join(runDirectory, 'request.json'), '-retkReport', path.join(runDirectory, 'report.json')], { encoding: 'utf8' });
  assert.equal(interrupted.status, 0, interrupted.stdout + interrupted.stderr);
  const bounded = JSON.parse(await fs.readFile(path.join(runDirectory, 'report.json'), 'utf8'));
  assert.equal(bounded.complete, false);
  assert.equal(bounded.compilation.state, 'succeeded');
  assert.equal(bounded.assets.length, 3, 'all remaining assets receive explicit incomplete rows');
  assert.ok(bounded.assets.every(row => row.traversal.stopReason === 'interrupted' && row.traversal.complete === false));
});
