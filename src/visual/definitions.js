const string=(max=256)=>({type:'string',minLength:1,maxLength:max});
const integer=(minimum,maximum)=>({type:'integer',minimum,maximum});
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const rectangle={x:integer(0,8191),y:integer(0,8191),width:integer(1,8192),height:integer(1,8192)};
const profile=object({width:integer(1,8192),height:integer(1,8192),locale:string(64),platform:string(128),orientation:string(),safeArea:object(rectangle),colorSpace:string(),renderPipeline:string(),unityVersion:string(),packageVersions:{type:'object',maxProperties:128,additionalProperties:string()},inputBackend:string(),gpu:string()},['width','height','locale','platform']);
const input={path:string(4096),sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},profile};
const baseline=object({...input,provenance:object({kind:{type:'string',enum:['original','fixture','regression']},build:string(1024),source:string(1024),approvedBy:string(1024)})},['path','profile','provenance']);
const frame=object({id:string(128),baseline:{anyOf:[{type:'null'},baseline]},candidate:object(input,['path','profile']),baselineTimeMs:integer(0,3600000),candidateTimeMs:integer(0,3600000)},['id','baseline','candidate']);
const region=object({id:string(128),...rectangle,pixelDelta:integer(0,255),maxChangedRatio:{type:'number',minimum:0,maximum:1},maxMeanAbsoluteError:{type:'number',minimum:0,maximum:255}});
export const visualRequestSchema=object({kind:{type:'string',const:'retoolkit-visual-request'},schemaVersion:{type:'integer',const:1},mode:{type:'string',enum:['image','video']},screen:string(),state:string(),profile,requiredRegions:{type:'array',minItems:1,maxItems:128,items:region},frames:{type:'array',minItems:1,maxItems:32,items:frame},ffmpegPath:string(4096)},['kind','schemaVersion','mode','screen','state','profile','requiredRegions','frames']);
// The service enforces mode-specific timestamp/executable fields, absolute paths,
// pixel budgets, region bounds and exact profiles in addition to this JSON schema.
export const visualDefinitions={
 'visual.compare':{properties:{request:visualRequestSchema},required:['request']},
 'visual.report':{properties:{operationId:{type:'string',pattern:'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-4[a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}$'},section:{type:'string',enum:['summary','report','frames','findings']},limit:integer(1,128),cursor:string(2048)},required:['operationId']},
};
