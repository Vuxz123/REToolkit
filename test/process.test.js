import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { runProcess, launchSpec } from '../src/process.js';
import { withWorkspaceLock } from '../src/state.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retk-process-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('real subprocess drains stdout and stderr without deadlocking and retains its complete log', async t => {
  const logFile = path.join(fixture(t), 'logs', 'complete.log');
  const size = 2 * 1024 * 1024 + 17;
  const result = await runProcess(process.execPath, ['-e', `process.stdout.write('a'.repeat(${size})); process.stderr.write('b'.repeat(${size}));`], { logFile });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, 1024 * 1024);
  assert.equal(result.stderr.length, 1024 * 1024);
  const log = fs.readFileSync(logFile);
  assert.equal(log.length, size * 2);
  assert.equal(log.filter(byte => byte === 97).length, size);
  assert.equal(log.filter(byte => byte === 98).length, size);
});

test('nonzero subprocess failures include bounded diagnostics, exit status and log location', async t => {
  const logFile = path.join(fixture(t), 'failure.log');
  const size = 2 * 1024 * 1024;
  await assert.rejects(runProcess(process.execPath, ['-e', `process.stderr.write('failure-'); process.stderr.write('x'.repeat(${size})); process.exitCode=17;`], { logFile }), error => {
    assert.equal(error.exitCode, 17);
    assert.match(error.message, /failure-/);
    assert.ok(error.message.includes(logFile));
    assert.ok(error.message.length < 1024 * 1024 + 1024);
    return true;
  });
  assert.equal(fs.statSync(logFile).size, size + 'failure-'.length);
});

test('spawn failures propagate and signal listeners are removed', async t => {
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  await assert.rejects(runProcess(path.join(fixture(t), 'does-not-exist.exe')), { code: 'ENOENT' });
  assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
});

test('diagnostics preserve UTF-8 characters split across output chunks', async () => {
  const script = `process.stdout.write(Buffer.from([0xf0,0x9f])); setTimeout(()=>process.stdout.write(Buffer.from([0x98,0x80])), 30);`;
  const result = await runProcess(process.execPath, ['-e', script]);
  assert.equal(result.stdout, '😀');
});

test('batch launchers run from paths with spaces and preserve Unicode arguments', { skip: process.platform !== 'win32' }, async t => {
  const root = path.join(fixture(t), 'tools with spaces');
  fs.mkdirSync(root);
  const batch = path.join(root, 'fixture launcher.cmd');
  const script = path.join(root, 'echo-args.mjs');
  fs.writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)))');
  fs.writeFileSync(batch, `@echo off\r\n"${process.execPath}" "%~dp0echo-args.mjs" %*\r\n`, 'ascii');
  const args = ['hello world', 'Tiếng Việt 日本語', 'C:\\directory with spaces\\file.txt', '(parentheses)', 'plain', ''];
  const result = await runProcess(batch, args);
  assert.deepEqual(JSON.parse(result.stdout.trim()), args);
  const spec = launchSpec(batch, args);
  assert.equal(spec.options.shell, false);
  assert.equal(spec.options.windowsVerbatimArguments, true);
});

test('batch launcher rejects shell expansion and metacharacters before spawning', { skip: process.platform !== 'win32' }, async t => {
  const batch = path.join(fixture(t), 'unneeded.cmd');
  for (const argument of ['a&b', 'a|b', '>file', '<file', '%PATH%', '!expand!', 'a^b', 'a"b', 'a\nb', 'a\rb', 'a?b']) {
    assert.throws(() => launchSpec(batch, [argument]), /Unsupported|interpreter/i);
    await assert.rejects(runProcess(batch, [argument]), /Unsupported|interpreter/i);
  }
});

