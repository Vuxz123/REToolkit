import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {rejectOutputLinks} from '../artifacts.js';

const failure=(code,message)=>Object.assign(new Error(message),{code});
const recovery=()=>Object.assign(failure('unity_recovery_required','Unity child closure is unconfirmed; inspect retained workspace and toolchain ownership before recovery.'),{preserveToolchainGate:true});
const optionKeys=['editor','projectDir','requestFile','reportFile','lockDirectory','toolkitRoot','timeoutSeconds','purpose'];
export async function runUnityEditor(options,dependencies={}){
  if(!options||Object.keys(options).some(key=>!optionKeys.includes(key)))throw failure('invalid_argument','Unsupported Unity execution option.');
  const config={...options,timeoutSeconds:options.timeoutSeconds??600,purpose:options.purpose??'validation'};
  if(!['validation','library-import'].includes(config.purpose))throw failure('invalid_argument','Unsupported Unity execution purpose.');
  if(!Number.isFinite(config.timeoutSeconds)||config.timeoutSeconds<=0||config.timeoutSeconds>86400)throw failure('invalid_argument','Unity timeout is invalid.');
  for(const key of optionKeys.filter(key=>!['timeoutSeconds','purpose'].includes(key))){
    if(typeof config[key]!=='string'||!path.isAbsolute(config[key])||/[\0\r\n]/.test(config[key]))throw failure('invalid_argument',`Unity ${key} must be an absolute path.`);
    config[key]=path.resolve(config[key]);rejectOutputLinks(config[key]);
  }
  if(!/^Unity\.exe$/i.test(path.basename(config.editor)))throw failure('invalid_argument','An exact Unity.exe Editor is required.');
  const control=path.dirname(config.projectDir);
  if(path.dirname(config.requestFile)!==control||path.dirname(config.reportFile)!==control||config.requestFile===config.reportFile)throw failure('invalid_argument','Unity request and report must be distinct files in the staging run control directory.');
  if(!fs.statSync(config.lockDirectory).isDirectory()||!fs.statSync(config.projectDir).isDirectory())throw failure('invalid_argument','Unity requires a staging project and workspace lock.');
  const engine=dependencies.engine;
  if(engine){
    if(typeof engine.file!=='string'||!path.isAbsolute(engine.file)||/\.(cmd|bat)$/i.test(engine.file)||!Array.isArray(engine.args)||engine.args.some(arg=>typeof arg!=='string'||arg.includes('\0')))throw failure('invalid_argument','Invalid programmatic Unity fixture engine.');
    config.engine={file:engine.file,args:engine.args,env:engine.env};
  }
  const token=randomUUID(),reservation=path.join(config.lockDirectory,`unity-reserved-${process.pid}-${token}.json`);
  fs.writeFileSync(reservation,JSON.stringify({token,parentPid:process.pid,...config}),{flag:'wx',mode:0o600});
  return await new Promise((resolve,reject)=>{
    let worker,result,spawnError,settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(watchdog);process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);error?reject(error):resolve(value);};
    const cancel=()=>{if(worker?.connected)worker.send({type:'unity-cancel',token},()=>{});};
    // The supervisor's own timeout/close grace should finish first. If it cannot
    // report, leave it and every ownership gate intact; never infer child death.
    const watchdog=setTimeout(()=>{worker?.disconnect();worker?.unref();finish(recovery());},config.timeoutSeconds*1000+20000);
    process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
    try{worker=spawn(process.execPath,[fileURLToPath(new URL('./worker.js',import.meta.url)),reservation],{detached:true,windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});}
    catch(error){fs.unlinkSync(reservation);finish(failure('unity_start_failed','Unity supervisor could not start.'));return;}
    worker.on('error',error=>{spawnError=error;});
    worker.on('message',message=>{if(message?.type==='unity-result'&&message.token===token)result=message;});
    worker.once('close',()=>{
      // Only an unclaimed reservation is known never to have launched an Editor.
      if(fs.existsSync(reservation))fs.unlinkSync(reservation);
      if(result?.error){finish(result.error.code==='unity_recovery_required'?recovery():failure(result.error.code,result.error.message));return;}
      if(spawnError){finish(failure('unity_start_failed','Unity supervisor could not start.'));return;}
      if(!result||result.closed!==true||typeof result.timedOut!=='boolean'||typeof result.logTail!=='string'||Buffer.byteLength(result.logTail)>4*1024*1024||!(result.exitCode===null||Number.isInteger(result.exitCode))){finish(recovery());return;}
      finish(null,{exitCode:result.exitCode,closed:true,timedOut:result.timedOut,logTail:result.logTail});
    });
  });
}
