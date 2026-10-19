import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';
import { exportWorkspace } from '../src/archive.js';
import { restoreWorkspace } from '../src/workspace-archive.js';
import { initializeState, invalidateSteps, withWorkspaceLock } from '../src/state.js';

async function legacyArchive(source, archive) {
  const zip = new yazl.ZipFile();
  const done = pipeline(zip.outputStream, fsSync.createWriteStream(archive));
  function walk(folder, prefix = 'Legacy') {
    for (const entry of fsSync.readdirSync(folder, { withFileTypes: true })) {
      const name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) { zip.addEmptyDirectory(name); walk(path.join(folder, entry.name), name); }
      else zip.addFile(path.join(folder, entry.name), name);
    }
  }
  walk(source);
  zip.end();
  await done;
}

async function fixture(t, { legacy = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'retk-restore-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspaces = path.join(root, 'workspaces');
  const source = path.join(root, 'source/Legacy');
  const oldRoot = 'D:\\Old Toolkit\\workspaces\\Legacy';
  const old = relative => `${oldRoot}\\${relative.replaceAll('/', '\\')}`;
  for (const [relative, content] of [
    ['01_Extracted/lib/arm64-v8a/libil2cpp.so', 'arm64'],
    ['01_Extracted/lib/armeabi-v7a/libil2cpp.so', 'armv7'],
    ['01_Extracted/assets/global-metadata.dat', 'first'],
    ['01_Extracted/selected/global-metadata.dat', 'selected'],
    ['03_GhidraProject/Legacy.rep/annotation', 'retained annotation'],
    ['04_Notes/imported-note', 'new note'],
  ]) {
    await fs.mkdir(path.dirname(path.join(source, relative)), { recursive: true });
    await fs.writeFile(path.join(source, relative), content);
  }
  const manifest = {
    name: 'Legacy', extractedPath: old('01_Extracted'),
    nativeBinary: old('01_Extracted/lib/armeabi-v7a/libil2cpp.so'),
    metadata: old('01_Extracted/selected/global-metadata.dat'),
    il2cppDumperOutput: old('02_Il2CppDumperOutput'), ghidraProjectDir: old('03_GhidraProject'),
    reconstructedSourceDir: old('05_ReconstructedSource'),
    selection: { binary: 'lib\\armeabi-v7a\\libil2cpp.so', metadata: 'selected/global-metadata.dat' },
    custom: { keep: true, inside: old('04_Notes/imported-note'), outside: `${oldRoot}-other\\file` },
    status: { scanned: true, dumped: true, imported: true },
  };
  if (!legacy) initializeState(manifest);
  const raw = Buffer.from(`${legacy ? '\uFEFF' : ''}${JSON.stringify(manifest)}\r\n`);
  await fs.writeFile(path.join(source, 'project.re.json'), raw);
  const archivePath = path.join(root, 'input.re');
  await exportWorkspace(source, archivePath);
  const saved = [];
  const saveProject = (name, project) => {
    const file = path.join(workspaces, name, 'project.re.json');
    const previous = JSON.parse(fsSync.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (!previous.schemaVersion || previous.schemaVersion < 2) fsSync.copyFileSync(file, `${file}.bak.original`);
    fsSync.writeFileSync(file, JSON.stringify(project));
    saved.push(project);
  };
  const args = { root, workspaces, archivePath, name: 'Restored', initializeState, invalidateSteps, saveProject, log() {} };
  return { root, workspaces, source, archivePath, manifest, raw, args, saved, destination: path.join(workspaces, 'Restored') };
}

test('restore rebases Windows paths and preserves explicit multi-ABI/metadata selection and unknown fields', async t => {
  const f = await fixture(t);
  const project = await restoreWorkspace(f.args);
  assert.equal(project.name, 'Restored');
  assert.equal(project.nativeBinary, path.join(f.destination, '01_Extracted/lib/armeabi-v7a/libil2cpp.so'));
  assert.equal(project.metadata, path.join(f.destination, '01_Extracted/selected/global-metadata.dat'));
  assert.equal(project.custom.inside, path.join(f.destination, '04_Notes/imported-note'));
  assert.equal(project.custom.outside, f.manifest.custom.outside);
  assert.equal(project.custom.keep, true);
  assert.equal(project.steps.import.state, 'stale');
  assert.equal(project.steps.analyze.state, 'stale');
  assert.equal(await fs.readFile(path.join(f.destination, '03_GhidraProject/Legacy.rep/annotation'), 'utf8'), 'retained annotation');
  assert.equal(f.saved.length, 1);
  assert.equal((await fs.readdir(f.workspaces)).some(name => name.startsWith('.archive-')), false);
});

test('restore legacy migration callback receives original BOM manifest for byte-exact backup', async t => {
  const f = await fixture(t, { legacy: true });
  await restoreWorkspace(f.args);
  assert.deepEqual(await fs.readFile(path.join(f.destination, 'project.re.json.bak.original')), f.raw);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.destination, 'project.re.json'), 'utf8')).schemaVersion, 2);
});

