import fs from 'node:fs/promises';
import path from 'node:path';
import { importWorkspaceArchive } from './archive.js';
import { withWorkspaceLock, initializeState as defaultInitialize, invalidateSteps as defaultInvalidate, fileIdentity } from './state.js';

const runtimeLock = name => /^\.retk-lock(?:\.|$)/i.test(name);

async function lstat(file) {
  try { return await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function assertName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(name) || name.endsWith('.') ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('Invalid or reserved workspace name.');
  }
}

function pathProvider(value) {
  return /^[A-Za-z]:[\\/]|^\\\\/.test(value) ? path.win32 : value.startsWith('/') ? path.posix : path;
}

// The source machine's path dialect may differ from the current machine's.
function relativeWithin(child, parent) {
  if (typeof child !== 'string' || typeof parent !== 'string') return null;
  const api = pathProvider(parent);
  if (!api.isAbsolute(child) || !api.isAbsolute(parent)) return null;
  if (pathProvider(child) !== api && pathProvider(child) !== path) return null;
  const relative = api.relative(api.normalize(parent), api.normalize(child));
  if (relative === '..' || relative.startsWith(`..${api.sep}`) || api.isAbsolute(relative)) return null;
  return relative.split(api.sep).join(path.sep);
}

function selectionRelative(value, kind) {
  if (typeof value !== 'string' || !value) throw new Error(`Invalid saved ${kind} selection: expected a relative file path.`);
  const parts = value.replaceAll('\\', '/').split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part))) {
    throw new Error(`Invalid saved ${kind} selection: path must remain relative to the extracted folder.`);
  }
  return parts.join(path.sep);
}

function previousWorkspaceRoot(project) {
  const fields = { il2cppDumperOutput: '02_Il2CppDumperOutput', ghidraProjectDir: '03_GhidraProject',
    reconstructedSourceDir: '05_ReconstructedSource', extractedPath: '01_Extracted' };
  for (const [key, leaf] of Object.entries(fields)) {
    const value = project[key];
    if (typeof value !== 'string') continue;
    const api = pathProvider(value);
    const normalized = api.normalize(value).replace(/[\\/]+$/, '');
    if (api.isAbsolute(normalized) && api.basename(normalized).toLowerCase() === leaf.toLowerCase()) return api.dirname(normalized);
  }
  if (typeof project.il2cppDumperOutput === 'string') {
    const api = pathProvider(project.il2cppDumperOutput);
    if (api.isAbsolute(project.il2cppDumperOutput)) return api.dirname(api.normalize(project.il2cppDumperOutput).replace(/[\\/]+$/, ''));
  }
  return null;
}

async function prepareProject(original, source, destination, name, initializeState, invalidateSteps) {
  const oldRoot = previousWorkspaceRoot(original);
  function rebase(value) {
    if (Array.isArray(value)) return value.map(rebase);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, rebase(child)]));
    const relative = relativeWithin(value, oldRoot);
    return relative === null ? value : path.join(destination, relative);
  }
  const project = initializeState(rebase(original));
  project.name = name;
  project.il2cppDumperOutput = path.join(destination, '02_Il2CppDumperOutput');
  project.ghidraProjectDir = path.join(destination, '03_GhidraProject');
  project.reconstructedSourceDir = path.join(destination, '05_ReconstructedSource');
  const mappedExtracted = typeof original.extractedPath === 'string' ? rebase(original.extractedPath) : null;
  project.extractedPath = mappedExtracted && relativeWithin(mappedExtracted, destination) !== null
    ? mappedExtracted : path.join(destination, '01_Extracted');
  project.selection = { ...project.selection };
  const unresolved = [];
  for (const [kind, field, identityKey] of [['binary', 'nativeBinary', 'native'], ['metadata', 'metadata', 'metadata']]) {
    let candidate = null;
    if (original.selection?.[kind] !== undefined) {
      candidate = path.join(project.extractedPath, selectionRelative(original.selection[kind], kind));
    } else {
      const mapped = rebase(original[field]);
      if (typeof mapped === 'string' && relativeWithin(mapped, destination) !== null) candidate = mapped;
      else {
        const relative = relativeWithin(original[field], original.extractedPath);
        if (relative) candidate = path.join(project.extractedPath, relative);
      }
    }
    const relative = candidate ? relativeWithin(candidate, destination) : null;
    const staged = relative !== null ? path.join(source, relative) : null;
    const stat = staged ? await lstat(staged) : null;
    if (!stat?.isFile()) {
      project[field] = null;
      unresolved.push(`${kind}: ${original[field] ?? '(not selected)'} (selected file is absent from the archive)`);
      if (project.identities[identityKey]) project.identities[identityKey].path = null;
      continue;
    }
    const actual = fileIdentity(staged);
    const previous = project.identities[identityKey];
    if (previous?.sha256 && previous.sha256 !== actual.sha256) invalidateSteps(project, ['scan', 'dump', 'import', 'analyze', 'symbols', 'notes', 'assetripper']);
    project.identities[identityKey] = { ...previous, ...actual, path: candidate };
    project[field] = candidate;
    project.selection[kind] = path.relative(project.extractedPath, candidate);
  }
  // Provider sessions and imported receipts never establish analysis readiness.
  invalidateSteps(project, ['import', 'analyze', 'symbols']);
  if (unresolved.length) {
    project.inputError = `Unresolved imported inputs; scan an extracted build with explicit selections. ${unresolved.join('; ')}`;
    invalidateSteps(project, ['scan', 'dump', 'import', 'analyze', 'symbols', 'notes', 'assetripper']);
  } else {
    delete project.inputError;
  }
  return project;
}

