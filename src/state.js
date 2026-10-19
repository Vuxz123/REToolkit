import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const legacySteps = { scanned: 'scan', dumped: 'dump', imported: 'import', analyzed: 'analyze',
  symbolsApplied: 'symbols', assetRipperExported: 'assetripper' };
const stepNames = ['extract', 'scan', 'dump', 'import', 'analyze', 'symbols', 'assetripper', 'notes'];
const states = new Set(['pending', 'running', 'succeeded', 'failed', 'awaiting-user', 'stale', 'unknown']);
const startToken = `${process.pid}:${performance.timeOrigin}`;
const lockContext = new AsyncLocalStorage();

export function initializeState(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) throw Error('Project must be an object.');
  if (project.schemaVersion !== undefined && (!Number.isInteger(project.schemaVersion) || project.schemaVersion > 2)) {
    throw Error(`Unsupported project schema ${project.schemaVersion}; this version supports schema 2.`);
  }
  project.identities ??= {};
  project.steps ??= {};
  project.status ??= {};
  for (const name of stepNames) {
    if (project.steps[name] !== undefined) continue;
    const legacySuccess = Object.entries(legacySteps).some(([flag, step]) => step === name && project.status[flag]);
    project.steps[name] = {
      state: legacySuccess || (name === 'analyze' && project.status.analyzing) ? 'unknown' : 'pending',
      fingerprint: null, outputs: [], runId: null, startedAt: null, completedAt: null, error: '', owner: null,
    };
  }
  project.schemaVersion = 2;
  syncLegacyStatus(project);
  return project;
}

export function syncLegacyStatus(project) {
  project.status ??= {};
  for (const [flag, name] of Object.entries(legacySteps)) project.status[flag] = project.steps?.[name]?.state === 'succeeded';
  const analysis = project.steps?.analyze;
  project.status.analyzing = analysis?.state === 'running';
  project.status.analyzeStartedAt = analysis?.startedAt ?? null;
  project.status.analyzeCompletedAt = analysis?.completedAt ?? null;
  project.status.assetRipperExportedAt = project.status.assetRipperExported ? project.steps.assetripper.completedAt ?? null : null;
  return project;
}

export function fileIdentity(filePath) {
  const fullPath = path.resolve(filePath);
  const stat = fs.lstatSync(fullPath);
  if (!stat.isFile()) throw Error(`Expected a regular file: ${fullPath}`);
  const hash = createHash('sha256');
  const descriptor = fs.openSync(fullPath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let count;
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
  } finally { fs.closeSync(descriptor); }
  return { path: fullPath, size: stat.size, sha256: hash.digest('hex') };
}

function canonical(value) {
  if (typeof value?.toJSON === 'function') return canonical(value.toJSON());
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function outputManifest(paths) {
  return paths.map(input => {
    const rootPath = path.resolve(input);
    const stat = fs.lstatSync(rootPath);
    const files = [];
    const directories = [];
    const recordFile = (file, relative) => {
      const identity = fileIdentity(file);
      files.push({ path: relative, size: identity.size, sha256: identity.sha256 });
    };
    if (stat.isDirectory()) {
      const walk = (directory, prefix = '') => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
          const relative = prefix + entry.name;
          const absolute = path.join(directory, entry.name);
          if (entry.isDirectory()) { directories.push(relative); walk(absolute, relative + '/'); }
          else recordFile(absolute, relative);
        }
      };
      walk(rootPath);
      return { path: rootPath, type: 'directory', files, directories };
    }
    recordFile(rootPath, path.basename(rootPath));
    return { path: rootPath, type: 'file', files, directories };
  });
}

export function validManifest(manifest) {
  if (!Array.isArray(manifest) || manifest.length === 0) return false;
  try {
    return manifest.every(root => {
      if (!root || !['file', 'directory'].includes(root.type) || !path.isAbsolute(root.path) || !Array.isArray(root.files) || !Array.isArray(root.directories)) return false;
      const actual = outputManifest([root.path])[0];
      return actual.type === root.type && fingerprint(actual.files) === fingerprint(root.files) && fingerprint(actual.directories) === fingerprint(root.directories);
    });
  } catch { return false; }
}

export function setStep(project, name, state, fp, outputs = [], error = '') {
  if (!states.has(state)) throw Error(`Invalid step state: ${state}`);
  if (!Array.isArray(outputs)) throw Error('Step outputs must be an output manifest array.');
  initializeState(project);
  const step = project.steps[name] ??= {};
  const wasRunning = step.state === 'running';
  if (state === 'running' || !wasRunning || !step.runId) step.runId = randomUUID();
  if (state === 'running') {
    step.startedAt = new Date().toISOString();
    step.owner = { pid: process.pid, startToken };
  } else if (!wasRunning) {
    step.startedAt = null;
    step.owner = null;
  }
  Object.assign(step, { state, fingerprint: fp, outputs, error,
    completedAt: ['succeeded', 'failed', 'awaiting-user'].includes(state) ? new Date().toISOString() : null });
  syncLegacyStatus(project);
  return step;
}

