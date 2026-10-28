import path from 'node:path';
import {createToolkit} from '../toolkit.js';
import {invokeAssetApi,validateAssetParams} from '../assets/api.js';
import {readJson} from '../recovery/artifacts.js';
import {check} from './provenance.js';
import {validationProgressPreview} from '../unity/progress.js';
export const dataUsage=`ScriptableObject serialized data contracts (staged Editor, never Play Mode)
  retk data capture <Game> --asset-ids <JSON-array-of-asset:GUID>
  retk data qualify <Game> --baseline <retained baseline UUID>
  retk data verify <Game> --baseline <baseline UUID> [--reuse-verification <saved verify UUID>]
  retk data report <Game> --operation <UUID> [--section summary|objects|properties|differences]
Capture/verify: --timeout-seconds 1..3600. Report: --limit 1..100, --cursor, --query.
Alternative DTO: --params-file <JSON-file>. Global: --root, --json, --help.
Baseline records initial observed data; verification is not gameplay equivalence.
`;
export const isDataCommand=argv=>argv[0]==='data';
export async function runDataCli(argv,defaultRoot){
 check(argv.length<=40&&Buffer.byteLength(JSON.stringify(argv))<=256*1024,'Data CLI exceeds argument budget');const positional=[],params={},options={},seen=new Set(),keys={'asset-ids':'assetIds',baseline:'baselineId','reuse-verification':'reuseVerificationId',operation:'operationId',section:'section',limit:'limit',cursor:'cursor',query:'query','timeout-seconds':'timeoutSeconds'};
 for(let i=0;i<argv.length;i++){
  const token=argv[i];if(!token.startsWith('--')){positional.push(token);continue;}
  const key=token.slice(2);check(!seen.has(key),'Duplicate data option');seen.add(key);if(['json','help'].includes(key)){options[key]=true;continue;}
  check(Object.hasOwn(keys,key)||['root','params-file'].includes(key),'Unknown data option');const value=argv[++i];check(value&&!value.startsWith('--')&&!/[\x00-\x1f]/.test(value),'Missing data option value');
  if(key==='root'||key==='params-file')options[key]=value;
  else if(key==='asset-ids')params.assetIds=JSON.parse(value);
  else if(key==='limit'||key==='timeout-seconds'){check(/^[1-9]\d*$/.test(value),'Invalid numeric data option');params[keys[key]]=Number(value);}
  else params[keys[key]]=value;
 }
 if(options.help){process.stdout.write(dataUsage);return;}
 const [group,command,name,...extra]=positional;check(group==='data'&&['capture','qualify','verify','report'].includes(command)&&name&&!extra.length,'Expected data operation and workspace');check(!options['params-file']||Object.keys(params).length===0,'Choose explicit options or a params file');
 const request=options['params-file']?readJson(path.resolve(options['params-file']),256*1024):params;validateAssetParams('data.'+command,request);
 const toolkit=createToolkit(path.resolve(options.root??defaultRoot),{log:m=>console.error(m)});
 toolkit.onValidationProgress=event=>{const progress=validationProgressPreview(event);if(progress)process.stderr.write(JSON.stringify({kind:'unity-validation-progress',...progress})+'\n');};
 const result=await invokeAssetApi(toolkit,name,'data.'+command,request),output=JSON.stringify(result,null,options.json?undefined:2);check(Buffer.byteLength(output)<=2*1024**2,'Data output exceeds budget; use report paging');process.stdout.write(output+'\n');return result;
}
