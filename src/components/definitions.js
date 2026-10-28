const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const id={type:'string',pattern:'^object:[a-f0-9]{32}:-?(0|[1-9][0-9]{0,18})$'},hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const paging={limit:{type:'integer',minimum:1,maximum:100},cursor:{type:'string',minLength:1,maxLength:4096},query:{type:'string',maxLength:512}};
export const componentDefinitions={
 'components.scan':{properties:{}},
 'components.observe':{properties:{componentIds:{type:'array',minItems:1,maxItems:1000,items:id},stageOperationId:uuid,timeoutSeconds:{type:'integer',minimum:1,maximum:3600}},required:['componentIds']},
 'components.plan':{properties:{observationId:uuid,mappings:{type:'array',maxItems:1000,items:{type:'object',additionalProperties:false,properties:{componentId:id,targetId:hash},required:['componentId','targetId']}}},required:['observationId']},
 'components.apply':{properties:{operationId:uuid},required:['operationId']},
 'components.verify':{properties:{operationId:uuid,observationId:uuid},required:['operationId']},
 'components.report':{properties:{operationId:uuid,section:{type:'string',enum:['summary','groups','targets','decisions']},...paging},required:['operationId']},
};