export function reusable(project, name, fp) {
  const step = project.steps?.[name];
  return Boolean(step?.state === 'succeeded' && typeof fp === 'string' && fp.length > 0 && step.fingerprint === fp &&
    Array.isArray(step.outputs) && step.outputs.some(root => Array.isArray(root?.files) && root.files.length > 0) && validManifest(step.outputs));
}

export function invalidateSteps(project, names) {
  initializeState(project);
  for (const name of names) if (project.steps[name]) {
    project.steps[name].state = 'stale';
    if(name==='symbols')delete project.steps[name].bridgeRevision;
  }
  syncLegacyStatus(project);
  return project;
}

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true; // Ambiguous ownership must not be reclaimed.
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

function ownerAlive(owner) {
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
  if (owner.pid === process.pid) return owner.startToken === startToken;
  // Node cannot inspect another process's startup token portably. A live PID is conservative evidence.
  return pidAlive(owner.pid);
}

export function recoverSteps(project, { isOwnerAlive = ownerAlive } = {}) {
  initializeState(project);
  for (const step of Object.values(project.steps)) {
    if (step?.state !== 'running') continue;
    const alive = isOwnerAlive(step.owner);
    if (typeof alive !== 'boolean') throw Error('isOwnerAlive must return a boolean synchronously.');
    if (alive) continue;
    step.state = 'failed';
    step.completedAt = new Date().toISOString();
    step.error = 'Interrupted run: its owner exited or its process identity changed. Artifacts were preserved; external child processes may still be running.';
  }
  syncLegacyStatus(project);
  return project;
}

function readLock(lockPath) {
  const entries = fs.readdirSync(lockPath);
  if (entries.length !== 1) return null;
  const match = /^(owner|reclaim)-(\d+)-([a-f0-9-]+)\.json$/.exec(entries[0]);
  if (!match) return null;
  const pid = Number(match[2]);
  if (match[1] === 'owner') {
    const owner = JSON.parse(fs.readFileSync(path.join(lockPath, entries[0]), 'utf8'));
    if (owner.pid !== pid || owner.token !== match[3]) return null;
  }
  return { file: entries[0], pid };
}

function reclaimDeadLock(lockPath) {
  try {
    const owner = readLock(lockPath);
    if (!owner || pidAlive(owner.pid)) return false;
    const claimToken = randomUUID();
    // Rename the exact observed owner marker: only one contender can win, and a
    // delayed contender cannot rename a new live owner's different marker.
    fs.renameSync(path.join(lockPath, owner.file), path.join(lockPath, `reclaim-${process.pid}-${claimToken}.json`));
    const abandonedPath = `${lockPath}.abandoned-${claimToken}`;
    fs.renameSync(lockPath, abandonedPath);
    fs.rmSync(abandonedPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (['ENOENT', 'EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code) || error instanceof SyntaxError) return false;
    throw error;
  }
}

export function ownsWorkspaceLock(workspace) {
  if(!fs.existsSync(workspace))return false;
  const actual=fs.realpathSync(workspace);
  const key=process.platform==='win32'?actual.toLowerCase():actual;
  return Boolean(lockContext.getStore()?.get(key)?.active);
}

export async function withWorkspaceLock(workspace, action, { timeoutMs = 0 } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw Error('Lock timeoutMs must be a nonnegative number.');
  fs.mkdirSync(workspace, { recursive: true });
  const actualPath = fs.realpathSync(workspace);
  const key = process.platform === 'win32' ? actualPath.toLowerCase() : actualPath;
  const inherited = lockContext.getStore();
  if (inherited?.get(key)?.active) return await action();
  const lockPath = path.join(actualPath, '.retk-lock');
  const token = randomUUID();
  const ownerFile = `owner-${process.pid}-${token}.json`;
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      try {
        fs.writeFileSync(path.join(lockPath, ownerFile), JSON.stringify({ pid: process.pid, startToken, token }), { flag: 'wx' });
      } catch (error) { fs.rmSync(lockPath, { recursive: true, force: true }); throw error; }
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (reclaimDeadLock(lockPath)) continue;
      if (performance.now() >= deadline) throw Error(`Workspace is busy: another process holds its lock (${lockPath}). Missing or ambiguous ownership requires inspection.`);
      await sleep(Math.min(25, Math.max(1, deadline - performance.now())));
    }
  }
  const lease = { active: true };
  const context = new Map(inherited ?? []);
  context.set(key, lease);
  try { return await lockContext.run(context, action); }
  finally {
    lease.active = false;
    // Never remove a lock whose token no longer matches this acquisition.
    const marker = path.join(lockPath, ownerFile);
    try {
      const owner = JSON.parse(fs.readFileSync(marker, 'utf8'));
      const entries = fs.readdirSync(lockPath);
      if (owner.token === token && entries.length === 1 && entries[0] === ownerFile) {
        const releasedPath = `${lockPath}.released-${token}`;
        fs.renameSync(lockPath, releasedPath);
        fs.rmSync(releasedPath, { recursive: true, force: true });
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
