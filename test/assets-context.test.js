import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createToolkit} from '../src/toolkit.js';
import {assetPaths,selectedAssetBinding,assertAssetPath,safeAssetExportPath} from '../src/assets/context.js';

async function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-assets-context-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const toolkit=createToolkit(root,{log:()=>{}}); await toolkit.init('Game');
  const input=path.join(toolkit.workspace('Game'),'01_Extracted');
  fs.writeFileSync(path.join(input,'libil2cpp.so'),'native');
  fs.writeFileSync(path.join(input,'global-metadata.dat'),'metadata');
  fs.writeFileSync(path.join(input,'level.assets'),'scene');
  await toolkit.scan('Game',input);return {root,toolkit,input};
}
test('asset context binds complete source inventory and selected native/metadata',async t=>{
  const {toolkit,input}=await fixture(t);const before=selectedAssetBinding(toolkit,'Game');
  assert.equal(before.binding.program,'libil2cpp.so');assert.equal(before.binding.projectName,'Game');
  assert.equal(before.sourceManifest.files.length,3);
  fs.writeFileSync(path.join(input,'level.assets'),'changed scene');
  assert.notEqual(selectedAssetBinding(toolkit,'Game').binding.assetsSha256,before.binding.assetsSha256);
  fs.writeFileSync(path.join(input,'libil2cpp.so'),'changed native');
  assert.throws(()=>selectedAssetBinding(toolkit,'Game'),{code:'asset_input_stale'});
});
test('asset output paths stay inside selected workspace without creating directories',async t=>{
  const {toolkit}=await fixture(t);const paths=assetPaths(toolkit,'Game');
  assert.equal(paths.graphFile,path.join(paths.workspace,'04_Notes/assets/graph.json'));
  assert.equal(fs.existsSync(paths.base),false);
  assert.throws(()=>assertAssetPath(path.join(paths.workspace,'../outside'),paths.workspace),{code:'asset_path_invalid'});
  for(const control of ['.retk-lock','backups','project.re.json','04_Notes','03_GhidraProject','01_Extracted'])assert.throws(()=>safeAssetExportPath(paths.workspace,path.join(paths.workspace,control)),{code:'asset_path_invalid'});
  assert.equal(safeAssetExportPath(paths.workspace,path.join(paths.workspace,'05_ReconstructedSource/ExportedProject')),path.join(paths.workspace,'05_ReconstructedSource/ExportedProject'));
});
test('source or output directory junctions are rejected',async t=>{
  const {root,toolkit,input}=await fixture(t);const outside=path.join(root,'outside');fs.mkdirSync(outside);
  fs.symlinkSync(outside,path.join(input,'linked'),'junction');
  assert.throws(()=>selectedAssetBinding(toolkit,'Game'),{code:'asset_path_invalid'});
  const notes=path.join(toolkit.workspace('Game'),'04_Notes');fs.rmdirSync(notes);
  fs.symlinkSync(outside,notes,'junction');assert.throws(()=>assetPaths(toolkit,'Game'),{code:'asset_path_invalid'});
});
