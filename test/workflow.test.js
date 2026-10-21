import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createToolkit } from '../src/toolkit.js';
import { withWorkspaceLock } from '../src/state.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retk-js-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'input with spaces');
  fs.mkdirSync(path.join(source, 'lib/arm64-v8a'), { recursive: true });
  fs.mkdirSync(path.join(source, 'assets'), { recursive: true });
  const binary = path.join(source, 'lib/arm64-v8a/libil2cpp.so');
  const metadata = path.join(source, 'assets/global-metadata.dat');
  const header = Buffer.alloc(64); header.write('\x7fELF'); header[4] = 2; header[5] = 1; header.writeUInt16LE(183, 18);
  fs.writeFileSync(binary, header); fs.writeFileSync(metadata, 'metadata');
  fs.mkdirSync(path.join(root, 'tools/Il2CppDumper'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools/Il2CppDumper/Il2CppDumper.exe'), 'fixture tool');
  const calls = { dump: 0, imports: [], open: 0, fail: false };
  const toolkit = createToolkit(root, { log() {}, async run(file, args) {
    if (file.endsWith('Il2CppDumper.exe')) {
      calls.dump++;
      fs.writeFileSync(path.join(args[2], 'dump.cs'), 'class Fixture {}');
      fs.writeFileSync(path.join(args[2], 'script.json'), '{}');
      if (calls.failDump) throw new Error('dumper failed');
    } else {
      const verification = args.includes('-readOnly');
      const importing=args.includes('-import');
      if(importing) calls.imports.push(args);
      if (calls.fail) throw new Error('import failed');
      const database=path.join(args[0], `${args[1]}.rep/program-data`);
      if(!importing&&!fs.existsSync(database)) throw new Error('program database missing or corrupt');
      fs.mkdirSync(path.join(args[0], `${args[1]}.rep`), { recursive: true });
      fs.writeFileSync(path.join(args[0], `${args[1]}.gpr`), 'Ghidra project');
      if(importing) fs.writeFileSync(database,'fixture database');
      const post=args.indexOf('-postScript');
      if(post>=0&&!calls.noReceipt) fs.writeFileSync(args[post+2],JSON.stringify({sha256:args[post+3],program:args[post+4]}));
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  }, async open() { calls.open++;assert.equal(fs.existsSync(path.join(root,'workspaces/Game/.retk-lock')),false,'flow must release preparation ownership before GUI worker claims it'); } });
  return { root, source, binary, metadata, toolkit, calls };
}

test('flow hands preparation ownership to the GUI after releasing the workspace lock',async t=>{
 const f=fixture(t);await f.toolkit.flow('Game',f.source);assert.equal(f.calls.open,1);
});

test('legacy migration is read-only until save, backs up original, preserves unknown fields', async t => {
  const f = fixture(t); await f.toolkit.init('Legacy');
  const file = f.toolkit.projectPath('Legacy');
  const old = JSON.parse(fs.readFileSync(file)); delete old.schemaVersion; delete old.steps;
  old.status.imported = true; old.custom = { keep: 1 }; fs.writeFileSync(file, JSON.stringify(old));
  const original = fs.readFileSync(file, 'utf8');
  const project = f.toolkit.read('Legacy');
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(project.steps.import.state, 'unknown');
  await f.toolkit.save('Legacy', project);
  assert.deepEqual(f.toolkit.read('Legacy').custom, { keep: 1 });
  assert.equal(fs.readdirSync(path.dirname(file)).filter(x => x.startsWith('project.re.json.bak.')).length, 1);
});

test('ambiguity requires explicit choice and retains selected relative input', async t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.source, 'other'));
  fs.writeFileSync(path.join(f.source, 'other/global-metadata.dat'), 'other');
  await f.toolkit.init('Game');
  await assert.rejects(f.toolkit.scan('Game', f.source), /Ambiguous metadata/);
  await f.toolkit.scan('Game', f.source, { metadata: 'assets/global-metadata.dat' });
  await f.toolkit.scan('Game', f.source);
  const p = f.toolkit.read('Game');
  assert.equal(p.metadata, f.metadata); assert.equal(p.identities.native.abi, 'arm64-v8a');
  assert.equal(p.identities.native.sha256.length, 64);
});

test('resume reuses valid output, repairs dump tamper, and preserves Ghidra annotations', async t => {
  const f = fixture(t);
  await f.toolkit.flow('Game', f.source, { noOpen: true });
  const p = f.toolkit.read('Game');
  const annotation = path.join(p.ghidraProjectDir, 'Game.rep/annotation'); fs.writeFileSync(annotation, 'my analysis');
  await f.toolkit.flow('Game', f.source, { resume: true, noOpen: true });
  assert.equal(f.calls.dump, 1); assert.equal(f.calls.imports.length, 1);
  assert.equal(p.steps.analyze.state, 'awaiting-user'); assert.equal(p.status.analyzed, false);
  fs.writeFileSync(path.join(p.il2cppDumperOutput, 'dump.cs'), 'tampered');
  await f.toolkit.flow('Game', f.source, { resume: true, noOpen: true });
  assert.equal(f.calls.dump, 2); assert.equal(f.calls.imports.length, 1);
  assert.equal(fs.readFileSync(annotation, 'utf8'), 'my analysis');
  assert.equal(f.calls.open, 0);
});