test('legacy restore derives the exact selected pair from extracted paths when no selection or output fields exist', async t => {
  const f = await fixture(t, { legacy: true });
  for (const key of ['selection', 'il2cppDumperOutput', 'ghidraProjectDir', 'reconstructedSourceDir']) delete f.manifest[key];
  f.manifest.extractedPath += '\\';
  await fs.writeFile(path.join(f.source, 'project.re.json'), JSON.stringify(f.manifest));
  await exportWorkspace(f.source, f.archivePath);
  const project = await restoreWorkspace(f.args);
  assert.equal(project.nativeBinary, path.join(f.destination, '01_Extracted/lib/armeabi-v7a/libil2cpp.so'));
  assert.equal(project.metadata, path.join(f.destination, '01_Extracted/selected/global-metadata.dat'));
  assert.equal(project.selection.binary, path.join('lib', 'armeabi-v7a', 'libil2cpp.so'));
});

test('restore refuses an existing nonempty directory without force even when it has no project JSON', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.destination, { recursive: true });
  await fs.writeFile(path.join(f.destination, 'keep.txt'), 'original');
  await assert.rejects(restoreWorkspace(f.args), /exists|nonempty|force/i);
  assert.deepEqual(await fs.readdir(f.destination), ['keep.txt']);
  assert.equal(await fs.readFile(path.join(f.destination, 'keep.txt'), 'utf8'), 'original');
});

test('forced restore keeps old contents in a backup and excludes imported runtime locks', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.destination, { recursive: true });
  await fs.writeFile(path.join(f.destination, 'old.txt'), 'old');
  // Simulate an older exporter that included a lock tombstone.
  await fs.mkdir(path.join(f.source, '.retk-lock.abandoned-old'));
  await fs.writeFile(path.join(f.source, '.retk-lock.abandoned-old/owner.json'), '{}');
  await fs.mkdir(path.join(f.source, '.retk-lock'));
  await fs.writeFile(path.join(f.source, '.retk-lock/owner-stale.json'), '{}');
  await legacyArchive(f.source, f.archivePath);
  let marker;
  const originalSave = f.args.saveProject;
  f.args.saveProject = (name, project) => {
    marker = fsSync.readdirSync(path.join(f.destination, '.retk-lock'));
    originalSave(name, project);
  };
  await restoreWorkspace({ ...f.args, force: true });
  assert.equal(marker.length, 1);
  assert.match(marker[0], /^owner-/);
  const backups = await fs.readdir(path.join(f.root, 'backups'));
  assert.equal(backups.length, 1);
  assert.equal(await fs.readFile(path.join(f.root, 'backups', backups[0], 'old.txt'), 'utf8'), 'old');
  assert.equal((await fs.readdir(f.destination)).some(name => name.startsWith('.retk-lock')), false);
});

test('forced restore rolls back all moved old files and raw JSON if saving the imported project fails', async t => {
  const f = await fixture(t);
  const oldJson = '\uFEFF{"name":"Restored","custom":"old raw"}\r\n';
  await fs.mkdir(path.join(f.destination, '04_Notes'), { recursive: true });
  await fs.writeFile(path.join(f.destination, 'project.re.json'), oldJson);
  await fs.writeFile(path.join(f.destination, '04_Notes/old-note'), 'keep');
  await fs.writeFile(path.join(f.destination, 'old.txt'), 'keep old file');
  await assert.rejects(restoreWorkspace({ ...f.args, force: true, saveProject(name, project) {
    fsSync.writeFileSync(path.join(f.destination, 'project.re.json'), JSON.stringify(project));
    throw new Error('injected save failure');
  } }), /injected save failure/);
  assert.equal(await fs.readFile(path.join(f.destination, 'project.re.json'), 'utf8'), oldJson);
  assert.equal(await fs.readFile(path.join(f.destination, '04_Notes/old-note'), 'utf8'), 'keep');
  assert.equal(await fs.readFile(path.join(f.destination, 'old.txt'), 'utf8'), 'keep old file');
  assert.deepEqual((await fs.readdir(f.destination)).sort(), ['04_Notes', 'old.txt', 'project.re.json']);
  await withWorkspaceLock(f.destination, () => {});
});

