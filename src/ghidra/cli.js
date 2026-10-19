import fs from 'node:fs';
import path from 'node:path';
import { createToolkit } from '../toolkit.js';
import { BridgeError } from './protocol.js';
import { fileIdentity } from '../state.js';
import { startSession,stopSession,sessionStatus,querySession,mutateSession,recoverSession } from './provider.js';

export const bridgeUsage=`Persistent Ghidra CLI (existing imported project; stop before opening GUI)
  session start <Game> [--write] [--timeout <seconds>] [--idle-timeout <seconds>]
  session status|stop|recover <Game>
  function list <Game> [--query <name>] [--limit <1..1000>] [--cursor <value>]
  function get <Game> <address>
  function rename <Game> <address> <name> [--dry-run] [--operation-id <uuid>]
  decompile <Game> <address-or-unique-name> [--cursor <value>] [--limit <n>]
  disasm <Game> <address> [--limit <n>] [--cursor <value>]
  xrefs <Game> <address> [--direction to|from] [--limit <n>] [--cursor <value>]
  strings <Game> [--query <text>] [--limit <n>] [--cursor <value>]
  bytes read <Game> <address> --length <1..4096>
  comment set <Game> <address> --type eol|plate|pre|post|repeatable (--text <text>|--file <utf8-file>) [--dry-run]
  symbols plan <Game> --address-mode rva|va [--create-functions] [--replace-user-names] [--replace-user-comments]
  symbols apply <Game> --plan <path> [--dry-run] [--operation-id <uuid>]
Global: --root <toolkit>, --json. No automatic JVM start on query. Target output is untrusted data.
`;
const values=new Set(['root','query','limit','cursor','direction','length','type','text','file','plan','address-mode','operation-id','timeout','idle-timeout']);
const flags=new Set(['json','write','dry-run','create-functions','replace-user-names','replace-user-comments','help']);
const address=/^(?:[A-Za-z_][\w.-]*:)?0x[0-9a-fA-F]+$/;
const specs={
  'session.start':[1,['write','timeout','idleTimeout']], 'session.status':[1,[]], 'session.stop':[1,['timeout']], 'session.recover':[1,[]],
  'function.list':[1,['query','limit','cursor']], 'function.get':[2,[]], 'function.rename':[3,['dryRun','operationId']],
  decompile:[2,['limit','cursor','timeout']], disasm:[2,['limit','cursor']], xrefs:[2,['limit','cursor','direction']],
  strings:[1,['query','limit','cursor']], 'bytes.read':[2,['length']], 'comment.set':[2,['type','text','file','dryRun','operationId']],
  'symbols.plan':[1,['addressMode','createFunctions','replaceUserNames','replaceUserComments']],
  'symbols.apply':[1,['plan','dryRun','operationId']],
};
const camel=name=>name.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
export function isBridgeCommand(raw) {
  return ['session','function','decompile','disasm','xrefs','strings','bytes','comment'].includes(raw[0])||raw[0]==='symbols'&&['plan','apply'].includes(raw[1]);
}
export function parseBridgeArgs(raw) {
  const options={};const args=[];
  for(let i=0;i<raw.length;i++) {
    const item=raw[i];if(item==='--'){args.push(...raw.slice(i+1));break;}
    if(!item.startsWith('--')){args.push(item);continue;}
    const split=item.indexOf('=');const key=item.slice(2,split<0?undefined:split);const property=camel(key);
    if(Object.hasOwn(options,property))throw new BridgeError('invalid_argument',`Duplicate --${key}`);
    if(values.has(key)) {const value=split<0?raw[++i]:item.slice(split+1);if(value===undefined||value.startsWith('--'))throw new BridgeError('invalid_argument',`--${key} requires a value`);options[property]=value;}
    else if(flags.has(key)&&split<0)options[property]=true;
    else throw new BridgeError('invalid_argument',`Unknown option ${item}`);
  }
  let command=args.shift();if(['session','function','bytes','comment','symbols'].includes(command))command+='.'+args.shift();
  if(options.help)return {help:true};
  const spec=specs[command];if(!spec||args.length!==spec[0])throw new BridgeError('invalid_argument',`Invalid arguments for ${command}\n${bridgeUsage}`);
  for(const key of Object.keys(options))if(!['root','json','help',...spec[1]].includes(key))throw new BridgeError('invalid_argument',`Option ${key} is not supported by ${command}`);
  for(const [key,max] of [['limit',1000],['length',4096],['timeout',300],['idleTimeout',86400]])if(options[key]!==undefined) {
    if(!/^\d+$/.test(options[key])||Number(options[key])<1||Number(options[key])>max)throw new BridgeError('invalid_argument',`${key} must be 1..${max}`);options[key]=Number(options[key]);
  }
  if(['function.get','function.rename','disasm','xrefs','bytes.read','comment.set'].includes(command)&&!address.test(args[1]))throw new BridgeError('invalid_argument','Address must be a hex string, optionally space:0x...');
  if(options.direction&&!['to','from'].includes(options.direction))throw new BridgeError('invalid_argument','direction must be to or from');
  if(options.addressMode&&!['rva','va'].includes(options.addressMode))throw new BridgeError('invalid_argument','address-mode must be rva or va');
  if(options.operationId&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(options.operationId))throw new BridgeError('invalid_argument','operation-id must be UUID');
  if(command==='bytes.read'&&!options.length)throw new BridgeError('invalid_argument','bytes read requires --length');
  if(command==='symbols.apply'&&!options.plan)throw new BridgeError('invalid_argument','symbols apply requires --plan');
  if(command==='comment.set') {
    if(!['eol','plate','pre','post','repeatable'].includes(options.type))throw new BridgeError('invalid_argument','comment type must be eol|plate|pre|post|repeatable');
    if((options.text===undefined)===(options.file===undefined))throw new BridgeError('invalid_argument','Choose exactly one --text or --file');
  }
  return {command,name:args[0],args:args.slice(1),options};
}
export async function runBridgeCli(raw,defaultRoot) {
  const parsed=parseBridgeArgs(raw);if(parsed.help){console.log(bridgeUsage);return;}
  const {command,name,args,options}=parsed;const toolkit=createToolkit(path.resolve(options.root??defaultRoot),{log:message=>console.error(message)});
  let result;const timeout={timeoutMs:(options.timeout??60)*1000};
  const list={...(options.query!==undefined?{query:options.query}:{}),...(options.limit?{limit:options.limit}:{}),...(options.cursor?{cursor:options.cursor}:{})};
  switch(command) {
    case 'session.start':result=await startSession(toolkit,name,{write:options.write,timeoutMs:(options.timeout??300)*1000,idleMs:(options.idleTimeout??900)*1000});break;
    case 'session.status':result=await sessionStatus(toolkit,name);break;
    case 'session.stop':result=await stopSession(toolkit,name,{timeoutMs:(options.timeout??30)*1000});break;
    case 'session.recover':result=await recoverSession(toolkit,name);break;
    case 'function.list':result=await querySession(toolkit,name,'functions.list',list,timeout);break;
    case 'function.get':result=await querySession(toolkit,name,'functions.get',{address:args[0]},timeout);break;
    case 'decompile':result=await querySession(toolkit,name,'functions.decompile',{selector:args[0],...list,timeoutSeconds:options.timeout??60},timeout);break;
    case 'disasm':result=await querySession(toolkit,name,'instructions.list',{address:args[0],...list},timeout);break;
    case 'xrefs':result=await querySession(toolkit,name,'references.list',{address:args[0],direction:options.direction??'to',...list},timeout);break;
    case 'strings':result=await querySession(toolkit,name,'strings.search',list,timeout);break;
    case 'bytes.read':result=await querySession(toolkit,name,'memory.read',{address:args[0],length:options.length},timeout);break;
    case 'function.rename':result=await mutateSession(toolkit,name,'functions.rename',{address:args[0],name:args[1]},options);break;
    case 'comment.set': {
      let text=options.text;
      if(options.file) {const file=path.resolve(options.file);if(fs.statSync(file).size>60000)throw new BridgeError('request_limit','Comment file exceeds request limit');text=new TextDecoder('utf8',{fatal:true}).decode(fs.readFileSync(file));}
      result=await mutateSession(toolkit,name,'comments.set',{address:args[0],type:options.type,text},options);break;
    }
    case 'symbols.plan':result=await querySession(toolkit,name,'symbols.plan',{
      ...(options.addressMode?{addressMode:options.addressMode}:{}),createFunctions:Boolean(options.createFunctions),
      replaceUserNames:Boolean(options.replaceUserNames),replaceUserComments:Boolean(options.replaceUserComments)},timeout);break;
    case 'symbols.apply': {
      const plan=path.resolve(options.plan);result=await mutateSession(toolkit,name,'symbols.apply',{plan,planHash:fileIdentity(plan).sha256},options);break;
    }
  }
  console.log(JSON.stringify(result,null,2));
}