test('input change invalidates dependent state, import refuses overwrite and explicit reimport backs up', async t => {
  const f = fixture(t); await f.toolkit.flow('Game', f.source, { noOpen: true });
  const p = f.toolkit.read('Game');
  fs.writeFileSync(path.join(p.ghidraProjectDir, 'Game.rep/annotation'), 'retain');
  fs.appendFileSync(f.binary, 'changed'); await f.toolkit.scan('Game', f.source);
  assert.equal(f.toolkit.read('Game').steps.import.state, 'stale');
  await assert.rejects(f.toolkit.importProgram('Game'), /existing|reimport/i);
  assert.equal(f.calls.imports.length, 1);
  await f.toolkit.dump('Game'); f.calls.fail = true;
  await assert.rejects(f.toolkit.importProgram('Game', { reimport: true }), /import failed/);
  const after = f.toolkit.read('Game');
  assert.equal(after.steps.dump.state, 'succeeded'); assert.equal(after.steps.import.state, 'failed');
  const backups = fs.readdirSync(path.join(f.toolkit.workspace('Game'), 'backups'));
  assert.ok(backups.some(x => fs.existsSync(path.join(f.toolkit.workspace('Game'), 'backups', x, 'Game.rep/annotation'))));
  assert.ok(f.calls.imports.at(-1).includes('-overwrite'));
});

test('failed staged dump keeps previous valid output and retry reruns failed step', async t => {
  const f = fixture(t); await f.toolkit.flow('Game', f.source, { noOpen: true });
  const output = path.join(f.toolkit.read('Game').il2cppDumperOutput, 'dump.cs');
  const content = fs.readFileSync(output, 'utf8'); fs.appendFileSync(f.metadata, 'v2'); f.calls.failDump = true;
  await assert.rejects(f.toolkit.dump('Game'), /dumper failed/);
  assert.equal(fs.readFileSync(output, 'utf8'), content);
  f.calls.failDump = false; await f.toolkit.dump('Game');
  assert.equal(f.toolkit.read('Game').steps.dump.state, 'succeeded');
});

test('dry-run does not create or migrate workspaces, run engines, or create lock files', async t => {
  const f = fixture(t);
  const plan = await f.toolkit.flow('New', f.source, { dryRun: true });
  assert.ok(plan.some(step => step.name === 'dump' && step.action === 'run'));
  assert.equal(fs.existsSync(f.toolkit.workspace('New')), false);
  assert.equal(f.calls.dump, 0); assert.equal(f.calls.imports.length, 0);
  const cli = spawnSync(process.execPath, [path.resolve('re.js'), 'flow', 'New', f.source, '--dry-run', '--root', f.root], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr); assert.match(cli.stdout, /dump/);
  assert.equal(fs.existsSync(f.toolkit.workspace('New')), false);
});

test('symbol template changes refresh scripts without rerunning dump or import', async t => {
  const f=fixture(t); const templates=path.join(f.root,'templates/Il2CppDumper'); fs.mkdirSync(templates,{recursive:true});
  fs.writeFileSync(path.join(templates,'ghidra.py'),'# version 1');
  await f.toolkit.flow('Game',f.source,{noOpen:true});
  fs.writeFileSync(path.join(templates,'ghidra.py'),'# version 2');
  await f.toolkit.flow('Game',f.source,{noOpen:true});
  assert.equal(f.calls.dump,1); assert.equal(f.calls.imports.length,1);
  assert.equal(fs.readFileSync(path.join(f.toolkit.read('Game').il2cppDumperOutput,'ghidra.py'),'utf8'),'# version 2');
  assert.equal(f.toolkit.read('Game').steps.symbols.state,'awaiting-user');
});

test('status detects missing/tampered output and effective configuration changes', async t => {
  const f=fixture(t); await f.toolkit.flow('Game',f.source,{noOpen:true});
  const file=path.join(f.toolkit.read('Game').il2cppDumperOutput,'dump.cs'); fs.writeFileSync(file,'tamper');
  assert.equal((await f.toolkit.status('Game')).steps.dump.state,'stale');
  await f.toolkit.dump('Game');
  fs.writeFileSync(path.join(path.dirname(f.toolkit.tools.dumper),'config.json'),JSON.stringify({ForceVersion:24}));
  assert.equal((await f.toolkit.status('Game')).steps.dump.state,'stale');
});

