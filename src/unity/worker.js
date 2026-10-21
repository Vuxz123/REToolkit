// This detached supervisor alone observes Editor close. Its marker and reader
// survive forced supervisor death and cannot be reclaimed from a dead PID.
import fs from 'node:fs';
import path from 'node:path';
import {acquireToolchainRead} from '../toolchain/lease.js';
import {executeUnityChild} from './child.js';

const reservation=process.argv[2];
let config,marker,reader,attempted=false,closed=false;
async function report(value){
  if(process.connected)await new Promise(resolve=>process.send({type:'unity-result',token:config.token,...value},()=>resolve()));
  if(process.connected)process.disconnect();
}
try{
  config=JSON.parse(fs.readFileSync(reservation,'utf8'));
  marker=path.join(path.dirname(reservation),`unity-${process.pid}-${config.token}.json`);
  fs.renameSync(reservation,marker);
  reader=acquireToolchainRead(config.toolkitRoot);
  const importing=config.purpose==='library-import';
  const args=['-batchmode','-nographics',...(importing?[]:['-quit']),'-projectPath',config.projectDir,'-executeMethod',importing?'REToolkit.LibraryImport.Run':'REToolkit.EditorValidation.Run','-logFile','-','-retkRequest',config.requestFile,'-retkReport',config.reportFile];
  const engine=config.engine??{file:config.editor,args:[]};
  attempted=true;
  const result=await executeUnityChild({file:engine.file,args:[...engine.args,...args],cwd:config.projectDir,env:{...process.env,...engine.env},timeoutSeconds:config.timeoutSeconds,token:config.token});
  closed=true;
  reader.release();reader=null;fs.unlinkSync(marker);marker=null;
  await report(result);
}catch(error){
  const certain=!attempted||closed||error.closed===true;
  if(certain){try{reader?.release();reader=null;if(marker)fs.unlinkSync(marker);marker=null;}catch{await report({error:{code:'unity_recovery_required'}});process.exitCode=1;}}
  await report({error:{code:certain&&marker===null?(error.code==='TOOLCHAIN_BUSY'?'TOOLCHAIN_BUSY':'unity_start_failed'):'unity_recovery_required',message:'Unity Editor validation could not complete.'}});
  process.exitCode=1;
}
