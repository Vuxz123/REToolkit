import path from 'node:path';
import {createToolkit} from '../toolkit.js';
import {validateAssetParamsForJob} from '../assets/api.js';

export const isPreparationCommand=argv=>['prepare','preparation'].includes(argv[0]);
const usage=`Automatic project preparation (Node background worker)
  retk prepare <Game> [--profile native|reconstruction]
       [--symbols plan|apply|skip] [--address-mode rva|va]
       [--serial <device> --package <package.name>]
       [--no-auto-pull] [--no-include-data] [--baseline-validation]
       [--resume-run <UUID>] [--root <toolkit>] [--json]
  retk preparation <Game> [--run <UUID>] [--root <toolkit>] [--json]
The worker continues without the agent. Status is read-only and does not take
the workspace engine lock. Preparation does not prove gameplay readiness.
`;
const fail=message=>{throw Object.assign(new Error(message),{code:'PREPARATION_ARGUMENT_INVALID'});};
export function parsePreparationArgs(argv){
 const positionals=[],params={},options={},seen=new Set(),values={profile:'profile',symbols:'symbols','address-mode':'addressMode',serial:'serial',package:'packageName','resume-run':'resumeRunId',run:'runId',root:'root'},flags={json:'json',help:'help','no-auto-pull':'autoPull','no-include-data':'includeData','baseline-validation':'baselineValidation'};
 for(let index=0;index<argv.length;index++){
  const arg=argv[index];if(!arg.startsWith('--')){positionals.push(arg);continue;}
  const key=arg.slice(2);if(seen.has(key))fail('Duplicate preparation option');seen.add(key);
  if(Object.hasOwn(flags,key)){const target=key==='json'||key==='help'?options:params;target[flags[key]]=!key.startsWith('no-');continue;}
  if(!Object.hasOwn(values,key))fail('Unsupported preparation option');const value=argv[++index];if(!value||value.startsWith('--')||/[\x00-\x1f]/.test(value))fail('Missing or invalid preparation option value');
  (key==='root'||key==='run'?options:params)[values[key]]=value;
 }
 if(options.help)return {help:true};
 const [command,name,...extra]=positionals;if(!isPreparationCommand([command])||!name||extra.length)fail('Expected a preparation operation and one workspace');
 if(command==='preparation'&&Object.keys(params).length||command==='prepare'&&options.runId)fail('Unsupported options for the preparation operation');
 if(command==='prepare')validateAssetParamsForJob('workspace.prepare',params);
 return {command,name,params,options};
}
export async function runPreparationCli(argv,defaultRoot){
 const parsed=parsePreparationArgs(argv);if(parsed.help){console.log(usage);return;}
 const toolkit=createToolkit(path.resolve(parsed.options.root??defaultRoot),{log:message=>process.stderr.write(String(message)+'\n')});
 let result;
 if(parsed.command==='prepare'){const {startJob}=await import('../jobs/service.js');result=await startJob(toolkit,parsed.name,{operation:'workspace.prepare',params:parsed.params});}
 else{const {inspectPreparation}=await import('./service.js');result=await inspectPreparation(toolkit,parsed.name,parsed.options.runId?{runId:parsed.options.runId}:{});}
 console.log(JSON.stringify(result,null,2));
}
