import {validateDataSnapshot} from '../data/contracts.js';
const MAX_JSON=16*1024*1024,MAX_REQUESTED=10000,MAX_COUNT=200000;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const version=value=>typeof value==='string'&&/^\d{4}\.\d+\.\d+[abfp]\d+(?:c\d+)?$/.test(value);
const integer=(value,max=MAX_COUNT)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const text=(value,max=2048)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\x00-\x1f\x7f]/.test(value);
function check(condition,message='Invalid Unity observation report'){
  if(!condition)throw Object.assign(new Error(message),{code:'unity_report_invalid'});
}
// Inspect descriptors before reading values: even programmatic callers must not
// smuggle getters, inherited fields, toJSON hooks, or non-JSON properties through.
function shape(value,allowed,required=allowed){
  check(value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
  const keys=Reflect.ownKeys(value);check(keys.every(key=>typeof key==='string'&&allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key)));
  for(const key of keys){const descriptor=Object.getOwnPropertyDescriptor(value,key);check(descriptor.enumerable&&Object.hasOwn(descriptor,'value'));}
}
function array(value,max){
  check(Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length<=max);
  check(Reflect.ownKeys(value).length===value.length+1);
  for(let i=0;i<value.length;i++){const descriptor=Object.getOwnPropertyDescriptor(value,String(i));check(descriptor?.enumerable&&Object.hasOwn(descriptor,'value'));}
}
function assetPath(value,extension){
  check(text(value)&&value.startsWith('Assets/')&&!/[\\:*?"<>|]/.test(value),'Invalid Unity observation Assets path');
  for(const part of value.split('/'))check(part&&part!=='.'&&part!=='..'&&!/[. ]$/.test(part)&&!/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part),'Invalid Unity observation Assets path');
  if(extension)check(value.toLowerCase().endsWith(extension),'Invalid Unity observation asset extension');
}
function fileID(value){
  if(typeof value!=='string'||value.length>20||! /^(?:0|-?[1-9]\d*)$/.test(value))return false;
  const number=BigInt(value);return number>=-(1n<<63n)&&number<=(1n<<63n)-1n;
}
function binding(value){
  shape(value,['native','metadata','assetsSha256','program','projectName'],['native','metadata','assetsSha256']);
  for(const key of ['native','metadata']){shape(value[key],['sha256','size']);check(hash(value[key].sha256)&&integer(value[key].size,Number.MAX_SAFE_INTEGER));}
  check(hash(value.assetsSha256));
  for(const key of ['program','projectName'])if(Object.hasOwn(value,key))check(text(value[key])&&!/[\\/]/.test(value[key]));
}
function requestRows(rows,script,ids,paths){
  array(rows,MAX_REQUESTED);const result=new Map();
  for(const row of rows){
    shape(row,script?['assetId','path']:['assetId','path','kind']);check(text(row.assetId));
    if(!script)check(['scene','prefab','asset'].includes(row.kind));
    assetPath(row.path,script?'.cs':{scene:'.unity',prefab:'.prefab',asset:'.asset'}[row.kind]);
    check(!ids.has(row.assetId)&&!paths.has(row.path),'Duplicate Unity validation request identity/path');
    ids.add(row.assetId);paths.add(row.path);result.set(row.assetId,row);
  }
  return result;
}
export function validateUnityRequest(value){
  shape(value,['kind','schemaVersion','runId','graphRevision','binding','unityVersion','scripts','assets','scanPolicy','dataCapture'],['kind','schemaVersion','runId','graphRevision','binding','unityVersion','scripts','assets']);
  check(value.kind==='retoolkit-unity-validation-request'&&value.schemaVersion===1&&uuid(value.runId)&&hash(value.graphRevision)&&version(value.unityVersion),'Invalid Unity validation request binding');
  if(Object.hasOwn(value,'scanPolicy'))check(value.scanPolicy==='reference-scan-v2','Unknown Unity traversal policy');
  binding(value.binding);const ids=new Set(),paths=new Set();
  const scripts=requestRows(value.scripts,true,ids,paths),assets=requestRows(value.assets,false,ids,paths);
  if(Object.hasOwn(value,'dataCapture'))check(typeof value.dataCapture==='boolean','Invalid data capture policy');
  if(value.dataCapture)check(assets.size>0&&assets.size<=64&&[...assets.values()].every(a=>a.kind==='asset'&&/^asset:[a-f0-9]{32}$/i.test(a.assetId)),'Data capture requires 1..64 stable .asset IDs');
  for(const row of assets.values())if(row.kind==='asset')check(value.scanPolicy==='reference-scan-v2','Data assets require explicit traversal policy');
  return {scripts,assets};
}
function traversal(value){
  shape(value,['complete','objects','properties','skippedSubtrees','stopReason','objectPath','componentType','propertyPath']);
  check(typeof value.complete==='boolean'&&integer(value.objects)&&integer(value.properties,2000000)&&integer(value.skippedSubtrees,2000000)&&value.skippedSubtrees<=value.properties,'Invalid Unity traversal counters');
  check(value.complete?value.stopReason==='':['property_limit','object_limit','asset_error','interrupted'].includes(value.stopReason),'Invalid Unity traversal completion');
  for(const key of ['objectPath','componentType','propertyPath'])check(typeof value[key]==='string'&&value[key].length<=2048&&!/[\x00-\x1f\x7f]/.test(value[key]),'Invalid Unity traversal location');
}
function observedRows(rows,expected,complete,script,extended,dataCapture=false){
  array(rows,MAX_REQUESTED);const seen=new Set();
  for(const row of rows){
    const required=script?['assetId','path','guid','fileID','fullName','assembly','resolved']:['assetId','path','kind','loaded','missingScripts','missingReferences'];
    shape(row,[...required,script?'classification':'traversal',...(script?['nonAttachableTypes']:[]),...(!script&&dataCapture?['data']:[])],required);
    const requested=expected.get(row.assetId);check(requested&&!seen.has(row.assetId)&&row.path===requested.path,'Unrequested or duplicate Unity observation identity/path');seen.add(row.assetId);
    if(script){
      check(typeof row.resolved==='boolean');
      const actualIdentity=typeof row.guid==='string'&&/^[a-f0-9]{32}$/i.test(row.guid)&&fileID(row.fileID);
      const actualClass=text(row.fullName)&&text(row.assembly);
      const compiledSource=row.classification==='compiled-source';
      check(row.resolved?actualIdentity&&actualClass:(actualIdentity||(row.guid===null&&row.fileID===null))&&(actualClass||(row.fullName===null&&(row.assembly===null||compiledSource&&text(row.assembly)))),'Invalid Unity MonoScript identity');
      if(Object.hasOwn(row,'classification')){
        check(extended&&['attachable','non-attachable','compiled-source','unresolved'].includes(row.classification),'Invalid Unity script classification');
        if(row.classification==='attachable'||row.classification==='non-attachable')check(actualIdentity&&actualClass&&row.resolved,'Classified Unity script lacks observed type identity');
        if(compiledSource)check(!row.resolved&&actualIdentity&&row.fullName===null&&text(row.assembly),'Compiled source lacks compiler assembly identity');
        if(row.classification==='unresolved')check(!row.resolved,'Unresolved script cannot be resolved');
      }
      if(Object.hasOwn(row,'nonAttachableTypes')){
        check(extended&&row.resolved&&['attachable','non-attachable'].includes(row.classification),'Reflected type inventory requires resolved script classification');
        array(row.nonAttachableTypes,1024);
        check(row.nonAttachableTypes.every(name=>text(name))&&new Set(row.nonAttachableTypes).size===row.nonAttachableTypes.length,'Invalid reflected non-attachable type inventory');
        check(row.nonAttachableTypes.includes(row.fullName)===(row.classification==='non-attachable'),'Reflected root type contradicts script classification');
      }
      if(actualIdentity&&/^asset:[a-f0-9]{32}$/i.test(row.assetId))check(row.guid.toLowerCase()===row.assetId.slice(6).toLowerCase(),'Unity MonoScript GUID does not match requested asset');
    }else{
      if(dataCapture){check(Object.hasOwn(row,'data'),'Requested data observation is missing');validateDataSnapshot(row.data,row.assetId);if(row.data.complete)check(row.loaded&&row.traversal?.complete&&row.data.objects.length===row.traversal.objects,'Complete data object coverage contradicts traversal');}
      check(row.kind===requested.kind&&typeof row.loaded==='boolean'&&integer(row.missingScripts)&&integer(row.missingReferences),'Invalid Unity serialized asset observation');
      if(extended){check(Object.hasOwn(row,'traversal'),'Extended Unity asset lacks traversal');traversal(row.traversal);check(!row.traversal.complete||row.loaded,'Unloaded asset cannot be traversal complete');check(!complete||row.traversal.complete,'Complete Unity observation has incomplete traversal');}
      else check(!Object.hasOwn(row,'traversal'),'Traversal lacks versioned policy');
    }
  }
  check(!complete||seen.size===expected.size,'Complete Unity observation omits requested assets');
}

/** Validate untrusted Editor output. Completeness is coverage, never readiness. */
export function validateUnityObservation(report,request){
  try{
    const expected=validateUnityRequest(request);
    const required=['kind','schemaVersion','runId','graphRevision','unityVersion','complete','compilation','scripts','assets','diagnostics'];
    shape(report,[...required,'traversal'],required);
    check(report.kind==='retoolkit-unity-observation'&&report.schemaVersion===1&&report.runId===request.runId&&report.graphRevision===request.graphRevision&&report.unityVersion===request.unityVersion,'Unity observation does not match expected run/revision/Editor');
    check(typeof report.complete==='boolean');shape(report.compilation,['state']);check(['succeeded','failed'].includes(report.compilation.state));
    const extended=Object.hasOwn(report,'traversal');
    for(const row of expected.assets.values())if(row.kind==='asset')check(extended,'Data assets require extended traversal observations');
    if(extended){shape(report.traversal,['policy']);check(request.scanPolicy==='reference-scan-v2'&&report.traversal.policy===request.scanPolicy,'Unknown Unity traversal policy');}
    observedRows(report.scripts,expected.scripts,report.complete,true,extended);observedRows(report.assets,expected.assets,report.complete,false,extended,request.dataCapture===true);
    array(report.diagnostics,1000);
    for(const diagnostic of report.diagnostics){
      shape(diagnostic,['severity','message','path']);check(['error','warning','info'].includes(diagnostic.severity)&&typeof diagnostic.message==='string'&&diagnostic.message.length<=8192,'Invalid Unity observation diagnostic');
      check(typeof diagnostic.path==='string');if(diagnostic.path!=='')assetPath(diagnostic.path);
    }
    check(Buffer.byteLength(JSON.stringify(report),'utf8')<=MAX_JSON,'Unity observation report exceeds 16 MiB limit');
    return report;
  }catch(error){
    if(error?.code==='unity_report_invalid')throw error;
    throw Object.assign(new Error('Invalid Unity observation report'),{code:'unity_report_invalid'});
  }
}
