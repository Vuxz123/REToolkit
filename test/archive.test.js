import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { extractZip, extractBuild, exportWorkspace, importWorkspaceArchive } from '../src/archive.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'retk-archive-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function zip(file, entries) {
  const archive = new yazl.ZipFile();
  const done = pipeline(archive.outputStream, createWriteStream(file));
  for (const [name, content, options] of entries) {
    if (name.endsWith('/')) archive.addEmptyDirectory(name);
    else archive.addBuffer(Buffer.isBuffer(content) ? content : Buffer.from(content), name, options);
  }
  archive.end();
  await done;
}

test('extractZip streams files, empty directories, and case-collision last entry wins', async t => {
  const root = await fixture(t);
  const archive = path.join(root, 'build.apk');
  await zip(archive, [['res/-n.png', 'first'], ['RES/-N.png', 'last'], ['empty/', ''], ['lib/arm64-v8a/libil2cpp.so', 'native']]);
  const dest = path.join(root, 'out');
  assert.equal(await extractZip(archive, dest), dest);
  assert.equal(await fs.readFile(path.join(dest, 'res/-n.png'), 'utf8'), 'last');
  assert.deepEqual(await fs.readdir(dest), ['empty', 'lib', 'res']);
  assert.equal((await fs.stat(path.join(dest, 'empty'))).isDirectory(), true);
});

test('extractZip rejects ZIP slip and Windows alternate data streams', async t => {
  const root = await fixture(t);
  for (const unsafe of ['../out.txt', '..\\out.txt', '/root.txt', 'C:/xx.txt', 'file:ads']) {
    // yazl rejects unsafe names itself; replace a same-length valid name in both ZIP headers.
    const archive = path.join(root, `bad-${Buffer.from(unsafe).toString('hex')}.zip`);
    const placeholder = 'x'.repeat(Buffer.byteLength(unsafe));
    await zip(archive, [[placeholder, 'escape']]);
    const bytes = await fs.readFile(archive);
    await fs.writeFile(archive, Buffer.from(bytes.toString('latin1').replaceAll(placeholder, unsafe), 'latin1'));
    await assert.rejects(extractZip(archive, path.join(root, 'out')), /invalid|unsafe|absolute|outside|relative|backslash/i);
  }
  await assert.rejects(fs.stat(path.join(root, 'out.txt')), { code: 'ENOENT' });
});

test('extractZip rejects file/directory conflicts and malformed archives', async t => {
  const root = await fixture(t);
  const archive = path.join(root, 'conflict.zip');
  await zip(archive, [['parent', 'file'], ['parent/child', 'child']]);
  await assert.rejects(extractZip(archive, path.join(root, 'conflict')), /directory|conflict/i);
  const malformed = path.join(root, 'malformed.apk');
  await fs.writeFile(malformed, 'not a ZIP');
  await assert.rejects(extractZip(malformed, path.join(root, 'bad')), /zip|archive|signature|end of central/i);
});

