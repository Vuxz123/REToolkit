import {createToolkit} from '../toolkit.js';
import {runProcess} from '../process.js';
import {executeJob,observedRun} from './service.js';

// Only fixed positional workspace/job identifiers are accepted. The saved
// request is revalidated; no executable, shell text or module path is accepted.
const [root,name,jobId,...extra]=process.argv.slice(2);
if(!root||!name||!jobId||extra.length)process.exitCode=1;
else {
 try {
  let progress=()=>{};
  const toolkit=createToolkit(root,{log:()=>{},run:observedRun(runProcess,(...args)=>progress(...args))});
  const result=await executeJob(toolkit,name,jobId,{onProgress:observer=>{progress=observer;}});
  process.exitCode=result.state==='succeeded'?0:1;
 }catch{process.exitCode=1;}
}