async function assertUnlinkedDirectory(directory) {
  const stat = await lstat(directory);
  if (stat?.isSymbolicLink()) throw new Error(`Refusing symbolic link or junction workspace path: ${directory}`);
  if (stat && !stat.isDirectory()) throw new Error(`Workspace path is not a directory: ${directory}`);
}

async function assertNoGhidraLocks(directory) {
  for (const name of await fs.readdir(directory)) {
    if (runtimeLock(name)) continue;
    const file = path.join(directory, name);
    const stat = await fs.lstat(file);
    if (/\.lock$|\.dbDirLock$/i.test(name)) throw new Error(`Ghidra project lock detected; save and close the owning GUI before restoring: ${file}`);
    if (stat.isDirectory()) await assertNoGhidraLocks(file);
  }
}

/** Restore a staged archive while keeping the destination lock and old data recoverable. */
export async function restoreWorkspace({ root, workspaces, archivePath, name, force = false,
  initializeState = defaultInitialize, invalidateSteps = defaultInvalidate, saveProject, log = () => {} }) {
  if (typeof saveProject !== 'function') throw new Error('restoreWorkspace requires a saveProject callback.');
  if (name !== undefined) assertName(name);
  root = await fs.realpath(path.resolve(root));
  workspaces = path.resolve(workspaces);
  if (relativeWithin(workspaces, root) === null) throw new Error('Workspaces directory must remain inside the toolkit root.');
  await assertUnlinkedDirectory(workspaces);
  await fs.mkdir(workspaces, { recursive: true });
  workspaces = await fs.realpath(workspaces);
  if (relativeWithin(workspaces, root) === null) throw new Error('Workspaces directory resolves outside the toolkit root.');
  const stage = await fs.mkdtemp(path.join(workspaces, '.archive-'));
  try {
    const source = await importWorkspaceArchive(path.resolve(archivePath), stage);
    const original = JSON.parse((await fs.readFile(path.join(source, 'project.re.json'), 'utf8')).replace(/^\uFEFF/, ''));
    name ??= original.name;
    assertName(name);
    const destination = path.join(workspaces, name);
    await assertUnlinkedDirectory(destination);
    return await withWorkspaceLock(destination, async () => {
      await assertUnlinkedDirectory(destination);
      const oldEntries = (await fs.readdir(destination)).filter(entry => entry !== '.retk-lock').sort();
      if (oldEntries.length && !force) throw new Error('Workspace directory is nonempty; use another name or --force (backup retained).');
      await assertNoGhidraLocks(destination);
      const project = await prepareProject(original, source, destination, name, initializeState, invalidateSteps);
      const incoming = (await fs.readdir(source)).filter(entry => !runtimeLock(entry)).sort();
      let backup = null;
      if (oldEntries.length) {
        const backups = path.join(root, 'backups');
        await assertUnlinkedDirectory(backups);
        await fs.mkdir(backups, { recursive: true });
        if (relativeWithin(await fs.realpath(backups), root) === null) throw new Error('Backup directory resolves outside the toolkit root.');
        backup = await fs.mkdtemp(path.join(backups, `${name}-`));
      }
      const movedOld = [];
      const movedNew = [];
      try {
        for (const entry of oldEntries) {
          await fs.rename(path.join(destination, entry), path.join(backup, entry));
          movedOld.push(entry);
        }
        for (const entry of incoming) {
          await fs.rename(path.join(source, entry), path.join(destination, entry));
          movedNew.push(entry);
        }
        // The imported manifest remains byte-exact until this callback. Legacy
        // migrations can therefore back up its BOM and all original fields.
        await saveProject(name, project);
      } catch (error) {
        const rollbackErrors = [];
        for (const entry of movedNew.reverse()) {
          try { await fs.rm(path.join(destination, entry), { recursive: true, force: true }); }
          catch (rollbackError) { rollbackErrors.push(rollbackError); }
        }
        for (const entry of movedOld.reverse()) {
          try { await fs.rename(path.join(backup, entry), path.join(destination, entry)); }
          catch (rollbackError) { rollbackErrors.push(rollbackError); }
        }
        if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], `Workspace restore failed: ${error.message}. Rollback needs inspection; preserved backup: ${backup}`, { cause: error });
        throw error;
      }
      if (backup) log(`Previous workspace retained: ${backup}`);
      if (project.inputError) log(project.inputError);
      return project;
    });
  } finally {
    // Only this freshly allocated, direct child is eligible for cleanup.
    if (path.dirname(stage) !== workspaces || !path.basename(stage).startsWith('.archive-')) throw new Error('Refusing unsafe archive staging cleanup.');
    await assertUnlinkedDirectory(stage);
    await fs.rm(stage, { recursive: true, force: true });
  }
}
