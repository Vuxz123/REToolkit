import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fileIdentity, fingerprint, outputManifest, validManifest, initializeState,
  syncLegacyStatus, setStep, recoverSteps, invalidateSteps, reusable, withWorkspaceLock } from '../src/state.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retk-js-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('symbol invalidation resets revision guards for a newly imported Program',()=>{
  const project=initializeState({});project.steps.symbols.bridgeRevision=100;project.steps.symbols.state='succeeded';
  invalidateSteps(project,['symbols']);assert.equal(project.steps.symbols.state,'stale');
  assert.equal(project.steps.symbols.bridgeRevision,undefined);
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms).unref());

test('schema migration is additive, conservative and rejects future schemas', () => {
  const project = { name: 'Game', custom: { keep: 7 }, identities: { future: 'keep' },
    status: { dumped: true, analyzing: true, future: 'keep' }, steps: { future: { keep: 9 } } };
  assert.equal(initializeState(project), project);
  assert.equal(project.schemaVersion, 2);
  assert.equal(project.steps.dump.state, 'unknown');
  assert.equal(project.steps.analyze.state, 'unknown');
  assert.equal(project.status.dumped, false);
  assert.equal(project.status.analyzing, false);
  assert.equal(project.steps.extract.state, 'pending');
  assert.deepEqual(project.custom, { keep: 7 });
  assert.equal(project.identities.future, 'keep');
  assert.equal(project.steps.future.keep, 9);
  assert.equal(project.status.future, 'keep');
  initializeState(project);
  assert.equal(project.steps.dump.state, 'unknown');
  assert.throws(() => initializeState({ schemaVersion: 3 }), /schema|newer/i);
});

test('identity hashes actual bytes and fingerprints use canonical object key order', t => {
  const file = path.join(fixture(t), 'native.bin');
  fs.writeFileSync(file, 'native-data');
  const identity = fileIdentity(file);
  assert.equal(identity.path, file);
  assert.equal(identity.size, 11);
  assert.match(identity.sha256, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint({ b: { d: 4, c: 3 }, a: 1 }), fingerprint({ a: 1, b: { c: 3, d: 4 } }));
  assert.notEqual(fingerprint([1, 2]), fingerprint([2, 1]));
  assert.notEqual(fingerprint({ option: 1 }), fingerprint({ option: 2 }));
  fs.writeFileSync(file, 'native-edit');
  assert.notEqual(fileIdentity(file).sha256, identity.sha256);
});

test('manifests recursively validate bytes, missing files and extra files or empty folders', t => {
  const root = fixture(t);
  const dir = path.join(root, 'output');
  fs.mkdirSync(path.join(dir, 'nested'), { recursive: true });
  const file = path.join(dir, 'nested', 'output.json');
  fs.writeFileSync(file, 'output');
  const manifest = outputManifest([dir, file]);
  assert.equal(manifest.length, 2);
  assert.equal(manifest[0].files[0].path, 'nested/output.json');
  assert.equal(validManifest(JSON.parse(JSON.stringify(manifest))), true);
  fs.writeFileSync(file, 'tamper');
  assert.equal(validManifest(manifest), false);
  fs.writeFileSync(file, 'output');
  fs.writeFileSync(path.join(dir, 'extra'), 'extra');
  assert.equal(validManifest(manifest), false);
  fs.unlinkSync(path.join(dir, 'extra'));
  fs.mkdirSync(path.join(dir, 'extra-empty'));
  assert.equal(validManifest(manifest), false);
  fs.rmdirSync(path.join(dir, 'extra-empty'));
  fs.unlinkSync(file);
  assert.equal(validManifest(manifest), false);
  assert.deepEqual(outputManifest([]), []);
  assert.equal(validManifest([]), false);
  assert.equal(validManifest([{ path: root, type: 'other' }]), false);
});

test('steps project legacy status and require successful matching nonempty outputs to reuse', t => {
  const file = path.join(fixture(t), 'output');
  fs.writeFileSync(file, 'result');
  const manifest = outputManifest([file]);
  const project = initializeState({});
  for (const state of ['pending', 'running', 'succeeded', 'failed', 'awaiting-user', 'stale', 'unknown']) {
    setStep(project, 'dump', state, 'fp', manifest, 'details');
    assert.equal(project.steps.dump.state, state);
    assert.equal(project.steps.dump.error, 'details');
    assert.ok(project.steps.dump.runId);
    assert.equal(project.status.dumped, state === 'succeeded');
  }
  assert.throws(() => setStep(project, 'dump', 'unsupported', 'fp'), /state/i);
  setStep(project, 'dump', 'succeeded', 'fp', manifest);
  assert.equal(reusable(project, 'dump', 'fp'), true);
  assert.equal(reusable(project, 'dump', 'different'), false);
  invalidateSteps(project, ['dump']);
  assert.equal(project.steps.dump.state, 'stale');
  assert.equal(project.status.dumped, false);
  assert.equal(reusable(project, 'dump', 'fp'), false);
  setStep(project, 'dump', 'succeeded', 'fp', []);
  assert.equal(reusable(project, 'dump', 'fp'), false);
  const empty = path.join(path.dirname(file), 'empty');
  fs.mkdirSync(empty);
  setStep(project, 'dump', 'succeeded', 'fp', outputManifest([empty]));
  assert.equal(reusable(project, 'dump', 'fp'), false);
  syncLegacyStatus(project);
});

