const phases=new Set(['snapshot.start','snapshot.copying','snapshot.complete','fork.start','operation.start','operation.complete']);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export function recoveryProgressPreview(event){
 if(!event||!phases.has(event.phase))return null;const result={phase:event.phase};
 for(const key of ['artifactId','revision'])if(uuid(event[key]))result[key]=event[key];
 for(const key of ['completedFiles','totalFiles'])if(Number.isSafeInteger(event[key])&&event[key]>=0&&event[key]<=250000)result[key]=event[key];
 return result;
}
