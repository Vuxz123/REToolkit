import fs from 'node:fs';
import path from 'node:path';
import {assertAssetPath,assetError} from '../assets/context.js';
import {readJson,writeJson,seal,unseal,uuid} from '../recovery/artifacts.js';
export const check=(ok,message,code='workflow_invalid')=>{if(!ok)throw assetError(code,message);};
export function workflowPaths(toolkit,name){
 const workspace=assertAssetPath(toolkit.workspace(name));check(fs.lstatSync(assertAssetPath(path.join(workspace,'project.re.json'),workspace)).isFile(),'Workspace must be initialized');
 return {workspace,base:assertAssetPath(path.join(workspace,'04_Notes/reconstruction-runs'),workspace)};
}
export function readRun(paths,runId){
 check(uuid(runId),'Expected run UUID');const r=unseal(readJson(assertAssetPath(path.join(paths.base,runId+'.json'),paths.base),16*1024**2));
 check(r.kind==='retoolkit-reconstruction-run'&&r.schemaVersion===1&&r.runId===runId&&r.workspace===paths.workspace&&Array.isArray(r.steps),'Invalid workflow record');return r;
}
export function saveRun(paths,r){r.sequence++;r.updatedAt=new Date().toISOString();const sealed=seal(r);check(Buffer.byteLength(JSON.stringify(sealed))+1<=16*1024**2,'Workflow record exceeds 16 MiB; retained state was not overwritten','workflow_record_limit');writeJson(path.join(paths.base,r.runId+'.json'),sealed);}
export function listRuns(paths){
 if(!fs.existsSync(paths.base))return [];const names=fs.readdirSync(paths.base).filter(n=>uuid(n.replace(/\.json$/,''))&&n.endsWith('.json'));check(names.length<=1000,'Workflow history exceeds 1000 runs');
 return names.map(n=>readRun(paths,n.slice(0,-5))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
export const inactive=r=>['paused','canceled','completed'].includes(r.state);
export const actionableStep=r=>r.steps.find(s=>s.state!=='verified'&&!(s.state==='blocked'&&(s.blocker||s.jobId))&&s.dependsOn.every(id=>r.steps.find(d=>d.id===id)?.state==='verified'))??null;
export function publicRun(r,{freshness='not-rechecked',nextStep=null,...extra}={}){
 const staleController=Boolean(r.controller&&Date.now()-Date.parse(r.controller.heartbeatAt)>120000);
 const staleCompletion=r.state==='completed'&&r.completionFreshness==='stale';
 const continuationRequired=!inactive(r)&&r.state!=='needs-inspection'&&!r.waiting&&Boolean(actionableStep(r));
 extra={...extra,continuationRequired,continuationAction:continuationRequired?'Continue the actionable step; use workflow.expand for missing recovery dependencies. A checklist update is not a stopping condition.':null};
 const proof=value=>{if(!value)return value;const {files,candidate,...rest}=value;return {...rest,...(files?{filesCount:files.length}:{}),...(candidate?{inventorySha256:candidate.inventorySha256}: {})};};
 const step=s=>s?{...s,...(s.evidence?{evidence:proof(s.evidence)}:{}),...(s.staleEvidence?{staleEvidence:proof(s.staleEvidence)}:{})}:null;
 return {...r,steps:r.steps.map(step),...(staleCompletion?{state:'needs-inspection',recordedState:'completed'}:{}),complete:r.state==='completed'&&!staleCompletion,agentResumed:Boolean(r.controller)&&!staleController,controller:r.controller?{...r.controller,heartbeatStale:staleController}:null,freshness:staleCompletion?'stale':freshness,nextStep:step(nextStep),...extra};
}