test('extractZip rejects corrupted stored file data instead of accepting wrong bytes', async t => {
  const root = await fixture(t);
  const archive = path.join(root, 'corrupt.zip');
  await zip(archive, [['data.bin', 'unique original content for crc']]);
  const bytes = await fs.readFile(archive);
  // Mutate the CRC in central directory; decompression and length still succeed.
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE((bytes.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16);
  await fs.writeFile(archive, bytes);
  await assert.rejects(extractZip(archive, path.join(root, 'out')), /crc|checksum/i);
});

test('extractZip refuses archive symlinks and pre-existing directory junctions', async t => {
  const root = await fixture(t);
  const archive = path.join(root, 'link.zip');
  await zip(archive, [['link', '../outside', { mode: 0o120777 }]]);
  await assert.rejects(extractZip(archive, path.join(root, 'link-out')), /symlink|symbolic|type/i);
  const outside = path.join(root, 'outside');
  const destination = path.join(root, 'destination');
  await fs.mkdir(outside);
  await fs.mkdir(destination);
  await fs.symlink(outside, path.join(destination, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await zip(archive, [['linked/escape.txt', 'no']]);
  await assert.rejects(extractZip(archive, destination), /symlink|symbolic|junction/i);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('extractBuild expands APK/OBB descendants, preserving split and asset directories', async t => {
  const root = await fixture(t);
  const apk = path.join(root, 'inner.apk');
  await zip(apk, [['lib/arm64-v8a/libil2cpp.so', 'native'], ['assets/bin/Data/Managed/Metadata/global-metadata.dat', 'meta']]);
  const obb = path.join(root, 'inner.obb');
  await zip(obb, [['assets/resource.bin', 'asset']]);
  const build = path.join(root, 'build.xapk');
  await zip(build, [['splits/base.apk', await fs.readFile(apk)], ['Android/obb/main.obb', await fs.readFile(obb)]]);
  const dest = path.join(root, 'out');
  const result = await extractBuild(build, dest);
  assert.equal(result.destination, dest);
  assert.deepEqual(result.warnings, []);
  assert.equal(await fs.readFile(path.join(dest, 'splits/base/lib/arm64-v8a/libil2cpp.so'), 'utf8'), 'native');
  assert.equal(await fs.readFile(path.join(dest, 'Android/obb/main/assets/resource.bin'), 'utf8'), 'asset');
  await assert.rejects(fs.stat(path.join(dest, 'splits/base.apk')), { code: 'ENOENT' });
});

test('extractBuild fails on malformed nested APK but reports non-ZIP OBB as a warning', async t => {
  const root = await fixture(t);
  const build = path.join(root, 'bad.xapk');
  await zip(build, [['base.apk', 'not a zip']]);
  await assert.rejects(extractBuild(build, path.join(root, 'bad')), /base\.apk/i);
  const assets = path.join(root, 'assets.xapk');
  await zip(assets, [['main.obb', 'opaque asset bytes']]);
  const result = await extractBuild(assets, path.join(root, 'assets'));
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /main\.obb/);
  assert.equal(await fs.readFile(path.join(root, 'assets/main.obb'), 'utf8'), 'opaque asset bytes');
  // A ZIP-shaped OBB with corrupt data must fail, rather than hiding an extraction error.
  const inner = path.join(root, 'corrupt.obb');
  await zip(inner, [['file.txt', 'payload']]);
  const corrupt = await fs.readFile(inner);
  const central = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  corrupt.writeUInt32LE((corrupt.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16);
  await zip(assets, [['main.obb', corrupt]]);
  await assert.rejects(extractBuild(assets, path.join(root, 'corrupt-obb')), /crc|checksum/i);
});

test('extractBuild enforces nested depth and archive count bounds', async t => {
  const root = await fixture(t);
  const child = path.join(root, 'child.apk');
  await zip(child, [['inner.dat', 'x']]);
  const build = path.join(root, 'build.xapk');
  await zip(build, [['one.apk', await fs.readFile(child)], ['two.apk', await fs.readFile(child)]]);
  await assert.rejects(extractBuild(build, path.join(root, 'depth'), { maxDepth: 0 }), /depth|limit/i);
  await assert.rejects(extractBuild(build, path.join(root, 'count'), { maxArchives: 1 }), /count|limit/i);
});

test('workspace archive roundtrip preserves manifest, payloads, dotfiles and empty folders', async t => {
  const root = await fixture(t);
  const workspace = path.join(root, 'MyGame');
  await fs.mkdir(path.join(workspace, '04_Notes/empty'), { recursive: true });
  const manifest = JSON.stringify({ name: 'MyGame', schemaVersion: 2 });
  await fs.writeFile(path.join(workspace, 'project.re.json'), manifest);
  await fs.writeFile(path.join(workspace, '04_Notes/.notes'), 'notes');
  const archive = path.join(root, 'exports/MyGame.re');
  assert.equal(await exportWorkspace(workspace, archive), archive);
  const restored = await importWorkspaceArchive(archive, path.join(root, 'stage'));
  assert.equal(restored, path.join(root, 'stage/MyGame'));
  assert.equal(await fs.readFile(path.join(restored, 'project.re.json'), 'utf8'), manifest);
  assert.equal(await fs.readFile(path.join(restored, '04_Notes/.notes'), 'utf8'), 'notes');
  assert.equal((await fs.stat(path.join(restored, '04_Notes/empty'))).isDirectory(), true);
  await assert.rejects(exportWorkspace(workspace, path.join(workspace, 'bad.re')), /inside|within/i);
});

test('workspace export omits the runtime lock and retains a previous archive if export fails', async t => {
  const root = await fixture(t);
  const workspace = path.join(root, 'MyGame');
  await fs.mkdir(path.join(workspace, '.retk-lock'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'project.re.json'), '{"name":"MyGame"}');
  await fs.writeFile(path.join(workspace, '.retk-lock/owner.json'), '{"pid":123}');
  for (const name of ['.retk-lock.abandoned-old', '.retk-lock.released-old']) {
    await fs.mkdir(path.join(workspace, name));
    await fs.writeFile(path.join(workspace, name, 'owner.json'), '{}');
  }
  const archive = path.join(root, 'MyGame.re');
  await exportWorkspace(workspace, archive);
  const restored = await importWorkspaceArchive(archive, path.join(root, 'restore'));
  await assert.rejects(fs.stat(path.join(restored, '.retk-lock')), { code: 'ENOENT' });
  assert.equal((await fs.readdir(restored)).some(name => name.startsWith('.retk-lock.')), false);
  const previous = await fs.readFile(archive);
  await fs.mkdir(path.join(root, 'outside'));
  await fs.symlink(path.join(root, 'outside'), path.join(workspace, 'junction'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(exportWorkspace(workspace, archive), /symbolic|junction/i);
  assert.deepEqual(await fs.readFile(archive), previous);
  assert.equal((await fs.readdir(root)).some(name => name.startsWith('.retk-export-')), false);
});

test('workspace import accepts root layout but rejects missing, multiple, or malformed manifests', async t => {
  const root = await fixture(t);
  const archive = path.join(root, 'input.re');
  await zip(archive, [['project.re.json', '{"name":"Game"}']]);
  assert.equal(await importWorkspaceArchive(archive, path.join(root, 'root')), path.join(root, 'root'));
  for (const [label, entries, error] of [
    ['missing', [['data', 'x']], /project\.re\.json/i],
    ['multiple', [['project.re.json', '{}'], ['Other/project.re.json', '{}']], /multiple|exactly one/i],
    ['deep', [['parent/child/project.re.json', '{}']], /root|top.level/i],
    ['malformed', [['project.re.json', 'not json']], /json|manifest/i],
  ]) {
    await zip(archive, entries);
    await assert.rejects(importWorkspaceArchive(archive, path.join(root, label)), error);
  }
});

test('workspace import accepts legacy PowerShell UTF-8 BOM without rewriting original manifest bytes', async t => {
  const root = await fixture(t);
  const archive = path.join(root, 'legacy.re');
  const original = Buffer.from('\uFEFF{"name":"Legacy","custom":{"keep":true}}\r\n');
  await zip(archive, [['Legacy/project.re.json', original]]);
  const restored = await importWorkspaceArchive(archive, path.join(root, 'stage'));
  assert.deepEqual(await fs.readFile(path.join(restored, 'project.re.json')), original);
});
