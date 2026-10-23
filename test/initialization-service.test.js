import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createToolkit} from '../src/toolkit.js';
import {runAssetOperation} from '../src/assets/service.js';
import {selectedAssetBinding} from '../src/assets/context.js';
import {createUnityFixture} from './fixtures/unity-export-fixture.mjs';
import {setStep,outputManifest,fingerprint} from '../src/state.js';
import {stepFingerprint} from '../src/inputs.js';

test('typed initialization plan/apply receives verified native context and returns a bounded proof preview',async t=>{
 const version='2022.3.62f2',editor=`C:/Program Files/Unity/Hub/Editor/${version}/Editor/Unity.exe`;if(!fs.existsSync(editor)){t.skip('Exact Editor bundled Roslyn required');return;}
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-initialization-service-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const toolkit=createToolkit(root,{log:()=>{},run:()=>{throw Error('No engine execution');}});await toolkit.init('Game');const workspace=toolkit.workspace('Game'),input=path.join(workspace,'01_Extracted');
 fs.writeFileSync(path.join(input,'libil2cpp.so'),'owned native');fs.writeFileSync(path.join(input,'global-metadata.dat'),'owned metadata');await toolkit.scan('Game',input);
 const f=await createUnityFixture(path.join(workspace,'05_ReconstructedSource')),project=toolkit.read('Game');project.reconstructedSourceDir=f.projectDir;project.unityEditorPath=editor;
 fs.writeFileSync(path.join(f.projectDir,'ProjectSettings/ProjectVersion.txt'),`m_EditorVersion: ${version}\n`);
 const original=f.source.replace('public void Tick()','public static class Flow { public static object Signal; } public void Tick()'),replacement=original.replace('public static object Signal;','public static object Signal; static Flow() { Signal = new object(); }');fs.writeFileSync(f.scriptPath,original);
 const dumpFile=path.join(project.il2cppDumperOutput,'dump.cs');fs.mkdirSync(project.il2cppDumperOutput,{recursive:true});fs.writeFileSync(dumpFile,'// Image 0: Assembly-CSharp.dll - 0\n// Namespace: Demo\npublic static class Player.Flow // TypeDefIndex: 0\n{\n// RVA: 0x1234 Offset: 0x1234 VA: 0x1234\nprivate static void .cctor() { }\n}\n');
 setStep(project,'dump','succeeded',stepFingerprint(project,'dump',toolkit.tools,root),outputManifest([project.il2cppDumperOutput]));await toolkit.save('Game',project);
 const binding=selectedAssetBinding(toolkit,'Game').binding,evidence={kind:'retoolkit-evidence',schemaVersion:1,query:{method:'functions.decompile',params:{selector:'ram:0x2234',limit:10}},build:{native:{...binding.native,abi:'unknown'},metadata:binding.metadata},programIdentity:{program:binding.program,projectName:binding.projectName,sha256:binding.native.sha256,imageBase:'ram:0x1000'},runId:'11111111-1111-4111-8111-111111111111',revision:1,collectedAt:'2026-10-20T00:00:00.000Z',result:{items:[{line:1,text:'owned ctor observation'}],nextCursor:null,address:'ram:0x2234'},coverage:{state:'observed',source:'loaded-program',explanation:'Whole observed constructor'},limitations:[],dataTrust:'untrusted-target-content'};
 const indexed=await runAssetOperation(toolkit,'Game','assets.index',{storage:'sqlite'}),page=await runAssetOperation(toolkit,'Game','assets.scripts',{query:'Assets/Player.cs',limit:1}),script=page.items[0];
 assert.equal(script.sourceCapabilities.missingInitialization.mode,'initialization');
 const request={kind:'retoolkit-reconstruction-request',schemaVersion:1,graphRevision:indexed.revision,changes:[{scriptId:script.scriptId,mode:'initialization',source:replacement,constructors:[{fullName:'Demo.Player+Flow',kind:'static',evidenceId:fingerprint(evidence)}]}]};
 const preview=await runAssetOperation(toolkit,'Game','reconstruct.plan',{request,evidence:[evidence]});assert.equal(preview.changes[0].initializationProof.proofInSavedPlan,true);assert.equal(preview.changes[0].initializationProof.originalSource,undefined);
 const saved=JSON.parse(fs.readFileSync(path.join(workspace,preview.storedPlan),'utf8'));assert.equal(saved.plan.changes[0].initializationProof.originalSource,original);
 const scene=fs.readFileSync(f.scenePath),meta=fs.readFileSync(f.scriptPath+'.meta');
 const receipt=await runAssetOperation(toolkit,'Game','reconstruct.apply',{operationId:preview.operationId});assert.equal(receipt.compileReady,false);assert.equal(fs.readFileSync(f.scriptPath,'utf8'),replacement);assert.deepEqual(fs.readFileSync(f.scenePath),scene);assert.deepEqual(fs.readFileSync(f.scriptPath+'.meta'),meta);
 assert.deepEqual(await runAssetOperation(toolkit,'Game','reconstruct.apply',{operationId:preview.operationId}),receipt);
 fs.appendFileSync(dumpFile,'// changed receipt content\n');await assert.rejects(runAssetOperation(toolkit,'Game','reconstruct.apply',{operationId:preview.operationId}),{code:'stale_graph'});
});
