import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {runUnityCli} from '../src/unity/live-cli.js';

function fixture(t, behavior) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retk-unity-cli-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const executable = path.join(dir, 'unity.exe'); fs.writeFileSync(executable, 'owned-inert-fixture');
  let invocation;
  const spawnImpl = (file, args, options) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { queueMicrotask(() => child.emit('close', null, 'SIGKILL')); return true; }; child.unref = () => {};
    invocation = {file, args, options, child}; queueMicrotask(() => behavior(child)); return child;
  };
  return {executable, spawnImpl, get invocation() { return invocation; }};
}

test('uses a trusted absolute executable and shell-free JSON transport, stripping Jev credentials', async t => {
  const f = fixture(t, child => { child.stdout.write(JSON.stringify({success: true, data: {result: 2}})); child.emit('close', 0); });
  const result = await runUnityCli(['command', 'eval', 'return 1+1;', '--project-path', process.cwd()], {...f, cwd: process.cwd(), env: {PATH: '', TYPESAFE_API_KEY: 'private', jev_secret: 'private2'}});
  assert.deepEqual(result, {success: true, data: {result: 2}});
  assert.equal(f.invocation.options.shell, false); assert.equal(f.invocation.options.windowsHide, true);
  assert.equal(f.invocation.options.env.TYPESAFE_API_KEY, undefined); assert.equal(f.invocation.options.env.jev_secret, undefined);
  assert.deepEqual(f.invocation.args.slice(0, 4), ['--format', 'json', '--non-interactive', '--no-pager']);
  assert.equal(f.invocation.file, fs.realpathSync(f.executable));
});

test('does not disclose raw output or exception text on failures', async t => {
  const f = fixture(t, child => { child.stdout.write(JSON.stringify({success: false, errors: [{code: 'COMPILE_FAILED', message: 'private-value'}], data: 'private-value'})); child.stderr.write('private-value'); child.emit('close', 6); });
  await assert.rejects(runUnityCli(['recompile'], {...f, env: {JEV_KEY: 'private-value'}}), error => {
    assert.equal(error.code, 'unity_cli_failed'); assert.equal(error.cliCode, 'COMPILE_FAILED'); assert.equal(error.exitCode, 6);
    assert.ok(!JSON.stringify(error).includes('private-value')); assert.ok(!error.message.includes('private-value')); return true;
  });
  await assert.rejects(runUnityCli(['status'], {...f, spawnImpl() { throw Error('private-value'); }}), error => error.code === 'unity_cli_start_failed' && !error.message.includes('private-value'));
});

test('redacts credential fields and known secrets in successful envelopes', async t => {
  const f = fixture(t, child => { child.stdout.write(JSON.stringify({success: true, data: {token: 'unknown-token', note: 'value private-value', nested: ['private-value']}})); child.emit('close', 0); });
  const result = await runUnityCli(['status'], {...f, env: {TYPESAFE_API_KEY: 'private-value'}});
  assert.deepEqual(result.data, {token: '[REDACTED]', note: 'value [REDACTED]', nested: ['[REDACTED]']});
});

test('rejects workspace executables and relative executable overrides before spawning', async t => {
  const f = fixture(t, () => assert.fail('must not execute'));
  await assert.rejects(runUnityCli(['status'], {...f, cwd: path.dirname(f.executable)}), {code: 'unity_cli_unavailable'});
  await assert.rejects(runUnityCli(['status'], {...f, executable: 'unity.exe'}), {code: 'unity_cli_unavailable'});
  await assert.rejects(runUnityCli(['status'], {...f, executable: f.executable.replace(/exe$/, 'cmd')}), {code: 'unity_cli_unavailable'});
});

test('resolves installed CLI from absolute PATH entries', async t => {
  const f = fixture(t, child => { child.stdout.end('{"success":true}'); child.emit('close', 0); });
  assert.equal((await runUnityCli(['status'], {spawnImpl: f.spawnImpl, env: {PATH: path.dirname(f.executable)}})).success, true);
});

test('malformed or absent success envelopes are rejected without raw text', async t => {
  const f = fixture(t, child => { child.stdout.write('private-value'); child.emit('close', 0); });
  await assert.rejects(runUnityCli(['status'], f), {code: 'unity_cli_invalid_response'});
});

test('timeout preserves ownership even after the CLI closes: remote execution may continue', async t => {
  const f = fixture(t, () => {});
  await assert.rejects(runUnityCli(['command', 'eval', 'return 1;'], {...f, timeoutSeconds: 0.01}), error => error.code === 'unity_recovery_required' && error.preserveToolchainGate === true);
});

test('CLI-reported command timeout also retains the toolchain gate', async t => {
  const f = fixture(t, child => { child.stdout.write('{"success":false,"errors":[{"code":"COMMAND_TIMEOUT"}]}'); child.emit('close', 7); });
  await assert.rejects(runUnityCli(['status'], f), {code: 'unity_recovery_required', preserveToolchainGate: true});
});

test('unknown process cleanup preserves ownership without hanging', async t => {
  const f = fixture(t, child => { child.kill = () => false; });
  await assert.rejects(runUnityCli(['status'], {...f, timeoutSeconds: 0.01}), error => error.code === 'unity_recovery_required' && error.preserveToolchainGate === true);
  assert.equal(f.invocation.child.stdout.destroyed, true);
});

test('oversized stdout and stderr stop execution with recovery required', async t => {
  for (const stream of ['stdout', 'stderr']) {
    const f = fixture(t, child => child[stream].write(Buffer.alloc(4 * 1024 * 1024 + 1, 65)));
    await assert.rejects(runUnityCli(['status'], f), {code: 'unity_recovery_required', preserveToolchainGate: true});
  }
});
