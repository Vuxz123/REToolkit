import {assetError} from '../assets/context.js';

const integer=(minimum,maximum)=>({type:'integer',minimum,maximum});
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const bool={type:'boolean'};
const inputPath={type:'string',minLength:1,maxLength:32767,pattern:'^[^\\x00-\\x1f]+$'};
const inputSelection={properties:{input:inputPath,binary:inputPath,metadata:inputPath},required:['input']};
const threadId={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
export const pipelineDefinitions={
 'agent.wake_after':{properties:{jobId:uuid,threadId,task:{type:'string',enum:['observe-job','verify-source-and-scoped-unity']},operationId:uuid,assetIds:{type:'array',minItems:1,maxItems:1000,items:{type:'string',minLength:1,maxLength:2048}},waitTimeoutSeconds:integer(1,86400)},required:['jobId','threadId','task'],oneOf:[{properties:{task:{const:'observe-job'}}},{properties:{task:{const:'verify-source-and-scoped-unity'}},required:['operationId','assetIds']}]},
 'workspace.status':{properties:{}},'workspace.dump':{properties:{}},
 'workspace.inputs.resolve':{properties:{policy:{type:'string',enum:['prefer-arm64','manual']}}},
 'workspace.add':inputSelection,'workspace.scan':inputSelection,
 'workspace.import':{properties:{reimport:bool}},
 'workspace.analyze':{properties:{}},
 'workspace.prepare':{properties:{profile:{type:'string',enum:['native','reconstruction']},symbols:{type:'string',enum:['plan','apply','skip']},addressMode:{type:'string',enum:['rva','va']},serial:{type:'string',minLength:1,maxLength:255,pattern:'^[A-Za-z0-9_][A-Za-z0-9_.:\\[\\]-]*$'},packageName:{type:'string',minLength:1,maxLength:255,pattern:'^[A-Za-z][A-Za-z0-9_]*(?:\\.[A-Za-z0-9_]*)+$'},autoPull:bool,includeData:bool,baselineValidation:bool,resumeRunId:uuid}},
 'ghidra.session.start':{properties:{write:bool,timeoutMs:integer(1,300000),idleMs:integer(1000,86400000)}},
 'ghidra.session.status':{properties:{}},'ghidra.session.stop':{properties:{timeoutMs:integer(1,300000)}},
 'ghidra.symbols.plan':{properties:{addressMode:{type:'string',enum:['rva','va']},createFunctions:bool,replaceUserNames:bool,replaceUserComments:bool},required:['addressMode']},
 'ghidra.symbols.apply':{properties:{plan:{type:'string',minLength:1,maxLength:4096},planHash:{type:'string',pattern:'^[a-f0-9]{64}$'},dryRun:bool,operationId:uuid},required:['plan','planHash']},
};

export function jobOperations(assetDefinitions){
 // Keep existing explicitly typed engine selections and their service checks.
 // There is no generic command/executable operation or shell parameter.
 return {...assetDefinitions,...pipelineDefinitions};
}
export function jobDefinitions(operations){return {
 'jobs.start':{properties:{operation:{type:'string',enum:Object.keys(operations)},params:{type:'object'}},required:['operation','params'],oneOf:Object.entries(operations).map(([operation,schema])=>({properties:{operation:{const:operation},params:{type:'object',additionalProperties:false,...schema}},required:['operation','params']}))},
 'jobs.get':{properties:{jobId:uuid,resultOffset:integer(0,128*1024**2),resultLimit:integer(1,65536)},required:['jobId']},
 'jobs.wait':{properties:{jobId:uuid,timeoutSeconds:integer(1,30),resultOffset:integer(0,128*1024**2),resultLimit:integer(1,65536)},required:['jobId']},
 'jobs.list':{properties:{limit:integer(1,100)}},
};}

// Request DTOs reject unknown fields; schemas for target evidence deliberately
// retain their allowance for arbitrary data. Validation happens before spawn.
export function validateSchema(value,schema,label='parameters',depth=0){
 const bad=()=>{throw assetError('job_params_invalid',`Invalid ${label}`);};
 if(depth>64)bad();
 if(schema.anyOf||schema.oneOf){const variants=schema.anyOf??schema.oneOf;let matches=0;for(const variant of variants)try{validateSchema(value,variant,label,depth+1);matches++;}catch{}if(schema.oneOf?matches!==1:matches===0)bad();}
 if(Object.hasOwn(schema,'const')&&value!==schema.const)bad();
 if(schema.enum&&!schema.enum.includes(value))bad();
 const type=schema.type;
 if(type==='null'&&value!==null||type==='boolean'&&typeof value!=='boolean'||type==='integer'&&!Number.isSafeInteger(value)||type==='number'&&(typeof value!=='number'||!Number.isFinite(value)))bad();
 if((type==='integer'||type==='number')&&(value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))bad();
 if(type==='string'&&(typeof value!=='string'||value.length<(schema.minLength??0)||value.length>(schema.maxLength??65536)||schema.pattern&&!new RegExp(schema.pattern).test(value)))bad();
 if(type==='array') {if(!Array.isArray(value)||value.length<(schema.minItems??0)||value.length>(schema.maxItems??10000))bad();for(const item of value)if(schema.items)validateSchema(item,schema.items,`${label} item`,depth+1);}
 if(type==='object'||schema.properties){
  if(!value||typeof value!=='object'||Array.isArray(value))bad();
  if(Object.keys(value).length>(schema.maxProperties??10000)||(schema.required??[]).some(key=>!Object.hasOwn(value,key)))bad();
  for(const [key,item]of Object.entries(value)){const spec=schema.properties?.[key];if(spec)validateSchema(item,spec,`${label}.${key}`,depth+1);else if(schema.additionalProperties===false)bad();else if(schema.additionalProperties&&typeof schema.additionalProperties==='object')validateSchema(item,schema.additionalProperties,`${label} value`,depth+1);}
 }
}
