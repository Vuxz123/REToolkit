import {createHash} from 'node:crypto';
import {fingerprint} from '../state.js';
import {check} from '../recovery/artifacts.js';
// m_GameObject is the serialized distinction between a component and an SO.
// Stripped/opaque rows without that evidence remain outside this inventory.
export const isComponent=n=>n.classID!==1&&n.fields?.m_GameObject?.fileID!==undefined&&String(n.fields.m_GameObject.fileID)!=='0';
export function inventoryComponents(nodes,{sampleLimit=20}={}){
 check(Number.isInteger(sampleLimit)&&sampleLimit>=0&&sampleLimit<=64,'Invalid component sample budget');
 const groups=new Map();let total=0;const digest=createHash('sha256');
 for(const n of nodes){if(!isComponent(n))continue;total++;const identity=n.classID===114?{classID:114,script:n.scriptRef??null}:{classID:n.classID,type:n.type};
  const key=fingerprint(identity);let group=groups.get(key);if(!group){check(groups.size<10000,'Component type inventory exceeds 10000 groups','components_inventory_limit');group={groupId:key,...identity,count:0,instances:[]};groups.set(key,group);}
  group.count++;digest.update(JSON.stringify({id:n.id,...identity})+'\n');if(group.instances.length<sampleLimit)group.instances.push(n.id);
 }
 const rows=[...groups.values()].sort((a,b)=>a.groupId.localeCompare(b.groupId));return {total,groups:rows,samplesComplete:rows.every(g=>g.count===g.instances.length),inventorySha256:digest.digest('hex'),coverage:'serialized-GameObject-components'};
}
