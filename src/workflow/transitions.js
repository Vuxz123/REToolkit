import {artifactPaths,loadArtifact,loadGeneration} from '../recovery/artifacts.js';
import {check} from './store.js';

// Reconcile provenance only. Acceptance is always evaluated separately against
// the current project by workflow.checkpoint; no engine work is replayed here.
export function verifyTransitionChain(toolkit,name,run,current,entries,mutable){
 const id=run.candidate.artifactId;
 check(id&&current.identity.artifactId===id&&current.identity.bindingSha256===run.candidate.bindingSha256,'Reconciliation requires the same artifact and input build','workflow_candidate_stale');
 check(entries.length&&new Set(entries.map(e=>e.jobId)).size===entries.length,'Expected distinct transition jobs','workflow_evidence_invalid');
 const paths=artifactPaths(toolkit,name,id),manifest=loadArtifact(paths,id);
 let revision=run.candidate.revision,inventory=run.candidate.inventorySha256;
 for(const e of entries){
  const p=e.request.params,result=e.result;
  check(e.request.operation==='recovery.run'&&p.artifactId===id&&p.operation===e.operation&&mutable.has(e.operation),'Not a supported artifact mutation','workflow_scope_invalid');
  check(p.revision===revision&&result.artifactId===id&&result.operation===e.operation&&result.revision!==revision,'Artifact transition differs','workflow_candidate_stale');
  const before=loadGeneration(paths,{artifactId:id,revision}),after=loadGeneration(paths,{artifactId:id,revision:result.revision}).receipt;
  check(before.receipt.inventorySha256===inventory&&after.parent===revision&&after.operation===e.operation&&after.inventorySha256===result.inventorySha256,'Generation transition differs','workflow_candidate_stale');
  check(manifest.history.some(h=>h.parent===revision&&h.revision===result.revision&&h.operation===e.operation&&h.inventorySha256===after.inventorySha256&&h.domainOperationId===(result.result?.operationId??null)),'Mutation is absent from artifact history','workflow_evidence_invalid');
  revision=result.revision;inventory=after.inventorySha256;
 }
 check(revision===current.identity.revision&&inventory===current.identity.inventorySha256&&manifest.revision===revision&&!manifest.pending,'Transition chain does not reach the current candidate','workflow_candidate_stale');
}