test('cancellation waits for a real child to close before rejecting and restores listeners', async t => {
  const root = fixture(t);
  const ready = path.join(root, 'ready');
  const complete = path.join(root, 'complete');
  const logFile = path.join(root, 'cancel.log');
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  const script = `const fs=require('node:fs'); fs.writeFileSync(process.argv[1], 'ready'); setTimeout(()=>{ fs.writeFileSync(process.argv[2], 'complete'); console.log('child completed'); }, 250);`;
  const result = runProcess(process.execPath, ['-e', script, ready, complete], { logFile });
  const rejection = assert.rejects(result, error => {
    assert.equal(error.code, 'ERR_PROCESS_CANCELLED');
    assert.equal(error.signal, 'SIGINT');
    assert.equal(error.exitCode, 0);
    assert.match(error.message, /cancel/i);
    assert.match(error.message, /descendant|external/i);
    assert.equal(fs.existsSync(complete), true, 'The child must finish before cancellation rejects.');
    return true;
  });
  const deadline = Date.now() + 3000;
  while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(fs.existsSync(ready), true);
  process.emit('SIGINT');
  process.emit('SIGINT');
  await rejection;
  assert.match(fs.readFileSync(logFile, 'utf8'), /child completed/);
  assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
});

test('leased subprocess preserves arguments, environment, output and exit status', async t => {
  const root = fixture(t);
  await withWorkspaceLock(root, async () => {
    const result = await runProcess(process.execPath, ['-e', 'console.log(JSON.stringify({args:process.argv.slice(1),env:process.env.RETK_PROCESS_TEST,cwd:process.cwd()}))', 'space 日本語'], {
      cwd: root, env: { ...process.env, RETK_PROCESS_TEST: 'environment value' }, leaseDirectory: path.join(root, '.retk-lock'),
    });
    assert.deepEqual(JSON.parse(result.stdout), { args: ['space 日本語'], env: 'environment value', cwd: root });
    assert.equal(fs.readdirSync(path.join(root, '.retk-lock')).length, 1);
    await assert.rejects(runProcess(process.execPath, ['-e', 'process.stderr.write("tool failed"); process.exitCode=19'], {
      leaseDirectory: path.join(root, '.retk-lock'),
    }), error => { assert.equal(error.exitCode, 19); assert.match(error.message, /tool failed/); return true; });
    assert.equal(fs.readdirSync(path.join(root, '.retk-lock')).length, 1);
  });
});

test('leased failure logs contain the complete original output without repeating diagnostics', async t => {
  const root = fixture(t);
  const logFile = path.join(root, 'engine.log');
  const size = 1024 * 1024 + 23;
  await withWorkspaceLock(root, async () => {
    await assert.rejects(runProcess(process.execPath, ['-e', `process.stderr.write('e'.repeat(${size}));process.exitCode=21;`], {
      logFile, leaseDirectory: path.join(root, '.retk-lock'),
    }), error => { assert.equal(error.exitCode, 21); return true; });
    assert.equal(fs.statSync(logFile).size, size);
    await assert.rejects(runProcess(path.join(root, 'missing.exe'), [], { leaseDirectory: path.join(root, '.retk-lock') }), { code: 'ENOENT' });
    assert.equal(fs.readdirSync(path.join(root, '.retk-lock')).length, 1);
  });
});

test('leased cancellation waits for the actual tool and removes its completed lease', async t => {
  const root = fixture(t);
  const ready = path.join(root, 'ready');
  const done = path.join(root, 'done');
  await withWorkspaceLock(root, async () => {
    const result = runProcess(process.execPath, ['-e', `const fs=require('node:fs');fs.writeFileSync(process.argv[1],'ready');setTimeout(()=>fs.writeFileSync(process.argv[2],'done'),200)`, ready, done], { leaseDirectory: path.join(root, '.retk-lock') });
    const rejected = assert.rejects(result, error => { assert.equal(error.code, 'ERR_PROCESS_CANCELLED'); assert.equal(fs.existsSync(done), true); return true; });
    const deadline = Date.now() + 3000;
    while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(fs.existsSync(ready), true);
    process.emit('SIGTERM');
    await rejected;
    assert.equal(fs.readdirSync(path.join(root, '.retk-lock')).length, 1);
  });
});