test('recovery preserves live owners and artifacts, but marks proven interrupted runs failed', () => {
  const project = initializeState({});
  setStep(project, 'analyze', 'running', 'fp', [{ artifact: 'keep' }]);
  const { runId, startedAt } = project.steps.analyze;
  assert.equal(project.steps.analyze.owner.pid, process.pid);
  assert.ok(project.steps.analyze.owner.startToken);
  recoverSteps(project);
  assert.equal(project.steps.analyze.state, 'running');
  assert.equal(project.steps.analyze.runId, runId);
  setStep(project, 'analyze', 'succeeded', 'fp');
  assert.equal(project.steps.analyze.runId, runId);
  assert.equal(project.steps.analyze.startedAt, startedAt);
  assert.ok(project.steps.analyze.completedAt);
  setStep(project, 'analyze', 'running', 'fp', [{ artifact: 'keep' }]);
  assert.notEqual(project.steps.analyze.runId, runId);
  recoverSteps(project, { isOwnerAlive: () => false });
  assert.equal(project.steps.analyze.state, 'failed');
  assert.match(project.steps.analyze.error, /interrupt/i);
  assert.deepEqual(project.steps.analyze.outputs, [{ artifact: 'keep' }]);
  assert.equal(project.status.analyzing, false);
  setStep(project, 'dump', 'running', 'fp');
  project.steps.dump.owner.startToken = 'reused-pid';
  recoverSteps(project);
  assert.equal(project.steps.dump.state, 'failed');
});

test('workspace lock reenters nested calls and releases on an exception', async t => {
  const root = fixture(t);
  assert.equal(await withWorkspaceLock(root, () => withWorkspaceLock(root, () => 'nested')), 'nested');
  await assert.rejects(withWorkspaceLock(root, () => { throw Error('expected'); }), /expected/);
  assert.equal(await withWorkspaceLock(root, () => 'released'), 'released');
});

test('workspace release preserves uncertain engine markers and requires inspection before reuse', async t => {
  const root = fixture(t);
  const lock = path.join(root, '.retk-lock');
  const engine = path.join(lock, 'engine-uncertain.json');
  await withWorkspaceLock(root, () => { fs.writeFileSync(engine, '{"phase":"uncertain"}'); });
  assert.equal(fs.existsSync(engine), true);
  await assert.rejects(withWorkspaceLock(root, () => 'unsafe'), /busy.*inspection/i);
});

test('independent concurrent calls in the same process contend', async t => {
  const root = fixture(t);
  let release;
  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const holder = withWorkspaceLock(root, async () => { entered(); await gate; });
  await ready;
  await assert.rejects(withWorkspaceLock(root, () => 'bad'), /lock|busy/i);
  const waiter = withWorkspaceLock(root, () => 'waited', { timeoutMs: 2000 });
  release();
  await holder;
  assert.equal(await waiter, 'waited');
});

test('expired inherited lock contexts cannot bypass a newer independent owner', async t => {
  const root = fixture(t);
  let releaseDescendant;
  let descendant;
  const gate = new Promise(resolve => { releaseDescendant = resolve; });
  await withWorkspaceLock(root, () => {
    descendant = (async () => { await gate; return withWorkspaceLock(root, () => 'bad'); })();
  });
  await withWorkspaceLock(root, async () => {
    releaseDescendant();
    await assert.rejects(descendant, /lock|busy/i);
  });
});

test('live PID with an unverifiable token stays busy and release never removes a different token', async t => {
  const root = fixture(t);
  const lock = path.join(root, '.retk-lock');
  fs.mkdirSync(lock);
  const staleToken = '00000000-0000-0000-0000-000000000000';
  const staleMarker = path.join(lock, `owner-${process.pid}-${staleToken}.json`);
  fs.writeFileSync(staleMarker, JSON.stringify({ pid: process.pid, token: staleToken, startToken: 'unknown' }));
  await assert.rejects(withWorkspaceLock(root, () => 'bad'), /lock|busy/i);
  fs.rmSync(lock, { recursive: true });
  await withWorkspaceLock(root, () => {
    const marker = path.join(lock, fs.readdirSync(lock)[0]);
    fs.renameSync(marker, staleMarker);
    fs.writeFileSync(staleMarker, JSON.stringify({ pid: process.pid, token: staleToken, startToken: 'replacement' }));
  });
  assert.equal(fs.existsSync(staleMarker), true);
});

test('subprocesses are excluded and dead-process abandoned locks are recovered', async t => {
  const root = fixture(t);
  const moduleUrl = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/state.js')).href;
  const childCode = `import {withWorkspaceLock} from ${JSON.stringify(moduleUrl)}; await withWorkspaceLock(process.argv[1], async()=>{console.log('ready'); await new Promise(()=>{});});`;
  // A timer keeps the subprocess alive while its callback deliberately waits.
  const child = spawn(process.execPath, ['--input-type=module', '-e', `setInterval(()=>{},1000); ${childCode}`, root], { windowsHide: true });
  const exited = once(child, 'exit');
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  await Promise.race([
    once(child.stdout, 'data').then(([data]) => assert.match(data.toString(), /ready/)),
    exited.then(() => { throw Error(`Lock child exited early: ${stderr}`); }),
    delay(5000).then(() => { throw Error(`Lock child timed out: ${stderr}`); }),
  ]);
  await assert.rejects(withWorkspaceLock(root, () => 'bad'), /lock|busy/i);
  child.kill();
  await exited;
  assert.equal(await withWorkspaceLock(root, () => 'recovered'), 'recovered');
});
