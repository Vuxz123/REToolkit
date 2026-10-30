export const workflowOperations=['assets.index','assets.list','assets.get','assets.tree','assets.refs','assets.scripts','assets.source','reconstruct.plan','reconstruct.apply','reconstruct.verify','reconstruct.resident-status','reconstruct.resident-stop','reconstruct.validate','reconstruct.validation','libraries.scan','libraries.list','libraries.identify','libraries.plan','libraries.import','libraries.verify','migration.observe','migration.plan','migration.apply','migration.verify','ghidra.session.start','ghidra.session.status','ghidra.session.stop','ghidra.analysis.targets','ghidra.analysis.ensure','ghidra.symbols.plan','ghidra.symbols.apply','recovery.run','data.capture','data.qualify','data.verify','data.report','components.scan','components.observe','components.plan','components.apply','components.verify','components.report'];
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
workflowOperations.push('libraries.runtime.plan','libraries.runtime.apply','libraries.runtime.verify');
const text={type:'string',minLength:1,maxLength:2048,pattern:'^[^\\x00-\\x1f]+$'};
const stepId={type:'string',pattern:'^[a-zA-Z0-9_-]{1,64}$'};
const sequence={type:'integer',minimum:0,maximum:1000000};
const bound={runId:uuid,sequence},owned={...bound,claimId:uuid};
export const workflowDefinitions={
 'workflow.authorize':{properties:{...owned,operations:{type:'array',minItems:1,maxItems:64,uniqueItems:true,items:{type:'string',enum:workflowOperations}},reason:text},required:[...Object.keys(owned),'operations','reason']},
 'workflow.reconcile':{properties:{...owned,jobIds:{type:'array',minItems:1,maxItems:64,uniqueItems:true,items:uuid}},required:[...Object.keys(owned),'jobIds']},
 'workflow.create':{properties:{goal:text,artifactId:uuid,authorizedOperations:{type:'array',minItems:1,maxItems:64,items:{type:'string',enum:workflowOperations}},steps:{type:'array',minItems:1,maxItems:256,items:{type:'object',additionalProperties:false,required:['id','label','dimension','dependsOn'],properties:{id:stepId,label:text,dimension:{type:'string',enum:['source','compilation','bindings','data','gameplay']},baselineId:uuid,sourcePaths:{type:'array',minItems:1,maxItems:16,items:text},dependsOn:{type:'array',maxItems:256,items:stepId},assetIds:{type:'array',minItems:1,maxItems:1000,items:text},scenario:{type:'object',additionalProperties:false,required:['entry','actions','expected'],properties:{entry:text,actions:{type:'array',minItems:1,maxItems:100,items:text},expected:text}}}}}},required:['goal','authorizedOperations','steps']},
 'workflow.status':{properties:{runId:uuid}},
 'workflow.next':{properties:{runId:uuid},required:['runId']},
 'workflow.claim':{properties:{...bound,harness:{type:'string',enum:['codex','claude','gemini','opencode']},threadId:{type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'}},required:['runId','sequence','harness','threadId']},
 'workflow.heartbeat':{properties:owned,required:Object.keys(owned)},
 'workflow.release':{properties:owned,required:Object.keys(owned)},
 'workflow.checkpoint':{properties:{...owned,stepId,outcome:{type:'string',enum:['progress','blocked','job']},note:text,jobId:uuid},required:[...Object.keys(owned),'stepId','outcome'],oneOf:[{properties:{outcome:{const:'job'}},required:['jobId']},{properties:{outcome:{enum:['progress','blocked']}},required:['note']}]},
 'workflow.wait':{properties:{...owned,stepId,jobId:uuid},required:[...Object.keys(owned),'stepId','jobId']},
 ...Object.fromEntries(['pause','resume','cancel'].map(c=>['workflow.'+c,{properties:bound,required:Object.keys(bound)}])),
};
workflowDefinitions['workflow.expand']={properties:{...owned,stepId,reason:text,steps:{...workflowDefinitions['workflow.create'].properties.steps,maxItems:32}},required:[...Object.keys(owned),'stepId','reason','steps']};
workflowDefinitions['workflow.transfer']={properties:{...bound,previousThreadId:workflowDefinitions['workflow.claim'].properties.threadId,harness:{type:'string',enum:['codex']},threadId:workflowDefinitions['workflow.claim'].properties.threadId,reason:text},required:[...Object.keys(bound),'previousThreadId','harness','threadId','reason']};
workflowDefinitions['workflow.checkpoint'].properties.blocker={type:'object',additionalProperties:false,required:['kind','attempted','missing','requiredFrom','resumeWhen'],properties:{kind:{type:'string',enum:['external-input','permission','tool-capability']},attempted:text,missing:text,requiredFrom:text,resumeWhen:text}};