test('archive export/import rebases paths and force import keeps a recoverable backup', async t => {
  const f=fixture(t); await f.toolkit.flow('Game',f.source,{noOpen:true});
  // Include selected files under the workspace so the portable archive owns them.
  const extracted=path.join(f.toolkit.workspace('Game'),'01_Extracted'); fs.cpSync(f.source,extracted,{recursive:true});
  await f.toolkit.scan('Game',extracted);
  const file=await f.toolkit.exportArchive('Game',path.join(f.root,'game.re'));
  const restored=await f.toolkit.importArchive(file,'Copy');
  assert.ok(restored.nativeBinary.startsWith(f.toolkit.workspace('Copy')));
  assert.ok(fs.existsSync(restored.nativeBinary)); assert.equal(restored.steps.import.state,'stale');
  assert.equal(fs.existsSync(path.join(f.toolkit.workspace('Copy'),'.retk-lock')),false);
  await assert.rejects(f.toolkit.importArchive(file,'Copy'),/nonempty|exists/);
  fs.writeFileSync(path.join(f.toolkit.workspace('Copy'),'user-note'),'retain');
  await f.toolkit.importArchive(file,'Copy',{force:true});
  const backupRoot=path.join(f.root,'backups');
  assert.ok(fs.readdirSync(backupRoot).some(entry=>fs.existsSync(path.join(backupRoot,entry,'user-note'))));
});

test('changing only dumper DLL invalidates cached output', async t => {
  const f=fixture(t); const dll=path.join(path.dirname(f.toolkit.tools.dumper),'Il2CppDumper.dll'); fs.writeFileSync(dll,'engine-v1');
  await f.toolkit.flow('Game',f.source,{noOpen:true}); fs.writeFileSync(dll,'engine-v2');
  await f.toolkit.flow('Game',f.source,{noOpen:true}); assert.equal(f.calls.dump,2);
});

test('resume validates the intended Ghidra program, not empty project directories', async t => {
  const f=fixture(t); await f.toolkit.flow('Game',f.source,{noOpen:true});
  const p=f.toolkit.read('Game'); fs.rmSync(path.join(p.ghidraProjectDir,'Game.rep/program-data'));
  await assert.rejects(f.toolkit.flow('Game',f.source,{noOpen:true}),/database missing/);
  assert.notEqual(f.toolkit.read('Game').steps.import.state,'succeeded');
  assert.equal(f.calls.imports.length,1,'Invalid existing database is never overwritten implicitly');
});

test('zero-exit Ghidra without program attestation is a failed import', async t => {
  const f=fixture(t); await f.toolkit.init('Game'); await f.toolkit.scan('Game',f.source); f.calls.noReceipt=true;
  await assert.rejects(f.toolkit.importProgram('Game'),/attestation|receipt/i);
  assert.equal(f.toolkit.read('Game').steps.import.state,'failed');
});

test('workspace-mutating legacy adapters contend with native workspace locks', async t => {
  const f=fixture(t); await f.toolkit.init('Game');
  await withWorkspaceLock(f.toolkit.workspace('Game'),async()=>{
    // Independent async context/process rather than nested reentrant call.
    const contender=spawnSync(process.execPath,['--input-type=module','-e',
      `import {createToolkit} from ${JSON.stringify(new URL('../src/toolkit.js',import.meta.url).href)}; await createToolkit(${JSON.stringify(f.root)}).compat('assetripper-cli',['Game']);`],{encoding:'utf8'});
    assert.notEqual(contender.status,0); assert.match(contender.stderr,/busy/);
  });
});

test('headless analysis requires selected program attestation, not just zero exit', async t => {
  const f=fixture(t); await f.toolkit.flow('Game',f.source,{noOpen:true}); f.calls.noReceipt=true;
  await assert.rejects(f.toolkit.analyze('Game'),/attestation|receipt/i);
  assert.equal(f.toolkit.read('Game').steps.analyze.state,'failed');
  assert.equal(f.toolkit.read('Game').status.analyzed,false);
});

test('status marks import and analysis stale when Ghidra runtime changes', async t => {
  const f=fixture(t); fs.mkdirSync(path.join(f.toolkit.tools.ghidra,'lib'),{recursive:true});
  const jar=path.join(f.toolkit.tools.ghidra,'lib/engine.jar'); fs.writeFileSync(jar,'v1');
  await f.toolkit.flow('Game',f.source,{noOpen:true}); await f.toolkit.analyze('Game');
  fs.writeFileSync(jar,'v2'); const status=await f.toolkit.status('Game');
  assert.equal(status.steps.import.state,'stale'); assert.equal(status.steps.analyze.state,'stale');
});

test('failed import verification and failed reimport invalidate earlier analysis confidence', async t => {
  const f=fixture(t); await f.toolkit.flow('Game',f.source,{noOpen:true}); await f.toolkit.analyze('Game');
  f.calls.fail=true;
  await assert.rejects(f.toolkit.importProgram('Game'),/import failed/);
  let project=f.toolkit.read('Game'); assert.equal(project.status.analyzed,false); assert.equal(project.steps.analyze.state,'stale');
  f.calls.fail=false; await f.toolkit.importProgram('Game',{reimport:true}); await f.toolkit.analyze('Game');
  f.calls.fail=true; await assert.rejects(f.toolkit.importProgram('Game',{reimport:true}),/import failed/);
  project=f.toolkit.read('Game'); assert.equal(project.status.analyzed,false); assert.equal(project.steps.symbols.state,'stale');
});
