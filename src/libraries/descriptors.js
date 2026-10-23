// Knowledge records are hints, never executable adapters or version claims.
// A custom record may add pins: [{archiveSha256, root, version, packageId?}].
// Only an exact hash/root pin may provide a missing release version.
export const libraryDescriptors = Object.freeze([
  // Local Yarn Fever!/threadscrew core snapshot; see libraries/dotween/README.md.
  {id:'dotween',aliases:['DOTween'],namespaces:['DG.Tweening'],assemblies:['DOTween'],pins:[{archiveSha256:'e50be4124b46cfcbceb300c8cc6b6cdaad8ca7f7a9365179979190cd4d2f26e0',root:'Assets',version:'1.2.335'}]},
  {id:'unitask',aliases:['UniTask'],namespaces:['Cysharp.Threading.Tasks'],assemblies:['UniTask']},
  {id:'newtonsoft-json',aliases:['Newtonsoft.Json','JSON.NET'],namespaces:['Newtonsoft.Json'],assemblies:['Newtonsoft.Json'],packageIds:['com.unity.nuget.newtonsoft-json']},
  {id:'textmeshpro',aliases:['TextMesh Pro','TMP'],namespaces:['TMPro'],assemblies:['Unity.TextMeshPro'],packageIds:['com.unity.textmeshpro']},
  {id:'cinemachine',aliases:['Cinemachine'],namespaces:['Cinemachine','Unity.Cinemachine'],packageIds:['com.unity.cinemachine']},
  {id:'input-system',aliases:['Input System'],namespaces:['UnityEngine.InputSystem'],packageIds:['com.unity.inputsystem']},
  {id:'urp',aliases:['Universal Render Pipeline'],namespaces:['UnityEngine.Rendering.Universal'],packageIds:['com.unity.render-pipelines.universal']},
  {id:'spine',aliases:['Spine'],namespaces:['Spine','Spine.Unity']},
  {id:'odin',aliases:['Odin Inspector'],namespaces:['Sirenix.OdinInspector','Sirenix.Serialization']},
  {id:'fairygui',aliases:['FairyGUI'],namespaces:['FairyGUI']}
].map(record=>Object.freeze(Object.fromEntries(Object.entries({pins:[],...record}).map(([key,value])=>[key,Array.isArray(value)?Object.freeze(value):value])))));

export function exactLibraryVersion(value){
  if(typeof value!=='string'||value.length>128)return false;
  const match=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  return !!match&&(!match[4]||match[4].split('.').every(id=>!/^\d+$/.test(id)||id==='0'||!id.startsWith('0')));
}

export function validatedDescriptors(custom=[]) {
  if(!Array.isArray(custom)||custom.length>256)throw Object.assign(Error('Library descriptors must be a bounded array.'),{code:'LIBRARY_DESCRIPTOR_INVALID'});
  const bounded=value=>typeof value==='string'&&value.length>0&&value.length<=512&&!/[\x00-\x1f]/.test(value);
  const allowed=new Set(['id','aliases','namespaces','assemblies','packageIds','pins']);
  let retainedBytes=0;
  function claim(value){retainedBytes+=Buffer.byteLength(value)+64;if(retainedBytes>1024**2)throw Object.assign(Error('Library descriptor metadata exceeds 1 MiB budget.'),{code:'LIBRARY_DESCRIPTOR_INVALID'});}
  for(const record of custom){
    if(!record||typeof record!=='object'||Array.isArray(record)||!bounded(record.id)||Object.keys(record).some(key=>!allowed.has(key)))throw Object.assign(Error('Invalid static library descriptor.'),{code:'LIBRARY_DESCRIPTOR_INVALID'});
    for(const key of ['aliases','namespaces','assemblies','packageIds'])if(record[key]!==undefined&&(!Array.isArray(record[key])||record[key].length>256||!record[key].every(bounded)))throw Object.assign(Error('Invalid library descriptor hints.'),{code:'LIBRARY_DESCRIPTOR_INVALID'});
    if(record.pins!==undefined&&(!Array.isArray(record.pins)||record.pins.length>256))throw Object.assign(Error('Invalid library descriptor pins.'),{code:'LIBRARY_DESCRIPTOR_INVALID'});
    for(const pin of record.pins??[])if(!pin||typeof pin!=='object'||Array.isArray(pin)||Object.keys(pin).some(key=>!['archiveSha256','root','version','packageId'].includes(key))||!/^[0-9a-f]{64}$/.test(pin.archiveSha256)||typeof pin.root!=='string'||!exactLibraryVersion(pin.version)||(pin.packageId!==undefined&&!bounded(pin.packageId)))throw Object.assign(Error('Invalid exact library descriptor pin.'),{code:'LIBRARY_DESCRIPTOR_INVALID'});
    claim(record.id);
    for(const key of ['aliases','namespaces','assemblies','packageIds'])for(const hint of record[key]??[])claim(hint);
    for(const pin of record.pins??[])for(const value of Object.values(pin))claim(value);
  }
  return [...libraryDescriptors,...JSON.parse(JSON.stringify(custom))];
}
