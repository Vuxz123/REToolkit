import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {snapshotProjectPackage} from '../src/libraries/project-package.js';
import {extractChecked,hashFile} from '../src/toolchain/archive-io.js';
import {snapshotTree} from '../src/toolchain/manifest.js';

async function fixture(t){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'library-project-package-'));
 t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const sourceRoot=path.join(home,'source');await fs.mkdir(path.join(sourceRoot,'Assets','Vendor'),{recursive:true});
 await fs.writeFile(path.join(sourceRoot,'Assets','Vendor','Core.dll'),'original DLL bytes');
 await fs.writeFile(path.join(sourceRoot,'Assets','Vendor.meta'),'fileFormatVersion: 2\nguid: 0123456789abcdef0123456789abcdef\n');
 await fs.writeFile(path.join(sourceRoot,'Assets','Private.txt'),'unrelated game asset');
 return {home,sourceRoot,paths:['Assets/Vendor','Assets/Vendor.meta'],provenance:{project:'fixture',version:'1.2.3'}};
}

test('selected project payload retains exact paths and bytes in a reproducible verified ZIP',async t=>{
 const f=await fixture(t),before=await snapshotTree(f.sourceRoot);
 const a=await snapshotProjectPackage({...f,archivePath:path.join(f.home,'one.zip')});
 const b=await snapshotProjectPackage({...f,archivePath:path.join(f.home,'two.zip')});
 assert.deepEqual(await fs.readFile(a.archivePath),await fs.readFile(b.archivePath));
 assert.deepEqual(a.archive,await hashFile(a.archivePath));
 assert.equal(a.kind,'retoolkit-project-library-snapshot');
 assert.equal(a.sourceRoot,f.sourceRoot);assert.deepEqual(a.provenance,f.provenance);
 const extracted=path.join(f.home,'extracted');await extractChecked(a.archivePath,extracted);
 assert.deepEqual(await snapshotTree(extracted),a.files);
 assert.deepEqual(a.files.map(x=>x.path),['Assets/Vendor.meta','Assets/Vendor/Core.dll']);
 assert.deepEqual(await snapshotTree(f.sourceRoot),before);
 assert.deepEqual(JSON.parse(await fs.readFile(a.receiptPath,'utf8')),a);
});

test('a pinned inventory detects changed project bytes before publication',async t=>{
 const f=await fixture(t),a=await snapshotProjectPackage({...f,archivePath:path.join(f.home,'one.zip')});
 await fs.writeFile(path.join(f.sourceRoot,'Assets','Vendor','Core.dll'),'different bytes');
 const archivePath=path.join(f.home,'changed.zip');
 await assert.rejects(snapshotProjectPackage({...f,archivePath,expectedFiles:a.files}),{code:'LIBRARY_SOURCE_CHANGED'});
 await assert.rejects(fs.stat(archivePath),{code:'ENOENT'});
});

test('unsafe and overlapping selections are rejected',async t=>{
 const f=await fixture(t);
 for(const paths of [['../outside'],['Assets/Vendor','Assets/Vendor/Core.dll'],['Assets/Vendor','assets/vendor']]){
  await assert.rejects(snapshotProjectPackage({...f,paths,archivePath:path.join(f.home,'bad.zip')}),{code:'LIBRARY_SNAPSHOT_INVALID'});
 }
});

test('source junctions are refused and existing packages are never overwritten',async t=>{
 const f=await fixture(t),archivePath=path.join(f.home,'existing.zip');
 await fs.writeFile(archivePath,'keep');
 await assert.rejects(snapshotProjectPackage({...f,archivePath}),{code:'EEXIST'});
 assert.equal(await fs.readFile(archivePath,'utf8'),'keep');
 const link=path.join(f.sourceRoot,'Assets','Link');await fs.symlink(path.join(f.sourceRoot,'Assets','Vendor'),link,'junction');
 await assert.rejects(snapshotProjectPackage({...f,paths:['Assets/Link'],archivePath:path.join(f.home,'linked.zip')}),{code:'TOOLCHAIN_PATH_UNSAFE'});
});
