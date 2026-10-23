import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runProcess } from '../process.js';
import { validatePackageName, validateSerial } from './client.js';

const MAX_OUTPUT = 1024 * 1024;
const MAX_FILES = 1024;
const MAX_FILE = 8 * 1024 ** 3;
const MAX_TOTAL = 32 * 1024 ** 3;
const CHUNK = 393216; // 512 KiB of base64, safely below the text runner's cap.
const segment = /^[A-Za-z0-9_~+=.@-]+$/;
const error = (code, message) => Object.assign(new Error(message), { code });
const invalid = () => error('ADB_DATA_METADATA_INVALID', 'App-data metadata is malformed, unsafe, or truncated.');
const limit = () => error('ADB_DATA_LIMIT', 'App-data exceeds the supported file, count, or aggregate limit.');
const changed = () => error('ADB_DATA_CHANGED', 'App-data changed during capture or failed its integrity check.');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

function relativePath(value) {
  if (typeof value !== 'string' || !value.length || value.length > 4096 || value.split('/').some(part => !segment.test(part) || part === '.' || part === '..')) throw invalid();
  return value;
}
function absolutePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) throw invalid();
  relativePath(value.slice(1));
  return value;
}
function bounded(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) >= MAX_OUTPUT || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffd]/.test(value) || /\r(?!\n)/.test(value)) throw invalid();
  return value.replaceAll('\r\n', '\n');
}
function frame(value, header) {
  const lines = bounded(value).split('\n');
  if (lines.shift() !== header || lines.pop() !== '' || lines.pop() !== 'END') throw invalid();
  return lines;
}
function parseStat(fields) {
  if (fields.length !== 5 || !/^[0-9a-fA-F]{4,8}$/.test(fields[0]) || fields.slice(1).some(field => !/^(?:0|[1-9][0-9]*)$/.test(field))) throw invalid();
  const [mode, size, time, inode, device] = fields.map((value, index) => Number.parseInt(value, index === 0 ? 16 : 10));
  if (![mode, size, time, inode, device].every(Number.isSafeInteger)) throw invalid();
  if (size > MAX_FILE) throw limit();
  return { mode, size, time, inode, device };
}
function type(stat) { return stat.mode & 0xf000; }
function sameStat(a, b) { return ['mode', 'size', 'time', 'inode', 'device'].every(key => a[key] === b[key]); }
function parseListing(value) {
  const lines = frame(value, 'RETK_DATA_V1');
  const rootLine = lines.shift()?.split('|');
  if (rootLine?.length !== 2 || rootLine[0] !== 'ROOT') throw invalid();
  const canonical = absolutePath(rootLine[1]);
  const rootStat = lines.shift()?.split('|');
  if (rootStat?.shift() !== 'R' || type(parseStat(rootStat)) !== 0x4000) throw invalid();
  if (lines.length > MAX_FILES) throw limit();
  const files = [], stats = new Map(), identities = new Set();
  let total = 0;
  for (const line of lines) {
    const fields = line.split('|');
    if (fields.shift() !== 'E' || fields.length !== 7) throw invalid();
    const stat = parseStat(fields.slice(0, 5)), [remote, resolved] = fields.slice(5);
    absolutePath(remote); absolutePath(resolved);
    if (!remote.startsWith(`${canonical}/`) || remote !== resolved) throw invalid();
    const relative = relativePath(remote.slice(canonical.length + 1));
    // Windows destinations cannot safely represent case aliases, reserved names,
    // trailing dots, or names normalized to a different path by Win32.
    if (relative.split('/').some(part => /[.]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw invalid();
    const identity = relative.toLowerCase();
    if (identities.has(identity)) throw invalid();
    identities.add(identity);
    if (type(stat) === 0x4000) continue;
    if (type(stat) !== 0x8000) throw invalid(); // Never follow internal links or special files.
    files.push({ relative, size: stat.size }); stats.set(relative, stat); total += stat.size;
    if (total > MAX_TOTAL) throw limit();
  }
  return { canonical, files, stats, total };
}

// Each ADB shell command is ONE quoted remote command. adb joins arguments before
// invoking Android's shell; passing unquoted `sh -c` arguments is not equivalent.
function command(access, packageName, script) {
  if (access === 'shell') return `sh -c ${quote(script)}`;
  if (access === 'run-as') return `run-as ${packageName} sh -c ${quote(script)}`;
  return `timeout 10 su -c ${quote(`sh -c ${quote(script)}`)}`;
}
function rootPrelude(root) {
  return `root=${quote(root)}; s=$(stat -L -c '%f|%s|%Y|%i|%d' "$root") || exit $?; test ! -L "$root" || { printf 'RETK_UNSAFE\\n'; exit 1; }; r=$(readlink -f "$root") || exit $?; `;
}
function listingScript(root) {
  const entry = 'for p do s=$(stat -c "%f|%s|%Y|%i|%d" "$p") || { printf "RETK_READ_FAILED\\n"; exit 1; }; c=$(readlink -f "$p") || { printf "RETK_READ_FAILED\\n"; exit 1; }; printf "E|%s|%s|%s\\n" "$s" "$p" "$c"; done';
  // The completion marker must travel through the bound too. Otherwise a cut at
  // an exact line boundary could masquerade as a complete smaller directory.
  return rootPrelude(root) + `printf 'RETK_DATA_V1\\nROOT|%s\\nR|%s\\n' "$r" "$s"; { find "$r" -mindepth 1 -exec sh -c ${quote(entry)} sh {} + && printf 'END\\n'; } | head -c 900000 | head -n 1025`;
}
function checkedFilePrelude(scope, relative) {
  const remote = `${scope.root}/${relative}`;
  // Validate every descendant before reading; aliases above the root are allowed.
  const ancestors = relative.split('/').map((_, index, parts) => `${scope.root}/${parts.slice(0, index + 1).join('/')}`);
  return rootPrelude(scope.root) + `test "$r" = ${quote(scope.canonical)} || { printf 'RETK_CHANGED\\n'; exit 1; }; ` +
    ancestors.map(part => `test ! -L ${quote(part)} || { printf 'RETK_UNSAFE\\n'; exit 1; }; `).join('') +
    `p=${quote(remote)}; c=$(readlink -f "$p") || exit $?; test "$c" = ${quote(`${scope.canonical}/${relative}`)} || { printf 'RETK_CHANGED\\n'; exit 1; }; test -f "$p" || { printf 'RETK_UNSAFE\\n'; exit 1; }; `;
}
function fileScript(scope, relative) {
  return checkedFilePrelude(scope, relative) + `s=$(stat -c '%f|%s|%Y|%i|%d' "$p") || exit $?; h=$(sha256sum "$p") || exit $?; h=\${h%% *}; printf 'RETK_FILE_V1\\nROOT|%s\\nS|%s\\nH|%s\\nEND\\n' "$r" "$s" "$h"`;
}
function chunkScript(scope, relative, index) {
  return checkedFilePrelude(scope, relative) + `printf 'RETK_CHUNK_V1\\n'; dd if="$p" bs=${CHUNK} skip=${index} count=1 2>/dev/null | base64; printf '\\nEND\\n'`;
}
function parseFile(value, scope) {
  const lines = frame(value, 'RETK_FILE_V1');
  if (lines.length !== 3 || lines[0] !== `ROOT|${scope.canonical}`) throw changed();
  const fields = lines[1].split('|');
  if (fields.shift() !== 'S') throw invalid();
  const stat = parseStat(fields);
  if (type(stat) !== 0x8000 || !/^H\|[a-f0-9]{64}$/.test(lines[2])) throw invalid();
  return { stat, hash: lines[2].slice(2) };
}
function parseChunk(value, expected) {
  const lines = frame(value, 'RETK_CHUNK_V1');
  const encoded = lines.join('');
  if (lines.some(line => !/^[A-Za-z0-9+/=]*$/.test(line)) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw invalid();
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== expected || bytes.length > CHUNK || bytes.toString('base64') !== encoded) throw invalid();
  return bytes;
}

function failureKind(source, root, access) {
  if (source?.signal || source?.code === 'ERR_PROCESS_CANCELLED') return null;
  let out, diagnostic;
  try {
    out = bounded(source?.stdout ?? '');
    diagnostic = bounded(source?.stderr || source?.stdout || source?.message || '');
  } catch { return null; }
  const roots = [root];
  const partialRoot = /^ROOT\|([^\n]+)$/m.exec(out)?.[1];
  if (partialRoot) { try { roots.push(absolutePath(partialRoot)); } catch { return null; } }
  const entries = diagnostic.split('\n').filter(Boolean).filter(line => !/^(?:adb|[^\r\n]+\.exe) failed \([1-9][0-9]*\)(?:; log: .+)?$/i.test(line));
  if (entries.length === 0) return null;
  let result;
  for (const line of entries) {
    const packageName = root.split('/').at(-1);
    if (access === 'run-as' && [
      `run-as: package not debuggable: ${packageName}`,
      `run-as: Package '${packageName}' is not debuggable`,
      'run-as: run-as is disabled from the kernel commandline',
      'run-as: Permission denied',
    ].includes(line)) { result = 'denied'; continue; }
    if (access === 'su' && /^(?:su: |Error: )?(?:Permission denied|permission denied|access denied)$/.test(line)) { result = 'denied'; continue; }
    const match = /^(?:stat|find|readlink): (?:cannot (?:stat|access) )?['"]?([^'"\n]+?)['"]?: (No such file or directory|Permission denied)$/.exec(line);
    if (!match) return null;
    try { absolutePath(match[1]); } catch { return null; }
    if (!roots.some(allowed => match[1] === allowed || match[1].startsWith(`${allowed}/`))) return null;
    const state = match[2] === 'Permission denied' ? 'denied' : 'absent';
    // Only the root's absence proves this scope absent. A disappearing child is a race.
    if (state === 'absent' && match[1] !== root) return null;
    if (result && result !== state) return null;
    result = state;
  }
  return result;
}
async function localHash(file) {
  const hash = createHash('sha256');
  for await (const bytes of fs.createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

export function createAdbDataClient({ file, run = runProcess, runOptions = {} }) {
  if (typeof file !== 'string' || !/\.exe$/i.test(file) || /[\x00-\x1f\x7f]/.test(file)) throw error('ADB_EXECUTABLE_INVALID', 'ADB requires a .exe executable path.');
  if (typeof run !== 'function') throw error('ADB_RUNNER_INVALID', 'ADB process runner must be a function.');
  if (runOptions.logFile || runOptions.inherit || runOptions.forwardOutput) throw error('ADB_DATA_LOGGING_UNSAFE', 'App-data transport requires process output logging and forwarding disabled.');
  const inspected = new Map();
  const key = (serial, packageName) => `${serial}\n${packageName}`;
  async function invoke(serial, args, failureContext) {
    if (runOptions.logFile || runOptions.inherit || runOptions.forwardOutput) throw error('ADB_DATA_LOGGING_UNSAFE', 'App-data transport requires process output logging and forwarding disabled.');
    let result;
    try {
      result = await run(file, ['-s', serial, ...args], runOptions);
      if (!result || result.exitCode !== 0) throw result ?? new Error('Missing process result');
    } catch (cause) {
      if(cause?.code==='cleanup_pending')throw error('cleanup_pending','Owned ADB process cleanup is unverified; retain staging and inspect leases before retrying.');
      const state = failureContext && failureKind(cause, failureContext.root, failureContext.access);
      if (state) return { state };
      // Do not put private file contents, base64 chunks, or runner diagnostics in errors.
      throw error('ADB_DATA_PROCESS_FAILED', 'ADB app-data read failed or was cancelled.');
    }
    const stdout = bounded(result.stdout ?? ''), stderr = bounded(result.stderr ?? '');
    if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) >= MAX_OUTPUT) throw invalid();
    if (failureContext && stderr) {
      const state = failureKind(result, failureContext.root, failureContext.access);
      if (state) return { state };
    }
    if (stderr && args[0] !== 'pull') throw invalid();
    return { stdout };
  }
  async function shell(serial, access, packageName, script, context) {
    return invoke(serial, ['shell', command(access, packageName, script)], context);
  }
  const client = {
    async inspect(serial, packageName) {
      validateSerial(serial); validatePackageName(packageName);
      inspected.delete(key(serial, packageName));
      let suReady;
      async function canSu() {
        if (suReady !== undefined) return suReady;
        const script = `if command -v su >/dev/null 2>&1; then if command -v timeout >/dev/null 2>&1; then timeout 1 sh -c ${quote("printf 'RETK_TIMEOUT_OK\\n'")}; else printf 'RETK_TIMEOUT_MISSING\\n'; fi; else printf 'RETK_SU_MISSING\\n'; fi`;
        const output = (await shell(serial, 'shell', packageName, script)).stdout;
        if (output === 'RETK_TIMEOUT_OK\n') suReady = true;
        else if (output === 'RETK_SU_MISSING\n' || output === 'RETK_TIMEOUT_MISSING\n') suReady = false;
        else throw invalid();
        return suReady;
      }
      async function scope(id, root) {
        for (const access of ['shell', 'run-as', 'su']) {
          if (access === 'su' && !(await canSu())) break;
          const result = await shell(serial, access, packageName, listingScript(root), { root, access });
          if (result.state === 'absent') return { id, root, access: 'none', state: 'absent', files: [] };
          if (result.state === 'denied') continue;
          const parsed = parseListing(result.stdout);
          return { id, root, access, state: 'available', ...parsed };
        }
        return { id, root, access: 'none', state: 'denied', files: [] };
      }
      const external = await scope('external', `/sdcard/Android/data/${packageName}`);
      let privateScope = await scope('private', `/data/user/0/${packageName}`);
      if (privateScope.state === 'absent') privateScope = await scope('private', `/data/data/${packageName}`);
      const scopes = [external, privateScope];
      if (scopes.reduce((total, scope) => total + (scope.total ?? 0), 0) > MAX_TOTAL || scopes.reduce((total, scope) => total + scope.files.length, 0) > MAX_FILES) throw limit();
      inspected.set(key(serial, packageName), scopes);
      return { scopes: scopes.map(({ id, root, access, state, files }) => ({ id, root, access, state, files: files.map(file => ({ ...file })) })) };
    },
    async pull(serial, packageName, scopeValue, fileValue, local) {
      validateSerial(serial); validatePackageName(packageName);
      const id = typeof scopeValue === 'string' ? scopeValue : scopeValue?.id;
      const scope = inspected.get(key(serial, packageName))?.find(scope => scope.id === id);
      const relative = relativePath(typeof fileValue === 'string' ? fileValue : fileValue?.relative);
      const expected = scope?.stats?.get(relative);
      if (!scope || scope.state !== 'available' || !expected) throw error('ADB_DATA_NOT_INSPECTED', 'App-data file requires a matching successful inspection.');
      if (typeof local !== 'string' || !local.length || /[\x00-\x1f\x7f]/.test(local)) throw error('ADB_LOCAL_INVALID', 'Invalid local file path.');
      if (fs.existsSync(local)) throw error('ADB_LOCAL_EXISTS', 'App-data destination already exists.');
      const before = parseFile((await shell(serial, scope.access, packageName, fileScript(scope, relative))).stdout, scope);
      if (!sameStat(before.stat, expected)) throw changed();
      const directory = path.dirname(path.resolve(local));
      fs.mkdirSync(directory, { recursive: true });
      const stage = fs.mkdtempSync(path.join(directory, '.retk-data-'));
      const partial = path.join(stage, 'part');
      let cleanupPending=false;
      try {
        if (scope.access === 'shell') {
          await invoke(serial, ['pull', `${scope.canonical}/${relative}`, partial]);
        } else {
          const fd = fs.openSync(partial, 'wx', 0o600);
          try {
            for (let offset = 0, index = 0; offset < expected.size; offset += CHUNK, index++) {
              const output = (await shell(serial, scope.access, packageName, chunkScript(scope, relative, index))).stdout;
              const bytes = parseChunk(output, Math.min(CHUNK, expected.size - offset));
              let written = 0;
              while (written < bytes.length) written += fs.writeSync(fd, bytes, written, bytes.length - written);
            }
          } finally { fs.closeSync(fd); }
        }
        const after = parseFile((await shell(serial, scope.access, packageName, fileScript(scope, relative))).stdout, scope);
        const localStat = fs.lstatSync(partial);
        if (!localStat.isFile() || localStat.isSymbolicLink() || localStat.size !== expected.size || !sameStat(before.stat, after.stat) || before.hash !== after.hash || await localHash(partial) !== before.hash) throw changed();
        // Hard-link creation publishes the verified bytes without overwriting an existing destination.
        fs.linkSync(partial, path.resolve(local));
        return { size: expected.size, sha256: before.hash };
      } catch(cause){cleanupPending=cause?.code==='cleanup_pending';throw cause;}
      finally { if(!cleanupPending)fs.rmSync(stage, { recursive: true, force: true }); }
    },
  };
  return client;
}
