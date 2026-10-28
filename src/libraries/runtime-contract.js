import {fingerprint} from '../state.js';
const check=(ok,message)=>{if(!ok)throw Object.assign(Error(message),{code:'runtime_provider_invalid'});};
const unique=(rows,key,label)=>{check(Array.isArray(rows)&&rows.length<=100000,'Invalid '+label);const map=new Map();for(const row of rows){check(row&&typeof row[key]==='string'&&!map.has(row[key]),'Missing or duplicate '+label);map.set(row[key],row);}return map;};
// Metadata compatibility is a staging precondition, never execution proof.
export function compareRuntimeProvider(before,after){
 check(before?.assembly&&after?.assembly,'Missing managed assembly identity');
 const blockers=[];const add=(code,subject)=>{if(blockers.length<1000)blockers.push({code,subject});};
 for(const key of ['name','culture','publicKeyToken'])if(before.assembly[key]!==after.assembly[key])add('assembly_identity_changed',key);
 const oldTypes=unique(before.types,'fullName','types'),newTypes=unique(after.types,'fullName','types');let improvedMethods=0,serializedFields=0,apiMethods=0;
 const implementationWarnings=[];
 function inheritedMethod(target,signature,visited=new Set()){
  check(!visited.has(target.fullName),'Cyclic managed inheritance');visited.add(target.fullName);
  const method=unique(target.methods,'signature','methods').get(signature);if(method)return method;
  if(signature.includes('::.ctor('))return undefined;
  const base=newTypes.get(target.baseType);return base?inheritedMethod(base,signature.replace(' '+target.fullName+'::',' '+base.fullName+'::'),visited):undefined;
 }
 for(const [name,type]of oldTypes){
  // Compiler generated implementation details are deliberately not an ABI.
  if(type.compilerGenerated&&!type.serializable&&!type.visible)continue;
  const target=newTypes.get(name);if(!target){add('type_missing',name);continue;}
  for(const key of ['baseType','genericArity','access'])if(type[key]!==target[key])add('type_contract_changed',name+':'+key);
  for(const key of ['visible','serializable'])if(type[key]===true&&target[key]!==true)add('type_contract_changed',name+':'+key);
  for(const key of ['isAbstract','isSealed'])if(type[key]===false&&target[key]===true)add('type_contract_changed',name+':'+key);
  for(const value of type.interfaces??[])if(!(target.interfaces??[]).includes(value))add('interface_missing',name+':'+value);
  const fields=unique(target.fields,'name','fields');
  for(const field of type.fields??[]){if(!field.serialized&&!field.api&&!type.isEnum)continue;const next=fields.get(field.name);if(!next||next.type!==field.type||next.isStatic!==field.isStatic||field.serialized&&!next.serialized||field.api&&(!next.api||field.access!==next.access||field.readOnly!==next.readOnly)||((type.isEnum||field.literal)&&fingerprint(next.constant)!==fingerprint(field.constant)))add('field_contract_changed',name+'::'+field.name);if(field.serialized)serializedFields++;}
  unique(target.methods,'signature','methods');
  for(const method of type.methods??[]){if(!method.api)continue;apiMethods++;const next=inheritedMethod(target,method.signature);if(!next||!next.api||method.access!==next.access||method.isStatic!==next.isStatic||method.isVirtual!==next.isVirtual||method.hasBody===true&&next.hasBody!==true||method.isFinal===false&&next.isFinal===true){add('method_contract_changed',method.signature);continue;}if(!method.stub&&next.stub&&implementationWarnings.length<1000)implementationWarnings.push({code:'body_became_trivial',subject:method.signature});if(method.stub&&!next.stub&&next.hasBody===true&&next.instructionCount>0)improvedMethods++;}
 }
 if(!improvedMethods)add('no_nontrivial_replacement','No formerly trivial public/protected method gains a nontrivial body');
 return {policy:'managed-provider-trial-v1',compatible:blockers.length===0,blockers,implementationWarnings,originalAssembly:before.assembly,replacementAssembly:after.assembly,versionTrial:before.assembly.version!==after.assembly.version,types:oldTypes.size,serializedFields,apiMethods,improvedMethods,runtimeVerified:false,limitations:['Trivial IL is a heuristic, not proof that a method is a stub.','Metadata/API compatibility does not prove serialized MonoScript IDs, dependency resolution, compilation or runtime behavior.','Fresh scoped Unity, data and feature behavior checks are required on the resulting candidate.']};
}
