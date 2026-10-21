const file={type:'string',minLength:1,maxLength:32767};
// The shared service validates exact input DTOs and confines all generated
// projects/receipts to its fixed UUID workspace paths; no target project input.
export const migrationDefinitions={
 'migration.observe':{properties:{receipt:file,components:file,editor:file,timeoutSeconds:{type:'integer',minimum:1,maximum:3600}}},
 'migration.plan':{properties:{request:file,observations:file},required:['request','observations']},
 'migration.apply':{properties:{plan:file,observations:file},required:['plan','observations']},
 'migration.verify':{properties:{receipt:file,observations:file},required:['receipt']},
};
