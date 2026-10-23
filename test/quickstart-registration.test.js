import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const moduleUrl = new URL('../src/bootstrap/registration.js', import.meta.url);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'retk-registration-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 're.js'), 'console.log(JSON.stringify(process.argv.slice(2)))');
  return root;
}
async function registration() { return import(moduleUrl); }

test('registration module exposes a write-free command plan', async (t) => {
  const { planQuickstartCommand } = await registration();
  const root = await fixture(t);
  const plan = planQuickstartCommand(root, { node: process.execPath });
  assert.equal(plan.bin, path.join(root, '.cache', 'quickstart', 'bin'));
  assert.equal(plan.shim, path.join(plan.bin, 'retk.cmd'));
  assert.equal(plan.node, process.execPath);
  await assert.rejects(fs.stat(plan.bin), { code: 'ENOENT' });
});

test('no-path creates a managed shim pinned to Node and checkout, then reuses it', async (t) => {
  const { registerQuickstartCommand } = await registration();
  const root = await fixture(t);
  const options = { noPath: true, spawn: () => { throw new Error('unexpected PATH write'); } };
  const result = await registerQuickstartCommand(root, options);
  assert.equal(result.state, 'ready');
  assert.equal(result.pathState, 'skipped');
  const content = await fs.readFile(result.shim, 'utf8');
  assert.match(content, /REToolkit quickstart managed shim v1/);
  assert.ok(content.includes(`"${process.execPath}" "${path.join(root, 're.js')}" %*`));
  assert.match(content, /DisableDelayedExpansion/);
  assert.deepEqual(await registerQuickstartCommand(root, options), result);
});

test('foreign shim is preserved and blocks PATH mutation', async (t) => {
  const { registerQuickstartCommand, planQuickstartCommand } = await registration();
  const root = await fixture(t);
  const plan = planQuickstartCommand(root);
  await fs.mkdir(plan.bin, { recursive: true });
  await fs.writeFile(plan.shim, '@echo foreign');
  const result = await registerQuickstartCommand(root, { spawn: () => { throw new Error('unexpected spawn'); } });
  assert.equal(result.state, 'blocked');
  assert.equal(await fs.readFile(plan.shim, 'utf8'), '@echo foreign');
});

test('registration rejects CMD expansion characters before filesystem writes', async (t) => {
  const { registerQuickstartCommand } = await registration();
  const root = await fixture(t);
  for (const character of ['%', '!', '^', '&', '|', '"', '\n', '<', '>']) {
    await assert.rejects(registerQuickstartCommand(path.join(root, `unsafe${character}root`), { noPath: true }), /unsafe|CMD/i);
    await assert.rejects(registerQuickstartCommand(root, { node: path.join(root, `unsafe${character}node.exe`), noPath: true }), /unsafe|CMD/i);
  }
  await assert.rejects(fs.stat(path.join(root, '.cache')), { code: 'ENOENT' });
});

test('linked cache directories cannot redirect shim writes', async (t) => {
  const { registerQuickstartCommand } = await registration();
  const root = await fixture(t);
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(root, '.cache'), 'junction');
  const result = await registerQuickstartCommand(root, { noPath: true });
  assert.equal(result.state, 'blocked');
  assert.deepEqual(await fs.readdir(outside), []);
});

test('a linked shim and an owned shim for a changed runtime are preserved', async (t) => {
  const { registerQuickstartCommand, planQuickstartCommand } = await registration();
  const root = await fixture(t);
  const original = await registerQuickstartCommand(root, { noPath: true });
  const before = await fs.readFile(original.shim, 'utf8');
  const changed = await registerQuickstartCommand(root, { noPath: true, node: path.join(root, 'other-node.exe') });
  assert.equal(changed.state, 'blocked');
  assert.equal(await fs.readFile(original.shim, 'utf8'), before);
  await fs.unlink(original.shim);
  const foreign = path.join(root, 'foreign.cmd');
  await fs.writeFile(foreign, before);
  await fs.link(foreign, planQuickstartCommand(root).shim);
  assert.equal((await registerQuickstartCommand(root, { noPath: true })).state, 'blocked');
  assert.equal(await fs.readFile(foreign, 'utf8'), before);
});

test('PATH registration uses an environment argument and bounded script results', async (t) => {
  const { registerQuickstartCommand } = await registration();
  const root = await fixture(t);
  const calls = [];
  const result = await registerQuickstartCommand(root, {
    platform: 'win32', env: { PATH: '', SystemRoot: process.env.SystemRoot },
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: '{"state":"added"}', stderr: '' };
    },
  });
  assert.equal(result.pathState, 'added');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.env.RETK_QUICKSTART_BIN, result.bin);
  assert.ok(calls[0].args.includes('-File'));
  assert.ok(!calls[0].args.includes('-Command'));
  assert.ok(!calls[0].args.includes(result.bin));
  assert.equal(calls[0].options.shell, false);
});

