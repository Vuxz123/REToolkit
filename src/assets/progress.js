// Fixed public observations, with no target text, paths, guessed percentages or ETA.
const phases=new Set(['source.validating','source.staged','source.before-publish','source.published','source.before-receipt','source.receipt','refresh.verifying','refresh.copying','refresh.updating','refresh.sealing','refresh.sealed','refresh.published','refresh.full-index','refresh.indexing','refresh.references']);
export function assetProgressPreview(event){
 if(!event||!phases.has(event.phase)||!Number.isSafeInteger(event.elapsedMs)||event.elapsedMs<0)return null;
 const result={phase:event.phase,elapsedMs:event.elapsedMs};
 for(const [key,max]of [['changedScripts',16],['databaseBytes',32*1024**3],['copiedBytes',32*1024**3]])if(event[key]!==undefined){if(!Number.isSafeInteger(event[key])||event[key]<0||event[key]>max)return null;result[key]=event[key];}
 return result;
}
