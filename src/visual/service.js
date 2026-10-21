import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {fingerprint,fileIdentity,withWorkspaceLock} from '../state.js';
import {acquireToolchainRead} from '../toolchain/lease.js';
import {assertAssetPath,selectedAssetBinding} from '../assets/context.js';
import {locateUnityProject,verifyGraphFiles,UNITY_PROJECT_LIMITS} from '../assets/graph.js';
import {verifyStoredGraph} from '../assets/graph-storage.js';
import {publishJson} from '../artifacts.js';
import {validateVisualRequest,shape,LIMITS,visualError} from './contract.js';
import {decodePng,comparePng} from './png.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const relative=(workspace,file)=>path.relative(workspace,file).split(path.sep).join('/');
function boundedJson(file,max=LIMITS.requestBytes){assertAssetPath(file);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>max)throw visualError('visual_payload_limit','Visual JSON exceeds limit or is not a file');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file)).replace(/^\uFEFF/,''));}
function identity(file,max){assertAssetPath(file);let before;try{before=fs.lstatSync(file);}catch(error){if(error.code==='ENOENT')return {path:path.resolve(file),missing:true};throw error;}
 if(!before.isFile()||before.size>max)throw visualError('visual_input_invalid','Visual input is not a bounded regular file');const actual=fileIdentity(file),after=fs.lstatSync(file);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino)throw visualError('visual_input_stale','Visual input changed while hashing');return actual;}
