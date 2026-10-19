// Optional Windows acceptance check. Builds its own tiny managed PE fixture;
// this checks Ghidra process/import/receipt wiring, not real IL2CPP decompilation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createToolkit } from '../src/toolkit.js';
import { runProcess } from '../src/process.js';

const engines=process.argv[2];
if(!engines) throw new Error('Usage: node test/real-ghidra.mjs <existing-toolkit-with-engines>');
const sourceRoot=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'retk-real-ghidra-'));
let success=false;
try {
  fs.mkdirSync(path.join(temp,'input')); fs.mkdirSync(path.join(temp,'scripts/ghidra'),{recursive:true});
  const code=path.join(temp,'Fixture.cs'); fs.writeFileSync(code,'public static class RetkFixture { public static int Constant() { return 7; } }');
  const binary=path.join(temp,'input/GameAssembly.dll');
  const csc=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  await runProcess(csc,['/nologo','/target:library',`/out:${binary}`,code]);
  fs.writeFileSync(path.join(temp,'input/global-metadata.dat'),'fixture metadata; not an IL2CPP build');
  fs.copyFileSync(path.join(sourceRoot,'scripts/ghidra/RetkProgramReceipt.java'),path.join(temp,'scripts/ghidra/RetkProgramReceipt.java'));
  const toolkit=createToolkit(temp); Object.assign(toolkit.tools,createToolkit(engines).tools);
  Object.assign(toolkit.env,createToolkit(engines).env);
  await toolkit.init('Fixture'); await toolkit.scan('Fixture',path.join(temp,'input'));
  await toolkit.importProgram('Fixture'); await toolkit.importProgram('Fixture');
  assert.equal(toolkit.read('Fixture').steps.import.state,'succeeded');
  assert.equal(toolkit.read('Fixture').status.analyzed,false);
  success=true; console.log('Real Ghidra import and read-only program attestation passed on source-owned PE fixture.');
} finally {
  if(success) fs.rmSync(temp,{recursive:true,force:true});
  else console.error(`Acceptance diagnostics retained at ${temp}`);
}
