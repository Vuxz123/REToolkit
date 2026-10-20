// A short-lived supervisor retains an engine marker even if the CLI parent exits.
// Its engine inherits these stdio handles; runProcess resolves only after close.
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runProcess } from './process.js';

const reservation = process.argv[2];
let marker;
let descriptor;
// The outer CLI may disappear while the engine still writes. pipe() unpipes on
// destination errors; runProcess's data listeners keep draining the engine.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

function report(result) {
  if (process.connected) process.send({ type: 'retk-engine-result', ...result }, () => {});
}

try {
  descriptor = JSON.parse(fs.readFileSync(reservation, 'utf8'));
  if (!descriptor.token || !Array.isArray(descriptor.args) || typeof descriptor.file !== 'string') throw Error('Invalid engine reservation.');
  marker = path.join(path.dirname(reservation), `engine-${process.pid}-${descriptor.token}.json`);
  // Claim before launching anything. At every point an extra directory entry
  // prevents an abandoned parent lock from being reclaimed by a different CLI.
  fs.renameSync(reservation, marker);
  const staging = marker + '.tmp';
  fs.writeFileSync(staging, JSON.stringify({ ...descriptor, phase: 'running',
    owner: { pid: process.pid, startToken: `${process.pid}:${performance.timeOrigin}` } }), { flag: 'wx' });
  fs.renameSync(staging, marker);

  let result;
  try {
    result = await runProcess(descriptor.file, descriptor.args, { forwardOutput: true,toolchainRoot:descriptor.toolchainRoot });
    report({ exitCode: result.exitCode });
  } catch (error) {
    report({ exitCode: error.exitCode ?? null, signal: error.signal ?? null,
      error: { message: error.message, code: error.code } });
    process.exitCode = Number.isInteger(error.exitCode) && error.exitCode > 0 && error.exitCode <= 255 ? error.exitCode : 1;
  }
  // A fulfilled/rejected runProcess has observed tool close (or failed before
  // spawn). An abruptly killed supervisor never reaches this cleanup.
  fs.unlinkSync(marker);
  marker = null;
} catch (error) {
  report({ error: { message: error.message, code: error.code } });
  process.stderr.write(`Engine supervisor failed: ${error.message}\n`);
  process.exitCode = 1;
  // Preserve claimed markers if publication or lifecycle handling was uncertain.
}
