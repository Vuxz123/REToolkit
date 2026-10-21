import fs from 'node:fs';
import path from 'node:path';
import { runProcess } from '../process.js';

const MAX_OUTPUT = 1024 * 1024;
const MAX_ENTRIES = 1024;

function fail(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  if (cause) {
    for (const key of ['exitCode', 'signal', 'stdout', 'stderr']) if (cause[key] !== undefined) error[key] = cause[key];
    error.originalCode = cause.code;
  }
  return error;
}

function executableName(file) {
  return typeof file === 'string' && file.length > 0 && !/[\x00-\x1f\x7f]/.test(file) && /\.exe$/i.test(file);
}

export function resolveAdbPath(adbPath, { env = process.env } = {}) {
  const regularExe = file => {
    if (!executableName(file)) return false;
    try { return fs.lstatSync(file).isFile(); } catch { return false; }
  };
  if (adbPath !== undefined) {
    if (!regularExe(adbPath)) throw fail('ADB_EXECUTABLE_INVALID', 'ADB must be an existing regular .exe file.');
    return path.resolve(adbPath);
  }
  const value = key => Object.entries(env).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];
  const candidates = String(value('PATH') ?? '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory.replace(/^"|"$/g, ''), 'adb.exe'));
  const drive = value('SystemDrive') ?? 'C:';
  for (const base of [drive, value('ProgramFiles') ?? `${drive}\\Program Files`, value('ProgramFiles(x86)') ?? `${drive}\\Program Files (x86)`]) {
    for (const edition of ['LDPlayer9', 'LDPlayer4']) candidates.push(path.join(base + (base.endsWith(':') ? '\\' : ''), 'LDPlayer', edition, 'adb.exe'));
  }
  const selected = candidates.find(regularExe);
  if (!selected) throw fail('ADB_EXECUTABLE_NOT_FOUND', 'adb.exe was not found on PATH or in known LDPlayer locations. Pass --adb <adb.exe>.');
  return path.resolve(selected);
}

export function validatePackageName(value) {
  if (typeof value !== 'string' || value.length > 255 || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(value)) throw fail('ADB_PACKAGE_INVALID', 'Invalid Android package name.');
  return value;
}

export function validateSerial(value) {
  if (typeof value !== 'string' || value.length > 255 || !/^[A-Za-z0-9_][A-Za-z0-9_.:\[\]-]*$/.test(value)) throw fail('ADB_SERIAL_INVALID', 'Invalid ADB device serial.');
  return value;
}

function validateRemote(value) {
  if (typeof value !== 'string' || value.length > 4096 || !/^\/(?:[A-Za-z0-9_~+=.@-]+\/)*[A-Za-z0-9_~+=.@-]+$/.test(value) || value.split('/').some(part => part === '.' || part === '..')) throw fail('ADB_REMOTE_INVALID', 'Invalid absolute Android remote path.');
  return value;
}

function boundedText(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') >= MAX_OUTPUT || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffd]/.test(text) || /\r(?!\n)/.test(text)) throw fail('ADB_METADATA_INVALID', 'ADB metadata is malformed or may have been truncated.');
  return text;
}

function lines(text) {
  if (text && !text.endsWith('\n')) throw fail('ADB_METADATA_INVALID', 'ADB metadata has an unterminated line and may be truncated.');
  const entries = boundedText(text).replace(/\r\n/g, '\n').split('\n');
  while (entries.at(-1) === '') entries.pop();
  if (entries.length > MAX_ENTRIES) throw fail('ADB_METADATA_LIMIT', 'ADB metadata exceeds the entry limit.');
  return entries;
}

export function parseDevices(text) {
  boundedText(text);
  if (!text.endsWith('\n')) throw fail('ADB_METADATA_INVALID', 'ADB device metadata may be truncated.');
  const entries = text.replace(/\r\n/g, '\n').split('\n');
  if (entries.shift() !== 'List of devices attached') throw fail('ADB_METADATA_INVALID', 'ADB devices header is missing.');
  while (entries.at(-1) === '') entries.pop();
  if (entries.length > MAX_ENTRIES) throw fail('ADB_METADATA_LIMIT', 'ADB device list exceeds the entry limit.');
  const seen = new Set();
  return entries.map(line => {
    const match = /^(\S+)[\t ]+(device|offline|unauthorized|bootloader|recovery|sideload|rescue|connecting|authorizing)(?:[\t ]+(.+))?$/.exec(line);
    if (!match) throw fail('ADB_METADATA_INVALID', 'Malformed ADB device entry.');
    const serial = validateSerial(match[1]);
    if (seen.has(serial.toLowerCase())) throw fail('ADB_METADATA_INVALID', 'Duplicate ADB device identity.');
    seen.add(serial.toLowerCase());
    const keys = new Set();
    for (const token of match[3]?.split(/[\t ]+/) ?? []) {
      const field = /^([a-z_]+):([A-Za-z0-9_.:\[\]-]+)$/.exec(token);
      if (!field || keys.has(field[1])) throw fail('ADB_METADATA_INVALID', 'Malformed or duplicate ADB device metadata.');
      keys.add(field[1]);
    }
    return { serial, state: match[2] };
  });
}

