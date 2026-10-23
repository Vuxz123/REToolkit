import {fingerprint} from '../state.js';

const budget=1024**2,size=value=>Buffer.byteLength(JSON.stringify(value));
/** Saved plans retain full proof; RPC previews carry only bounded review facts. */
export function reconstructionPreview(plan,storedPlan){
 const {inventory,...preview}=plan;
 const result={...preview,inventoryFiles:inventory.length,storedPlan,changes:plan.changes.map(change=>{
  if(!change.initializationProof)return {...change};
  const proof=change.initializationProof;
  return {...change,initializationProof:{kind:proof.kind,schemaVersion:proof.schemaVersion,sha256:fingerprint(proof),originalTokenSha256:proof.originalTokenSha256,dump:proof.dump,constructors:proof.constructors.map(({fullName,kind,evidenceId,metadata})=>({fullName,kind,evidenceId,metadata})),proofInSavedPlan:true}};
 })};
 if(size(result)>budget)result.changes=result.changes.map(({source,...change})=>({...change,sourceInSavedPlan:true}));
 if(size(result)>budget)return {kind:plan.kind,schemaVersion:plan.schemaVersion,operationId:plan.operationId,payloadSha256:plan.payloadSha256,storedPlan,inventoryFiles:inventory.length,compileReady:false,logic:'unverified',previewTruncated:true,changes:plan.changes.map(({scriptId,path,mode,constructors})=>({scriptId,path,mode,constructorCount:constructors?.length??0,sourceInSavedPlan:true,detailsInSavedPlan:true}))};
 return result;
}