function inputIdentity(input,max){const result=identity(input.path,max);if(!result.missing&&input.sha256!==undefined&&result.sha256!==input.sha256)throw visualError('visual_input_stale','Visual input SHA256 does not match the contract');return result;}
function sameIdentity(actual,expected){return fingerprint(actual)===fingerprint(expected);}
function readExact(record){const bytes=fs.readFileSync(assertAssetPath(record.path));if(bytes.length!==record.size||sha(bytes)!==record.sha256)throw visualError('visual_input_stale','Visual bytes changed after hashing');return bytes;}
async function snapshot(toolkit,name){
 const project=toolkit.read(name),result={projectSha256:fingerprint(project)};
 if(project.extractedPath&&project.nativeBinary&&project.metadata)result.selectedBinding=selectedAssetBinding(toolkit,name).binding;
 const graphPath=assertAssetPath(path.join(toolkit.workspace(name),'04_Notes/assets/graph.json'));
 if(fs.existsSync(graphPath)){const graph=boundedJson(graphPath,UNITY_PROJECT_LIMITS.maxStoredGraphBytes);result.graph=identity(graphPath,UNITY_PROJECT_LIMITS.maxStoredGraphBytes);const projectDir=await locateUnityProject(project.reconstructedSourceDir??path.join(toolkit.workspace(name),'05_ReconstructedSource'));verifyStoredGraph(graph,graphPath,{expectedStorage:project.assetReconstruction?.graphStorage});await verifyGraphFiles(projectDir,graph);result.graphRevision=graph.revision;}
 return result;
}
function aggregate(outcomes){return outcomes.includes('fail')?'fail':outcomes.includes('unverified')||!outcomes.length?'unverified':'pass';}
function summary(report,stale=false){return {operationId:report.operationId,state:stale?'unverified':report.comparison,visualFidelity:stale?'unverified':report.visualFidelity,regression:stale?'unverified':report.regression,interaction:'unverified',temporalBehavior:'unverified',coverage:report.coverage,stale,reportPath:report.reportPath,limitations:stale?[...report.limitations,'Saved comparison is stale: an input, source snapshot or artifact changed.']:report.limitations};}
function unknownFrame(frame,reason,regions,inputs){return {id:frame.id,outcome:'unverified',reason,...inputs,...(frame.baselineTimeMs===undefined?{}:{baselineTimeMs:frame.baselineTimeMs,candidateTimeMs:frame.candidateTimeMs}),regions:regions.map(r=>({id:r.id,outcome:'unverified',reason}))};}
async function ownedCreate(toolkit,name,request,deps){
 const workspace=assertAssetPath(toolkit.workspace(name)),sourceSnapshot=await snapshot(toolkit,name);
 const base=assertAssetPath(path.join(workspace,'04_Notes/visual'),workspace);fs.mkdirSync(base,{recursive:true});
 const operationId=randomUUID(),directory=assertAssetPath(path.join(base,operationId),workspace);fs.mkdirSync(directory,{mode:0o700});
 const reportPath=path.join(directory,'report.json'),artifacts=[],inputs=[],frames=[],privateSources=new Map();let sourceBytes=0;
 const remember=input=>{const known=inputs.find(i=>i.path===path.resolve(input.path));if(known){if(!known.missing&&input.sha256!==undefined&&input.sha256!==known.sha256)throw visualError('visual_input_stale','Conflicting visual input SHA256');return known;}const actual=inputIdentity(input,request.mode==='image'?LIMITS.pngBytes:LIMITS.videoBytes);sourceBytes+=actual.size??0;if(sourceBytes>(request.mode==='image'?512*1024**2:4*1024**3))throw visualError('visual_input_limit','Visual source byte budget exceeded');inputs.push(actual);return actual;};
 if(deps.requestFile)inputs.push(deps.requestFileIdentity??identity(deps.requestFile,LIMITS.requestBytes));
 const privateSource=source=>{if(privateSources.has(source.path))return privateSources.get(source.path);const folder=assertAssetPath(path.join(directory,'private-inputs'),workspace);fs.mkdirSync(folder,{recursive:true,mode:0o700});const target=assertAssetPath(path.join(folder,String(privateSources.size)+'.media'),workspace);fs.copyFileSync(source.path,target,fs.constants.COPYFILE_EXCL);const copied=identity(target,LIMITS.videoBytes);if(copied.size!==source.size||copied.sha256!==source.sha256)throw visualError('visual_input_stale','Video source changed during private snapshot');privateSources.set(source.path,target);return target;};
 let ffmpeg;
 if(request.mode==='video'){ffmpeg=identity(request.ffmpegPath,512*1024**2);if(ffmpeg.missing)throw visualError('visual_ffmpeg_missing','Explicit ffmpeg executable is missing');inputs.push(ffmpeg);}
 for(let index=0;index<request.frames.length;index++){
 const frame=request.frames[index],candidate=remember(frame.candidate),baseline=frame.baseline===null?null:remember(frame.baseline),records={baseline,candidate};
 if(!baseline||baseline.missing||candidate.missing){frames.push(unknownFrame(frame,!baseline||baseline.missing?'missing_baseline':'missing_candidate',request.requiredRegions,records));continue;}
 if(fingerprint(frame.baseline.profile)!==fingerprint(request.profile)||fingerprint(frame.candidate.profile)!==fingerprint(request.profile)){frames.push(unknownFrame(frame,'profile_mismatch',request.requiredRegions,records));continue;}
 let basePng,candidatePng,frameArtifacts={};
 try{
 if(request.mode==='video'){
 const {extractFrame}=await import('./video.js');
 for(const [side,source,timeMs] of [['baseline',baseline,frame.baselineTimeMs],['candidate',candidate,frame.candidateTimeMs]]){
 const output=assertAssetPath(path.join(directory,`${index}-${side}.png`),workspace);
 const capturedSource=privateSource(source);await extractFrame({executable:request.ffmpegPath,input:capturedSource,timeMs,output,profile:request.profile,...(deps.runFrame?{run:deps.runFrame}:{})});
 const actual=identity(output,LIMITS.pngBytes);if(actual.missing)throw visualError('visual_frame_missing','ffmpeg did not produce the requested frame');const artifact={path:relative(workspace,output),size:actual.size,sha256:actual.sha256};artifacts.push(artifact);frameArtifacts[side]=artifact;
 }
 basePng=decodePng(fs.readFileSync(path.join(workspace,frameArtifacts.baseline.path)));candidatePng=decodePng(fs.readFileSync(path.join(workspace,frameArtifacts.candidate.path)));
 }else{basePng=decodePng(readExact(baseline));candidatePng=decodePng(readExact(candidate));}
 }catch(error){if(error.code==='visual_input_stale'||!String(error.code??'').startsWith('visual_'))throw error;frames.push(unknownFrame(frame,error.code,request.requiredRegions,{...records,frameArtifacts}));continue;}
 if([basePng,candidatePng].some(p=>p.width!==request.profile.width||p.height!==request.profile.height)){frames.push(unknownFrame(frame,'image_geometry_mismatch',request.requiredRegions,{...records,frameArtifacts}));continue;}
 const compared=comparePng(basePng,candidatePng,request.requiredRegions),output=assertAssetPath(path.join(directory,`${index}-diff.png`),workspace);
 fs.writeFileSync(output,compared.diff,{flag:'wx',mode:0o600});const diff={path:relative(workspace,output),size:compared.diff.length,sha256:sha(compared.diff)};artifacts.push(diff);
 frames.push({id:frame.id,outcome:aggregate(compared.regions.map(r=>r.outcome)),baseline:{...baseline,provenance:frame.baseline.provenance},candidate,...(request.mode==='video'?{baselineTimeMs:frame.baselineTimeMs,candidateTimeMs:frame.candidateTimeMs,frameArtifacts}:{}),regions:compared.regions,diff});
 }
 // Rehash every selected input after processing, including ffmpeg and request JSON.
 for(const input of inputs)if(!sameIdentity(identity(input.path,input.path===request.ffmpegPath?512*1024**2:input.path===deps.requestFile?LIMITS.requestBytes:request.mode==='image'?LIMITS.pngBytes:LIMITS.videoBytes),input))throw visualError('visual_input_stale','Visual input changed during comparison');
 if(fingerprint(await snapshot(toolkit,name))!==fingerprint(sourceSnapshot))throw visualError('visual_input_stale','Source snapshot changed during comparison');
 for(const [source,target] of privateSources){const expected=inputs.find(i=>i.path===source),copied=identity(target,LIMITS.videoBytes);if(copied.sha256!==expected.sha256||copied.size!==expected.size)throw visualError('visual_input_stale','Private video source changed during extraction');fs.unlinkSync(assertAssetPath(target,workspace));}
 const outcomes=frames.flatMap(f=>f.regions.map(r=>r.outcome)),comparison=aggregate(outcomes),original=request.frames.every(f=>f.baseline?.provenance.kind==='original');
 const visualFidelity=aggregate(frames.map((f,i)=>request.frames[i].baseline?.provenance.kind==='original'?f.outcome:'unverified'));
 const regression=aggregate(frames.map((f,i)=>request.frames[i].baseline&&request.frames[i].baseline.provenance.kind!=='original'?f.outcome:'unverified'));
 const report={kind:'retoolkit-visual-report',schemaVersion:1,operationId,createdAt:new Date().toISOString(),request,requestSha256:fingerprint(request),sourceSnapshot,inputs,artifacts,profile:request.profile,mode:request.mode,screen:request.screen,state:request.state,comparison,visualFidelity,regression,interaction:'unverified',temporalBehavior:'unverified',coverage:{requested:outcomes.length,observed:outcomes.filter(v=>v!=='unverified').length,unknown:outcomes.filter(v=>v==='unverified').length,excluded:0},frames,reportPath:relative(workspace,reportPath),metric:{name:'absolute-rgba-v1',changedPixel:'maximum absolute RGBA channel difference exceeds region pixelDelta',meanAbsoluteError:'sum of absolute RGBA channel differences / (region pixels * 4)',diff:'maximum of absolute RGB and alpha differences in each RGB channel, opaque alpha; no scaling, registration, crop or mask'},maskPolicy:{mode:'none',excludedPixels:0},limitations:['Input provenance is supplied by the caller; original-game origin is not independently authenticated.','Only declared frames and pixel regions were compared; metrics do not establish text semantics, asset identity or interaction.','Static image and sampled video comparisons do not verify animation, transition ordering, input response or temporal behavior.',...(original?[]:['No complete original-game baseline set: visual fidelity remains unverified.'])]};
 report.payloadSha256=fingerprint(report);publishJson(reportPath,report,{maxBytes:16*1024**2});return summary(report);
}
export async function createVisualReport(toolkit,name,value,deps={}){
 const request=validateVisualRequest(value),workspace=assertAssetPath(toolkit.workspace(name)),lease=acquireToolchainRead(toolkit.root);
 try{return await withWorkspaceLock(workspace,()=>ownedCreate(toolkit,name,request,deps));}finally{lease.release();}
}
export async function runVisualComparison(toolkit,name,params){
 shape(params,['request','requestFile'],'visual parameters');if((params.request===undefined)===(params.requestFile===undefined))throw visualError('visual_request_invalid','Provide exactly one visual request or requestFile');
 if(params.requestFile===undefined)return createVisualReport(toolkit,name,params.request);
 if(typeof params.requestFile!=='string'||!path.isAbsolute(params.requestFile))throw visualError('visual_request_invalid','Visual requestFile must be absolute');
 const requestFileIdentity=identity(params.requestFile,LIMITS.requestBytes);if(requestFileIdentity.missing)throw visualError('visual_request_invalid','Visual request file is missing');
 const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readExact(requestFileIdentity)).replace(/^\uFEFF/,''));
 return createVisualReport(toolkit,name,value,{requestFile:params.requestFile,requestFileIdentity});
}
async function ownedRead(toolkit,name,params){
 shape(params,['operationId','section','limit','cursor'],'visual report parameters');if(!uuid(params.operationId))throw visualError('visual_request_invalid','Expected visual operation UUID');const section=params.section??'summary';if(!['summary','report','frames','findings'].includes(section))throw visualError('visual_request_invalid','Unknown visual report section');
 if(params.limit!==undefined&&(!Number.isSafeInteger(params.limit)||params.limit<1||params.limit>128))throw visualError('visual_request_invalid','Visual report page limit must be 1..128');
 if(params.cursor!==undefined&&(typeof params.cursor!=='string'||params.cursor.length>2048||!params.cursor.length))throw visualError('visual_cursor_invalid','Visual report cursor must be a bounded string');
 const workspace=assertAssetPath(toolkit.workspace(name)),file=assertAssetPath(path.join(workspace,'04_Notes/visual',params.operationId,'report.json'),workspace),report=boundedJson(file,16*1024**2),{payloadSha256,...payload}=report;
 if(report.kind!=='retoolkit-visual-report'||report.operationId!==params.operationId||fingerprint(payload)!==payloadSha256)throw visualError('visual_report_invalid','Visual report integrity check failed');
 let stale=false;try{stale=fingerprint(await snapshot(toolkit,name))!==fingerprint(report.sourceSnapshot)||report.inputs.some(i=>!sameIdentity(identity(i.path,Math.max(LIMITS.videoBytes,512*1024**2)),i))||report.artifacts.some(a=>!sameIdentity(identity(assertAssetPath(path.join(workspace,a.path),path.join(workspace,'04_Notes/visual',params.operationId)),LIMITS.pngBytes),{path:path.resolve(workspace,a.path),size:a.size,sha256:a.sha256}));}catch{stale=true;}
 const compact=summary(report,stale);if(section==='summary')return compact;
 if(section==='report'){if(Buffer.byteLength(JSON.stringify(report))>LIMITS.requestBytes)throw visualError('visual_payload_limit','Use paged frames or findings for this report');return {...report,stale,...(stale?{comparison:'unverified',visualFidelity:'unverified',regression:'unverified'}:{})};}
 const limit=params.limit??100;if(!Number.isSafeInteger(limit)||limit<1||limit>128)throw visualError('visual_request_invalid','Visual report page limit must be 1..128');let offset=0;if(params.cursor!==undefined){try{const c=JSON.parse(Buffer.from(params.cursor,'base64url').toString());if(c.hash!==payloadSha256||c.section!==section||!Number.isSafeInteger(c.offset)||c.offset<0)throw Error();offset=c.offset;}catch{throw visualError('visual_cursor_invalid','Stale or invalid visual report cursor');}}
 const rows=section==='frames'?report.frames:report.frames.flatMap(f=>f.regions.map(r=>({frameId:f.id,...r})));const items=rows.slice(offset,offset+limit);if(Buffer.byteLength(JSON.stringify(items))>LIMITS.requestBytes)throw visualError('visual_payload_limit','Reduce visual report page limit');return {...compact,items,nextCursor:offset+limit<rows.length?Buffer.from(JSON.stringify({hash:payloadSha256,section,offset:offset+limit})).toString('base64url'):null};
}

export async function readVisualReport(toolkit,name,params){const workspace=assertAssetPath(toolkit.workspace(name)),lease=acquireToolchainRead(toolkit.root);try{return await withWorkspaceLock(workspace,()=>ownedRead(toolkit,name,params));}finally{lease.release();}}
