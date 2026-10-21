import {timingSafeEqual} from 'node:crypto';
export {BridgeError,createFrameDecoder} from '../ghidra/protocol.js';
import {BridgeError} from '../ghidra/protocol.js';
export const VERSION=1,REQUEST_LIMIT=64*1024,RESPONSE_LIMIT=2*1024*1024;
export const methods=new Set(['session.status','session.stop','assets.export','assets.raw','operation']);
export function validateRequest(request,config) {
 if(request.version!==VERSION||request.runId!==config.runId||typeof request.id!=='string'||request.id.length>64||!methods.has(request.method))throw new BridgeError('invalid_request','Unsupported asset bridge request');
 if(typeof request.token!=='string'||request.token.length!==config.token.length||!timingSafeEqual(Buffer.from(request.token),Buffer.from(config.token)))throw new BridgeError('authentication_failed','Asset bridge authentication failed');
 if(!request.params||typeof request.params!=='object'||Array.isArray(request.params))throw new BridgeError('invalid_argument','Parameters must be an object');
}
export function requestFrame(binding,id,method,params) {
 if(!methods.has(method))throw new BridgeError('invalid_request','Unsupported asset bridge method');
 const frame=JSON.stringify({version:VERSION,runId:binding.runId,token:binding.token,id,method,params})+'\n';
 if(Buffer.byteLength(frame)-1>REQUEST_LIMIT)throw new BridgeError('request_limit','Request exceeds 64 KiB limit; use a disk plan');return frame;
}
export function sourcePath(params) {
 const keys=Object.keys(params);if(keys.some(k=>!['format','bundle','collection','pathID'].includes(k)))throw new BridgeError('invalid_argument','Unknown raw asset parameter');
 const {format,bundle,collection,pathID}=params;
 const formats={json:'/Assets/Json',yaml:'/Assets/Yaml',text:'/Assets/Text',binary:'/Assets/Binary',image:'/Assets/Image',audio:'/Assets/Audio',model:'/Assets/Model.glb',font:'/Assets/Font',video:'/Assets/Video'};
 if(!Object.hasOwn(formats,format))throw new BridgeError('invalid_argument','Unknown raw asset format');
 if(!Array.isArray(bundle)||bundle.length>64||bundle.some(n=>!Number.isInteger(n)||n<0||n>2147483647)||!Number.isInteger(collection)||collection<0||collection>2147483647)throw new BridgeError('invalid_argument','Bundle and collection must be nonnegative Int32 selectors');
 if(typeof pathID!=='string'||! /^-?(0|[1-9]\d{0,18})$/.test(pathID)||BigInt(pathID)<-(1n<<63n)||BigInt(pathID)>(1n<<63n)-1n)throw new BridgeError('invalid_argument','PathID must be a signed 64-bit decimal string');
 // .NET AssetPath expects a numeric JSON token. Never round it through Number.
 return {route:formats[format],path:`{"C":{"B":{"P":${JSON.stringify(bundle)}},"I":${collection}},"D":${pathID}}`,binary:!['json','yaml','text'].includes(format)};
}
