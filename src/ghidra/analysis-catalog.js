import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fingerprint,reusable} from '../state.js';
import {stepFingerprint} from '../inputs.js';
import {assertAssetPath} from '../assets/context.js';
import {BridgeError} from './protocol.js';

const boundary=(value,roots)=>roots.some(root=>value===root||value.startsWith(root+'.'));
export function classifyAnalysisTarget({namespace='',type='',assembly=''}){
 if(boundary(namespace,['GoogleMobileAds','AppLovin','MaxSdk','IronSource','UnityEngine.Advertisements','Unity.Services.Analytics','Unity.Analytics','Firebase.Analytics','AppsFlyerSDK','com.adjust.sdk','AdjustSdk','GameAnalyticsSDK','Facebook.Unity'])||['GoogleMobileAds','AppLovinSDK','IronSource','AppsFlyer','GameAnalytics'].includes(assembly.replace(/\.dll$/,'')))return {category:'sdk-excluded',classificationReason:'Recognized ads/telemetry SDK namespace or assembly; inspect game-side callbacks separately'};
 if(boundary(namespace,['UnityEngine','System','DG.Tweening','Cysharp.Threading.Tasks','TMPro','Unity.Mathematics']))return {category:'support',classificationReason:'Supporting engine/runtime/library; follow only when gameplay requires it'};
 if(/(?:Board|Level|Input|Player|Slot|Box|Item|Puzzle|Match|Grid|Enemy|Inventory|Game)(?:Manager|Controller|System|Logic|State|Model)$/.test(type))return {category:'gameplay-candidate',classificationReason:'Gameplay type-name hint; confirm against scene bindings and behavior'};
 return {category:'unknown',classificationReason:'No conclusive classification; retained for agent inspection'};
}
// Metadata declarations only. Do not infer extents from adjacent method addresses.
export async function* parseMethodCatalog(lines){
 let namespace='',type='',assembly='',pending;const images=[];
 for await(const line of lines){
  const image=/^\/\/ Image \d+: (.+?)\.dll - (\d+)\s*$/.exec(line);if(image){const start=Number(image[2]);if(Number.isSafeInteger(start))images.push({assembly:image[1],start});continue;}
  const ns=/^\/\/ Namespace:\s*(.*)$/.exec(line);if(ns){namespace=ns[1].trim();type='';assembly='';pending=undefined;continue;}
  const td=/\b(?:class|struct|interface)\s+(.+?)\s*(?:\s+:.*?)?\s*\/\/ TypeDefIndex:\s*(\d+)/.exec(line);if(td){type=td[1].trim();const index=Number(td[2]);assembly=images.filter(image=>image.start<=index).sort((a,b)=>b.start-a.start)[0]?.assembly??'';pending=undefined;continue;}
  const addr=/\/\/ RVA:\s*(0x[\da-fA-F]+)\s+Offset:\s*0x[\da-fA-F]+\s+VA:\s*(0x[\da-fA-F]+)/.exec(line);
  if(addr){pending={rva:addr[1],va:addr[2]};continue;}
  if(!pending||!line.trim()||line.trim().startsWith('['))continue;
  const method=/([^\s(]+)\s*\(/.exec(line);if(method&&BigInt(pending.rva)!==0n){yield {namespace,type,assembly:assembly||null,method:method[1],...pending,...classifyAnalysisTarget({namespace,type,assembly})};}
  pending=undefined;
 }
}
async function* lines(file,hash){
 const decoder=new TextDecoder('utf-8',{fatal:true});let pending='';
 for await(const chunk of fs.createReadStream(file,{highWaterMark:65536})){
  hash.update(chunk);pending+=decoder.decode(chunk,{stream:true});let at;
  while((at=pending.indexOf('\n'))!==-1){if(at>65536)throw new BridgeError('request_limit','Dump declaration line exceeds 64 KiB');yield pending.slice(0,at).replace(/\r$/,'');pending=pending.slice(at+1);}
  if(pending.length>65536)throw new BridgeError('request_limit','Dump declaration line exceeds 64 KiB');
 }
 pending+=decoder.decode();if(pending)yield pending.replace(/\r$/,'');
}
export async function analysisTargets(toolkit,name,params={}){
 const focus=params.focus??'gameplay',query=params.query??'',limit=params.limit??100;
 if(!['gameplay','all'].includes(focus)||typeof query!=='string'||query.length>2048||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw new BridgeError('invalid_argument','Invalid target catalog focus, query or limit');
 const project=toolkit.read(name),workspace=toolkit.workspace(name);
 const dumpFingerprint=stepFingerprint(project,'dump',toolkit.tools,toolkit.root);
 if(!reusable(project,'dump',dumpFingerprint))throw new BridgeError('input_changed','A current verified IL2CPP dump is required for the method catalog');
 const file=assertAssetPath(path.join(project.il2cppDumperOutput,'dump.cs'),workspace),before=fs.lstatSync(file);
 if(!before.isFile()||before.nlink!==1||before.size>128*1024**2)throw new BridgeError('request_limit','Dump catalog input must be a regular file within 128 MiB');
 let offset=0,cursor;
 if(params.cursor!==undefined){try{cursor=JSON.parse(Buffer.from(params.cursor,'base64url').toString());if(cursor.focus!==focus||cursor.query!==query||!Number.isSafeInteger(cursor.offset)||cursor.offset<0)throw Error();offset=cursor.offset;}catch{throw new BridgeError('invalid_cursor','Target cursor does not bind this query');}}
 const items=[],counts={total:0,excluded:0,visible:0},hash=createHash('sha256');let bytes=0,pageFull=false;
 for await(const row of parseMethodCatalog(lines(file,hash))){counts.total++;if(row.category==='sdk-excluded'){counts.excluded++;if(focus==='gameplay')continue;}if(query&&!`${row.assembly??''}.${row.namespace}.${row.type}.${row.method}`.toLowerCase().includes(query.toLowerCase()))continue;if(counts.visible++>=offset&&!pageFull){const length=Buffer.byteLength(JSON.stringify(row));if(items.length===limit||bytes+length>1024**2){pageFull=true;continue;}items.push(row);bytes+=length;}}
 const after=fs.lstatSync(file);if(['dev','ino','size','mtimeMs','ctimeMs'].some(key=>before[key]!==after[key]))throw new BridgeError('input_changed','Dump changed while reading target catalog');
 const current=toolkit.read(name);if(current.il2cppDumperOutput!==project.il2cppDumperOutput||stepFingerprint(current,'dump',toolkit.tools,toolkit.root)!==dumpFingerprint)throw new BridgeError('input_changed','Selected native/metadata or dumper changed during target discovery');
 const revision=fingerprint({dump:hash.digest('hex'),native:project.identities?.native?.sha256,metadata:project.identities?.metadata?.sha256});
 if(cursor&&cursor.revision!==revision)throw new BridgeError('revision_conflict','Target catalog changed; start a fresh page');
 return {items,revision,focus,counts,nextCursor:offset+items.length<counts.visible?Buffer.from(JSON.stringify({revision,focus,query,offset:offset+items.length})).toString('base64url'):null,coverage:'metadata-only',limitations:['Classification is a hint, unknown code remains visible. No method bounds, global callers or complete xrefs are inferred.','Use the explicit RVA/VA mapping and inspect bytes before choosing an inclusive analysis range.']};
}