function missingDirectory(error, directory) {
  if (error.originalCode === 'ERR_PROCESS_CANCELLED' || error.signal) return false;
  const source = error.cause ?? error;
  const streams = [source.stdout, source.stderr].filter(value => typeof value === 'string' && value.length);
  const diagnostic = streams.length ? streams.join('\n') : source.message ?? '';
  if (Buffer.byteLength(diagnostic) >= MAX_OUTPUT || /permission denied|access denied/i.test(diagnostic)) return false;
  const escaped = directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const missing = new RegExp(`^ls: (?:cannot access )?['\"]?${escaped}['\"]?: No such file or directory$`);
  const entries = diagnostic.split(/\r?\n/).filter(Boolean);
  return entries.some(line => missing.test(line)) && entries.every(line => missing.test(line) || /^(?:adb|[^\r\n]+\.exe) failed \([1-9][0-9]*\)(?:; log: .+)?$/i.test(line));
}

export function createAdbClient({ file, run = runProcess, runOptions = {} }) {
  // Resolution checks the actual file; an injected runner can use an inert name.
  if (!executableName(file)) throw fail('ADB_EXECUTABLE_INVALID', 'ADB requires a .exe executable path.');
  if (typeof run !== 'function') throw fail('ADB_RUNNER_INVALID', 'ADB process runner must be a function.');
  async function invoke(args) {
    let result;
    try { result = await run(file, args, runOptions); }
    catch (error) { throw fail('ADB_PROCESS_FAILED', `ADB command failed: ${error.message}`, error); }
    if (!result || result.exitCode !== 0) throw fail('ADB_PROCESS_FAILED', `ADB command failed (${result?.exitCode ?? 'unknown status'}): ${result?.stderr || result?.stdout || ''}`, result);
    const stdout = boundedText(result.stdout ?? '');
    const stderr = boundedText(result.stderr ?? '');
    if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) >= MAX_OUTPUT) throw fail('ADB_METADATA_LIMIT', 'ADB output may have been truncated.');
    return { stdout, stderr };
  }
  const deviceArgs = serial => ['-s', validateSerial(serial)];
  const client = {
    async devices() { return parseDevices((await invoke(['devices', '-l'])).stdout); },
    async selectDevice(serial) {
      if (serial !== undefined) validateSerial(serial);
      const devices = await client.devices();
      if (serial !== undefined) {
        const selected = devices.find(device => device.serial === serial);
        if (!selected || selected.state !== 'device') throw fail('ADB_DEVICE_UNAVAILABLE', `Selected device ${serial} is unavailable or not ready.`);
        return selected.serial;
      }
      const ready = devices.filter(device => device.state === 'device');
      if (ready.length !== 1) throw fail('ADB_DEVICE_SELECTION', 'Select exactly one ready device with --serial.');
      return ready[0].serial;
    },
    async packagePaths(serial, packageName) {
      const args = deviceArgs(serial); validatePackageName(packageName);
      const installed = lines((await invoke([...args, 'shell', 'pm', 'list', 'packages', packageName])).stdout).map(line => {
        if (!line.startsWith('package:')) throw fail('ADB_METADATA_INVALID', 'Malformed installed package metadata.');
        return validatePackageName(line.slice(8));
      });
      if (!installed.includes(packageName)) throw fail('ADB_PACKAGE_NOT_FOUND', `Exact package ${packageName} is not installed.`);
      const paths = lines((await invoke([...args, 'shell', 'pm', 'path', packageName])).stdout).map(line => {
        if (!line.startsWith('package:')) throw fail('ADB_METADATA_INVALID', 'Malformed APK path metadata.');
        const remote = validateRemote(line.slice(8));
        if (!remote.endsWith('.apk')) throw fail('ADB_METADATA_INVALID', 'Package path must reference an APK.');
        return remote;
      });
      if (!paths.length) throw fail('ADB_PACKAGE_PATHS_EMPTY', 'Package returned no APK paths.');
      return [...new Set(paths)];
    },
    async obbPaths(serial, packageName) {
      const args = deviceArgs(serial); validatePackageName(packageName);
      const directory = `/sdcard/Android/obb/${packageName}`;
      let result;
      try { result = await invoke([...args, 'shell', 'ls', '-1', directory]); }
      catch (error) { if (missingDirectory(error, directory)) return []; throw error; }
      if (missingDirectory(result, directory)) return [];
      if (result.stderr.length) throw fail('ADB_OBB_ACCESS', `Unexpected OBB listing diagnostic: ${result.stderr}`);
      return lines(result.stdout).map(name => {
        if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*\.obb$/.test(name)) throw fail('ADB_METADATA_INVALID', 'Malformed OBB basename.');
        return `${directory}/${name}`;
      });
    },
    async launch(serial, packageName) {
      const args = deviceArgs(serial); validatePackageName(packageName);
      await invoke([...args, 'shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1']);
    },
    async size(serial, remote) {
      const args = deviceArgs(serial); validateRemote(remote);
      const entries = lines((await invoke([...args, 'shell', 'stat', '-c', '%s', remote])).stdout);
      if (entries.length !== 1 || !/^(0|[1-9][0-9]*)$/.test(entries[0])) throw fail('ADB_METADATA_INVALID', 'Malformed remote file size.');
      const size = Number(entries[0]);
      if (!Number.isSafeInteger(size) || size > 8 * 1024 ** 3) throw fail('ADB_METADATA_LIMIT', 'Remote file size exceeds 8 GiB.');
      return size;
    },
    async pull(serial, remote, local) {
      const args = deviceArgs(serial); validateRemote(remote);
      if (typeof local !== 'string' || !local.length || /[\x00-\x1f\x7f]/.test(local)) throw fail('ADB_LOCAL_INVALID', 'Invalid local file path.');
      await invoke([...args, 'pull', remote, local]);
    },
  };
  return client;
}
