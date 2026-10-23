import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const marker = 'REToolkit quickstart managed shim v1';
const pathScript = fileURLToPath(new URL('../../scripts/register-cli-path.ps1', import.meta.url));

function safeEmbeddedPath(value) {
  if (typeof value !== 'string' || !value || /[%!^&|<>"\r\n\0]/.test(value)) {
    throw new Error('Unsafe CMD characters in quickstart command path; use a checkout and Node path without CMD expansion characters.');
  }
  return path.resolve(value);
}

/** Pure: constructing the plan never inspects or writes the filesystem. */
export function planQuickstartCommand(root, { node = process.execPath } = {}) {
  root = safeEmbeddedPath(root);
  node = safeEmbeddedPath(node);
  const bin = path.join(root, '.cache', 'quickstart', 'bin');
  return { root, node, entry: path.join(root, 're.js'), bin, shim: path.join(bin, 'retk.cmd') };
}

function shimText(plan) {
  return `@echo off\r\n@rem ${marker}\r\n@setlocal DisableDelayedExpansion\r\n@for /f "tokens=2 delims=:" %%a in ('"%SystemRoot%\\System32\\chcp.com"') do @set "_retk_cp=%%a"\r\n@"%SystemRoot%\\System32\\chcp.com" 65001 >nul\r\n"${plan.node}" "${plan.entry}" %*\r\n@set "_retk_exit=%errorlevel%"\r\n@"%SystemRoot%\\System32\\chcp.com" %_retk_cp% >nul\r\n@exit /b %_retk_exit%\r\n`;
}

async function statOrNull(target) {
  try { return await fs.lstat(target); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function safeDirectories(plan) {
  const rootStat = await fs.lstat(plan.root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Checkout root must be an ordinary directory.');
  const realRoot = await fs.realpath(plan.root);
  let current = plan.root;
  for (const segment of ['.cache', 'quickstart', 'bin']) {
    current = path.join(current, segment);
    try { await fs.mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await fs.lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Managed shim directory is a link or non-directory.');
    const relative = path.relative(realRoot, await fs.realpath(current));
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error('Managed shim directory escapes the checkout.');
    }
  }
}

async function matchingShim(plan, content) {
  const info = await statOrNull(plan.shim);
  if (!info) return false;
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 32768 || await fs.readFile(plan.shim, 'utf8') !== content) {
    throw new Error('Existing retk.cmd is foreign or differs from the selected runtime; inspect it before retrying.');
  }
  return true;
}

async function ensureShim(plan) {
  await safeDirectories(plan);
  const content = shimText(plan);
  if (await matchingShim(plan, content)) return;
  const temporary = path.join(plan.bin, `.retk-${randomUUID()}.tmp`);
  let created = false;
  try {
    await fs.writeFile(temporary, content, { flag: 'wx' });
    created = true;
    await safeDirectories(plan);
    try { await fs.link(temporary, plan.shim); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await matchingShim(plan, content);
    }
  } finally {
    // This unpredictable name was created exclusively by this invocation.
    if (created) await fs.unlink(temporary);
  }
}

function envValue(env, key) {
  return env[Object.keys(env).find((name) => name.toLowerCase() === key.toLowerCase())] || '';
}

function canonical(value, env) {
  const expanded = value.replace(/%([^%]+)%/g, (whole, key) => envValue(env, key) || whole);
  return path.resolve(expanded.trim().replace(/^"|"$/g, '')).replace(/[\\/]+$/, '').toLowerCase();
}

async function earlierCommand(plan, env, platform) {
  const extensions = platform === 'win32'
    ? [...new Set(['.ps1', ...(envValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter((item) => /^\.[a-z0-9]+$/i.test(item)).map((item) => item.toLowerCase()), '.cmd'])]
    : [''];
  const directories = envValue(env, 'PATH').split(platform === 'win32' ? ';' : path.delimiter);
  for (const raw of directories) {
    if (!raw.trim()) continue;
    if (canonical(raw, env) === canonical(plan.bin, env)) break;
    const directory = raw.replace(/%([^%]+)%/g, (whole, key) => envValue(env, key) || whole).replace(/^"|"$/g, '');
    for (const extension of extensions) {
      const command = path.resolve(directory, `retk${extension}`);
      try { if ((await fs.stat(command)).isFile()) return command; } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      }
    }
  }
  return undefined;
}

/** Only the explicit PowerShell helper may mutate the user's persisted PATH. */
export async function registerQuickstartCommand(root, {
  node = process.execPath, noPath = false, env = process.env, spawn = spawnSync, platform = process.platform,
} = {}) {
  const plan = planQuickstartCommand(root, { node });
  const result = { state: 'ready', shim: plan.shim, bin: plan.bin, pathState: 'skipped' };
  try { await ensureShim(plan); } catch (error) {
    return { ...result, state: 'blocked', warning: String(error.message).slice(0, 900) };
  }
  const collision = await earlierCommand(plan, env, platform);
  if (collision) {
    result.collision = collision;
    result.warning = 'An existing retk command appears earlier on PATH and takes precedence. It has been left unchanged.';
    result.instructions = `Run "${plan.shim}" directly, or review PATH ordering in a new terminal.`;
  }
  if (noPath) return result;
  if (platform !== 'win32') return { ...result, pathState: 'unsupported', instructions: `Add "${plan.bin}" to PATH manually.` };
  try {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const run = await spawn(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', pathScript], {
      env: { ...env, RETK_QUICKSTART_BIN: plan.bin }, shell: false, encoding: 'utf8',
      windowsHide: true, timeout: 30000, maxBuffer: 65536,
    });
    if (run.error || run.status !== 0) throw new Error('User PATH registration failed; add the managed bin directory manually.');
    const status = JSON.parse(run.stdout.trim());
    if (!['added', 'present'].includes(status.state)) throw new Error('User PATH registration returned an invalid status.');
    result.pathState = status.state;
    result.instructions ||= 'Open a new terminal to use retk from the updated user PATH.';
    return result;
  } catch (error) {
    return { ...result, state: 'blocked', pathState: 'failed', warning: String(error.message).slice(0, 900), instructions: `Add "${plan.bin}" to your user PATH, or run "${plan.shim}" directly.` };
  }
}
