import {BridgeError} from './protocol.js';
export const ANALYSIS_KINDS=Object.freeze(['disassemble','function','stack']);
export function validateAnalysisScope(p){
 const fail=message=>{throw new BridgeError('invalid_argument',message);};
 const parse=value=>{if(typeof value!=='string'||! /^(?:[A-Za-z_][\w.-]*:)?0x[0-9a-fA-F]{1,16}$/.test(value))fail('Analysis addresses must be exact hex strings');const [space='ram',hex]=value.includes(':')?value.split(':'):['ram',value];return {space,value:BigInt(hex)};};
 const a=parse(p.address),b=parse(p.endAddress);
 if(a.space!==b.space||b.value<a.value||b.value-a.value>=65536n)fail('Analysis requires one address space and an inclusive range of 1..65536 bytes');
 if(!ANALYSIS_KINDS.includes(p.kind))fail('Analysis kind must be disassemble, function or stack');
 if(typeof p.reason!=='string'||!p.reason.trim()||p.reason.length>2048)fail('Analysis requires a reason of 1..2048 characters');
 if(p.timeoutSeconds!==undefined&&(!Number.isSafeInteger(p.timeoutSeconds)||p.timeoutSeconds<1||p.timeoutSeconds>300))fail('Analysis timeout must be 1..300 seconds');
 return p;
}
