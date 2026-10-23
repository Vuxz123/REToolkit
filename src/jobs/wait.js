import fs from 'node:fs';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {assertAssetPath} from '../assets/context.js';
import {validateAssetParams} from '../assets/api.js';

const terminal=new Set(['succeeded','failed','unknown']);

// This observer deliberately uses getJob's public, bounded snapshot. In
// particular, a deadline does not establish that an engine or worker closed.
export async function waitForJob(toolkit,name,params,dependencies={}){
 validateAssetParams('jobs.wait',params);
 const started=performance.now(),timeoutMs=dependencies.deadlineMs??(params.timeoutSeconds??25)*1000;
 const deadline=started+timeoutMs,reconcileMs=dependencies.reconcileMs??1000;
 const getJob=dependencies.getJob??(await import('./service.js')).getJob;
 const watch=dependencies.watch??fs.watch;
 const {timeoutSeconds,...readParams}=params;
 const finish=(snapshot,state)=>({...snapshot,wait:{state,elapsedMs:Math.max(0,Math.round(performance.now()-started))}});
 let snapshot=await getJob(toolkit,name,readParams);
 if(terminal.has(snapshot.state))return finish(snapshot,'terminal');
 if(performance.now()>=deadline)return finish(snapshot,'timed-out');

 // Validate the bound directory independently of injected getJob implementations.
 // Watching the directory survives atomic record.json replacement on all hosts.
 const workspace=assertAssetPath(toolkit.workspace(name));
 const directory=assertAssetPath(path.join(workspace,'04_Notes/jobs',params.jobId),workspace);
 let watcher,deadlineTimer,reconcileTimer,signal,revision=0,watchError;
 const wake=()=>{revision++;const resolve=signal;signal=undefined;resolve?.();};
 const onChange=(_event,filename)=>{
  if(filename===null||filename===undefined||String(filename)==='record.json')wake();
 };
 const onError=error=>{watchError=error;wake();};
 const onDeadline=()=>{
  const remaining=deadline-performance.now();
  // Timer delays are rounded by the runtime. An early callback must not consume
  // the only deadline signal and leave the observer waiting for reconciliation.
  if(remaining>0)deadlineTimer=setTimeout(onDeadline,Math.ceil(remaining));else wake();
 };
 try{
  watcher=watch(directory,{persistent:false},onChange);
  watcher.on('error',onError);
  deadlineTimer=setTimeout(onDeadline,Math.max(0,Math.ceil(deadline-performance.now())));
  reconcileTimer=setInterval(wake,reconcileMs);
  // Re-read immediately after subscription to cover completion in the gap after
  // the initial read. All later reads are serialized; events during reads remain
  // visible through revision, rather than being lost when a promise is replaced.
  while(true){
   const observedRevision=revision;
   if(watchError)throw watchError;
   snapshot=await getJob(toolkit,name,readParams);
   if(watchError)throw watchError;
   if(terminal.has(snapshot.state))return finish(snapshot,'terminal');
   if(performance.now()>=deadline)return finish(snapshot,'timed-out');
   if(revision!==observedRevision)continue;
   await new Promise(resolve=>{signal=resolve;});
  }
 }finally{
  clearTimeout(deadlineTimer);clearInterval(reconcileTimer);signal=undefined;
  if(watcher){watcher.removeListener('error',onError);watcher.close();}
 }
}