test('forced restore refuses Ghidra project locks before moving any contents', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.destination, '03_GhidraProject/Legacy.rep'), { recursive: true });
  const lock = path.join(f.destination, '03_GhidraProject/Legacy.rep/.dbDirLock');
  await fs.writeFile(lock, 'live Ghidra lock');
  await assert.rejects(restoreWorkspace({ ...f.args, force: true }), /Ghidra.*lock|save.*close/i);
  assert.equal(await fs.readFile(lock, 'utf8'), 'live Ghidra lock');
  assert.equal(f.saved.length, 0);
});

test('forced restore rolls back prior moves when an incoming entry rename fails', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.destination, { recursive: true });
  const old = '{"name":"Restored","keep":true}';
  await fs.writeFile(path.join(f.destination, 'project.re.json'), old);
  await fs.writeFile(path.join(f.destination, 'old'), 'retained');
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (source, target) => {
    if (source.includes('.archive-') && target === path.join(f.destination, 'project.re.json')) throw new Error('injected rename failure');
    return rename(source, target);
  });
  await assert.rejects(restoreWorkspace({ ...f.args, force: true }), /injected rename failure/);
  assert.equal(await fs.readFile(path.join(f.destination, 'project.re.json'), 'utf8'), old);
  assert.deepEqual((await fs.readdir(f.destination)).sort(), ['old', 'project.re.json']);
});

test('restore refuses symbolic link workspace targets and reserved names', async t => {
  const f = await fixture(t);
  const outside = path.join(f.root, 'outside');
  await fs.mkdir(outside);
  await fs.mkdir(f.workspaces);
  await fs.symlink(outside, f.destination, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(restoreWorkspace(f.args), /symbolic|junction|linked/i);
  assert.deepEqual(await fs.readdir(outside), []);
  for (const name of ['../outside', 'NUL', 'CON.txt', 'Game.']) {
    await assert.rejects(restoreWorkspace({ ...f.args, name }), /workspace name|reserved|invalid/i);
  }
});

test('restore leaves missing external references unresolved instead of selecting arbitrary archived candidates', async t => {
  const f = await fixture(t);
  const manifest = { ...f.manifest, nativeBinary: 'Q:\\Missing\\libil2cpp.so', metadata: 'Q:\\Missing\\global-metadata.dat' };
  delete manifest.selection;
  manifest.extractedPath = 'Q:\\Missing';
  await fs.writeFile(path.join(f.source, 'project.re.json'), JSON.stringify(manifest));
  await exportWorkspace(f.source, f.archivePath);
  const project = await restoreWorkspace(f.args);
  assert.equal(project.nativeBinary, null);
  assert.equal(project.metadata, null);
  assert.match(project.inputError, /unresolved|missing|scan/i);
  assert.equal(project.steps.scan.state, 'stale');
  assert.equal(project.steps.dump.state, 'stale');
});

test('restore rejects traversal in saved selections and keeps an existing workspace untouched', async t => {
  const f = await fixture(t);
  f.manifest.selection.binary = '../../outside/libil2cpp.so';
  await fs.writeFile(path.join(f.source, 'project.re.json'), JSON.stringify(f.manifest));
  await exportWorkspace(f.source, f.archivePath);
  await fs.mkdir(f.destination, { recursive: true });
  await fs.writeFile(path.join(f.destination, 'keep'), 'safe');
  await assert.rejects(restoreWorkspace({ ...f.args, force: true }), /selection|outside|relative/i);
  assert.deepEqual(await fs.readdir(f.destination), ['keep']);
});

test('restore holds the workspace lock through asynchronous save and releases it afterward', async t => {
  const f = await fixture(t);
  const originalSave = f.args.saveProject;
  await restoreWorkspace({ ...f.args, async saveProject(name, project) {
    await assert.rejects(new Promise((resolve, reject) => {
      // A child process has a separate lock context; same-context calls are intentionally reentrant.
      import('node:child_process').then(({ spawn }) => {
        const script = `import {withWorkspaceLock} from ${JSON.stringify(new URL('../src/state.js', import.meta.url).href)}; await withWorkspaceLock(${JSON.stringify(f.destination)},()=>{});`;
        const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = ''; child.stderr.on('data', data => { stderr += data; });
        child.on('error', reject);
        child.on('close', code => code ? reject(new Error(stderr)) : resolve());
      }, reject);
    }), /busy|lock/i);
    originalSave(name, project);
  } });
  assert.equal(f.saved.length, 1);
  await withWorkspaceLock(f.destination, () => {});
});
