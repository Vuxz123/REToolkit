import path from 'node:path';
import {createToolkit} from '../toolkit.js';
import {readAssetJson} from '../assets/service.js';
import {readLibraryConfig,addLibraryRoot,runLibraryOperation} from './service.js';
export const isLibraryCommand=argv=>argv[0]==='libraries';
export const libraryUsage=`Local Unity library catalog (configured ZIP roots)
  node re.js libraries roots list
  node re.js libraries roots add <folder>
  node re.js libraries scan
  node re.js libraries list [--query <text>] [--limit 100] [--cursor <cursor>]
  node re.js libraries identify|plan <Game> [--requirements <json>]
  node re.js libraries identify <Game> [--section candidates|installed|requirements] [--limit 100] [--cursor <cursor>]
  node re.js libraries import|verify <Game> --operation <UUID>
Global: --root <toolkit>, --json. Imports use staging; original exports stay unchanged.
`;
export function parseLibraryArgs(argv){
 const positional=[],params={},options={},seen=new Set();
 for(let i=0;i<argv.length;i++){
  const token=argv[i];if(!token.startsWith('--')){positional.push(token);continue;}
  const key=token.slice(2);if(seen.has(key))throw Error('Duplicate library option');seen.add(key);
  if(['json','help'].includes(key)){options[key]=true;continue;}
  if(!['root','requirements','section','limit','query','cursor','operation'].includes(key))throw Error('Unknown library option');
  const value=argv[++i];if(!value||value.startsWith('--'))throw Error('Missing library option value');
  if(['root','requirements'].includes(key))options[key]=value;else if(key==='limit'){if(!/^[1-9]\d*$/.test(value)||Number(value)>1000)throw Error('Invalid library limit');params.limit=Number(value);}else params[key==='operation'?'operationId':key]=value;
 }
 if(options.help)return {help:true};const [,command,...rest]=positional;let method,name;
 if(command==='roots'){
  const [action,folder,...extra]=rest;if(extra.length||!['list','add'].includes(action)||action==='add'&&!folder||action==='list'&&folder||Object.keys(params).length||options.requirements)throw Error('Invalid library root command');
  return {method:'libraries.roots.'+action,directory:folder,options,params};
 }
 if(!['scan','list','identify','plan','import','verify'].includes(command))throw Error('Unknown library command');method='libraries.'+command;
 if(['scan','list'].includes(command)){if(rest.length)throw Error('Unexpected workspace argument');}else{if(rest.length!==1||!/^[A-Za-z0-9_.-]{1,64}$/.test(rest[0]))throw Error('Expected one workspace name');[name]=rest;}
 const allowed={scan:[],list:['query','limit','cursor'],identify:['section','query','limit','cursor'],plan:[],import:['operationId'],verify:['operationId']}[command];
 if(Object.keys(params).some(p=>!allowed.includes(p))||options.requirements&&!['identify','plan'].includes(command))throw Error('Unsupported library option');
 if(['import','verify'].includes(command)&&! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(params.operationId??''))throw Error('Expected saved operation UUID');
 return {method,name,params,options};
}
export async function runLibraryCli(argv,defaultRoot){
 const parsed=parseLibraryArgs(argv);if(parsed.help){console.log(libraryUsage);return;}
 const toolkit=createToolkit(path.resolve(parsed.options.root??defaultRoot),{log:message=>console.error(message)});
 if(parsed.options.requirements)parsed.params.requirements=readAssetJson(path.resolve(parsed.options.requirements),1024**2);
 const result=parsed.method==='libraries.roots.list'?readLibraryConfig(toolkit):parsed.method==='libraries.roots.add'?addLibraryRoot(toolkit,parsed.directory):await runLibraryOperation(toolkit,parsed.name,parsed.method,parsed.params);
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