test('earlier foreign retk command produces a warning without overwriting it', async (t) => {
  const { registerQuickstartCommand } = await registration();
  const root = await fixture(t);
  const foreign = path.join(root, 'old-bin');
  await fs.mkdir(foreign);
  await fs.writeFile(path.join(foreign, 'retk.cmd'), '@echo old');
  const result = await registerQuickstartCommand(root, {
    noPath: true, platform: 'win32', env: { PATH: foreign, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.collision, path.join(foreign, 'retk.cmd'));
  assert.match(result.warning, /earlier|ahead|takes precedence/i);
  assert.ok(result.instructions.includes(result.shim));
  assert.equal(await fs.readFile(path.join(foreign, 'retk.cmd'), 'utf8'), '@echo old');
});

test('PATH helper failures remain bounded and honest', async (t) => {
  const { registerQuickstartCommand } = await registration();
  const root = await fixture(t);
  const result = await registerQuickstartCommand(root, {
    platform: 'win32', env: { PATH: '' },
    spawn: () => ({ status: 1, stdout: '', stderr: 'failure'.repeat(10000) }),
  });
  assert.equal(result.pathState, 'failed');
  assert.equal(result.state, 'blocked');
  assert.ok(result.warning.length < 1000);
});

test('PowerShell helper recognizes an existing managed path without changing raw entries', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await fixture(t);
  const helper = path.resolve('scripts/register-cli-path.ps1');
  const harness = path.join(root, 'path-test.ps1');
  await fs.writeFile(harness, `param([string]$Helper)\n. $Helper -LibraryOnly\n$env:RETK_PATH_FIXTURE = 'C:\\Fixture Root'\n$result = Merge-UserPathValue '%RETK_PATH_FIXTURE%\\bin;C:\\Other;C:\\FIXTURE ROOT\\bin\\' 'C:\\fixture root\\bin'\n$result | ConvertTo-Json -Compress\n`);
  const run = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harness, helper], { encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout.trim()), { value: '%RETK_PATH_FIXTURE%\\bin;C:\\Other;C:\\FIXTURE ROOT\\bin\\', state: 'present' });
});

test('PowerShell helper appends only its bin and preserves duplicates and empty entries for future expansion', { skip: process.platform !== 'win32' }, async (t) => {
  const root = await fixture(t);
  const helper = path.resolve('scripts/register-cli-path.ps1');
  const harness = path.join(root, 'append-path-test.ps1');
  await fs.writeFile(harness, `param([string]$Helper)\n. $Helper -LibraryOnly\n$env:RETK_FIRST = 'C:\\Same'\n$env:RETK_SECOND = 'C:\\Same'\n$raw = '%RETK_FIRST%\\bin;;%RETK_SECOND%\\bin;C:\\Other;;'\n$bin = 'C:\\Managed Bin'\n$first = Merge-UserPathValue $raw $bin\n$again = Merge-UserPathValue $first.value 'c:\\MANAGED BIN\\'\n$env:RETK_SECOND = 'C:\\Changed'\n$changed = Merge-UserPathValue $again.value $bin\n@($first, $again, $changed) | ConvertTo-Json -Compress\n`);
  const run = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', harness, helper], { encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stderr);
  const value = '%RETK_FIRST%\\bin;;%RETK_SECOND%\\bin;C:\\Other;;;C:\\Managed Bin';
  assert.deepEqual(JSON.parse(run.stdout.trim()), [
    { value, state: 'added' },
    { value, state: 'present' },
    { value, state: 'present' },
  ]);
});

test('isolated cmd executes the pinned Node despite an earlier fake Node on PATH', { skip: process.platform !== 'win32' }, async (t) => {
  const { registerQuickstartCommand } = await registration();
  const root = await fixture(t);
  const fake = path.join(root, 'old-node');
  await fs.mkdir(fake);
  await fs.writeFile(path.join(fake, 'node.cmd'), '@exit /b 91');
  const result = await registerQuickstartCommand(root, { noPath: true });
  const run = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${result.shim}" --version "two words""`], {
    encoding: 'utf8', env: { ...process.env, PATH: fake }, windowsHide: true, windowsVerbatimArguments: true,
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout.trim()), ['--version', 'two words']);
});

test('isolated managed command runs the actual checkout CLI version', { skip: process.platform !== 'win32' }, async (t) => {
  const { registerQuickstartCommand } = await registration();
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 're.js'), `import ${JSON.stringify(new URL('../re.js', import.meta.url).href)};`);
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  const result = await registerQuickstartCommand(root, { noPath: true });
  const run = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${result.shim}" --version"`], {
    encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true,
  });
  assert.equal(run.status, 0, run.stderr);
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(run.stdout.trim(), pkg.version);
});

test('managed shim runs from a Unicode checkout under a legacy CMD codepage', { skip: process.platform !== 'win32' }, async (t) => {
  const { registerQuickstartCommand } = await registration();
  const parent = await fixture(t);
  const root = path.join(parent, 'Việt Nam');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 're.js'), 'console.log("unicode-ok"); process.exitCode = 7;');
  const result = await registerQuickstartCommand(root, { noPath: true });
  const harness = path.join(parent, 'unicode-test.cmd');
  await fs.writeFile(harness, '@echo off\r\n@"%SystemRoot%\\System32\\chcp.com" 437 >nul\r\n@call "%RETK_TEST_SHIM%"\r\n@set "_test_exit=%errorlevel%"\r\n@"%SystemRoot%\\System32\\chcp.com"\r\n@exit /b %_test_exit%\r\n');
  const run = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${harness}""`], {
    encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, env: { ...process.env, RETK_TEST_SHIM: result.shim },
  });
  assert.equal(run.status, 7, run.stderr);
  assert.match(run.stdout, /^unicode-ok\r?\n/);
  assert.match(run.stdout, /437/);
});
