import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const api = await import('../src/adb/client.js');
const { resolveAdbPath, validatePackageName, validateSerial, parseDevices, createAdbClient } = api;
const serial = '127.0.0.1:5555';
const pkg = 'com.example.game';
const apk = '/data/app/~~abc==/com.example-game==/base.apk';
function fake(responses) {
  const calls = [];
  const run = async (...args) => {
    calls.push(args);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    assert.notEqual(response, undefined, 'Unexpected process call');
    return typeof response === 'string' ? { stdout: response, stderr: '', exitCode: 0 } : response;
  };
  return { run, calls };
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retk-adb-client-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function errorCode(prefix) { return error => typeof error.code === 'string' && error.code.startsWith(prefix); }

test('client exports the synchronous validation and factory API', () => {
  for (const name of ['resolveAdbPath', 'validatePackageName', 'validateSerial', 'parseDevices', 'createAdbClient']) assert.equal(typeof api[name], 'function', name);
});

test('package and serial validation reject shell syntax and controls', () => {
  assert.equal(validatePackageName(pkg), pkg);
  assert.equal(validatePackageName('com.example_game.a1'), 'com.example_game.a1');
  assert.equal(validateSerial(serial), serial);
  assert.equal(validateSerial('emulator-5554'), 'emulator-5554');
  for (const value of ['', 'com', '-com.example', 'com..example', 'com.example;id', 'com.example\n', 'com.$(id)', null]) assert.throws(() => validatePackageName(value), errorCode('ADB_'));
  for (const value of ['', '-s', 'serial x', 'a;b', 'a\n', 'a$HOME', 'a`id`', null]) assert.throws(() => validateSerial(value), errorCode('ADB_'));
});

test('resolver prefers an explicit regular executable and rejects script launchers', t => {
  const root = fixture(t);
  const explicit = path.join(root, 'selected.exe');
  const discovered = path.join(root, 'adb.exe');
  fs.writeFileSync(explicit, 'owned fixture'); fs.writeFileSync(discovered, 'owned fixture');
  assert.equal(resolveAdbPath(explicit, { env: { PATH: root } }), explicit);
  assert.equal(resolveAdbPath(undefined, { env: { PATH: root } }), discovered);
  for (const name of ['adb.cmd', 'adb.bat', 'adb.ps1', 'directory.exe']) {
    const file = path.join(root, name);
    if (name === 'directory.exe') fs.mkdirSync(file); else fs.writeFileSync(file, 'fixture');
    assert.throws(() => resolveAdbPath(file, { env: { PATH: root } }), errorCode('ADB_'));
  }
  assert.throws(() => resolveAdbPath(path.join(root, 'missing.exe'), { env: { PATH: root } }), errorCode('ADB_'));
});

test('resolver discovers known LDPlayer installations after PATH', t => {
  const root = fixture(t);
  const file = path.join(root, 'LDPlayer', 'LDPlayer9', 'adb.exe');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture');
  assert.equal(resolveAdbPath(undefined, { env: { PATH: '', ProgramFiles: root, SystemDrive: root } }), file);
});

test('devices parser retains ready and unavailable devices with strict metadata', () => {
  assert.deepEqual(parseDevices(`List of devices attached\r\n${serial}\tdevice product:p model:m device:d transport_id:1\r\nemulator-5554\toffline\r\n\r\n`), [{ serial, state: 'device' }, { serial: 'emulator-5554', state: 'offline' }]);
  assert.deepEqual(parseDevices('List of devices attached\n\n'), []);
  for (const text of ['garbage\n', `List of devices attached\n${serial}\n`, `List of devices attached\n${serial}\tdevice broken\n`, `List of devices attached\n${serial}\tdevice model:a model:b\n`, `List of devices attached\n${serial}\tdevice\n${serial}\toffline\n`, `List of devices attached\n${serial};x\tdevice\n`, 'x'.repeat(1024 * 1024), `List of devices attached\n${Array.from({ length: 1025 }, (_, i) => `emulator-${i}\tdevice`).join('\n')}\n`]) assert.throws(() => parseDevices(text), errorCode('ADB_'));
});

test('selectDevice queries readiness and rejects ambiguous or unavailable serials', async () => {
  const observation = `List of devices attached\n${serial}\tdevice\nemulator-5554\toffline\n`;
  const stub = fake([observation, observation, observation, 'List of devices attached\na\tdevice\nb\tdevice\n', 'List of devices attached\n\n']);
  const client = createAdbClient({ file: 'fixture.exe', run: stub.run });
  assert.equal(await client.selectDevice(), serial);
  assert.equal(await client.selectDevice(serial), serial);
  await assert.rejects(client.selectDevice('emulator-5554'), errorCode('ADB_'));
  await assert.rejects(client.selectDevice(), errorCode('ADB_'));
  await assert.rejects(client.selectDevice(), errorCode('ADB_'));
  assert.deepEqual(stub.calls[0].slice(0, 2), ['fixture.exe', ['devices', '-l']]);
});

test('package paths confirm exact identity and retain all unique safe split APK paths', async () => {
  const split = '/data/app/~~abc==/com.example-game==/split_config.arm64_v8a.apk';
  const stub = fake([`package:${pkg}.other\npackage:${pkg}\n`, `package:${apk}\npackage:${split}\npackage:${apk}\n`]);
  const client = createAdbClient({ file: 'fixture.exe', run: stub.run });
  assert.deepEqual(await client.packagePaths(serial, pkg), [apk, split]);
  assert.deepEqual(stub.calls.map(call => call[1]), [['-s', serial, 'shell', 'pm', 'list', 'packages', pkg], ['-s', serial, 'shell', 'pm', 'path', pkg]]);
});

test('package identity never accepts a substring and malformed APK metadata fails', async () => {
  const absent = fake([`package:${pkg}.other\n`]);
  await assert.rejects(createAdbClient({ file: 'fixture.exe', run: absent.run }).packagePaths(serial, pkg), errorCode('ADB_'));
  assert.equal(absent.calls.length, 1);
  for (const output of ['', 'noise\n', 'package:relative.apk\n', 'package:/data/app/a;id.apk\n', 'package:/data/../base.apk\n', 'package:/data/app/base.zip\n', 'package:/data//base.apk\n', 'package:/data/base.apk\u0000\n']) {
    const stub = fake([`package:${pkg}\n`, output]);
    await assert.rejects(createAdbClient({ file: 'fixture.exe', run: stub.run }).packagePaths(serial, pkg), errorCode('ADB_'));
  }
});

test('OBB listing returns safe basenames as absolute remote paths', async () => {
  const stub = fake([`main.1.${pkg}.obb\npatch.2.${pkg}.obb\n`]);
  const client = createAdbClient({ file: 'fixture.exe', run: stub.run });
  assert.deepEqual(await client.obbPaths(serial, pkg), [`/sdcard/Android/obb/${pkg}/main.1.${pkg}.obb`, `/sdcard/Android/obb/${pkg}/patch.2.${pkg}.obb`]);
  assert.deepEqual(stub.calls[0][1], ['-s', serial, 'shell', 'ls', '-1', `/sdcard/Android/obb/${pkg}`]);
  for (const output of ['../escape.obb\n', '/full.obb\n', 'main;id.obb\n', 'directory/thing.obb\n', 'unexpected.txt\n']) {
    const invalid = fake([output]);
    await assert.rejects(createAdbClient({ file: 'fixture.exe', run: invalid.run }).obbPaths(serial, pkg), errorCode('ADB_'));
  }
});

test('only explicit missing OBB directory is optional, while denied access fails', async () => {
  const missing = `ls: /sdcard/Android/obb/${pkg}: No such file or directory`;
  for (const response of [{ stdout: '', stderr: `${missing}\n`, exitCode: 1 }, Object.assign(new Error(`adb failed (1)\n${missing}`), { exitCode: 1 })]) {
    const stub = fake([response]);
    assert.deepEqual(await createAdbClient({ file: 'fixture.exe', run: stub.run }).obbPaths(serial, pkg), []);
  }
  for (const response of [{ stdout: '', stderr: 'Permission denied\n', exitCode: 1 }, new Error('Permission denied'), new Error('adb executable: No such file or directory'), { stdout: '', stderr: 'unknown failure', exitCode: 1 }]) {
    const stub = fake([response]);
    await assert.rejects(createAdbClient({ file: 'fixture.exe', run: stub.run }).obbPaths(serial, pkg), errorCode('ADB_'));
  }
});

test('launch and pull use argument arrays and forward every run option', async () => {
  const options = { leaseDirectory: '/lease', toolchainRoot: '/tools', env: { fixture: 'yes' } };
  const stub = fake(['', 'List of devices attached\n\n', `package:${pkg}\n`, `package:${apk}\n`, '', '']);
  const client = createAdbClient({ file: 'fixture.exe', run: stub.run, runOptions: options });
  await client.launch(serial, pkg); await client.devices(); await client.packagePaths(serial, pkg); await client.obbPaths(serial, pkg); await client.pull(serial, apk, path.resolve('local with spaces.apk'));
  assert.deepEqual(stub.calls[0][1], ['-s', serial, 'shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']);
  assert.deepEqual(stub.calls.at(-1)[1], ['-s', serial, 'pull', apk, path.resolve('local with spaces.apk')]);
  for (const call of stub.calls) assert.equal(call[2], options);
});

test('invalid user arguments reject before any process call', async () => {
  const stub = fake([]); const client = createAdbClient({ file: 'fixture.exe', run: stub.run });
  for (const call of [() => client.selectDevice('a;b'), () => client.packagePaths(serial, 'bad;pkg'), () => client.obbPaths('-s', pkg), () => client.launch(serial, 'a.b\n'), ...['/data/a;id.apk', '/data/../base.apk', 'relative', '/data/a\nb.apk', '/data/a\\b.apk'].map(remote => () => client.pull(serial, remote, '/local')), () => client.pull(serial, apk, 'bad\u0000local')]) await assert.rejects(call(), errorCode('ADB_'));
  assert.equal(stub.calls.length, 0);
  for (const file of ['adb.cmd', 'adb.ps1', '', null]) assert.throws(() => createAdbClient({ file, run: stub.run }), errorCode('ADB_'));
});

test('process errors, nonzero statuses and bounded metadata are structured failures', async () => {
  for (const response of [{ stdout: 'List of devices attached\n', stderr: 'failed', exitCode: 3 }, new Error('spawn failed'), { stdout: 'x'.repeat(1024 * 1024), stderr: '', exitCode: 0 }, { stdout: 'List of devices attached\n', stderr: 'x'.repeat(1024 * 1024), exitCode: 0 }, { stdout: 'List of devices attached\n', exitCode: null }]) {
    const stub = fake([response]);
    await assert.rejects(createAdbClient({ file: 'fixture.exe', run: stub.run }).devices(), errorCode('ADB_'));
  }
});

test('remote size uses fixed stat arguments and strictly bounds byte metadata', async () => {
  const options = { leaseDirectory: '/lease', toolchainRoot: '/tools' };
  const stub = fake(['123\n', '0\n', `${8 * 1024 ** 3}\n`]);
  const client = createAdbClient({ file: 'fixture.exe', run: stub.run, runOptions: options });
  assert.equal(await client.size(serial, apk), 123);
  assert.equal(await client.size(serial, apk), 0);
  assert.equal(await client.size(serial, apk), 8 * 1024 ** 3);
  assert.deepEqual(stub.calls[0], ['fixture.exe', ['-s', serial, 'shell', 'stat', '-c', '%s', apk], options]);
  for (const output of ['-1\n', '12x\n', '1\n2\n', '1.5\n', ' 1\n', `${8 * 1024 ** 3 + 1}\n`, '9007199254740992\n']) {
    const invalid = fake([output]);
    await assert.rejects(createAdbClient({ file: 'fixture.exe', run: invalid.run }).size(serial, apk), errorCode('ADB_'));
  }
  const invalid = fake([]);
  await assert.rejects(createAdbClient({ file: 'fixture.exe', run: invalid.run }).size(serial, '/data/a;id'), errorCode('ADB_'));
  assert.equal(invalid.calls.length, 0);
});

test('unterminated metadata is rejected instead of accepting possibly truncated identities', async () => {
  assert.throws(() => parseDevices(`List of devices attached\n${serial}\tdevice`), errorCode('ADB_'));
  const cases = [
    [() => 'packagePaths', [`package:${pkg}`]],
    [() => 'packagePaths', [`package:${pkg}\n`, `package:${apk}`]],
    [() => 'obbPaths', [`main.1.${pkg}.obb`]],
    [() => 'size', ['123']],
  ];
  for (const [method, responses] of cases) {
    const stub = fake(responses); const client = createAdbClient({ file: 'fixture.exe', run: stub.run });
    await assert.rejects(client[method()](serial, method() === 'size' ? apk : pkg), errorCode('ADB_'));
  }
});

test('a missing OBB message cannot hide another error or cancellation', async () => {
  const missing = `ls: /sdcard/Android/obb/${pkg}: No such file or directory\n`;
  for (const response of [
    { stdout: missing, stderr: 'device disconnected\n', exitCode: 1 },
    Object.assign(new Error(missing), { code: 'ERR_PROCESS_CANCELLED', signal: 'SIGINT', exitCode: 0 }),
    Object.assign(new Error(`${missing}device offline\n`), { exitCode: 1 }),
  ]) {
    const stub = fake([response]);
    await assert.rejects(createAdbClient({ file: 'fixture.exe', run: stub.run }).obbPaths(serial, pkg), errorCode('ADB_'));
  }
});

test('zero-exit OBB responses reject any unexpected stderr diagnostic', async () => {
  const missing = `ls: /sdcard/Android/obb/${pkg}: No such file or directory\n`;
  for (const response of [
    { stdout: '', stderr: `ls: /sdcard/Android/obb/${pkg}: I/O error\n`, exitCode: 0 },
    { stdout: '', stderr: 'unexpected diagnostic\n', exitCode: 0 },
    { stdout: missing, stderr: 'device disconnected\n', exitCode: 0 },
    { stdout: '', stderr: `${missing}device offline\n`, exitCode: 0 },
  ]) {
    const stub = fake([response]);
    await assert.rejects(createAdbClient({ file: 'fixture.exe', run: stub.run }).obbPaths(serial, pkg), errorCode('ADB_'));
  }
});
