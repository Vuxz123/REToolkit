import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareMcpCommand} from '../src/python-runtime/launcher.js';
import {createToolkit} from '../src/toolkit.js';
import {diagnose} from '../src/diagnostics.js';
test('MCP legacy fallback only applies when no managed pointer exists',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retk-python-launch-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const tk=createToolkit(root);const command=await prepareMcpCommand(tk);assert.equal(command.file,tk.tools.bridge);assert.deepEqual(command.args,['--transport','stdio']);
 await fs.mkdir(path.join(root,'runtime/python'),{recursive:true});await fs.writeFile(path.join(root,'runtime/python/active.json'),'{}');await assert.rejects(prepareMcpCommand(tk),{code:'PYTHON_PROFILE_INVALID'});
 const report=await diagnose(tk);assert.equal(report.tasks.mcp.state,'blocked');assert.ok(report.diagnostics.some(d=>d.code==='PYTHON_PROFILE_INVALID'));assert.ok(!report.tasks.prepare.diagnosticIds.includes('mcp.managed'));
});
