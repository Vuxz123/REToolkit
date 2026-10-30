import {assetError} from './context.js';
import {runAssetOperation} from './service.js';
import {startAssetSession,assetSessionStatus,stopAssetSession,requestAssetSession} from './session.js';
import {sourcePath} from './protocol.js';
import {visualDefinitions} from '../visual/definitions.js';
import {migrationDefinitions} from '../reconstruction/migration-definitions.js';
import {adbDefinitions,runAdbOperation} from '../adb/api.js';
import {jobOperations,jobDefinitions,validateSchema} from '../jobs/definitions.js';
import {validateAnalysisScope} from '../ghidra/analysis-scope.js';
import {recoveryDefinitions} from '../recovery/definitions.js';
import {workflowDefinitions} from '../workflow/definitions.js';
import {dataDefinitions} from '../data/definitions.js';
import {componentDefinitions} from '../components/definitions.js';

const text={type:'string',minLength:1,maxLength:2048},limit={type:'integer',minimum:1,maximum:1000};
const paging={limit,cursor:{...text,maxLength:65536}};
const operationId={type:'string',pattern:'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$'};
const evidence={type:'array',maxItems:10000,items:{type:'object'}};
const libraryRequirements={type:'object',additionalProperties:false,required:['kind','schemaVersion','packages'],properties:{kind:{const:'retoolkit-library-requirements',type:'string'},schemaVersion:{const:1,type:'integer'},packages:{type:'array',maxItems:64,items:{type:'object',additionalProperties:false,required:['id','version'],properties:{id:{type:'string',minLength:1,maxLength:256},version:{type:'string',minLength:1,maxLength:128}}}}}};
const constructorDeclarations={type:'array',minItems:1,maxItems:32,items:{type:'object',additionalProperties:false,required:['fullName','kind','evidenceId'],properties:{fullName:text,kind:{type:'string',enum:['static','instance']},evidenceId:{type:'string',pattern:'^[a-f0-9]{64}$'}}}};
const eventDeclarations={type:'array',minItems:1,maxItems:32,items:{type:'object',additionalProperties:false,required:['fullName','name','addEvidenceId','removeEvidenceId'],properties:{fullName:text,name:{type:'string',minLength:1,maxLength:512},addEvidenceId:{type:'string',pattern:'^[a-f0-9]{64}$'},removeEvidenceId:{type:'string',pattern:'^[a-f0-9]{64}$'}}}};
const request={type:'object',additionalProperties:false,required:['kind','schemaVersion','graphRevision','changes'],properties:{kind:{type:'string',const:'retoolkit-reconstruction-request'},schemaVersion:{type:'integer',const:1},graphRevision:{type:'string',pattern:'^[a-f0-9]{64}$'},changes:{type:'array',minItems:1,maxItems:16,items:{type:'object',additionalProperties:false,required:['scriptId','source'],properties:{scriptId:text,source:{type:'string',minLength:1,maxLength:1024**2},mode:{type:'string',enum:['bodies','initialization','event-storage']},constructors:constructorDeclarations,events:eventDeclarations,evidenceIds:{type:'array',maxItems:1000,items:{type:'string',pattern:'^[a-f0-9]{64}$'}}}}}}};
export const definitions={
 'preparation.status':{properties:{runId:operationId,verifyFreshness:{type:'boolean'}}},
 ...adbDefinitions,
 ...visualDefinitions,
 ...migrationDefinitions,
 ...dataDefinitions,
 ...componentDefinitions,
 'assets.session.start':{properties:{}},'assets.session.status':{properties:{}},'assets.session.stop':{properties:{}},
 'assets.export':{properties:{}},'assets.index':{properties:{storage:{type:'string',enum:['json','sqlite']},graphMaxMiB:{type:'integer',minimum:128,maximum:512,enum:[128,256,512]}}},
 'assets.raw':{properties:{format:{type:'string',enum:['json','yaml','text','binary','image','audio','model','font','video']},bundle:{type:'array',maxItems:64,items:{type:'integer',minimum:0,maximum:2147483647}},collection:{type:'integer',minimum:0,maximum:2147483647},pathID:{type:'string',minLength:1,maxLength:20}},required:['format','bundle','collection','pathID']},
 'assets.list':{properties:{...paging,kind:text,name:text,path:text,search:text}},
 'assets.get':{properties:{id:text},required:['id']},
 'assets.source':{properties:{id:text},required:['id']},
 'assets.refs':{properties:{...paging,id:text,direction:{type:'string',enum:['incoming','outgoing','both']}},required:['id']},
 'assets.tree':{properties:{...paging,id:text,depth:{type:'integer',minimum:0,maximum:100}},required:['id']},
 'assets.scripts':{properties:{...paging,query:text,evidence}},
 'reconstruct.plan':{properties:{request,evidence},required:['request']},
 'reconstruct.apply':{properties:{operationId},required:['operationId']},
 'reconstruct.verify':{properties:{operationId},required:['operationId']},
 'reconstruct.resident-status':{properties:{}},
 'reconstruct.resident-stop':{properties:{}},
 'reconstruct.validate':{properties:{mode:{type:'string',enum:['clean','resident']},dataCapture:{type:'boolean'},timeoutSeconds:{type:'integer',minimum:1,maximum:3600},resumeOperationId:operationId,assetIds:{type:'array',minItems:1,maxItems:1000,items:text}}},
 'reconstruct.validation':{properties:{operationId,...paging,section:{type:'string',enum:['summary','scripts','assets','diagnostics']}},required:['operationId']},
 'libraries.scan':{properties:{}},
 'libraries.list':{properties:{...paging,query:text}},
 'libraries.identify':{properties:{...paging,section:{type:'string',enum:['candidates','installed','requirements']},query:text,requirements:libraryRequirements}},
 'libraries.plan':{properties:{requirements:libraryRequirements}},
 'libraries.import':{properties:{operationId},required:['operationId']},
 'libraries.verify':{properties:{operationId},required:['operationId']},
 'libraries.runtime.plan':{properties:{dll:{type:'string',minLength:1,maxLength:2048},replacement:{type:'string',minLength:1,maxLength:32767}},required:['dll','replacement']},
 'libraries.runtime.apply':{properties:{operationId},required:['operationId']},
 'libraries.runtime.verify':{properties:{operationId},required:['operationId']},
 'evidence.capture':{properties:{kind:{type:'string',enum:['decompile','xrefs','functions','instructions']},selector:text,endAddress:text,direction:{type:'string',enum:['to','from']},limit},required:['kind']},
};
Object.assign(definitions,recoveryDefinitions(definitions));
Object.assign(definitions,workflowDefinitions);
export const registeredJobOperations=jobOperations(definitions);
Object.assign(definitions,jobDefinitions(registeredJobOperations));
export function validateAssetParams(method,params) {
 if(method.startsWith('components.')){if(!definitions[method])throw assetError('asset_params_invalid','Unknown component operation');validateSchema(params,{type:'object',additionalProperties:false,...definitions[method]});if(Buffer.byteLength(JSON.stringify(params))>512*1024)throw assetError('asset_payload_limit','Component operation exceeds payload budget');return params;}
 if(method.startsWith('data.')){if(!definitions[method])throw assetError('asset_params_invalid','Unknown data operation');validateSchema(params,{type:'object',additionalProperties:false,...definitions[method]});if(Buffer.byteLength(JSON.stringify(params))>256*1024)throw assetError('asset_payload_limit','Data operation exceeds payload budget');return params;}
 if(method.startsWith('workflow.')){if(!definitions[method])throw assetError('asset_params_invalid','Unknown workflow operation');validateSchema(params,{type:'object',additionalProperties:false,...definitions[method]});if(Buffer.byteLength(JSON.stringify(params))>512*1024)throw assetError('asset_payload_limit','Workflow payload exceeds 512 KiB');return params;}
 if(method.startsWith('recovery.')){
  if(!definitions[method])throw assetError('asset_params_invalid','Unknown recovery operation');
  validateSchema(params,{type:'object',additionalProperties:false,...definitions[method]});
  if(method==='recovery.run')validateAssetParams(params.operation,params.params);
  if(Buffer.byteLength(JSON.stringify(params))>32*1024**2)throw assetError('asset_payload_limit','Recovery parameters exceed 32 MiB');
  return params;
 }
 if(method==='preparation.status'){
  validateSchema(params,{type:'object',additionalProperties:false,...definitions[method]});return params;
 }
 const schema=definitions[method];
 if(method==='reconstruct.validate'){
  try{validateSchema(params,{type:'object',additionalProperties:false,...schema});}catch{throw assetError('asset_params_invalid','Invalid Unity validation scope or resume options');}
  if(params.assetIds&&new Set(params.assetIds).size!==params.assetIds.length)throw assetError('asset_params_invalid','Validation asset IDs must be unique');
 }
 if(method.startsWith('jobs.')) {
  if(method==='jobs.start'&&params.operation==='ghidra.analysis.ensure')validateAnalysisScope(params.params??{});
  if(!schema)throw assetError('asset_params_invalid','Unknown job operation');
  validateSchema(params,{type:'object',additionalProperties:false,...schema});
  if(method==='jobs.start')validateAssetParamsForJob(params.operation,params.params);
  return params;
 }
 if(method==='assets.index'&&params?.storage==='sqlite'&&params.graphMaxMiB!==undefined)throw assetError('asset_params_invalid','SQLite storage does not use a JSON memory budget');
 if(!schema||!params||typeof params!=='object'||Array.isArray(params)||Object.keys(params).some(k=>!Object.hasOwn(schema.properties,k))||(schema.required??[]).some(k=>!Object.hasOwn(params,k)))throw assetError('asset_params_invalid','Unknown operation or invalid asset parameters');
 for(const [key,value] of Object.entries(params)) {
  const spec=schema.properties[key],type=spec.type;
  if(spec.enum&&!spec.enum.includes(value)||type==='integer'&&(!Number.isSafeInteger(value)||value<spec.minimum||value>spec.maximum)||type==='string'&&(typeof value!=='string'||value.length<(spec.minLength??0)||value.length>(spec.maxLength??2048)||spec.pattern&&!new RegExp(spec.pattern).test(value))||type==='array'&&(!Array.isArray(value)||value.length>spec.maxItems)||type==='object'&&(!value||typeof value!=='object'||Array.isArray(value)))throw assetError('asset_params_invalid',`Invalid ${key}`);
 }
 if(method==='assets.raw')sourcePath(params);
 if(Buffer.byteLength(JSON.stringify(params))>32*1024**2)throw assetError('asset_payload_limit','Asset operation exceeds 32 MiB');
 return params;
}
export function validateAssetParamsForJob(operation,params) {
 if(operation==='ghidra.analysis.ensure')validateAnalysisScope(params??{});
 const schema=registeredJobOperations[operation];
 if(!schema)throw assetError('job_operation_invalid','Unsupported job operation');
 validateSchema(params,{type:'object',additionalProperties:false,...schema});
 if(Object.hasOwn(definitions,operation))validateAssetParams(operation,params);
 if(Buffer.byteLength(JSON.stringify(params))>1024**2)throw assetError('job_payload_limit','Job parameters exceed 1 MiB');
 return params;
}
export async function invokeAssetApi(toolkit,name,method,params={}) {
 validateAssetParams(method,params);
 if(method==='evidence.capture'){const {captureEvidence}=await import('../evidence.js');return captureEvidence(toolkit,name,params);}
 if(method.startsWith('components.')){const {runComponentOperation}=await import('../components/service.js');return runComponentOperation(toolkit,name,method.slice(11),params);}
 if(method.startsWith('data.')){const {runDataOperation}=await import('../data/service.js');return runDataOperation(toolkit,name,method.slice(5),params);}
 if(method.startsWith('workflow.')){const {runWorkflowOperation}=await import('../workflow/service.js');return runWorkflowOperation(toolkit,name,method.slice(9),params);}
 if(method.startsWith('recovery.')){const {runRecoveryOperation}=await import('../recovery/service.js');return runRecoveryOperation(toolkit,name,method.slice('recovery.'.length),params);}
 if(method==='preparation.status'){const {inspectPreparation}=await import('../preparation/service.js');return inspectPreparation(toolkit,name,params);}
 if(method.startsWith('jobs.')){const {invokeJobApi}=await import('../jobs/service.js');return invokeJobApi(toolkit,name,method,params);}
 if(method.startsWith('adb.'))return runAdbOperation(toolkit,name,method,params);
 if(method==='visual.compare'){const {runVisualComparison}=await import('../visual/service.js');return runVisualComparison(toolkit,name,params);}
 if(method==='visual.report'){const {readVisualReport}=await import('../visual/service.js');return readVisualReport(toolkit,name,params);}
 if(method.startsWith('migration.')){const {runMigrationOperation}=await import('../reconstruction/migration-cli.js');return runMigrationOperation(toolkit,name,method.slice('migration.'.length),params);}
 if(method.startsWith('libraries.')){const {runLibraryOperation}=await import('../libraries/service.js');return runLibraryOperation(toolkit,name,method,params);}
 if(method==='assets.session.start')return startAssetSession(toolkit,name);
 if(method==='assets.session.status')return assetSessionStatus(toolkit,name);
 if(method==='assets.session.stop')return stopAssetSession(toolkit,name);
 if(method==='assets.export')return requestAssetSession(toolkit,name,'assets.export');
 if(method==='assets.raw')return requestAssetSession(toolkit,name,'assets.raw',params);
 return runAssetOperation(toolkit,name,method,params);
}
