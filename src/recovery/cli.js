import path from 'node:path';
import {createToolkit} from '../toolkit.js';
import {validateAssetParams,invokeAssetApi,definitions} from '../assets/api.js';
import {validateSchema} from '../jobs/definitions.js';
import {readJson,check} from './artifacts.js';

export const recoveryUsage=`Versioned reconstruction artifact and diagnosis
  retk recovery create <Game>
  retk recovery status|history|diagnose <Game> --artifact <UUID>
  retk recovery run <Game> --artifact <UUID> --revision <UUID>
       --operation <typed operation> [--params <JSON> | --params-file <JSON-file>]
Paging: --limit 1..100, --cursor <cursor>; diagnose: --query <text>.
After inspecting an uncertain write: recovery abandon <Game> --artifact <UUID>
       --revision <UUID> --intent <UUID> (retains candidate files, never retries).
Global: --root <toolkit>, --json, --help.
Existing direct commands still target the original export. No runtime stub is
automatically replaced. Run reconstruct.validate on the current artifact after
library/migration adoption; library verify refers to a separate import stage.
`;
export const isRecoveryCommand=argv=>argv[0]==='recovery';
export function parseRecoveryArgs(argv){
 check(Array.isArray(argv)&&argv.length<=64&&argv.every(v=>typeof v==='string')&&Buffer.byteLength(JSON.stringify(argv))<=128*1024,'Recovery argument limit exceeded');
 const positional=[],params={},options={},seen=new Set();
 for(let i=0;i<argv.length;i++){
  const token=argv[i];if(!token.startsWith('--')){positional.push(token);continue;}
  const [key,...equal]=token.slice(2).split('=');check(!seen.has(key),'Duplicate recovery option');seen.add(key);
  if(['json','help'].includes(key)){check(!equal.length,'Flag cannot take a value');options[key]=true;continue;}
  check(['root','artifact','revision','operation','params','params-file','limit','cursor','query','intent'].includes(key),'Unknown recovery option');
  const value=equal.length?equal.join('='):argv[++i];check(value&&!value.startsWith('--')&&!/[\x00-\x1f]/.test(value),'Missing or invalid recovery option value');
  if(['root','params-file'].includes(key))options[key]=value;
  else if(key==='params'){try{params.params=JSON.parse(value);}catch{check(false,'Invalid operation JSON');}}
  else if(key==='limit'){check(/^[1-9]\d*$/.test(value),'Invalid limit');params.limit=Number(value);}
  else params[key==='artifact'?'artifactId':key==='intent'?'intentId':key]=value;
 }
 if(options.help)return {help:true};
 const [group,command,name,...extra]=positional;check(group==='recovery'&&['create','status','history','diagnose','run','abandon'].includes(command)&&typeof name==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(name)&&!extra.length,'Expected one recovery workspace');
 check(!(seen.has('params')&&options['params-file'])&&(!options['params-file']||command==='run'),'Invalid params-file option');
 if(command==='run'&&!params.params)params.params={};
 if(options['params-file']){
  const {oneOf,...outer}=definitions['recovery.run'];validateSchema(params,{type:'object',additionalProperties:false,...outer});
 }else validateAssetParams('recovery.'+command,params);
 return {command,name,params,options};
}
export async function runRecoveryCli(argv,defaultRoot){
 const parsed=parseRecoveryArgs(argv);if(parsed.help){console.log(recoveryUsage);return;}
 const {name,command,params,options}=parsed;
 if(options['params-file'])params.params=readJson(path.resolve(options['params-file']),32*1024**2);
 const toolkit=createToolkit(path.resolve(options.root??defaultRoot),{log:message=>console.error(message)});
 const result=await invokeAssetApi(toolkit,name,'recovery.'+command,params);const output=JSON.stringify(result,null,options.json?undefined:2);
 check(Buffer.byteLength(output)<=2*1024**2,'Recovery output exceeds budget; request a smaller page');process.stdout.write(output+'\n');return result;
}
