import fs from 'node:fs';
import path from 'node:path';
import {createToolkit} from './toolkit.js';
import {diagnose,formatDiagnostics} from './diagnostics.js';
import {createHandoff,verifyHandoff} from './handoff.js';
import {captureEvidence} from './evidence.js';
import {buildJevRequest,runJevRequest,MAX_REQUEST_BYTES} from './jev.js';
import {loadJevSettings,runConfiguredJevRequest} from './jev-settings.js';
import {artifactError,externalOutput,publishJson,rejectOutputLinks} from './artifacts.js';

export const milestoneUsage=`Diagnostics and evidence handoff
  doctor [Game] [--task prepare|headless|mcp|assetripper] [--probe] [--json]
  status <Game> [--task <task>] [--probe] [--json]
  handoff create <Game> [--out <folder|zip>] [--evidence <folder>]
                    [--include-dummy-dll] [--include-assets] [--include-binaries]
  handoff verify <folder|zip>
  evidence capture <Game> --kind decompile|xrefs|functions [--selector <name/address>]
                    [--direction to|from] [--limit <1..1000>] [--out <external-folder>]
  jev request <bundle> --questions <json> --out <request.json> [--against <bundle>]
                    [--file <relative-path>]... [--model <id>] [--max-state-bytes <n>]
  jev run <request.json> --out <result.json> [--timeout <seconds>]
Global: --root <toolkit>, --json. Request creation is offline; jev run sends selected data.
`;
const values=new Set(['root','task','out','evidence','kind','selector','direction','limit','questions','against','file','model','max-state-bytes','timeout']);
const flags=new Set(['json','probe','include-dummy-dll','include-assets','include-binaries','help']);
const camel=value=>value.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
const specs={doctor:[0,1,['task','probe','timeout']],status:[1,1,['task','probe','timeout']],
 'handoff.create':[1,1,['out','evidence','includeDummyDll','includeAssets','includeBinaries']], 'handoff.verify':[1,1,[]],
 'evidence.capture':[1,1,['kind','selector','direction','limit','out']],
 'jev.request':[1,1,['questions','out','against','files','model','maxStateBytes']], 'jev.run':[1,1,['out','timeout']]};
