import path from 'node:path';
import {toolchainError} from '../toolchain/manifest.js';
import {runSetup} from './service.js';

export const isSetupCommand=argv=>argv[0]==='setup';
export const setupUsage=`Node native engine setup (Windows x64, Node24+)
  setup resolve [--components jdk,ghidra] [--out <fresh.lock.json>]
  setup plan [--components jdk,ghidra] [--lock <reviewed.lock.json>]
  setup install [--components jdk,ghidra] [--lock <reviewed.lock.json>] [--cache <folder>]
  setup install --all --native-only
  setup status
Versions: --jdk-version 21.0.11 --ghidra-version 12.1.2 --dumper-version 6.7.48 --assetripper-version 1.3.14
Global: --root <toolkit> --json --help
Resolve/plan use release metadata unless --lock is supplied. Existing toolchain plan remains offline.
Full --all requires separate GUI Python, extension and global .NET profiles; it never silently skips them.
`;
const fail=message=>{throw toolchainError('SETUP_ARGUMENT_INVALID',message);};
export function parseSetupArgs(argv){
 const args=[],options={},cli={},seen=new Set();
 const values=['components','root','lock','out','cache','require-component','jdk-version','ghidra-version','dumper-version','assetripper-version'];
 for(let index=0;index<argv.length;index++){
  const token=argv[index];if(!token.startsWith('--')){args.push(token);continue;}
  const key=token.slice(2);
  if(seen.has(key)&&key!=='require-component')fail('Duplicate setup option');seen.add(key);
  if(['json','help'].includes(key)){cli[key]=true;continue;}
  if(['all','native-only'].includes(key)){options[key==='all'?'all':'nativeOnly']=true;continue;}
  if(!values.includes(key))fail('Unknown setup option');
  const value=argv[++index];if(!value||value.startsWith('--')||/[\0\r\n]/.test(value))fail('Missing or invalid setup value');
  if(key==='root')cli.root=value;
  else if(key==='components')options.components=value.split(',');
  else if(key==='require-component')(options.requiredComponents??=[]).push(value);
  else if(key.endsWith('-version'))(options.versions??={})[key.slice(0,-8)]=value;
  else options[key]=value;
 }
 if(cli.help)return {help:true};
 const [command,action,...extra]=args;
 if(command!=='setup'||!['resolve','plan','install','status'].includes(action)||extra.length)fail('Expected one fixed setup operation');
 if(action==='status'&&Object.keys(options).length||options.out&&action!=='resolve'||options.cache&&action!=='install')fail('Unsupported setup option for this operation');
 if(options.components&&(!options.components.length||options.components.length>4||new Set(options.components).size!==options.components.length||options.components.some(id=>!['jdk','ghidra','dumper','assetripper'].includes(id))))fail('Select unique supported native components');
 if(options.lock&&['components','versions','all','nativeOnly','requiredComponents'].some(key=>options[key]!==undefined))fail('An explicit lock defines package selection');
 if(options.nativeOnly&&!options.all||options.all&&options.components)fail('Ambiguous native selection');
 return {action,options,cli};
}
export async function runSetupCli(argv,defaultRoot){
 const parsed=parseSetupArgs(argv);if(parsed.help){console.log(setupUsage);return;}
 const options={...parsed.options};
 if(parsed.action==='install'){
  let last=0;
  options.onProgress=event=>{
   if(!Number.isSafeInteger(event.received)||!Number.isSafeInteger(event.total)||event.received<0||event.total<=0)return;
   const now=Date.now();if(now-last<500&&event.received!==event.total)return;last=now;
   process.stderr.write(`Download ${Math.floor(100*event.received/event.total)}% (${event.received}/${event.total} bytes), attempt ${event.attempt}\n`);
  };
 }
 const result=await runSetup(path.resolve(parsed.cli.root??defaultRoot),parsed.action,options);
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 if(parsed.action==='status'&&!result.ok)process.exitCode=1;
}
