import path from 'node:path';
import {createToolkit} from '../toolkit.js';
import {invokeAssetApi,validateAssetParams,definitions} from './api.js';
import {readAssetJson} from './service.js';
import {serveAssetsMcp} from './mcp.js';
import {validationProgressPreview} from '../unity/progress.js';
export const assetUsage=`AssetRipper AI bridge (exported Unity project)
  node re.js assets session start|status|stop <Game>
  node re.js assets export|mcp <Game>
  node re.js assets index <Game> [--storage json|sqlite] [--max-graph-mib 128|256|512]
  node re.js assets list <Game> [--kind <kind>] [--search <text>]
  node re.js assets get|tree|refs|source <Game> --id <asset/object ID>
  node re.js assets scripts <Game> [--query <full type/path>] [--evidence <json>]
  node re.js assets raw <Game> --format json --bundle 0,1 --collection 0 --path-id <signed64>
  node re.js reconstruct plan <Game> --request <json> [--evidence <json>]
  node re.js reconstruct apply|verify <Game> --operation <UUID>
  node re.js reconstruct validate <Game> [--mode clean|resident] [--timeout-seconds 600] [--resume-operation <UUID>] [--asset-ids <JSON-array>]
  node re.js reconstruct resident-status|resident-stop <Game>
  node re.js reconstruct validation <Game> --operation <UUID>
Global: --root <directory>, --json; paging: --limit 1..1000, --cursor <cursor>
Stub filling preserves GUID/meta/YAML. Validate in Unity separately; behavior stays unverified.
`;
export const isAssetCommand=argv=>['assets','reconstruct'].includes(argv[0]);
export function parseAssetArgs(argv) {
 const positionals=[],options={},params={},seen=new Set();
 for(let i=0;i<argv.length;i++) {
  const token=argv[i];if(!token.startsWith('--')){positionals.push(token);continue;}
  const [key,...equal]=token.slice(2).split('=');if(seen.has(key))throw Error(`Duplicate --${key}`);seen.add(key);
  if(['json','help'].includes(key)){if(equal.length)throw Error(`Invalid --${key}`);options[key]=true;continue;}
  const value=equal.length?equal.join('='):argv[++i];if(!value||value.startsWith('--'))throw Error(`Missing --${key} value`);
  if(['root','request','evidence'].includes(key)){options[key]=value;continue;}
  const param=key==='resume-operation'?'resumeOperationId':key==='asset-ids'?'assetIds':key==='max-graph-mib'?'graphMaxMiB':key==='operation'?'operationId':key==='path-id'?'pathID':key==='timeout-seconds'?'timeoutSeconds':key;
  if(key==='asset-ids'){try{params[param]=JSON.parse(value);}catch{throw Error('Invalid --asset-ids JSON array');}}
  else if(key==='bundle'){if(value==='[]')params[param]=[];else{if(!/^\d+(?:,\d+)*$/.test(value))throw Error('Invalid bundle');params[param]=value.split(',').map(Number);}}
  else if(['limit','depth','collection','timeout-seconds','max-graph-mib'].includes(key)){if(!/^(0|[1-9]\d*)$/.test(value))throw Error(`Invalid --${key}`);params[param]=Number(value);}else params[param]=value;
 }
 if(options.help)return {help:true};
 const [group,sub,...rest]=positionals;let name,method;
 if(group==='assets'&&sub==='session'){const [action,workspace,...extra]=rest;if(extra.length)throw Error('Too many arguments');method=`assets.session.${action}`;name=workspace;}
 else{[name]=rest;if(rest.length!==1)throw Error('Expected exactly one workspace name');method=`${group}.${sub}`;}
 if(!name||!/^[A-Za-z0-9_.-]{1,64}$/.test(name))throw Error('Invalid workspace name');
 if(method==='assets.mcp'){if(Object.keys(params).length||options.request||options.evidence)throw Error('Unexpected MCP parameters');return {name,method,params,options};}
 if(!Object.hasOwn(definitions,method))throw Error('Unknown asset command');
 if(options.request&&method!=='reconstruct.plan'||options.evidence&&!['assets.scripts','reconstruct.plan'].includes(method))throw Error('Unsupported input file option');
 validateAssetParams(method,{...params,...(options.request?{request:{}}:{}),...(options.evidence?{evidence:[]}: {})});
 return {name,method,params,options};
}
export async function runAssetCli(argv,defaultRoot) {
 const parsed=parseAssetArgs(argv);if(parsed.help){console.log(assetUsage);return;}
 const {name,method,params,options}=parsed,toolkit=createToolkit(path.resolve(options.root??defaultRoot),{log:message=>console.error(message)});
 if(method==='reconstruct.validate')toolkit.onValidationProgress=event=>{const progress=validationProgressPreview(event);if(progress)process.stderr.write(JSON.stringify({kind:'unity-validation-progress',...progress})+'\n');};
 if(method==='assets.mcp')return serveAssetsMcp(toolkit,name);
 if(options.request)params.request=readAssetJson(path.resolve(options.request),32*1024**2);
 if(options.evidence)params.evidence=readAssetJson(path.resolve(options.evidence),1024**2);
 const result=await invokeAssetApi(toolkit,name,method,params);process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
