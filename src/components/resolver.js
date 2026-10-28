import {fingerprint} from '../state.js';
import {libraryDescriptors} from '../libraries/descriptors.js';
import {identityOf} from './registry.js';
import {isComponent} from './inventory.js';
export {inventoryComponents,isComponent} from './inventory.js';
export {enrichComponentGraph,componentTargets,targetId} from './registry.js';
export function libraryHints(type,catalog={packages:[]}){
 const descriptors=libraryDescriptors.filter(d=>(d.namespaces??[]).some(ns=>type.fullName?.startsWith(ns+'.'))||(d.assemblies??[]).includes(type.assembly));
 const available=(catalog.packages??[]).filter(p=>(p.identity?.types??[]).includes(type.fullName)||(type.assembly&&(p.identity?.assemblies??[]).includes(type.assembly))||descriptors.some(d=>d.id===p.libraryId)).map(p=>({id:p.id,libraryId:p.libraryId,version:p.version,installed:false}));
 const unique=new Map(available.filter(p=>p.version).map(p=>[p.libraryId+'@'+p.version,p]));
 const selected=unique.size===1?[...unique.values()][0]:null;
 return {versionPolicy:'available-first',available:available.slice(0,20),availableCount:available.length,descriptors:descriptors.map(d=>({id:d.id,packageIds:d.packageIds??[]})),...(selected?{nextAction:{operation:'libraries.plan',params:{requirements:{kind:'retoolkit-library-requirements',schemaVersion:1,packages:[{id:selected.libraryId,version:selected.version}]}}}}:{})};
}
export function resolveComponents({graph,observation,targets=[],mappings=[]}){
 const decisions=[];for(const node of graph.nodes.filter(isComponent)){
  const matches=observation?.components.filter(c=>c.componentId===node.id)??[],row=matches.length===1?matches[0]:null;
  const base={componentId:node.id,classID:node.classID};
  if(node.classID!==114){const observed=row?.native&&row.fullName&&row.assembly,matching=observed&&row.fullName.startsWith('UnityEngine.')&&row.fullName.split('.').at(-1)===node.type&&/^UnityEngine(?:\.|$)/.test(row.assembly);decisions.push({...base,state:observed?matching?'preserve':'conflict':'unverified',reason:observed&&!matching?'native-type-mismatch':'native-engine-component',fullName:row?.fullName??node.type,assembly:row?.assembly??null,writable:false});continue;}
  const from=row?.script,candidates=from?targets.filter(t=>t.fullName===from.fullName):[];
  if(!from||from.guid!==node.scriptRef?.guid||from.fileID!==node.scriptRef?.fileID){decisions.push({...base,state:'unverified',reason:'compiled-component-identity-required'});continue;}
  const chosen=mappings.find(m=>m.componentId===node.id),target=chosen?targets.find(t=>t.targetId===chosen.targetId):candidates.find(t=>fingerprint(identityOf(t))===fingerprint(from));
  if(!chosen&&candidates.length>1){decisions.push({...base,from,state:'conflict',reason:'duplicate-full-type',candidateCount:candidates.length});continue;}
  if(!target){decisions.push({...base,from,state:'missing',reason:chosen?'target-not-found':'no-exact-observed-target'});continue;}
  const same=fingerprint(identityOf(target))===fingerprint(from);
  const duplicate=(observation?.scripts??[]).filter(t=>t.fullName===target.fullName).length!==1;
  decisions.push({...base,from,to:identityOf(target),targetId:target.targetId,state:duplicate?'conflict':same?'preserve':target.writable?'rebind':'blocked',reason:duplicate?'duplicate-full-type':same?'exact-observed-identity':target.writable?'explicit-target':'target-not-in-writable-inventory',path:target.path});
 }
 return {decisions,counts:decisions.reduce((a,d)=>(a[d.state]=(a[d.state]??0)+1,a),{})};
}
