import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { acquireToolchainRead } from './toolchain/lease.js';

export function launchSpec(file, args = []) {
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { file, args, options:{ shell:false } };
  // Batch launchers require cmd.exe. Reject its expansion/metacharacter syntax
  // rather than interpolate arbitrary user text into a shell command.
  const tokens = [file,...args].map(String);
  if (tokens.some(token => /["\r\n%!?^&|<>]/.test(token))) throw new Error('Unsupported command-interpreter characters in batch launcher arguments');
  return {
    file:path.join(process.env.SystemRoot ?? 'C:\\Windows','System32/cmd.exe'),
    args:['/d','/s','/v:off','/c',`"${tokens.map(token => `"${token}"`).join(' ')}"`],
    options:{ shell:false, windowsVerbatimArguments:true },
  };
}

export async function runProcess(file, args = [], { leaseDirectory, toolchainRoot, ...options } = {}) {
  if (!leaseDirectory) {
    const lease=toolchainRoot?acquireToolchainRead(toolchainRoot):null;
    try{return await runChild(file,args,options);}finally{lease?.release();}
  }
  launchSpec(file, args); // Reject unsupported shell syntax before reserving a lease.
  const directory = path.resolve(leaseDirectory);
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Engine lease requires an existing workspace lock directory.');
  const token = randomUUID();
  const reservation = path.join(directory, `engine-reserved-${process.pid}-${token}.json`);
  fs.writeFileSync(reservation, JSON.stringify({ token, parentPid: process.pid, file, args,toolchainRoot }), { flag: 'wx' });
  try {
    return await runChild(process.execPath, [fileURLToPath(new URL('./engine-worker.js', import.meta.url)), reservation], {
      ...options, supervised: true, displayFile: file,
    });
  } finally {
    // An unclaimed reservation cannot have launched an engine. A worker-owned
    // marker is intentionally never removed here, even when the worker fails.
    try { fs.unlinkSync(reservation); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function runChild(file, args = [], { cwd, env, logFile, inherit = false, supervised = false, displayFile = file, forwardOutput = false, windowsHide = true } = {}) {
  const spec = launchSpec(file,args);
  if (logFile) fs.mkdirSync(path.dirname(logFile),{recursive:true});
  const log = logFile ? fs.openSync(logFile,'a') : null;
  let stdout = ''; let stderr = ''; const limit = 1024 * 1024;
  try {
    return await new Promise((resolve,reject) => {
      const stdio = inherit ? ['inherit','inherit','inherit'] : ['ignore','pipe','pipe'];
      if(supervised) stdio.push('ipc');
      const child = spawn(spec.file,spec.args,{...spec.options,cwd,env,windowsHide,detached:supervised,stdio});
      let cancellation = null; let spawnError = null; let logError = null; let workerResult = null;
      if(supervised) child.on('message',message => { if(message?.type==='retk-engine-result') workerResult=message; });
      // On Windows kill() can terminate cmd.exe without terminating its JVM.
      // Record cancellation and retain the workspace lock until this launcher
      // actually closes; never infer that an external descendant was stopped.
      const interrupt = () => { cancellation ??= 'SIGINT'; };
      const terminate = () => { cancellation ??= 'SIGTERM'; };
      process.on('SIGINT',interrupt); process.on('SIGTERM',terminate);
      const cleanup = () => { process.removeListener('SIGINT',interrupt); process.removeListener('SIGTERM',terminate); };
      const stdoutDecoder = new StringDecoder('utf8'); const stderrDecoder = new StringDecoder('utf8');
      const capture = (decoder, data) => {
        if(log!==null && !logError) { try { fs.writeSync(log,data); } catch (error) { logError = error; } }
        return decoder.write(data);
      };
      if (!inherit) {
        child.stdout.on('data',data => { const text = capture(stdoutDecoder,data); if(stdout.length<limit) stdout += text.slice(0,limit-stdout.length); });
        child.stderr.on('data',data => { const text = capture(stderrDecoder,data); if(stderr.length<limit) stderr += text.slice(0,limit-stderr.length); });
        if(forwardOutput) {
          child.stdout.pipe(process.stdout,{end:false});
          child.stderr.pipe(process.stderr,{end:false});
        }
      }
      child.once('error',error => { spawnError = error; });
      child.once('close',(exitCode,signal) => {
        cleanup();
        stdout += stdoutDecoder.end().slice(0,limit-stdout.length);
        stderr += stderrDecoder.end().slice(0,limit-stderr.length);
        if(spawnError) { reject(spawnError); return; }
        if(logError) { reject(logError); return; }
        if(cancellation || exitCode!==0 || workerResult?.error) {
          const actualExitCode = workerResult?.exitCode ?? exitCode;
          const status = cancellation
            ? `cancellation requested (${cancellation}); waited for the launcher to close. External descendant processes may still be running`
            : `failed (${workerResult?.signal ?? signal ?? actualExitCode})`;
          const error = new Error(`${path.basename(displayFile)} ${status}${logFile?`; log: ${logFile}`:''}\n${stderr || stdout || workerResult?.error?.message || ''}`);
          error.exitCode=actualExitCode; error.signal=cancellation ?? workerResult?.signal ?? signal;
          if(workerResult?.error?.code) error.code=workerResult.error.code;
          if(cancellation) error.code='ERR_PROCESS_CANCELLED';
          reject(error);
        } else resolve({exitCode,stdout,stderr});
      });
    });
  } finally { if(log!==null) fs.closeSync(log); }
}
