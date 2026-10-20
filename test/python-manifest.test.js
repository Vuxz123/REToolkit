import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePythonLock,pythonLockFingerprint,validatePythonReceipt,validateActivePointer} from '../src/python-runtime/manifest.js';
import {lock} from './python-fixtures.js';
test('Python lock pins full offline inputs and rejects ambiguous or injected requirements',()=>{
 const value=lock();assert.deepEqual(validatePythonLock(value),value);assert.equal(pythonLockFingerprint(value).length,64);
 for(const mutate of [l=>l.wheels.push({...l.wheels[0]}),l=>l.wheels[0].name='Ghidra_MCP_Bridge',l=>l.wheels[0].version='6.0\n--extra-index-url=x',l=>l.python.version='3.13.0',l=>l.pip.source.url+='?token=x',l=>l.wheels[0].filename='../x.whl',l=>l.wheels=[]]){const bad=lock();mutate(bad);assert.throws(()=>validatePythonLock(bad),{code:'PYTHON_LOCK_INVALID'});}
});
test('Receipt validates exact locked metadata and self fingerprint',()=>{
 const l=lock();const r={kind:'retoolkit-python-receipt',schemaVersion:1,platform:l.platform,generation:'11111111-1111-4111-8111-111111111111',createdAt:new Date().toISOString(),lockFingerprint:pythonLockFingerprint(l),python:l.python,pip:l.pip,wheels:l.wheels,probe:{pythonVersion:l.python.version,bits:64,implementation:'cpython',distributions:l.wheels.map(({name,version})=>({name,version})),entryPoint:'bridge_mcp_ghidra.cli:main'},files:[{path:'python/python.exe',size:1,sha256:'b'.repeat(64)}],limitations:[]};
 assert.equal(validatePythonReceipt(r),r);assert.throws(()=>validatePythonReceipt({...r,lockFingerprint:'c'.repeat(64)}));assert.throws(()=>validatePythonReceipt({...r,probe:{...r.probe,distributions:[]}}));assert.throws(()=>validatePythonReceipt({...r,files:[...r.files,{...r.files[0],path:'Python/PYTHON.exe'}]}));
 assert.equal(validateActivePointer({kind:'retoolkit-python-active',schemaVersion:1,generation:r.generation,receiptSha256:'a'.repeat(64)}).generation,r.generation);
});
