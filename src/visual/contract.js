import path from 'node:path';
export const LIMITS=Object.freeze({requestBytes:1024*1024,pngBytes:64*1024*1024,videoBytes:2*1024**3,pixels:16*1024*1024,workPixels:128*1024*1024,frames:32,regions:128,timeoutMs:30000,timeMs:3600000});
export const visualError=(code,message)=>Object.assign(new Error(message),{code});
export function shape(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw visualError('visual_request_invalid',`Invalid ${label} fields`);}
function text(value,label,max=256){if(typeof value!=='string'||!value.length||value.length>max||/[\x00-\x1f]/.test(value))throw visualError('visual_request_invalid',`Invalid ${label}`);}
function integer(v,min,max,label){if(!Number.isSafeInteger(v)||v<min||v>max)throw visualError('visual_request_invalid',`Invalid ${label}`);}
function ratio(v,max,label){if(!Number.isFinite(v)||v<0||v>max)throw visualError('visual_request_invalid',`Invalid ${label}`);}
export function validateProfile(p){
 shape(p,['width','height','locale','platform','orientation','safeArea','colorSpace','renderPipeline','unityVersion','packageVersions','inputBackend','gpu'],'profile');
 integer(p.width,1,8192,'profile width');integer(p.height,1,8192,'profile height');if(p.width*p.height>LIMITS.pixels)throw visualError('visual_request_invalid','Profile pixel limit exceeded');
 text(p.locale,'locale',64);text(p.platform,'platform',128);
 for(const k of ['orientation','colorSpace','renderPipeline','unityVersion','inputBackend','gpu'])if(p[k]!==undefined)text(p[k],k);
 if(p.safeArea!==undefined){shape(p.safeArea,['x','y','width','height'],'safe area');rectangle(p.safeArea,p,'safe area');}
 if(p.packageVersions!==undefined){if(!p.packageVersions||typeof p.packageVersions!=='object'||Array.isArray(p.packageVersions)||Object.keys(p.packageVersions).length>128)throw visualError('visual_request_invalid','Invalid package versions');for(const [k,v] of Object.entries(p.packageVersions)){text(k,'package');text(v,'package version');}}
}
function rectangle(r,p,label){integer(r.x,0,p.width-1,`${label} x`);integer(r.y,0,p.height-1,`${label} y`);integer(r.width,1,p.width,`${label} width`);integer(r.height,1,p.height,`${label} height`);if(r.x+r.width>p.width||r.y+r.height>p.height)throw visualError('visual_request_invalid',`${label} exceeds profile`);}
function input(v,baseline){shape(v,baseline?['path','sha256','profile','provenance']:['path','sha256','profile'],'frame input');text(v.path,'input path',4096);if(!path.isAbsolute(v.path))throw visualError('visual_request_invalid','Visual input path must be absolute');if(v.sha256!==undefined&&!/^[a-f0-9]{64}$/.test(v.sha256))throw visualError('visual_request_invalid','Invalid input SHA256');validateProfile(v.profile);
 if(baseline){shape(v.provenance,['kind','build','source','approvedBy'],'baseline provenance');if(!['original','fixture','regression'].includes(v.provenance.kind))throw visualError('visual_request_invalid','Invalid baseline provenance kind');for(const k of ['build','source','approvedBy'])text(v.provenance[k],`baseline ${k}`,1024);}
}
export function validateVisualRequest(value){
 if(Buffer.byteLength(JSON.stringify(value)??'')>LIMITS.requestBytes)throw visualError('visual_request_invalid','Visual request exceeds byte limit');
 shape(value,['kind','schemaVersion','mode','screen','state','profile','requiredRegions','frames','ffmpegPath'],'visual request');
 if(value.kind!=='retoolkit-visual-request'||value.schemaVersion!==1||!['image','video'].includes(value.mode))throw visualError('visual_request_invalid','Unsupported visual request');
 text(value.screen,'screen');text(value.state,'state');validateProfile(value.profile);
 if(!Array.isArray(value.requiredRegions)||!value.requiredRegions.length||value.requiredRegions.length>LIMITS.regions)throw visualError('visual_request_invalid','Visual region scope must be nonempty and bounded');
 const regions=new Set();let pixels=0;
 for(const r of value.requiredRegions){shape(r,['id','x','y','width','height','pixelDelta','maxChangedRatio','maxMeanAbsoluteError'],'region');text(r.id,'region id',128);if(regions.has(r.id))throw visualError('visual_request_invalid','Duplicate region id');regions.add(r.id);rectangle(r,value.profile,'region');integer(r.pixelDelta,0,255,'region pixelDelta');ratio(r.maxChangedRatio,1,'region maxChangedRatio');ratio(r.maxMeanAbsoluteError,255,'region maxMeanAbsoluteError');pixels+=r.width*r.height;}
 if(!Array.isArray(value.frames)||!value.frames.length||value.frames.length>LIMITS.frames)throw visualError('visual_request_invalid','Visual frame scope must be nonempty and bounded');
 if((pixels+value.profile.width*value.profile.height)*value.frames.length>LIMITS.workPixels)throw visualError('visual_request_invalid','Visual region and diff work limit exceeded');
 const frames=new Set();for(const f of value.frames){shape(f,value.mode==='video'?['id','baseline','candidate','baselineTimeMs','candidateTimeMs']:['id','baseline','candidate'],'frame');text(f.id,'frame id',128);if(frames.has(f.id))throw visualError('visual_request_invalid','Duplicate frame id');frames.add(f.id);if(f.baseline!==null)input(f.baseline,true);input(f.candidate,false);if(value.mode==='video'){integer(f.baselineTimeMs,0,LIMITS.timeMs,'baseline frame time');integer(f.candidateTimeMs,0,LIMITS.timeMs,'candidate frame time');}}
 if(value.mode==='video'){text(value.ffmpegPath,'ffmpeg path',4096);if(!path.isAbsolute(value.ffmpegPath)||!/\.exe$/i.test(value.ffmpegPath)&&process.platform==='win32')throw visualError('visual_request_invalid','Explicit ffmpeg executable path required');}
 else if(value.ffmpegPath!==undefined)throw visualError('visual_request_invalid','ffmpegPath only applies to video');
 return structuredClone(value);
}
