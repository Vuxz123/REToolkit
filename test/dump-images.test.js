import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

function metadata(second='Assembly-CSharp.dll'){
 const strings=Buffer.from('Other.dll\0'+second+'\0'),types=Buffer.alloc(88*8),images=Buffer.alloc(80),bytes=Buffer.alloc(256+strings.length+types.length+images.length);
 bytes.writeUInt32LE(0xfab11baf,0);bytes.writeUInt32LE(31,4);bytes.writeUInt32LE(256,8);bytes.writeUInt32LE(256,24);bytes.writeUInt32LE(strings.length,28);bytes.writeUInt32LE(256+strings.length,160);bytes.writeUInt32LE(types.length,164);const offset=256+strings.length+types.length;bytes.writeUInt32LE(offset,168);bytes.writeUInt32LE(images.length,172);strings.copy(bytes,256);
 for(const [index,name,start,count]of [[0,0,0,5],[1,10,5,3]]){const at=offset+index*40;bytes.writeUInt32LE(name,at);bytes.writeUInt32LE(index,at+4);bytes.writeInt32LE(start,at+8);bytes.writeUInt32LE(count,at+12);}
 return bytes;
}

test('symbolic Dumper image headers use hash-bound raw metadata ranges instead of name guessing',async()=>{
 const api=await import('../src/reconstruction/dump-images.js').catch(()=>({}));assert.equal(typeof api.inspectMetadataImageRanges,'function');assert.equal(typeof api.dumpImageRanges,'function');
 const raw=metadata(),ranges=api.inspectMetadataImageRanges(raw),dump={text:'// Image 0: Other.dll - Il2CppDumper.TypeDefinitionIndex\n// Image 1: Assembly-CSharp.dll - Il2CppDumper.TypeDefinitionIndex\n',build:{metadata:ranges.metadata},imageRanges:ranges};
 assert.deepEqual(api.dumpImageRanges(dump).map(({assembly,start,count})=>({assembly,start,count})),[{assembly:'Other',start:0,count:5},{assembly:'Assembly-CSharp',start:5,count:3}]);
 for(const mutate of [d=>{d.build.metadata.sha256='f'.repeat(64);},d=>{d.imageRanges.images[1].start=4;},d=>{d.imageRanges.images[1].assembly='Wrong';}]){const changed={...dump,build:structuredClone(dump.build),imageRanges:api.inspectMetadataImageRanges(raw)};mutate(changed);assert.throws(()=>api.dumpImageRanges(changed));}
 assert.throws(()=>api.dumpImageRanges(structuredClone(dump)));assert.deepEqual(api.dumpImageRanges({...dump,imageRanges:undefined}),[]);
 assert.equal(ranges.metadata.sha256,createHash('sha256').update(raw).digest('hex'));
});

test('metadata-generated image without DLL suffix retains range coverage and exact header identity',async()=>{
 const api=await import('../src/reconstruction/dump-images.js'),ranges=api.inspectMetadataImageRanges(metadata('__Generated'));
 const dump={text:'// Image 0: Other.dll - Il2CppDumper.TypeDefinitionIndex\n// Image 1: __Generated - Il2CppDumper.TypeDefinitionIndex\n',build:{metadata:ranges.metadata},imageRanges:ranges};
 assert.equal(api.dumpImageRanges(dump)[1].assembly,'__Generated');
});

test('metadata image parser rejects unsupported layout, malformed ranges and unsafe strings',async()=>{
 const api=await import('../src/reconstruction/dump-images.js').catch(()=>({}));assert.equal(typeof api.inspectMetadataImageRanges,'function');
 for(const mutate of [b=>b.writeUInt32LE(39,4),b=>b.writeUInt32LE(9999999,168),b=>b.writeUInt32LE(79,172),b=>b.writeInt32LE(4,b.readUInt32LE(168)+40+8),b=>b.writeUInt32LE(999,b.readUInt32LE(168)+40),b=>b.writeUInt32LE(99,b.readUInt32LE(168)+12),b=>b.write('Bad/path!',256)]){const raw=metadata();mutate(raw);assert.throws(()=>api.inspectMetadataImageRanges(raw));}
});
