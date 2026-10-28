import path from 'node:path';
import {createToolkit} from '../toolkit.js';
import {invokeAssetApi,validateAssetParams} from '../assets/api.js';
import {readJson} from '../recovery/artifacts.js';
import {check} from './store.js';
import {workflowDefinitions} from './definitions.js';
export const workflowUsage=`Durable reconstruction task (job completion is not gameplay completion)
  retk workflow create <Game> --params-file goal.json
  retk workflow status|next <Game> [--run <UUID>]
  retk workflow claim|heartbeat|release|checkpoint|wait <Game> --params-file step.json
  retk workflow pause|resume|cancel <Game> --run <UUID> --sequence <integer>
Every mutation returns sequence; use it on the next controller operation.
Use --params <JSON> instead of --params-file for small typed requests.
Global: --root <toolkit>, --json, --help. No arbitrary commands or auto-retries.
`;
export const isWorkflowCommand=argv=>argv[0]==='workflow';
export async function runWorkflowCli(argv,defaultRoot){
 check(argv.length<=32&&Buffer.byteLength(JSON.stringify(argv))<=512*1024,'Workflow CLI exceeds argument budget');
 const positional=[],values={},flags=new Set();
 for(let i=0;i<argv.length;i++){
  const key=argv[i];if(!key.startsWith('--')){positional.push(key);continue;}
  check(!flags.has(key),'Duplicate workflow flag');flags.add(key);
  if(['--json','--help'].includes(key))continue;
  check(['--root','--run','--sequence','--params','--params-file'].includes(key),'Unknown workflow flag');const value=argv[++i];check(value&&!value.startsWith('--')&&!/[\x00-\x1f]/.test(value),'Missing workflow value');values[key]=value;
 }
 if(flags.has('--help')){process.stdout.write(workflowUsage);return;}
 const [group,command,name,...rest]=positional;check(group==='workflow'&&workflowDefinitions['workflow.'+command]&&name&&!rest.length,'Expected workflow command and workspace');
 check(!(values['--params']&&values['--params-file']),'Choose one parameter source');
 const params=values['--params-file']?readJson(path.resolve(values['--params-file']),512*1024):values['--params']?JSON.parse(values['--params']):{};
 if(values['--run']){check(!Object.hasOwn(params,'runId'),'Duplicate runId');params.runId=values['--run'];}
 if(values['--sequence']){check(!Object.hasOwn(params,'sequence')&&/^(0|[1-9]\d*)$/.test(values['--sequence']),'Invalid sequence');params.sequence=Number(values['--sequence']);}
 validateAssetParams('workflow.'+command,params);const toolkit=createToolkit(path.resolve(values['--root']??defaultRoot),{log:m=>console.error(m)});
 const result=await invokeAssetApi(toolkit,name,'workflow.'+command,params),output=JSON.stringify(result,null,flags.has('--json')?undefined:2);
 check(Buffer.byteLength(output)<=2*1024**2,'Workflow result exceeds output budget');process.stdout.write(output+'\n');return result;
}