test('a killed engine worker retains an uncertain marker through parent lock release', async t => {
  const root = fixture(t);
  const lock = path.join(root, '.retk-lock');
  const ready = path.join(root, 'ready');
  const done = path.join(root, 'done');
  let marker;
  await withWorkspaceLock(root, async () => {
    const running = runProcess(process.execPath, ['-e', `const fs=require('node:fs');fs.writeFileSync(process.argv[1],'ready');setTimeout(()=>fs.writeFileSync(process.argv[2],'done'),300)`, ready, done], { leaseDirectory: lock });
    const rejected = assert.rejects(running);
    const deadline = Date.now() + 3000;
    while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(fs.existsSync(ready), true);
    marker = path.join(lock, fs.readdirSync(lock).find(name => /^engine-\d+-/.test(name)));
    const owner = JSON.parse(fs.readFileSync(marker, 'utf8')).owner;
    process.kill(owner.pid, 'SIGKILL');
    await rejected;
    assert.equal(fs.existsSync(marker), true);
  });
  assert.equal(fs.existsSync(marker), true);
  await assert.rejects(withWorkspaceLock(root, () => 'unsafe writer'), /busy.*inspection/i);
  // The engine may survive its supervisor; allow its short fixture to finish
  // without making any claim that killing the worker stopped its descendant.
  await new Promise(resolve => setTimeout(resolve, 350));
});

test('a surviving engine worker prevents lock reclamation after its outer parent is killed', async t => {
  const root = fixture(t);
  const ready = path.join(root, 'engine-ready');
  const complete = path.join(root, 'engine-complete');
  const stateUrl = pathToFileURL(path.resolve('src/state.js')).href;
  const processUrl = pathToFileURL(path.resolve('src/process.js')).href;
  const toolCode = `const fs=require('node:fs');fs.writeFileSync(process.argv[1],'ready');const timer=setInterval(()=>console.log('engine still writing'),20);setTimeout(()=>{clearInterval(timer);fs.writeFileSync(process.argv[2],'complete')},800);`;
  const code = `import path from 'node:path';import {withWorkspaceLock} from ${JSON.stringify(stateUrl)};import {runProcess} from ${JSON.stringify(processUrl)};await withWorkspaceLock(process.argv[1],()=>runProcess(process.execPath,['-e',${JSON.stringify(toolCode)},process.argv[2],process.argv[3]],{leaseDirectory:path.join(process.argv[1],'.retk-lock')}));`;
  const parent = spawn(process.execPath, ['--input-type=module', '-e', code, root, ready, complete], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(parent, 'exit');
  let stderr = '';
  parent.stderr.on('data', data => { stderr += data; });
  t.after(async () => {
    if (parent.exitCode === null) parent.kill();
    // Keep the fixture alive until its deliberately surviving short child finishes.
    const deadline = Date.now() + 3000;
    while (fs.existsSync(ready) && !fs.existsSync(complete) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  });
  const deadline = Date.now() + 3000;
  while (!fs.existsSync(ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(fs.existsSync(ready), true, stderr);
  parent.kill();
  await exited;
  assert.equal(fs.existsSync(complete), false);
  await assert.rejects(withWorkspaceLock(root, () => 'unsafe concurrent writer'), /lock|busy/i);
  let reclaimed;
  try { reclaimed = await withWorkspaceLock(root, () => 'reclaimed after child completion', { timeoutMs: 3000 }); }
  catch (error) {
    error.message += `; tool complete=${fs.existsSync(complete)}; markers=${fs.readdirSync(path.join(root, '.retk-lock')).map(name => `${name}: ${fs.readFileSync(path.join(root, '.retk-lock', name), 'utf8')}`).join('; ')}`;
    throw error;
  }
  assert.equal(reclaimed, 'reclaimed after child completion');
  assert.equal(fs.existsSync(complete), true);
});
