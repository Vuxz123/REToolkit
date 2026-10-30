import path from 'node:path';
import {fingerprint} from '../state.js';
import {readJson,unseal} from '../recovery/artifacts.js';
import {assetError,assertAssetPath} from '../assets/context.js';

// Process closure and completion of one resident invocation are different facts.
// Callers must verify the resident attestation before accepting the latter.
export function validationExecutionComplete(receipt){
 return receipt.process?.exitCode===0&&!receipt.process.timedOut&&(receipt.process.closed===true||receipt.execution?.mode==='resident'&&receipt.execution.completed===true&&receipt.execution.operationId===receipt.operationId);
}
export function verifyResidentExecution(directory,receipt){
 if(!receipt.execution)return;
 const execution=unseal(readJson(assertAssetPath(path.join(directory,'execution.json'),directory)));
 const equal=(a,b)=>fingerprint(a)===fingerprint(b);
 if(execution.kind!=='retoolkit-unity-resident-execution'||execution.schemaVersion!==1||execution.mode!=='resident'||!execution.completed||!equal(execution,receipt.execution)||execution.operationId!==receipt.operationId||execution.graphRevision!==receipt.graphRevision||!equal(execution.binding,receipt.binding)||!equal(execution.editor,receipt.editor)||execution.helperSha256!==receipt.helperSha256||execution.requestSha256!==receipt.requestSha256||execution.observationSha256!==receipt.observationSha256||receipt.process?.closed!==false)throw assetError('unity_validation_invalid','Resident execution attestation differs');
}
