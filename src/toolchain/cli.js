import path from 'node:path';
import {readToolchainLock,planToolchain,toolchainError} from './manifest.js';
import {installToolchain} from './installer.js';
import {verifyToolchain} from './verify.js';

export const toolchainUsage=`Locked archive installation (Windows x64)
  toolchain plan <lock.json> [--root <toolkit>] [--json]
  toolchain install <lock.json> [--cache <folder>] [--root <toolkit>] [--json]
  toolchain verify [--root <toolkit>] [--json]
Plan/verify are offline. Install explicitly downloads missing checksummed archives.
Supported packages: JDK21, Ghidra, Il2CppDumper, AssetRipper. Legacy Python/MCP/.NET setup remains separate.
`;
export function isToolchainCommand(raw){
 for(let i=0;i<raw.length;i++){const value=raw[i];if(value==='--root'){i++;continue;}if(value.startsWith('--'))continue;return value==='toolchain';}return false;
}
export function parseToolchainArgs(raw){
 const options={},args=[];
 for(let i=0;i<raw.length;i++){
  const token=raw[i];if(!token.startsWith('--')){args.push(token);continue;}
  const split=token.indexOf('='),key=token.slice(2,split<0?undefined:split);
  if(Object.hasOwn(options,key))throw toolchainError('TOOLCHAIN_ARGUMENT_INVALID','Duplicate option: '+key);
  if(['root','cache'].includes(key)){const value=split<0?raw[++i]:token.slice(split+1);if(!value||value.startsWith('--'))throw toolchainError('TOOLCHAIN_ARGUMENT_INVALID','Option requires a value: '+key);options[key]=value;}
  else if(['json','help'].includes(key)&&split<0)options[key]=true;
  else throw toolchainError('TOOLCHAIN_ARGUMENT_INVALID','Unknown toolchain option: '+key);
 }
 if(options.help)return {help:true};
 const [command,action,lock,...extra]=args;
 if(command!=='toolchain'||!['plan','install','verify'].includes(action)||extra.length||(action==='verify'?lock!==undefined:!lock)||options.cache&&action!=='install')throw toolchainError('TOOLCHAIN_ARGUMENT_INVALID','Invalid toolchain arguments\n'+toolchainUsage);
 return {action,lock,options};
}
export async function runToolchainCli(raw,defaultRoot){
 const parsed=parseToolchainArgs(raw);if(parsed.help){console.log(toolchainUsage);return;}
 const {action,lock,options}=parsed,root=path.resolve(options.root??defaultRoot);
 const result=action==='verify'?await verifyToolchain(root):action==='plan'?planToolchain(root,await readToolchainLock(lock)):await installToolchain(root,await readToolchainLock(lock),{cache:options.cache});
 console.log(JSON.stringify(result,null,2));if(action==='verify'&&!result.ok)process.exitCode=1;
}
