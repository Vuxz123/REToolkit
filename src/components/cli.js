import path from 'node:path';
import {createToolkit} from '../toolkit.js';
import {invokeAssetApi,validateAssetParams} from '../assets/api.js';
import {readJson,check} from '../recovery/artifacts.js';
export const isComponentCommand=argv=>argv[0]==='components';
export const componentUsage=`Unity component and current-library mapping
  retk components scan <Game>
  retk components observe <Game> --component-ids <JSON-array> [--stage <migration UUID>] [--timeout-seconds 600]
  retk components plan <Game> --observation <UUID> [--mappings <JSON-array>]
  retk components apply <Game> --operation <component-plan UUID>
  retk components verify <Game> --operation <component-plan UUID> [--observation <post-apply UUID>]
  retk components report <Game> --operation <UUID> [--section summary|groups|targets|decisions]
Report: --limit 1..100, --cursor, --query. Alternative: --params-file <JSON>.
Global: --root, --json, --help. Native components are preserved; rebind writes staging only.
`;
export async function runComponentCli(argv,defaultRoot){
 check(argv.length<=40&&Buffer.byteLength(JSON.stringify(argv))<=512*1024,'Component CLI exceeds argument budget');const positional=[],params={},options={},seen=new Set(),keys={'component-ids':'componentIds',stage:'stageOperationId',observation:'observationId',operation:'operationId',mappings:'mappings',section:'section',limit:'limit',cursor:'cursor',query:'query','timeout-seconds':'timeoutSeconds'};
 for(let i=0;i<argv.length;i++){const token=argv[i];if(!token.startsWith('--')){positional.push(token);continue;}const key=token.slice(2);check(!seen.has(key),'Duplicate component option');seen.add(key);if(['json','help'].includes(key)){options[key]=true;continue;}check(Object.hasOwn(keys,key)||['root','params-file'].includes(key),'Unknown component option');const value=argv[++i];check(value&&!value.startsWith('--')&&!/[\x00-\x1f]/.test(value),'Missing component option value');if(key==='root'||key==='params-file')options[key]=value;else if(['component-ids','mappings'].includes(key))params[keys[key]]=JSON.parse(value);else if(['limit','timeout-seconds'].includes(key)){check(/^[1-9]\d*$/.test(value),'Invalid numeric component option');params[keys[key]]=Number(value);}else params[keys[key]]=value;}
 if(options.help){process.stdout.write(componentUsage);return;}
 const [group,command,name,...extra]=positional;check(group==='components'&&name&&!extra.length&&['scan','observe','plan','apply','verify','report'].includes(command),'Expected component operation and workspace');check(!options['params-file']||!Object.keys(params).length,'Choose params file or explicit options');
 const request=options['params-file']?readJson(path.resolve(options['params-file']),512*1024):params;validateAssetParams('components.'+command,request);
 const toolkit=createToolkit(path.resolve(options.root??defaultRoot),{log:m=>console.error(m)}),result=await invokeAssetApi(toolkit,name,'components.'+command,request);process.stdout.write(JSON.stringify(result,null,options.json?undefined:2)+'\n');return result;
}
