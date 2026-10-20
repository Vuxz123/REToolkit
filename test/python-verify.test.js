import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {snapshotPythonGeneration,inspectManagedPython,verifyPythonRuntime} from '../src/python-runtime/verify.js';
import {pythonLockFingerprint,ACTIVE_PATH,GENERATIONS_PATH} from '../src/python-runtime/manifest.js';
import {lock} from './python-fixtures.js';
test('Managed selection verifies exact files without mutation and refuses altered pointers',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-python-verify-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));assert.equal(inspectManagedPython(root).state,'absent');
 const generation='11111111-1111-4111-8111-111111111111',folder=path.join(root,GENERATIONS_PATH,generation);await fs.mkdir(path.join(folder,'python'),{recursive:true});await fs.writeFile(path.join(folder,'python/python.exe'),'fake');
 const l=lock(),r={kind:'retoolkit-python-receipt',schemaVersion:1,platform:l.platform,generation,createdAt:new Date().toISOString(),lockFingerprint:pythonLockFingerprint(l),python:l.python,pip:l.pip,wheels:l.wheels,probe:{pythonVersion:l.python.version,bits:64,implementation:'cpython',distributions:l.wheels.map(({name,version})=>({name,version})),entryPoint:'bridge_mcp_ghidra.cli:main'},files:await snapshotPythonGeneration(folder),limitations:[]};
 const bytes=JSON.stringify(r);await fs.writeFile(path.join(folder,'receipt.json'),bytes);await fs.writeFile(path.join(root,ACTIVE_PATH),JSON.stringify({kind:'retoolkit-python-active',schemaVersion:1,generation,receiptSha256:createHash('sha256').update(bytes).digest('hex')}));
 assert.equal(inspectManagedPython(root).state,'selected');assert.equal((await verifyPythonRuntime(root)).ok,true);
 await fs.writeFile(path.join(folder,'python/python.exe'),'tamper');assert.equal((await verifyPythonRuntime(root)).ok,false);
 await fs.writeFile(path.join(folder,'receipt.json'),bytes+' ');assert.equal(inspectManagedPython(root).state,'invalid');
});

test('generation snapshot includes nested receipt names and rejects links',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-python-links-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const folder=path.join(root,'generation'),external=path.join(root,'external');await fs.mkdir(path.join(folder,'site'),{recursive:true});await fs.mkdir(external);await fs.writeFile(path.join(folder,'receipt.json'),'root metadata');await fs.writeFile(path.join(folder,'site/receipt.json'),'package data');
 assert.deepEqual((await snapshotPythonGeneration(folder)).map(f=>f.path),['site/receipt.json']);
 await fs.symlink(external,path.join(folder,'linked'),process.platform==='win32'?'junction':'dir');await assert.rejects(snapshotPythonGeneration(folder));
 await fs.mkdir(path.join(root,'runtime'),{recursive:true});await fs.symlink(external,path.join(root,'runtime/python'),process.platform==='win32'?'junction':'dir');assert.equal(inspectManagedPython(root).state,'invalid');
});
