export const recoveryOperations=new Set(['assets.index','assets.list','assets.get','assets.tree','assets.refs','assets.scripts','assets.source','reconstruct.plan','reconstruct.apply','reconstruct.verify','reconstruct.resident-status','reconstruct.resident-stop','reconstruct.validate','reconstruct.validation','libraries.identify','libraries.plan','libraries.import','libraries.runtime.plan','libraries.runtime.apply','libraries.runtime.verify','migration.observe','migration.plan','migration.apply','migration.verify','data.capture','data.qualify','data.verify','data.report','components.scan','components.observe','components.plan','components.apply','components.verify','components.report']);
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const paging={limit:{type:'integer',minimum:1,maximum:100},cursor:{type:'string',minLength:1,maxLength:4096}};
export function recoveryDefinitions(domain){return {
 'recovery.create':{properties:{}},
 'recovery.status':{properties:{artifactId:uuid},required:['artifactId']},
 'recovery.abandon':{properties:{artifactId:uuid,revision:uuid,intentId:uuid},required:['artifactId','revision','intentId']},
 'recovery.history':{properties:{artifactId:uuid,...paging},required:['artifactId']},
 'recovery.diagnose':{properties:{artifactId:uuid,...paging,query:{type:'string',maxLength:512}},required:['artifactId']},
 'recovery.run':{properties:{artifactId:uuid,revision:uuid,operation:{type:'string',enum:[...recoveryOperations]},params:{type:'object'}},required:['artifactId','revision','operation','params'],oneOf:[...recoveryOperations].map(operation=>({properties:{operation:{const:operation},params:{type:'object',additionalProperties:false,...domain[operation]}},required:['operation','params']}))},
};}
