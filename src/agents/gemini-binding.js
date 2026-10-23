import fs from 'node:fs';
import path from 'node:path';
import {assertAssetPath} from '../assets/context.js';

const names=['retoolkit_assets','retoolkit_ghidra'];
const conflict=(detail,file)=>Object.assign(new Error(`Gemini MCP binding conflict: ${detail} in ${file}. Preserve the existing configuration and resolve the conflict before opening Gemini.`),{code:'AGENT_MCP_CONFIG_CONFLICT'});

// Gemini accepts JSON with comments. Mask comments without changing quoted
// strings; strict JSON parsing then matches its settings loader's behavior.
function settingsJson(text){
 let result='',quoted=false;
 for(let i=0;i<text.length;i++){
  const char=text[i];
  if(quoted){result+=char;if(char==='\\')result+=text[++i]??'';else if(char==='"')quoted=false;continue;}
  if(char==='"'){quoted=true;result+=char;continue;}
  if(char==='/'&&text[i+1]==='/'){while(i<text.length&&text[i]!=='\n')i++;result+='\n';continue;}
  if(char==='/'&&text[i+1]==='*'){i+=2;while(i<text.length&&!(text[i]==='*'&&text[i+1]==='/'))i++;if(i>=text.length)throw Error('Unterminated settings comment');i++;result+=' ';continue;}
  result+=char;
 }
 const value=JSON.parse(result.replace(/^\uFEFF/,''));
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected a settings object');
 return value;
}

// Official precedence: system defaults < isolated user settings < project <
// system overrides. Never replace managed/system configuration to force binding.
// https://geminicli.com/docs/reference/configuration/#configuration-layers
export function assertGeminiBinding(workspace,env=process.env,platform=process.platform){
 const system=env.GEMINI_CLI_SYSTEM_SETTINGS_PATH??(platform==='win32'?'C:\\ProgramData\\gemini-cli\\settings.json':platform==='darwin'?'/Library/Application Support/GeminiCli/settings.json':'/etc/gemini-cli/settings.json');
 const defaults=env.GEMINI_CLI_SYSTEM_DEFAULTS_PATH??path.join(path.dirname(system),'system-defaults.json');
 for(const file of new Set([path.join(workspace,'.gemini','settings.json'),system,defaults])){
  let config;
  try{
   assertAssetPath(file);if(!fs.existsSync(file))continue;
   const stat=fs.statSync(file);if(!stat.isFile()||stat.size>1024**2)throw Error('Expected a bounded regular settings file');
   config=settingsJson(fs.readFileSync(file,'utf8'));
  }catch{throw conflict('cannot validate existing settings',file);}
  if(Object.hasOwn(config,'mcpServers')&&(!config.mcpServers||typeof config.mcpServers!=='object'||Array.isArray(config.mcpServers)))throw conflict('cannot validate the existing mcpServers setting',file);
  for(const name of names)if(Object.hasOwn(config.mcpServers??{},name))throw conflict(`${name} has an existing reserved-name definition`,file);
  const mcp=config.mcp;
  if(Object.hasOwn(config,'mcp')&&(!mcp||typeof mcp!=='object'||Array.isArray(mcp)))throw conflict('cannot validate the existing MCP policy',file);
  for(const key of ['allowed','excluded'])if(mcp&&Object.hasOwn(mcp,key)&&!Array.isArray(mcp[key]))throw conflict(`cannot validate the existing MCP ${key} policy`,file);
  if(mcp?.serverCommand)throw conflict('global MCP serverCommand overrides session commands',file);
  if(Array.isArray(mcp?.allowed)&&names.some(name=>!mcp.allowed.includes(name)))throw conflict('MCP allowed list omits a required session server',file);
  if(Array.isArray(mcp?.excluded)&&names.some(name=>mcp.excluded.includes(name)))throw conflict('MCP excluded list disables a required session server',file);
  const admin=config.admin?.mcp;
  if(admin?.enabled===false)throw conflict('managed policy disables MCP servers',file);
  // Gemini's admin allowlist replaces connection details and removes local
  // command/args even for allowed names. Keep that policy intact and stop.
  if(admin?.config&&Object.keys(admin.config).length)throw conflict('managed MCP allowlist replaces or blocks local session bindings',file);
  for(const name of names)if(Object.hasOwn(admin?.requiredConfig??{},name))throw conflict(`${name} has a managed required-server definition`,file);
 }
}
