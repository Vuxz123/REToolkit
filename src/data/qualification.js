import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {fingerprint,fileIdentity} from '../state.js';
import {assertAssetPath,assetError} from '../assets/context.js';
import {readJson,writeJson,seal,unseal,uuid} from '../recovery/artifacts.js';
import {compatibleDataHelpers} from './reference-policy.js';

const policy='scoped-scriptable-data-v1',policyFile=fileURLToPath(import.meta.url);
// This previous qualification policy checked the same per-SO typed evidence.
// Its immutable proof remains valid only when every other rederived field and
// the reviewed data-helper compatibility still match.
const retainedQualificationPolicy='030bfcfbb7572a93162cf7a59545b9908eb5253f025b6709e96dc36992be8598';
const check=(ok,message,code='data_baseline_unqualified')=>{if(!ok)throw assetError(code,message);};
// This is narrower than global source/binding validation. Each captured SO must
// have complete typed data and its own exact observed MonoScript identity.
function scopedEvidence(baseline){
 const {receipt:r,evidence:e,rows}=baseline,validation=e.receipt,o=e.observation;
 check(r.command==='capture'&&e.request?.dataCapture===true&&validation.compileReady===true&&validation.process?.closed===true&&validation.process.exitCode===0&&!validation.process.timedOut&&o?.complete===true&&o.compilation?.state==='succeeded'&&!o.diagnostics.some(d=>d.severity==='error'),'Baseline has no complete closed-Editor data observation');
 check(rows.length===r.assetIds.length&&o.assets.length===rows.length&&o.assets.every(a=>a.loaded&&a.missingScripts===0&&a.missingReferences===0&&a.traversal?.complete&&a.data?.complete&&a.data.unsupportedProperties===0),'Baseline typed coverage is incomplete or unsupported');
 const scripts=new Map();for(const script of o.scripts.filter(s=>s.resolved)){const key=script.guid.toLowerCase()+':'+script.fileID;check(!scripts.has(key),'Baseline has ambiguous script identity');scripts.set(key,script);}
 let objects=0,scriptableObjects=0,properties=0;
 for(const asset of rows)for(const object of asset.data.objects){objects++;properties+=object.properties.length;check(object.complete,'Baseline object coverage is incomplete');if(!object.scriptable)continue;scriptableObjects++;const refs=object.properties.filter(p=>p.path==='m_Script'&&p.kind==='ObjectReference');const script=refs.length===1?scripts.get(refs[0].value?.toLowerCase()):null;check(script&&script.fullName===object.fullName&&script.assembly===object.assembly,'Baseline ScriptableObject identity is unverified');}
 check(scriptableObjects>0,'Baseline contains no verified ScriptableObject data');return {assets:rows.length,objects,scriptableObjects,properties};
}
function proof(toolkit,baseline){
 const r=baseline.receipt,helper=assertAssetPath(path.join(toolkit.root,'templates/Unity/REToolkitValidation.cs'));
 const stagedHelper=assertAssetPath(path.join(baseline.paths.base,'unity-validation',r.validationOperationId,'project/Assets/REToolkitValidation/Editor/REToolkitValidation.cs'),baseline.paths.workspace);
 const currentHelper=fileIdentity(helper).sha256,compatible=currentHelper===r.helperSha256||compatibleDataHelpers(helper,stagedHelper);
 check(compatible&&baseline.evidence.receipt.helperSha256===r.helperSha256&&fileIdentity(stagedHelper).sha256===r.helperSha256,'Baseline helper differs; qualification cannot reinterpret an unknown helper','data_baseline_stale');
 return {kind:'retoolkit-data-baseline-qualification',schemaVersion:1,policy,policySha256:fileIdentity(policyFile).sha256,baselineId:r.operationId,baselineReceiptSha256:fingerprint(r),dataSha256:r.dataSha256,rawFilesSha256:fingerprint(r.rawFiles),validationOperationId:r.validationOperationId,validationReceiptSha256:r.validationReceiptSha256,helperSha256:r.helperSha256,binding:r.binding,graphRevision:r.graphRevision,coverage:scopedEvidence(baseline),state:'qualified',dataCaptureComplete:true,sourceIdentity:'not-attested',bindingsVerified:false,gameplay:'unverified'};
}
function qualificationFile(baseline){return assertAssetPath(path.join(baseline.paths.directory,'qualification.json'),baseline.paths.directory);}
export function readBaselineQualification(toolkit,baseline){
 const pointer=qualificationFile(baseline);if(!fs.existsSync(pointer))return null;
 const reference=unseal(readJson(pointer,65536));check(reference.kind==='retoolkit-data-qualification-reference'&&reference.baselineId===baseline.receipt.operationId&&uuid(reference.operationId),'Invalid baseline qualification reference','data_qualification_invalid');
 const file=assertAssetPath(path.join(baseline.paths.directory,'qualifications',reference.operationId+'.json'),baseline.paths.directory),record=unseal(readJson(file,1024**2)),{operationId,createdAt,...given}=record;
 const expected=proof(toolkit,baseline);if(given.policySha256===retainedQualificationPolicy)expected.policySha256=retainedQualificationPolicy;
 check(operationId===reference.operationId&&fingerprint(record)===reference.receiptSha256&&fingerprint(given)===fingerprint(expected),'Baseline qualification or retained evidence changed','data_qualification_stale');return {...record,storedQualification:path.relative(baseline.paths.workspace,file).split(path.sep).join('/')};
}
export function qualifyDataBaseline(toolkit,name,baseline){
 const payload=proof(toolkit,baseline);let old;
 try{old=readBaselineQualification(toolkit,baseline);}catch(error){if(error.code!=='data_qualification_stale')throw error;}
 if(old)return old;
 const operationId=randomUUID(),record={...payload,operationId,createdAt:new Date().toISOString()},file=assertAssetPath(path.join(baseline.paths.directory,'qualifications',operationId+'.json'),baseline.paths.directory);
 writeJson(file,seal(record),{exclusive:true});writeJson(qualificationFile(baseline),seal({kind:'retoolkit-data-qualification-reference',baselineId:baseline.receipt.operationId,operationId,receiptSha256:fingerprint(record)}),{exclusive:!fs.existsSync(qualificationFile(baseline))});return {...record,storedQualification:path.relative(baseline.paths.workspace,file).split(path.sep).join('/')};
}
