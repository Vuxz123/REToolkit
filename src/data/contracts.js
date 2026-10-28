import {createHash} from 'node:crypto';
const kinds=new Set(['Integer','Boolean','Float','String','ObjectReference','Enum','ArraySize','Character','Generic','ManagedReference','Vector2','Vector3','Vector4','Color','Rect','Bounds','Quaternion','Vector2Int','Vector3Int','RectInt','BoundsInt','FixedBufferSize']);
const fail=message=>{throw Object.assign(Error(message),{code:'data_observation_invalid'});};
function check(ok,message='Invalid ScriptableObject observation'){if(!ok)fail(message);}
function shape(v,keys){check(v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v)));const d=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>d[k]?.enumerable&&Object.hasOwn(d[k],'value')));}
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&v.isWellFormed()&&!/[\x00-\x1f\x7f]/.test(v);
const fileID=v=>typeof v==='string'&&/^(?:0|-?[1-9]\d*)$/.test(v)&&v.length<=20&&BigInt(v)>=-(1n<<63n)&&BigInt(v)<(1n<<63n);
function array(v,max){check(Array.isArray(v)&&v.length<=max&&Object.keys(v).length===v.length);for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));check(d&&Object.hasOwn(d,'value'));}}
const persistentReference=value=>value==='null'||typeof value==='string'&&/^[a-f0-9]{32}:-?(?:0|[1-9]\d*)$/i.test(value)&&fileID(value.slice(33))&&value.slice(33)!=='0';
function referenceAncestor(propertyPath,parents){for(let i=propertyPath.lastIndexOf('.');i>=0;i=propertyPath.lastIndexOf('.',i-1))if(parents.has(propertyPath.slice(0,i)))return true;return false;}
export function validateDataSnapshot(value,assetId){
 shape(value,['policy','complete','unsupportedProperties','objects']);check(['scriptable-data-v1','scriptable-data-v2'].includes(value.policy)&&typeof value.complete==='boolean'&&Number.isSafeInteger(value.unsupportedProperties)&&value.unsupportedProperties>=0);
 array(value.objects,10000);const ids=new Set();let unsupported=0,properties=0,bytes=0;
 if(assetId!==undefined)check(/^asset:[a-f0-9]{32}$/i.test(assetId),'Data assets require a stable exported GUID');
 for(const o of value.objects){
  shape(o,['guid','fileID','fullName','assembly','scriptable','complete','properties']);check(typeof o.guid==='string'&&/^[a-f0-9]{32}$/i.test(o.guid)&&fileID(o.fileID)&&text(o.fullName,2048)&&text(o.assembly,512)&&typeof o.scriptable==='boolean'&&typeof o.complete==='boolean');
  if(assetId)check(o.guid.toLowerCase()===assetId.slice(6).toLowerCase(),'Observed object belongs to another asset');
  const key=o.guid.toLowerCase()+':'+o.fileID;check(!ids.has(key),'Duplicate serialized object identity');ids.add(key);array(o.properties,100000);check(o.scriptable||o.properties.length===0,'Non-ScriptableObject property scope is unsupported');
  const paths=new Set();let missing=0;
  for(const p of o.properties){
   shape(p,['path','kind','type','value']);check(++properties<=100000,'Data property budget exceeded');check(text(p.path,2048)&&text(p.kind,64)&&text(p.type,512)&&!paths.has(p.path),'Invalid or duplicate serialized property');paths.add(p.path);
   check(p.value===null||typeof p.value==='string'&&p.value.isWellFormed()&&Buffer.byteLength(p.value)<=32768,'Property values must be bounded exact strings');
   if(p.value===null){unsupported++;missing++;}else check(kinds.has(p.kind),'Unknown property kind cannot establish complete data');
   bytes+=Buffer.byteLength(p.path)+Buffer.byteLength(p.type)+Buffer.byteLength(p.value??'')+128;check(bytes<=8*1024**2,'Data observation exceeds byte budget');
  }
  check(!o.complete||!missing,'Complete object contains unsupported properties');
  if(value.policy==='scriptable-data-v2'){
   const parents=new Set(o.properties.filter(p=>p.kind==='ObjectReference').map(p=>p.path));
   for(const p of o.properties){check(!referenceAncestor(p.path,parents),'Atomic ObjectReference contains transport descendants');if(p.kind==='ObjectReference'&&p.value!==null)check(persistentReference(p.value),'Invalid persistent ObjectReference identity');}
  }
 }
 check(unsupported===value.unsupportedProperties,'Unsupported property coverage differs');
 check(!value.complete||value.objects.every(o=>o.complete)&&!unsupported,'Complete snapshot has partial object coverage');return value;
}
export function canonicalData(snapshot){
 validateDataSnapshot(snapshot);return snapshot.objects.map(o=>({...o,guid:o.guid.toLowerCase(),properties:[...o.properties].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0)})).sort((a,b)=>(a.guid+':'+a.fileID).localeCompare(b.guid+':'+b.fileID));
}
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function valuePreview(value,kind){
 if(value===null)return null;let display;
 if(['Float','Vector2','Vector3','Vector4','Color','Rect','Bounds','Quaternion'].includes(kind)&&value.split(';').every(v=>/^f32:[a-f0-9]{8}$|^f64:[a-f0-9]{16}$/.test(v))){
  display=value.split(';').map(v=>{const bits=Buffer.from(v.slice(4),'hex'),number=v.startsWith('f32:')?bits.readFloatBE():bits.readDoubleBE();return Object.is(number,-0)?'-0':String(number);}).join(', ');
 }
 return {preview:value.slice(0,512),...(display===undefined?{}:{display}),bytes:Buffer.byteLength(value),sha256:digest(value),truncated:value.length>512};
}
export function compareDataSnapshots(baseline,current,{referencePolicy='exact-v1'}={}){
 check(['exact-v1','persistent-object-reference-v1'].includes(referencePolicy),'Unknown data comparison policy');
 const normalization={policy:referencePolicy,excludedBefore:0,excludedAfter:0};
 const project=(rows,side)=>rows.map(row=>{validateDataSnapshot(row.data,row.assetId);return {...row,data:{...row.data,objects:row.data.objects.map(o=>{for(const p of o.properties)if(p.kind==='ObjectReference'&&p.value!==null)check(persistentReference(p.value),'Atomic comparison requires a persistent reference identity');const parents=new Set(o.properties.filter(p=>p.kind==='ObjectReference'&&persistentReference(p.value)).map(p=>p.path));return {...o,properties:o.properties.filter(p=>{if(p.value===null||!referenceAncestor(p.path,parents))return true;normalization[side]++;return false;})};})}};});
 if(referencePolicy!=='exact-v1'){baseline=project(baseline,'excludedBefore');current=project(current,'excludedAfter');}
 const differences=[],counts={schema:0,values:0,references:0};let differenceCount=0;
 const add=(kind,assetId,objectId,propertyPath,before,after)=>{differenceCount++;if(before?.kind==='ObjectReference'||after?.kind==='ObjectReference')counts.references++;if(kind==='value_changed')counts.values++;else counts.schema++;if(differences.length<1000)differences.push({kind,assetId,objectId,propertyPath,...(before?{before:typeof before.value==='string'||before.value===null?{kind:before.kind,type:before.type,value:valuePreview(before.value,before.kind)}:before}:{}),...(after?{after:typeof after.value==='string'||after.value===null?{kind:after.kind,type:after.type,value:valuePreview(after.value,after.kind)}:after}:{})});};
 const index=rows=>{const map=new Map();for(const row of rows){check(!map.has(row.assetId),'Duplicate data asset');validateDataSnapshot(row.data,row.assetId);map.set(row.assetId,row);}return map;},a=index(baseline),b=index(current);
 for(const assetId of [...new Set([...a.keys(),...b.keys()])].sort()){
  const left=a.get(assetId),right=b.get(assetId);if(!left||!right){add(left?'asset_missing':'asset_added',assetId,null,null,null,null);continue;}
  const objects=rows=>new Map(canonicalData(rows.data).map(o=>[o.guid+':'+o.fileID,o])),before=objects(left),after=objects(right);
  for(const id of [...new Set([...before.keys(),...after.keys()])].sort()){
   const x=before.get(id),y=after.get(id);if(!x||!y){add(x?'object_missing':'object_added',assetId,id,null,null,null);continue;}
   if(x.fullName!==y.fullName||x.assembly!==y.assembly||x.scriptable!==y.scriptable)add('object_type_changed',assetId,id,null,{fullName:x.fullName,assembly:x.assembly},{fullName:y.fullName,assembly:y.assembly});
   const px=new Map(x.properties.map(p=>[p.path,p])),py=new Map(y.properties.map(p=>[p.path,p]));
   for(const key of [...new Set([...px.keys(),...py.keys()])].sort()){
    const p=px.get(key),q=py.get(key);if(!p||!q)add(p?'property_missing':'property_added',assetId,id,key,p,q);
    else if(p.kind!==q.kind||p.type!==q.type||['Enum','ManagedReference'].includes(p.kind)&&p.value?.slice(p.value.indexOf(':')+1)!==q.value?.slice(q.value.indexOf(':')+1))add('property_type_changed',assetId,id,key,p,q);
    else if(p.value!==q.value)add('value_changed',assetId,id,key,p,q);
   }
  }
 }
 const complete=baseline.length>0&&current.length>0&&baseline.every(r=>r.data.complete)&&current.every(r=>r.data.complete);
 return {complete,dataPreserved:complete&&differenceCount===0,differenceCount,differences,differencesTruncated:differenceCount>differences.length,counts,...(referencePolicy==='exact-v1'?{}:{normalization})};
}
