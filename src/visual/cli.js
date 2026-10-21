import path from 'node:path';
import {createToolkit} from '../toolkit.js';
import {runVisualComparison,readVisualReport} from './service.js';
import {visualError,LIMITS} from './contract.js';
export const visualUsage=`Visual evidence comparison
  node re.js visual compare <Game> --request <json>
  node re.js visual report <Game> --operation <UUID>
             [--section summary|report|frames|findings] [--limit 1..128] [--cursor <cursor>]
Global: --root <toolkit>, --json, --help.
Inputs are read-only. Missing original baselines and stale evidence remain unverified.
Video requires an explicitly selected ffmpeg executable in its request contract.
`;
const valueKeys=new Set(['root','request','operation','section','limit','cursor']);
const flags=new Set(['json','help']);
const invalid=message=>visualError('visual_argument_invalid',message);
export function isVisualCommand(argv){
 for(let i=0;i<argv.length;i++){const token=argv[i];if(token==='--')return argv[i+1]==='visual';if(token.startsWith('--')){const key=token.slice(2).split('=')[0];if(valueKeys.has(key)&&!token.includes('='))i++;continue;}return token==='visual';}return false;
}
export function parseVisualArgs(argv){
 if(!Array.isArray(argv)||argv.length>64||argv.some(v=>typeof v!=='string')||Buffer.byteLength(JSON.stringify(argv))>16384)throw invalid('Visual argument size limit exceeded');
 const positional=[],options={},params={},seen=new Set();
 for(let i=0;i<argv.length;i++){
 const token=argv[i];if(token==='--'){positional.push(...argv.slice(i+1));break;}if(!token.startsWith('--')){positional.push(token);continue;}
 const equal=token.indexOf('='),key=token.slice(2,equal<0?undefined:equal);if(seen.has(key))throw invalid(`Duplicate visual option --${key}`);seen.add(key);
 if(flags.has(key)){if(equal>=0)throw invalid(`Visual flag --${key} takes no value`);options[key]=true;continue;}
 if(!valueKeys.has(key))throw invalid(`Unknown visual option --${key}`);const value=equal<0?argv[++i]:token.slice(equal+1);if(!value||value.startsWith('--')||/[\x00-\x1f]/.test(value)||value.length>(key==='cursor'?2048:4096))throw invalid(`Missing or invalid visual option --${key} value`);
 if(key==='root'||key==='request')options[key]=value;else if(key==='limit'){if(!/^[1-9]\d*$/.test(value)||Number(value)>128)throw invalid('Visual report limit must be 1..128');params.limit=Number(value);}else params[key==='operation'?'operationId':key]=value;
 }
 const [group,command,name,...extra]=positional;if(group!=='visual'||command!==undefined&&!['compare','report'].includes(command))throw invalid('Unknown visual command');
 if(options.help){if(extra.length)throw invalid('Too many visual arguments');return {help:true};}
 if(!command||!name||extra.length||!/^[A-Za-z0-9_.-]{1,64}$/.test(name)||name.endsWith('.')||['.','..'].includes(name)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))throw invalid('Expected exactly one valid visual workspace name');
 if(command==='compare'){if(!options.request||Object.keys(params).length)throw invalid('Visual compare requires only --request plus global options');}
 else{
 if(options.request||!params.operationId||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(params.operationId))throw invalid('Visual report requires saved --operation UUID');
 if(params.section!==undefined&&!['summary','report','frames','findings'].includes(params.section))throw invalid('Unknown visual report section');
 }
 return {method:'visual.'+command,name,params,options};
}
export async function runVisualCli(argv,defaultRoot,{write=message=>process.stdout.write(message)}={}){
 const parsed=parseVisualArgs(argv);if(parsed.help){write(visualUsage);return;}
 const {name,method,params,options}=parsed,toolkit=createToolkit(path.resolve(options.root??defaultRoot),{log:message=>console.error(message)});
 const result=method==='visual.compare'?await runVisualComparison(toolkit,name,{requestFile:path.resolve(options.request)}):await readVisualReport(toolkit,name,params);
 let output=JSON.stringify(result,null,options.json?undefined:2);if(Buffer.byteLength(output)>LIMITS.requestBytes)output=JSON.stringify(result);if(Buffer.byteLength(output)>LIMITS.requestBytes)throw visualError('visual_payload_limit','Visual CLI output exceeds 1 MiB; request a smaller report page');write(output+'\n');return result;
}
