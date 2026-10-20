import path from 'node:path';
import {readPythonLock,planPythonRuntime} from './manifest.js';
import {installPythonRuntime} from './installer.js';
import {verifyPythonRuntime} from './verify.js';

export const pythonRuntimeUsage=`Locked Python/MCP CLI (Windows x64 CPython 3.12)
  python-runtime plan <lock.json> [--root <toolkit>] [--json]
  python-runtime install <lock.json> [--cache <folder>] [--root <toolkit>] [--json]
  python-runtime verify [--root <toolkit>] [--json]
Plan/verify are offline. Install executes the explicitly locked Python/pip locally,
downloads missing checksummed assets, and installs wheels without online resolution.
`;
const invalid=message=>{throw Object.assign(new Error(message),{code:'PYTHON_ARGUMENT_INVALID'});};
export function isPythonRuntimeCommand(raw){for(let i=0;i<raw.length;i++){const token=raw[i];if(token==='--root'){i++;continue;}if(token.startsWith('--'))continue;return token==='python-runtime';}return false;}
export function parsePythonRuntimeArgs(raw){
 const options={},args=[];
 for(let i=0;i<raw.length;i++){const token=raw[i];if(!token.startsWith('--')){args.push(token);continue;}const split=token.indexOf('='),key=token.slice(2,split<0?undefined:split);if(Object.hasOwn(options,key))invalid('Duplicate option: '+key);
  if(['root','cache'].includes(key)){const value=split<0?raw[++i]:token.slice(split+1);if(!value||value.startsWith('--'))invalid('Option requires a value: '+key);options[key]=value;}
  else if(['json','help'].includes(key)&&split<0)options[key]=true;else invalid('Unknown Python runtime option: '+key);
 }
 if(options.help)return {help:true};const [command,action,lock,...extra]=args;
 if(command!=='python-runtime'||!['plan','install','verify'].includes(action)||extra.length||(action==='verify'?lock!==undefined:!lock)||options.cache&&action!=='install')invalid('Invalid Python runtime arguments\n'+pythonRuntimeUsage);
 return {action,lock,options};
}
export async function runPythonRuntimeCli(raw,defaultRoot){const parsed=parsePythonRuntimeArgs(raw);if(parsed.help){console.log(pythonRuntimeUsage);return;}const {action,lock,options}=parsed,root=path.resolve(options.root??defaultRoot);const result=action==='verify'?await verifyPythonRuntime(root):action==='plan'?planPythonRuntime(root,await readPythonLock(lock)):await installPythonRuntime(root,await readPythonLock(lock),{cache:options.cache});console.log(JSON.stringify(result,null,2));if(action==='verify'&&!result.ok)process.exitCode=1;}
