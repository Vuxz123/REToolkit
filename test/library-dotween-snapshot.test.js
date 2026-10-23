import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {scanLibraries} from '../src/libraries/catalog.js';
import {libraryDescriptors} from '../src/libraries/descriptors.js';

const source=fileURLToPath(new URL('../libraries/dotween/dotween-1.2.335-yarnfever.zip',import.meta.url));
const archiveSha256='e50be4124b46cfcbceb300c8cc6b6cdaad8ca7f7a9365179979190cd4d2f26e0';
const localSnapshot={skip:existsSync(source)?false:'Optional local DOTween ZIP is not distributed with the source repository'};
async function fixture(t,bytes){
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'dotween-snapshot-'));
 t.after(()=>fs.rm(home,{recursive:true,force:true}));
 const root=path.join(home,'sources');await fs.mkdir(root);await fs.writeFile(path.join(root,'vendor.zip'),bytes);
 return (await scanLibraries({roots:[root],cacheDir:path.join(home,'.cache','libraries')})).packages[0];
}

test('built-in DOTween descriptor retains the exact optional archive release pin',()=>{
 const descriptor=libraryDescriptors.find(item=>item.id==='dotween');
 assert(descriptor.pins.some(pin=>pin.archiveSha256===archiveSha256&&pin.root==='Assets'&&pin.version==='1.2.335'));
});

test('built-in DOTween pin confirms the exact Yarn Fever core archive without clearing compatibility limits',localSnapshot,async t=>{
 const p=await fixture(t,await fs.readFile(source));
 assert.equal(p.libraryId,'dotween');assert.equal(p.version,'1.2.335');assert.equal(p.recognition,'confirmed');
 assert.equal(p.payloadFiles.length,37);assert.equal(p.guidInventory.length,21);
 assert(p.evidence.some(item=>item.kind==='exact-content-pin'));
 assert(p.evidence.some(item=>item.kind==='unsupported-managed-metadata'));
 assert(p.evidence.some(item=>item.kind==='unsupported-native-plugin'));
 assert(p.evidence.some(item=>item.kind==='unsupported-source-declarations'));
});

test('changing only the ZIP comment invalidates the exact DOTween release pin',localSnapshot,async t=>{
 const original=await fs.readFile(source),comment=Buffer.from('changed');
 assert.equal(original.readUInt32LE(original.length-22),0x06054b50);
 const modified=Buffer.concat([original,comment]);modified.writeUInt16LE(comment.length,original.length-2);
 const p=await fixture(t,modified);
 assert.equal(p.libraryId,'dotween');assert.equal(p.version,null);assert.equal(p.recognition,'candidate');
 assert(!p.evidence.some(item=>item.kind==='exact-content-pin'));
 assert.equal(p.payloadFiles.length,37);
});
