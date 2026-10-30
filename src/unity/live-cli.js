import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {withoutJevCredentials} from '../jev-environment.js';

const toolkitRoot = fileURLToPath(new URL('../../', import.meta.url));
const limit = 4 * 1024 * 1024;
const fail = (code, message, metadata = {}) => Object.assign(new Error(message), {code, ...metadata});
const recovery = () => fail('unity_recovery_required', 'Unity CLI completion is uncertain; inspect the resident Editor before recovery.', {preserveToolchainGate: true});
const inside = (root, file) => { const relative = path.relative(root, file); return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };
const envValue = (env, key) => Object.entries(env).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];

function resolveExecutable(executable, cwd, env) {
  const roots = [toolkitRoot, cwd].filter(Boolean).map(root => { try { return fs.realpathSync(root); } catch { return path.resolve(root); } });
  const local = envValue(env, 'LOCALAPPDATA');
  const candidates = executable !== undefined ? [executable] : [
    ...(local && path.isAbsolute(local) ? [path.join(local, 'Unity', 'bin', 'unity.exe')] : []),
    ...(envValue(env, 'PATH') ?? '').split(path.delimiter).filter(entry => entry && path.isAbsolute(entry)).map(entry => path.join(entry, 'unity.exe')),
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || /[\0\r\n]/.test(candidate) || !/^unity\.exe$/i.test(path.basename(candidate))) continue;
    try {
      const real = fs.realpathSync(candidate);
      if (roots.some(root => inside(root, real) || inside(root, path.resolve(candidate))) || !fs.statSync(real).isFile() || !/^unity\.exe$/i.test(path.basename(real))) continue;
      return real;
    } catch { /* A missing PATH entry is not an executable. */ }
  }
  throw fail('unity_cli_unavailable', 'An installed Unity CLI executable outside the workspace is required.');
}

// No raw process diagnostics cross this boundary. Successful envelopes retain
// their data shape, with credential fields and known environment secrets removed.
function scrub(value, secrets, depth = 0) {
  if (depth > 64) throw fail('unity_cli_invalid_response', 'Unity CLI returned an invalid response.');
  if (typeof value === 'string') {
    for (const secret of secrets) value = value.split(secret).join('[REDACTED]');
    return value;
  }
  if (Array.isArray(value)) return value.map(item => scrub(item, secrets, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [scrub(key, secrets, depth + 1), /token|secret|password|credential|api.?key|authorization/i.test(key) ? '[REDACTED]' : scrub(item, secrets, depth + 1)]));
  return value;
}

export async function runUnityCli(args, {cwd, timeoutSeconds = 600, env = process.env, spawnImpl = spawn, executable} = {}) {
  if (!Array.isArray(args) || !args.length || args.some(arg => typeof arg !== 'string' || arg.includes('\0')) || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 86400 || (cwd !== undefined && (typeof cwd !== 'string' || !path.isAbsolute(cwd) || /[\0\r\n]/.test(cwd)))) throw fail('invalid_argument', 'Invalid Unity CLI arguments or timeout.');
  const file = resolveExecutable(executable, cwd, env);
  const secrets = Object.entries(env).filter(([key, value]) => /token|secret|password|credential|api.?key|authorization|^(JEV|TYPESAFE)_/i.test(key) && typeof value === 'string' && value.length).map(([, value]) => value).sort((a, b) => b.length - a.length);
  const childEnv = {...withoutJevCredentials(env), UNITY_FORMAT: 'json', UNITY_NON_INTERACTIVE: '1', UNITY_NO_PAGER: '1', UNITY_NO_BANNER: '1', UNITY_NO_CONSENT_PROMPT: '1'};
  return await new Promise((resolve, reject) => {
    let child, timer, cleanupTimer, settled = false, stopping = false, spawnFailed = false, stdout = [], stdoutBytes = 0, stderrBytes = 0;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(cleanupTimer); stdout = []; error ? reject(error) : resolve(result); };
    const stop = () => {
      if (stopping || settled) return;
      stopping = true;
      cleanupTimer = setTimeout(() => {
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref?.(); finish(recovery());
      }, 2000);
      try { child.kill('SIGKILL'); } catch { /* Closure must still be observed. */ }
    };
    try { child = spawnImpl(file, ['--format', 'json', '--non-interactive', '--no-pager', ...args], {cwd, env: childEnv, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']}); }
    catch { finish(fail('unity_cli_start_failed', 'Unity CLI could not start.')); return; }
    child.stdout.on('data', chunk => { if (settled || stopping) return; const bytes = Buffer.from(chunk); stdoutBytes += bytes.length; if (stdoutBytes > limit) stop(); else stdout.push(bytes); });
    child.stderr.on('data', chunk => { if (settled || stopping) return; stderrBytes += Buffer.byteLength(chunk); if (stderrBytes > limit) stop(); });
    child.stdout.on('error', stop); child.stderr.on('error', stop);
    child.on('error', () => { spawnFailed = true; });
    child.once('close', (exitCode, signal) => {
      if (stopping || signal) { finish(recovery()); return; }
      if (spawnFailed) { finish(fail('unity_cli_start_failed', 'Unity CLI could not start.')); return; }
      let envelope;
      try { envelope = JSON.parse(Buffer.concat(stdout).toString('utf8').replace(/^\uFEFF/, '')); } catch { /* Report only bounded, known metadata below. */ }
      if (exitCode !== 0 || envelope?.success === false) {
        const rawCode = envelope?.errors?.[0]?.code;
        // The CLI can itself time out while a Pipeline job continues running.
        if (typeof rawCode === 'string' && /TIME[ _]?OUT|TIMED_OUT|CONNECTION_(LOST|CLOSED)/i.test(rawCode)) { finish(recovery()); return; }
        const cliCode = typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.test(rawCode) && !secrets.some(secret => rawCode.includes(secret)) ? rawCode : undefined;
        finish(fail('unity_cli_failed', 'Unity CLI reported a failure.', {exitCode: Number.isInteger(exitCode) ? exitCode : null, ...(cliCode ? {cliCode} : {})})); return;
      }
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.success !== true) { finish(fail('unity_cli_invalid_response', 'Unity CLI returned an invalid response.')); return; }
      try { finish(null, scrub(envelope, secrets)); } catch { finish(fail('unity_cli_invalid_response', 'Unity CLI returned an invalid response.')); }
    });
    timer = setTimeout(stop, timeoutSeconds * 1000);
  });
}
