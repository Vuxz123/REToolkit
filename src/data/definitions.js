const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
export const dataAssetIds={type:'array',minItems:1,maxItems:64,items:{type:'string',pattern:'^asset:[a-f0-9]{32}$'}};
const timeoutSeconds={type:'integer',minimum:1,maximum:3600};
export const dataDefinitions={
 'data.qualify':{properties:{baselineId:uuid},required:['baselineId']},
 'data.capture':{properties:{assetIds:dataAssetIds,timeoutSeconds},required:['assetIds']},
 'data.verify':{properties:{mode:{type:'string',enum:['clean','resident']},baselineId:uuid,reuseVerificationId:uuid,timeoutSeconds},required:['baselineId']},
 'data.report':{properties:{operationId:uuid,section:{type:'string',enum:['summary','objects','properties','differences']},query:{type:'string',maxLength:512},limit:{type:'integer',minimum:1,maximum:100},cursor:{type:'string',minLength:1,maxLength:4096}},required:['operationId']},
};
