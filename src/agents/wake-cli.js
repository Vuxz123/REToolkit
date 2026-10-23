import path from 'node:path';
import {createToolkit} from '../toolkit.js';
import {validateAssetParams,validateAssetParamsForJob,invokeAssetApi} from '../assets/api.js';

export const isWakeCommand=argv=>argv[0]==='agents'&&argv[1]==='wake-after'||argv[0]==='jobs'&&argv[1]==='wait';
const usage=`Job completion and Codex CLI wake
  retk jobs wait <Game> --job-id <UUID> [--timeout-seconds 25] [--json]
  retk agents wake-after <Game> --job-id <UUID> --thread-id <Codex UUID>
       --task observe-job|verify-source-and-scoped-unity
       [--operation <source UUID> --asset-ids <JSON-array>]
       [--wait-timeout-seconds 86400] [--root <toolkit>] [--json]
Registers one background watcher; queue acceptance does not prove Agent work.
`;
const fail=()=>{throw Object.assign(Error('Invalid wait/wake arguments; exact job/thread and typed task are required'),{code:'agent_wake_arguments_invalid'});};
export function parseWakeArgs(argv){
 const positionals=[],params={},options={},seen=new Set(),keys={'job-id':'jobId','thread-id':'threadId',task:'task',operation:'operationId','asset-ids':'assetIds','timeout-seconds':'timeoutSeconds','wait-timeout-seconds':'waitTimeoutSeconds',root:'root'};
 for(let i=0;i<argv.length;i++){
  const token=argv[i];if(!token.startsWith('--')){positionals.push(token);continue;}
  const key=token.slice(2);if(seen.has(key))fail();seen.add(key);
  if(key==='help'||key==='json'){options[key]=true;continue;}
  if(!Object.hasOwn(keys,key))fail();const value=argv[++i];if(!value||value.startsWith('--')||/[\x00-\x1f]/.test(value))fail();
  if(key==='root')options.root=value;
  else if(key==='asset-ids'){try{params.assetIds=JSON.parse(value);}catch{fail();}}
  else if(key.endsWith('-seconds')){if(!/^[1-9]\d*$/.test(value))fail();params[keys[key]]=Number(value);}
  else params[keys[key]]=value;
 }
 if(options.help)return {help:true};
 const [group,command,name,...extra]=positionals;if(!isWakeCommand([group,command])||!name||extra.length)fail();
 if(group==='jobs')validateAssetParams('jobs.wait',params);else validateAssetParamsForJob('agent.wake_after',params);
 return {group,command,name,params,options};
}
export async function runWakeCli(argv,defaultRoot){
 const parsed=parseWakeArgs(argv);if(parsed.help){console.log(usage);return;}
 const toolkit=createToolkit(path.resolve(parsed.options.root??defaultRoot),{log:message=>process.stderr.write(String(message)+'\n')});
 const result=parsed.group==='jobs'?await invokeAssetApi(toolkit,parsed.name,'jobs.wait',parsed.params):await invokeAssetApi(toolkit,parsed.name,'jobs.start',{operation:'agent.wake_after',params:parsed.params});
 console.log(JSON.stringify(result,null,2));
}
