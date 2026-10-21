import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('vendor smoke input failures emit only a sanitized nonzero report',()=>{
 const script=fileURLToPath(new URL('./vendor-mcp-smoke.mjs',import.meta.url));const r=spawnSync(process.execPath,[script,'SECRET-missing-lock.json','SECRET-cache','SECRET-extension.zip','SECRET-ghidra'],{encoding:'utf8',timeout:5000,windowsHide:true});assert.equal(r.status,1);assert.ok(!r.stderr.includes('SECRET'));const report=JSON.parse(r.stderr.trim());assert.equal(report.passed,false);assert.equal(report.code,'PYTHON_LOCK_INVALID');
});
