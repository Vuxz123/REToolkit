import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createToolkit} from '../src/toolkit.js';
import {outputManifest,setStep} from '../src/state.js';
import {stepFingerprint} from '../src/inputs.js';

async function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-diag-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const toolkit=createToolkit(root,{log:()=>{}});await toolkit.init('Game');
 for(const key of ['dumper','java','headless']){fs.mkdirSync(path.dirname(toolkit.tools[key]),{recursive:true});fs.writeFileSync(toolkit.tools[key],'fixture');}
 fs.mkdirSync(path.join(toolkit.tools.ghidra,'Ghidra'),{recursive:true});fs.writeFileSync(path.join(toolkit.tools.ghidra,'Ghidra/application.properties'),'application.version=12.1.2\n');
 const input=path.join(root,'input');fs.mkdirSync(input);fs.writeFileSync(path.join(input,'libil2cpp.so'),'native');fs.writeFileSync(path.join(input,'global-metadata.dat'),'metadata');
 await toolkit.scan('Game',input);const project=toolkit.read('Game');
 for(const filename of ['dump.cs','script.json'])fs.writeFileSync(path.join(project.il2cppDumperOutput,filename),'verified fixture');
 const receipt=path.join(toolkit.workspace('Game'),'04_Notes/import-receipt.json');
 fs.writeFileSync(receipt,JSON.stringify({fingerprint:stepFingerprint(project,'import',toolkit.tools,root),native:project.identities.native,project:project.ghidraProjectName,program:project.ghidraProgramName,attestation:{sha256:project.identities.native.sha256,program:project.ghidraProgramName}}));
 fs.writeFileSync(path.join(project.ghidraProjectDir,'Game.gpr'),'fixture');fs.mkdirSync(path.join(project.ghidraProjectDir,'Game.rep'));
 setStep(project,'dump','succeeded',stepFingerprint(project,'dump',toolkit.tools,root),outputManifest([project.il2cppDumperOutput]));
 setStep(project,'import','succeeded',stepFingerprint(project,'import',toolkit.tools,root),outputManifest([receipt]));
 await toolkit.save('Game',project);return toolkit;
}
const diagnose=async(...args)=>(await import('../src/diagnostics.js')).diagnose(...args);
test('prepare evidence is ready without optional Python and AssetRipper; inspection is read only',async t=>{
 const toolkit=await setup(t);const before=fs.readFileSync(toolkit.projectPath('Game'));
 toolkit.status=toolkit.save=()=>{throw Error('diagnostics must not mutate');};
 const report=await diagnose(toolkit,{name:'Game'});
 assert.equal(report.schemaVersion,1);assert.equal(report.ok,true);assert.equal(report.tasks.prepare.state,'ready');
 assert.equal(report.checks.assetripper.exists,false);assert.equal(report.tasks.assetripper.state,'blocked');
 assert.equal(report.tasks.analysis.state,'unknown');assert.equal(report.tasks.symbols.state,'unknown');
 assert.deepEqual(fs.readFileSync(toolkit.projectPath('Game')),before);
 assert.ok(report.diagnostics.every(d=>d.id&&d.code&&d.status&&d.message&&'action'in d&&'evidence'in d));
});
test('file presence only establishes availability without workspace evidence',async t=>{
 const toolkit=await setup(t);const report=await diagnose(toolkit,{});
 assert.equal(report.tasks.prepare.state,'available');assert.equal(report.ok,false);
 assert.equal(report.tasks.headless.state,'unknown');assert.equal(report.tasks.mcp.state,'blocked');
});
test('changed native and metadata are distinct stable diagnostics',async t=>{
 const toolkit=await setup(t);const p=toolkit.read('Game');fs.writeFileSync(p.nativeBinary,'changed');fs.writeFileSync(p.metadata,'changed');
 const report=await diagnose(toolkit,{name:'Game'});assert.equal(report.tasks.prepare.state,'blocked');
 assert.ok(report.diagnostics.some(d=>d.code==='NATIVE_INPUT_STALE'));assert.ok(report.diagnostics.some(d=>d.code==='METADATA_INPUT_STALE'));
});
test('stale output manifests prevent prepared readiness',async t=>{
 const toolkit=await setup(t);fs.writeFileSync(path.join(toolkit.read('Game').il2cppDumperOutput,'dump.cs'),'tampered');
 const report=await diagnose(toolkit,{name:'Game'});assert.equal(report.ok,false);assert.ok(report.diagnostics.some(d=>d.code==='DUMP_EVIDENCE_STALE'));
});
test('valid manifest bytes cannot attest an import for a different Program',async t=>{
 const toolkit=await setup(t);const project=toolkit.read('Game');const receipt=path.join(toolkit.workspace('Game'),'04_Notes/import-receipt.json');
 const value=JSON.parse(fs.readFileSync(receipt));value.attestation.program='wrong.so';fs.writeFileSync(receipt,JSON.stringify(value));
 project.steps.import.outputs=outputManifest([receipt]);await toolkit.save('Game',project);
 const report=await diagnose(toolkit,{name:'Game'});assert.equal(report.tasks.prepare.state,'blocked');assert.ok(report.diagnostics.some(d=>d.code==='IMPORT_EVIDENCE_STALE'));
});
test('workspace busy marker is preserved and does not imply stale lock reclamation',async t=>{
 const toolkit=await setup(t);const marker=path.join(toolkit.workspace('Game'),'.retk-lock');fs.mkdirSync(marker);fs.writeFileSync(path.join(marker,'ambiguous-owner'),'leave');
 const report=await diagnose(toolkit,{name:'Game'});assert.equal(report.tasks.prepare.state,'blocked');assert.ok(report.diagnostics.some(d=>d.code==='WORKSPACE_BUSY'));assert.ok(fs.existsSync(marker));
});
test('project lock has close action and healthy own session does not become a GUI lock',async t=>{
 const toolkit=await setup(t);const p=toolkit.read('Game');fs.writeFileSync(path.join(p.ghidraProjectDir,'Game.lock'),'');
 let report=await diagnose(toolkit,{name:'Game',task:'headless'});assert.equal(report.tasks.headless.state,'blocked');
 assert.match(report.diagnostics.find(d=>d.code==='GHIDRA_PROJECT_LOCKED').action,/close/i);
 fs.mkdirSync(path.join(toolkit.workspace('Game'),'.retk-lock'));
 const live={state:'ready',runId:'fixture-run',live:{ok:true,runId:'fixture-run',programIdentity:{program:p.ghidraProgramName,projectName:p.ghidraProjectName,sha256:p.identities.native.sha256},result:{state:'ready'}}};
 report=await diagnose(toolkit,{name:'Game',task:'headless',getSessionStatus:async()=>live});
 assert.equal(report.tasks.headless.state,'ready');assert.equal(report.ok,true);assert.ok(!report.diagnostics.some(d=>d.code==='GHIDRA_PROJECT_LOCKED'));
 assert.equal(report.tasks.prepare.state,'blocked');
});
test('session wrong exact program cannot establish readiness or leak errors',async t=>{
 const toolkit=await setup(t);const p=toolkit.read('Game');
 const report=await diagnose(toolkit,{name:'Game',task:'headless',getSessionStatus:async()=>({state:'ready',runId:'run',live:{ok:true,runId:'run',programIdentity:{program:p.ghidraProgramName+'other',projectName:p.ghidraProjectName,sha256:p.identities.native.sha256},result:{state:'ready'}},liveError:{message:'SECRET'}})});
 assert.equal(report.tasks.headless.state,'blocked');assert.doesNotMatch(JSON.stringify(report),/SECRET/);
});
test('session response without hash capability remains unknown',async t=>{
 const toolkit=await setup(t);const p=toolkit.read('Game');
 const report=await diagnose(toolkit,{name:'Game',task:'headless',getSessionStatus:async()=>({state:'ready',runId:'run',live:{ok:true,runId:'run',programIdentity:{program:p.ghidraProgramName,projectName:p.ghidraProjectName},result:{state:'ready'}}})});
 assert.equal(report.readiness,'unknown');assert.ok(report.diagnostics.some(d=>d.code==='NATIVE_SESSION_UNVERIFIED'));
});
test('MCP explicit probe only and observed incompatible extension version',async t=>{
 const toolkit=await setup(t);for(const key of ['bridge','python']){fs.mkdirSync(path.dirname(toolkit.tools[key]),{recursive:true});fs.writeFileSync(toolkit.tools[key],'fixture');}
 const extension=path.join(toolkit.root,'extensions/GhidraMCP');fs.mkdirSync(extension,{recursive:true});fs.writeFileSync(path.join(extension,'extension.properties'),'name=GhidraMCP\nversion=12.0\ndescription=Plugin version 6.0.0.\n');fs.writeFileSync(path.join(extension,'Module.manifest'),'');
 let calls=0;const options={name:'Game',extensionPaths:[extension],probeMcp:async()=>{calls++;return {state:'unknown',code:'MCP_IDENTITY_UNVERIFIED',message:'Hash unavailable',evidence:{},limitations:[]};}};
 let report=await diagnose(toolkit,options);assert.equal(calls,0);assert.ok(report.diagnostics.some(d=>d.code==='MCP_EXTENSION_VERSION_MISMATCH'));
 report=await diagnose(toolkit,{...options,probe:true});assert.equal(calls,1);assert.equal(report.tasks.mcp.state,'blocked');
 const {formatDiagnostics}=await import('../src/diagnostics.js');assert.match(formatDiagnostics(report),/MCP_EXTENSION_VERSION_MISMATCH/);
});
test('MCP initialize server implementation version is not an observed bridge release',async t=>{
 const toolkit=await setup(t);const report=await diagnose(toolkit,{probe:true,probeMcp:async()=>({state:'unknown',code:'MCP_IDENTITY_UNVERIFIED',message:'Hash unknown',evidence:{serverVersion:'1.28.1'}})});
 assert.ok(!report.diagnostics.some(d=>d.id==='mcp.probed-release'));
});