export function isMilestoneCommand(raw){
 for(let i=0;i<raw.length;i++){const item=raw[i];if(item==='--')return ['doctor','status','handoff','evidence','jev'].includes(raw[i+1]);
  if(item.startsWith('--')){if(values.has(item.slice(2).split('=')[0])&&!item.includes('='))i++;continue;}
  return ['doctor','status','handoff','evidence','jev'].includes(item);
 }return false;
}
export function parseMilestoneArgs(raw){
 const options={},args=[];
 for(let i=0;i<raw.length;i++){
  const item=raw[i];if(item==='--'){args.push(...raw.slice(i+1));break;}
  if(!item.startsWith('--')){args.push(item);continue;}
  const equal=item.indexOf('=');const key=item.slice(2,equal<0?undefined:equal);const property=key==='file'?'files':camel(key);
  if(property!=='files'&&Object.hasOwn(options,property))throw artifactError('invalid_argument',`Duplicate option --${key}`);
  if(values.has(key)){const value=equal<0?raw[++i]:item.slice(equal+1);if(value===undefined||!value||value.startsWith('--'))throw artifactError('invalid_argument',`--${key} requires a value`);
   if(property==='files')(options.files??=[]).push(value);else options[property]=value;
  }else if(flags.has(key)&&equal<0)options[property]=true;
  else throw artifactError('invalid_argument',`Unknown option --${key}`);
 }
 let command=args.shift();if(['handoff','evidence','jev'].includes(command))command+='.'+args.shift();
 if(options.help)return {help:true};
 const spec=specs[command];if(!spec||args.length<spec[0]||args.length>spec[1])throw artifactError('invalid_argument',`Invalid arguments for ${command??'command'}\n${milestoneUsage}`);
 for(const key of Object.keys(options))if(!['root','json','help',...spec[2]].includes(key))throw artifactError('invalid_argument',`Option ${key} is not supported by ${command}`);
 if(options.task&&!['prepare','headless','mcp','assetripper'].includes(options.task))throw artifactError('invalid_argument','Unknown diagnostic task');
 for(const [key,max] of [['limit',1000],['timeout',300],['maxStateBytes',MAX_REQUEST_BYTES]])if(options[key]!==undefined){
  if(!/^\d+$/.test(options[key])||Number(options[key])<1||Number(options[key])>max)throw artifactError('invalid_argument',`${key} must be 1..${max}`);options[key]=Number(options[key]);
 }
 if(['doctor','status'].includes(command)&&options.timeout>30)throw artifactError('invalid_argument','Diagnostic timeout must be 1..30 seconds');
 if(command==='evidence.capture'){
  if(!['decompile','xrefs','functions'].includes(options.kind))throw artifactError('invalid_argument','Evidence requires --kind decompile|xrefs|functions');
  if(options.kind!=='functions'&&!options.selector)throw artifactError('invalid_argument','This evidence kind requires --selector');
  if(options.direction&&!['to','from'].includes(options.direction))throw artifactError('invalid_argument','Direction must be to|from');
 }
 if(command==='jev.request'&&(!options.questions||!options.out))throw artifactError('invalid_argument','Jev request requires --questions and --out');
 if(command==='jev.run'&&!options.out)throw artifactError('invalid_argument','Jev run requires --out');
 return {command,name:args[0],options};
}
function jsonInput(file){
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>MAX_REQUEST_BYTES)throw artifactError('input_invalid','Expected a JSON file of at most 32 MiB');
 try{return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(fs.readFileSync(file)).replace(/^\uFEFF/,''));}
 catch{throw artifactError('input_invalid','Input must be valid UTF-8 JSON');}
}
function newOutput(toolkit,out){const file=externalOutput(toolkit,out);rejectOutputLinks(file);if(fs.existsSync(file))throw artifactError('output_exists','Output already exists; choose a new file');return file;}
export async function runMilestoneCli(raw,defaultRoot){
 const parsed=parseMilestoneArgs(raw);if(parsed.help){console.log(milestoneUsage);return;}
 const {command,name,options}=parsed;const toolkit=createToolkit(path.resolve(options.root??defaultRoot),{log:message=>console.error(message)});
 const print=value=>console.log(JSON.stringify(value,null,2));
 if(command==='doctor'){
  const report=await diagnose(toolkit,{name,task:options.task,probe:options.probe,timeoutMs:options.timeout?options.timeout*1000:undefined});
  console.log(options.json?JSON.stringify(report,null,2):formatDiagnostics(report));if(report.readiness==='blocked')process.exitCode=1;return;
 }
 if(command==='status'){
  const project=await toolkit.status(name);const report=await diagnose(toolkit,{name,task:options.task,probe:options.probe,timeoutMs:options.timeout?options.timeout*1000:undefined});
  print({...project,diagnosticsSchemaVersion:report.schemaVersion,readiness:report.readiness,tasks:report.tasks,diagnostics:report.diagnostics,limitations:report.limitations});return;
 }
 if(command==='handoff.create'){print(await createHandoff(toolkit,name,options));return;}
 if(command==='handoff.verify'){const result=await verifyHandoff(name);print(result);if(!result.ok)process.exitCode=1;return;}
 if(command==='evidence.capture'){print(await captureEvidence(toolkit,name,options));return;}
 if(command==='jev.request'){
  const file=newOutput(toolkit,options.out);const request=await buildJevRequest(name,{...options,model:options.model??loadJevSettings(toolkit.root).settings.model,questions:jsonInput(options.questions)});
  publishJson(file,request,{maxBytes:MAX_REQUEST_BYTES+1});print({path:file,model:request.model,stateBytes:Buffer.byteLength(JSON.stringify(request.state)),network:'not-sent'});return;
 }
 const file=newOutput(toolkit,options.out);const response=await runConfiguredJevRequest(toolkit.root,jsonInput(name),{timeoutMs:(options.timeout??60)*1000});
 publishJson(file,response,{maxBytes:4*1024*1024});print({path:file,model:response.model,usage:response.usage});
}
