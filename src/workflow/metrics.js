import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
const phases=new Set(['total','input.verify','inventory.verify','snapshot.copy','snapshot.verify','fork','stage.adopt','graph.index','graph.refresh','source.parser','unity.stage','unity.execute','engine.execute','domain.operation']);
export const currentPhaseMetrics=()=>context.getStore();
export const withPhaseMetrics=(metrics,action)=>context.run(metrics,action);
export const measurePhase=(phase,action)=>context.getStore()?.measure(phase,action)??action();
export const measurePhaseSync=(phase,action)=>context.getStore()?context.getStore().measureSync(phase,action):action();
export const countPhaseWork=(phase,bytes,files=0)=>context.getStore()?.count(phase,bytes,files);
export function phaseMetricsPreview(value){
 if(!Array.isArray(value))return [];return value.slice(0,32).filter(r=>r&&phases.has(r.phase)).map(r=>{
  const row={phase:r.phase};for(const key of ['calls','elapsedMs','bytes','files'])if(Number.isFinite(r[key])&&r[key]>=0&&r[key]<=Number.MAX_SAFE_INTEGER)row[key]=Math.round(r[key]*1000)/1000;return row;
 });
}
export function createPhaseMetrics(clock=()=>performance.now()){
 const rows=new Map();const row=phase=>{if(!phases.has(phase))throw Error('Unknown metric phase');if(!rows.has(phase))rows.set(phase,{phase,calls:0,elapsedMs:0,bytes:0,files:0});return rows.get(phase);};
 return {async measure(phase,action){const r=row(phase),start=clock();r.calls++;try{return await action();}finally{r.elapsedMs+=Math.max(0,clock()-start);}},measureSync(phase,action){const r=row(phase),start=clock();r.calls++;try{return action();}finally{r.elapsedMs+=Math.max(0,clock()-start);}},count(phase,bytes,files=0){const r=row(phase);r.bytes+=bytes;r.files+=files;},snapshot:()=>phaseMetricsPreview([...rows.values()])};
}
