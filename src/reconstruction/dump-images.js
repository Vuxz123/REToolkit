import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {assertAssetPath,assetError} from '../assets/context.js';
import {fingerprint} from '../state.js';

// v29/v31 fixed metadata header and image/type record layouts, from upstream:
// https://github.com/Perfare/Il2CppDumper/blob/master/Il2CppDumper/Il2Cpp/MetadataClass.cs
const check=(ok,message)=>{if(!ok)throw assetError('metadata_images_invalid',message);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const attestations=new WeakMap();
const assembly=name=>{check(typeof name==='string'&&name.length>0&&name.length<=4096&&!/[\\/:\x00-\x1f\x7f]/.test(name),'Invalid metadata image name');const result=name.endsWith('.dll')?name.slice(0,-4):name;check(result.length>0,'Empty metadata assembly name');return result;};
function validateImages(images,typeCount){
 check(Array.isArray(images)&&images.length>0&&images.length<=10000,'Invalid metadata image count');const names=new Set(),ranges=[];
 for(const [index,image]of images.entries()){
  check(image.index===index&&typeof image.assembly==='string'&&image.assembly.length>0&&!/[\\/:\x00-\x1f\x7f]/.test(image.assembly)&&!names.has(image.assembly.toLowerCase()),'Duplicate or invalid metadata assembly');names.add(image.assembly.toLowerCase());
  check(Number.isSafeInteger(image.start)&&Number.isSafeInteger(image.count)&&image.count>=0&&image.count<=8000000&&(image.count===0?image.start>=-1:image.start>=0)&&image.start+image.count<=8000000,'Invalid metadata type range');if(image.count)ranges.push(image);
 }
 ranges.sort((a,b)=>a.start-b.start);let end=0;for(const image of ranges){check(image.start===end,'Overlapping or incomplete metadata image ranges');end=image.start+image.count;}
 if(typeCount!==undefined)check(end===typeCount,'Metadata image ranges do not cover type definitions');
}
/** Parse selected metadata as data. No target assembly or Dumper execution. */
export function inspectMetadataImageRanges(bytes){
 check(Buffer.isBuffer(bytes)&&bytes.length>=256&&bytes.length<=256*1024**2,'Metadata image input must be 256 bytes..256 MiB');
 check(bytes.readUInt32LE(0)===0xfab11baf&&[29,31].includes(bytes.readUInt32LE(4)),'Unsupported raw metadata image layout');
 const section=at=>{const start=bytes.readUInt32LE(at),size=bytes.readUInt32LE(at+4);check(start>=256&&size>0&&start+size<=bytes.length,'Metadata section exceeds file bounds');return {start,size,end:start+size};};
 const strings=section(24),types=section(160),imagesSection=section(168);check(types.size%88===0&&imagesSection.size%40===0,'Invalid metadata type/image record size');
 const regions=[strings,types,imagesSection].sort((a,b)=>a.start-b.start);for(let i=1;i<regions.length;i++)check(regions[i-1].end<=regions[i].start,'Overlapping metadata sections');
 const count=imagesSection.size/40;check(count<=10000,'Metadata image count exceeds limit');const images=[];
 for(let index=0;index<count;index++){
  const at=imagesSection.start+index*40,nameIndex=bytes.readUInt32LE(at);check(nameIndex<strings.size,'Metadata image string index is out of range');
  const start=strings.start+nameIndex,end=bytes.indexOf(0,start);check(end>=start&&end<strings.end&&end-start<=4096,'Metadata image name is unterminated or excessive');
  let name;try{name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(start,end));}catch{throw assetError('metadata_images_invalid','Metadata image name must be UTF-8');}
  images.push({index,assembly:assembly(name),start:bytes.readInt32LE(at+8),count:bytes.readUInt32LE(at+12)});
 }
 validateImages(images,types.size/88);const result={kind:'retoolkit-il2cpp-image-ranges',schemaVersion:1,version:bytes.readUInt32LE(4),metadata:{sha256:sha(bytes),size:bytes.length},images};attestations.set(result,fingerprint(result));return result;
}
export function readMetadataImageRanges(file,expected){
 file=assertAssetPath(file);const before=fs.lstatSync(file);check(before.isFile()&&before.size<=256*1024**2,'Metadata image input is unsupported');const bytes=fs.readFileSync(file),after=fs.lstatSync(file);
 check(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'Metadata changed while reading image ranges');
 const result=inspectMetadataImageRanges(bytes);check(result.metadata.sha256===expected?.sha256&&result.metadata.size===expected?.size,'Metadata image ranges differ from selected build');return result;
}
/** Numeric legacy headers remain valid; symbolic headers require authoritative
 * selected-metadata ranges supplied internally by the shared service. */
export function dumpImageRanges(dump){
 const headers=[...dump.text.matchAll(/^\/\/ Image (\d+): (.+?) - ([^\r\n]+)\s*$/gm)].map(m=>({index:Number(m[1]),assembly:assembly(m[2]),value:m[3].trim()}));
 if(dump.imageRanges){
  const ranges=dump.imageRanges;check(attestations.get(ranges)===fingerprint(ranges),'Raw metadata image ranges require a fresh authenticated metadata traversal');check(ranges.kind==='retoolkit-il2cpp-image-ranges'&&ranges.schemaVersion===1&&[29,31].includes(ranges.version)&&ranges.metadata?.sha256===dump.build?.metadata?.sha256&&ranges.metadata?.size===dump.build?.metadata?.size,'Raw metadata image attestation is not bound to this dump build');validateImages(ranges.images);
  check(headers.length===ranges.images.length&&headers.every((header,index)=>header.index===index&&header.assembly===ranges.images[index].assembly&&(!/^\d+$/.test(header.value)||Number(header.value)===ranges.images[index].start)),'Dump image headers conflict with selected raw metadata');return ranges.images;
 }
 if(headers.some(header=>!/^\d+$/.test(header.value)))return [];
 return headers.map(header=>({assembly:header.assembly,start:Number(header.value)})).sort((a,b)=>a.start-b.start);
}
