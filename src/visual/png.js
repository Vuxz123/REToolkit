import {PNG} from 'pngjs';
import {LIMITS,visualError} from './contract.js';
export function decodePng(bytes){
 const signature=Buffer.from([137,80,78,71,13,10,26,10]);
 if(bytes.length>LIMITS.pngBytes||bytes.length<33||!bytes.subarray(0,8).equals(signature)||bytes.toString('ascii',12,16)!=='IHDR')throw visualError('visual_png_invalid','Invalid or oversized PNG');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width>8192||height>8192||width*height>LIMITS.pixels)throw visualError('visual_png_invalid','PNG geometry exceeds resource limit');
 // pngjs' interlaced synchronous inflater does not bound inflated bytes.
 // Screenshots use eight-bit noninterlaced PNG; reject other modes explicitly.
 if(bytes[24]!==8||bytes[28]!==0)throw visualError('visual_png_unsupported','Only 8-bit noninterlaced PNG is supported');
 for(let offset=8;offset+12<=bytes.length;){const size=bytes.readUInt32BE(offset);if(size>bytes.length-offset-12)throw visualError('visual_png_invalid','Truncated PNG chunk');if(bytes.toString('ascii',offset+4,offset+8)==='acTL')throw visualError('visual_png_invalid','Animated PNG is unsupported');offset+=size+12;}
 try{return PNG.sync.read(bytes,{checkCRC:true});}catch{throw visualError('visual_png_invalid','PNG decode failed');}
}
export function comparePng(baseline,candidate,regions){
 if(baseline.width!==candidate.width||baseline.height!==candidate.height)throw visualError('visual_profile_mismatch','PNG sizes differ');
 const diff=new PNG({width:baseline.width,height:baseline.height});
 for(let i=0;i<diff.data.length;i+=4){const alphaDelta=Math.abs(baseline.data[i+3]-candidate.data[i+3]);for(let c=0;c<3;c++)diff.data[i+c]=Math.max(alphaDelta,Math.abs(baseline.data[i+c]-candidate.data[i+c]));diff.data[i+3]=255;}
 const results=regions.map(r=>{let changed=0,total=0,maxDelta=0;for(let y=r.y;y<r.y+r.height;y++)for(let x=r.x;x<r.x+r.width;x++){let pixelMax=0;const i=(y*baseline.width+x)*4;for(let c=0;c<4;c++){const d=Math.abs(baseline.data[i+c]-candidate.data[i+c]);total+=d;pixelMax=Math.max(pixelMax,d);}if(pixelMax>r.pixelDelta)changed++;maxDelta=Math.max(maxDelta,pixelMax);}
 const pixelCount=r.width*r.height,changedRatio=changed/pixelCount,meanAbsoluteError=total/(pixelCount*4);
 return {id:r.id,outcome:changedRatio<=r.maxChangedRatio&&meanAbsoluteError<=r.maxMeanAbsoluteError?'pass':'fail',metrics:{pixelCount,changedPixels:changed,changedRatio,meanAbsoluteError,maxChannelDelta:maxDelta},thresholds:{pixelDelta:r.pixelDelta,maxChangedRatio:r.maxChangedRatio,maxMeanAbsoluteError:r.maxMeanAbsoluteError},rectangle:{x:r.x,y:r.y,width:r.width,height:r.height}};
 });return {regions:results,diff:PNG.sync.write(diff,{filterType:4,deflateLevel:9,deflateStrategy:3})};
}
