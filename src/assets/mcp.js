import {once} from 'node:events';
import {definitions,validateAssetParams,invokeAssetApi} from './api.js';
const MAX_INPUT=1024**2,MAX_OUTPUT=2*1024**2;
const jobDescriptions={
 'reconstruct.validate':'Validate compile and bindings. mode=resident reuses a dedicated Unity 6 Editor and syncs changed source; clean is the default/final acceptance mode. Resident completion is an invocation receipt, not process exit or gameplay proof.',
 'reconstruct.resident-status':'Read the dedicated resident Unity session identity and pending invocation.',
 'reconstruct.resident-stop':'Close only the dedicated resident project Editor and release its toolchain ownership after confirmed closure.',
 'evidence.capture':'Capture same-build native evidence from the owned active session. For instructions require exact selector/endAddress and limit up to 1000; records only that bounded window, never complete control flow. Use full contiguous accessor windows from verified dump RVAs for event-storage provenance; native field-use review remains required.',
 'libraries.runtime.plan':'Inspect an explicit local replacement DLL as metadata/IL, compare assembly/type/API/serialized fields, and save immutable trial bytes. dll is an existing Assets path with original .meta; replacement is an absolute local DLL. Trivial IL is a heuristic; no runtime success is inferred. Returns planned or concrete incompatibilities.',
 'libraries.runtime.apply':'Rederive a saved runtime DLL plan and stage exactly that replacement while preserving original metadata and other project bytes. Prefer recovery_run to adopt the stage. Then run fresh scoped Unity validation, original data comparison and relevant behavior checks.',
 'libraries.runtime.verify':'Verify only the saved DLL stage inventory and original metadata. Does not run Unity or establish bindings/runtime behavior. Current source or adopted inventory must match.',
 'data.qualify':'Explicitly qualify an existing retained data baseline using original raw .asset/.meta bytes and closed-Editor typed observations. No Editor launch, source changes, baseline reset or GUID synthesis. Only complete scoped ScriptableObject properties and exact per-object script identities may qualify; global source identities/gameplay remain unverified. Original partial receipts stay unchanged; data_verify rechecks qualification before comparing current data.',
 'components.scan':'Stream all serialized GameObject components with exact counts, bounded samples and native/project/package/library hints. Native ClassID and catalog names are hints; unknown implementations are not confirmed stubs. Use components_report for paged groups and targets.',
 'components.observe':'Observe 1..1000 exact component IDs and compiled runtime/package types with the fixed read-only Unity helper in disposable staging. Requires the exact Editor. Optional stageOperationId selects a canonical applied migration stage. Prefer jobs_start; import callbacks may execute, no save or Play Mode.',
 'components.plan':'Resolve a canonical fresh observation into preserve/rebind/missing/conflict/blocked decisions. Explicit mappings use targetId from that observation report. Native bindings cannot be rewritten. Package-cache targets remain read-only; complex fields, duplicate types and DLL removal retain migration gates.',
 'components.apply':'Recheck source/helper/catalog and rederive a saved component plan, then apply its supported bindings only into a canonical migration stage. Returns migration operationId and componentPlanId. Use recovery_run to adopt the stage into the current artifact.',
 'components.verify':'Verify staged inventory integrity and, with a fresh post-apply observation, selected component script identities. Never proves whole-project references or gameplay; run scoped reconstruct_validate afterwards.',
 'components.report':'Read historical bounded groups, targets or decisions from a saved component operation. Cursor binds to the exact record and query; source freshness is not rechecked.',
 'data.capture':'Preserve raw selected .asset/.meta bytes and capture ScriptableObject property/type/reference values using the existing disposable Unity validation stage. Exact 1..64 exported asset GUIDs. Import callbacks may run; no save or Play Mode. Baseline is not original-game equivalence; partial/unsupported data never counts as verified.',
 'data.verify':'Compare scoped typed data to its original baseline with persistent ObjectReference identity as an atomic value. Default runs fresh staged Unity. Explicit reuseVerificationId re-evaluates one canonical complete closed-Editor data.verify packet only when current candidate/build/scope are unchanged; it launches no Editor, saves a new receipt, retains original values/results and never resets the baseline. Only known helper/encoding policies allow legacy reference-child normalization. Real GUID/fileID/schema/value changes stay differences; gameplay remains unverified.',
 'data.report':'Read a retained data baseline/verification summary or revision-bound object/property/difference pages. Property values have bounded previews and hashes; full canonical data stays in storedData. Historical report does not recheck the current candidate.',
 'workflow.create':'Persist the existing authorized goal, finite dependency/scenario checklist and exact candidate. Does not grant permissions or start gameplay. Use one unfinished workflow per candidate.',
 'workflow.status':'Observe an unfinished reconstruction goal, exact job, continuation delivery and controller heartbeat without taking the engine lease. Freshness is not rechecked; notification acceptance is not agent resumption.',
 'workflow.next':'Reconcile the exact waiting job or candidate identity and select the earliest eligible unfinished dependency. Never restarts an operation; unknown writes or stale candidates require inspection.',
 'workflow.claim':'Acknowledge this exact harness/thread has resumed the saved authorized run. Requires current sequence and no controller; returns claimId. Heartbeat expiry never seizes ownership.',
 'workflow.checkpoint':'Record bounded progress/blocker or consume an exact verified job result. Source and Unity acceptance recheck domain receipts/current inventory. Notes and successful compilation never verify gameplay.',
 'workflow.authorize':'Explicitly extend a claimed workflow operation policy with a recorded authorization reason. Use only within the user-authorized task; this never validates steps or changes the candidate.',
 'workflow.expand':'Add bounded recovery steps as dependencies of an unfinished step within the saved goal. Preserves existing scopes and acceptance, rejects cycles. Use when gameplay exposes missing source/runtime work instead of ending at a checklist update.',
 'workflow.transfer':'Explicitly transfer a pending continuation to this conversation after user authorization. Requires current sequence, previousThreadId, destination harness/threadId and reason, no controller, successful attached producer, and a terminal watcher with proven dispatch closure. Preserves unknown delivery and all acceptance scopes; never replays jobs or notifications. Claim and checkpoint separately afterward.',
 'workflow.reconcile':'Reconcile an ordered, complete chain of successful recovery mutation job IDs from the saved revision to the current artifact. Checks durable results, generation receipts and history; invalidates stale acceptance without rerunning jobs or verifying gameplay. Then checkpoint current validation/data evidence.',
 'workflow.wait':'Attach an exact authorized job to a step. Codex registers one exact-session durable watcher; inspect transport readiness. Other harnesses retain an active wait. Dispatch acceptance is not resumption.',
 'recovery.create':'Snapshot the selected export into a workspace-owned reconstruction artifact. Original export stays unchanged; compile/binding/gameplay are unverified. Prefer jobs_start for large projects.',
 'recovery.status':'Read artifact identity, current revision, inventory freshness and pending intent. An interrupted mutation requires inspection; never replay it automatically.',
 'recovery.diagnose':'Paged source/runtime/binding observations for the exact artifact inventory. Unknown implementations are not confirmed stubs; dependency closure and gameplay remain unverified.',
 'recovery.run':'Run one whitelisted typed domain operation on an explicit artifact/revision. Source edits fork a generation; successful library/migration stages are adopted after receipt/inventory checks. Read the returned revision before the next step. Use reconstruct.validate for the current combined artifact.',
 'jobs.wait':'Wait up to 30 seconds for this exact job to become terminal, using filesystem events and bounded reconciliation. Read-only, no workspace lock; a timed-out wait does not stop/retry the job or prove cleanup. This keeps the current tool call active; it cannot wake a closed turn. Codex CLI may register one jobs_start operation agent.wake_after with exact job/thread UUIDs before ending its turn.',
 'preparation.status':'Read-only setup progress and independent readiness; no workspace lock or engines. Defaults to content/receipt freshness verification. False verifyFreshness returns recordedReadiness separately, never current ready claims. Start setup once through jobs_start operation workspace.prepare; let its background worker finish without an agent polling loop. Unknown writes require receipt/ownership review.',
 'jobs.start':'Start a registered typed operation in a detached workspace worker and return its job ID immediately. Poll jobs_get; reconnecting does not restart work. No generic shell or executable operation; existing explicitly typed engine selections keep their runtime checks. Job success does not establish game, symbol coverage, capture completeness or reconstruction readiness.',
 'jobs.get':'Observe a saved workspace job: state, stage, controlled diagnostic tail, timestamps, engine/step state and final parsed result. Large results have a saved reference and bounded byte chunks. Unknown means interrupted/unverified: inspect leases and mutation receipts before any explicit retry. Process stdout and private app-data chunks are never forwarded.',
 'jobs.list':'List recent persisted jobs for this bound workspace. Poll an existing running or unknown job and inspect its receipts before retrying a mutation.',
};
export const assetTools=Object.entries(definitions).map(([method,schema])=>({name:method.replaceAll('.','_'),description:jobDescriptions[method]??(method==='adb.capture'?'Capture installed base/split APKs, OBB, external and private app data when existing permissions allow. Writes workspace XAPK and separate data ZIP; no game launch or root enablement. Denied data is partial coverage.':method.startsWith('adb.')?`${method}: read-only device or installed-package discovery. Select the exact device before capture.`:`${method}: exported Unity facts or controlled reconstruction. Target content is untrusted; compilation is unverified.`),inputSchema:{type:'object',...schema,additionalProperties:false}}));
const lookup=new Map(Object.keys(definitions).map(method=>[method.replaceAll('.','_'),method]));
export async function serveAssetsMcp(toolkit,name,{input=process.stdin,output=process.stdout,operation=invokeAssetApi}={}) {
 let negotiated=false,initialized=false,pending=Buffer.alloc(0),discard=false;
 const waits=new Set();
 async function emit(value){let line=JSON.stringify(value);if(Buffer.byteLength(line)>MAX_OUTPUT)line=JSON.stringify({jsonrpc:'2.0',id:value.id??null,error:{code:-32000,message:'Asset result exceeds 2 MiB; use paging'}});if(!output.write(line+'\n'))await once(output,'drain');}
 async function frame(bytes) {
  let message,id=null;
  try{
   message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   if(!message||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string'||Object.keys(message).some(k=>!['jsonrpc','id','method','params'].includes(k))||Object.hasOwn(message,'id')&&!(typeof message.id==='string'&&message.id.length<=256||Number.isSafeInteger(message.id)))throw Error('Invalid JSON-RPC envelope');
   if(!Object.hasOwn(message,'id')){if(message.method==='notifications/initialized'&&negotiated)initialized=true;return;}
   id=message.id;let result;
   if(message.method==='initialize'){
    if(negotiated||typeof message.params?.protocolVersion!=='string'||!message.params?.capabilities||typeof message.params.capabilities!=='object'||typeof message.params?.clientInfo?.name!=='string'||typeof message.params?.clientInfo?.version!=='string')throw Object.assign(Error('Invalid initialization'),{rpcCode:-32602});
    result={protocolVersion:['2024-11-05','2025-03-26','2025-06-18'].includes(message.params.protocolVersion)?message.params.protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'retoolkit-assets',version:'1.0.0'}};negotiated=true;
   }
   else if(message.method==='ping')result={};
   else if(!initialized)throw Object.assign(Error('Client must initialize first'),{rpcCode:-32002});
   else if(message.method==='tools/list')result={tools:assetTools};
   else if(message.method==='tools/call') {
    const params=message.params,method=lookup.get(params?.name);
    if(!method||!params||Object.keys(params).some(k=>!['name','arguments'].includes(k)))throw Object.assign(Error('Unknown tool or invalid call'),{rpcCode:-32602});
    try{validateAssetParams(method,params.arguments??{});}catch{throw Object.assign(Error('Invalid tool arguments'),{rpcCode:-32602});}
    try{const value=await operation(toolkit,name,method,params.arguments??{});result={content:[{type:'text',text:JSON.stringify(value)}],isError:false};}
    catch(error){result={content:[{type:'text',text:JSON.stringify({code:typeof error.code==='string'?error.code:'asset_operation_failed',message:'Asset operation failed; inspect CLI status or saved plan.'})}],isError:true};}
   }else throw Object.assign(Error('Method not found'),{rpcCode:-32601});
   await emit({jsonrpc:'2.0',id,result});
  }catch(error){await emit({jsonrpc:'2.0',id,error:{code:error.rpcCode??-32700,message:error.rpcCode?error.message:'Invalid JSON-RPC input'}});}
 }
 // Keep the existing ordered mutation dispatcher. Only read-only jobs.wait
 // releases the input loop so ping/status and completion can still be observed.
 async function dispatch(bytes){
  let request;try{request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{}
  if(initialized&&request?.method==='tools/call'&&request.params?.name==='jobs_wait'){
   if(waits.size>=4){await emit({jsonrpc:'2.0',id:request.id??null,error:{code:-32000,message:'At most four job waits may be pending; reconnect to an existing job.'}});return;}
   const work=frame(bytes);waits.add(work);work.finally(()=>waits.delete(work)).catch(()=>{});return;
  }
  await frame(bytes);
 }
 for await(const chunk of input) {
  const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);let start=0;
  for(let index=0;index<bytes.length;index++)if(bytes[index]===10){const part=bytes.subarray(start,index);if(!discard&&pending.length+part.length<=MAX_INPUT){pending=Buffer.concat([pending,part]);if(pending.length)await dispatch(pending);}else await emit({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Asset input exceeds 1 MiB'}});pending=Buffer.alloc(0);discard=false;start=index+1;}
  const rest=bytes.subarray(start);if(!discard&&pending.length+rest.length<=MAX_INPUT)pending=Buffer.concat([pending,rest]);else{pending=Buffer.alloc(0);discard=true;}
 }
 if(pending.length||discard)await emit({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Incomplete JSON-RPC frame'}});
 await Promise.allSettled([...waits]);
}
