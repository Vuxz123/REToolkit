import fs from 'node:fs';import path from 'node:path';
import {assertAssetPath} from '../assets/context.js';
import {planDesktopRuntime,installDesktopRuntime,verifyDesktopRuntime} from './index.js';
const invalid=()=>{throw Error('Usage: retk desktop-runtime plan|install --lock <json> [--cache <folder>] | verify [--root <toolkit>] [--json]');};
export const isDesktopRuntimeCommand=argv=>argv[0]==='desktop-runtime';
export function parseDesktopRuntimeArgs(argv){
 const args=[],options={};for(let i=0;i<argv.length;i++){const token=argv[i];if(!token.startsWith('--')){args.push(token);continue;}const key=token.slice(2);if(Object.hasOwn(options,key))invalid();if(['help','json'].includes(key))options[key]=true;else if(['root','lock','cache'].includes(key)){const value=argv[++i];if(!value||value.startsWith('--'))invalid();options[key]=value;}else invalid();}
 if(options.help)return {help:true};const [group,action,...extra]=args;if(group!=='desktop-runtime'||extra.length||!['plan','install','verify'].includes(action)||(action==='verify'?options.lock!==undefined:!options.lock)||options.cache&&action!=='install')invalid();return {action,options};
}
export async function runDesktopRuntimeCli(argv,defaultRoot){const parsed=parseDesktopRuntimeArgs(argv);if(parsed.help){console.log('retk desktop-runtime plan|install --lock <json> [--cache <folder>]; verify');return;}const {action,options}=parsed,root=path.resolve(options.root??defaultRoot);let result;
 if(action==='verify')result=await verifyDesktopRuntime(root);else {const file=assertAssetPath(path.resolve(options.lock)),stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>1024**2)throw Error('Desktop lock must be a regular JSON file up to 1 MiB');const lock=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));result=action==='plan'?planDesktopRuntime(root,lock):await installDesktopRuntime(root,lock,{cache:options.cache});}
 console.log(JSON.stringify(result,null,2));if(action==='verify'&&!result.ok)process.exitCode=1;
}
