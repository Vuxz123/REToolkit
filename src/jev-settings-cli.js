import path from 'node:path';
import {loadJevSettings,saveJevSettings,testJevSettings,readJevSettingsRequest} from './jev-settings.js';
export const jevSettingsUsage=`Jev settings (authentication values are never written)
  retk jev-settings show
  retk jev-settings save --request <json>
  retk jev-settings test
Global: --root <toolkit>, --json, --help.
Settings use config/jev.json. Test sends only a small synthetic request to TypeSafe.
`;
const invalid=()=>{throw Object.assign(Error('Invalid jev-settings arguments; use show, save --request <json>, or test, with --root/--json/--help.'),{code:'jev_settings_argument_invalid'});};
export function isJevSettingsCommand(argv){for(let i=0;i<argv.length;i++){const token=argv[i];if(token==='--')return argv[i+1]==='jev-settings';if(token.startsWith('--')){if(['root','request'].includes(token.slice(2).split('=')[0])&&!token.includes('='))i++;continue;}return token==='jev-settings';}return false;}
export function parseJevSettingsArgs(argv){
 if(!Array.isArray(argv)||argv.length>16||argv.some(v=>typeof v!=='string')||Buffer.byteLength(JSON.stringify(argv))>12288)invalid();const args=[],options={},seen=new Set();
 for(let i=0;i<argv.length;i++){const token=argv[i];if(token==='--'){args.push(...argv.slice(i+1));break;}if(!token.startsWith('--')){args.push(token);continue;}const equal=token.indexOf('='),key=token.slice(2,equal<0?undefined:equal);if(seen.has(key))invalid();seen.add(key);if(['json','help'].includes(key)){if(equal>=0)invalid();options[key]=true;}else if(['root','request'].includes(key)){const value=equal<0?argv[++i]:token.slice(equal+1);if(!value||value.startsWith('--')||value.length>4096||/[\x00-\x1f]/.test(value))invalid();options[key]=value;}else invalid();}
 const [group,action,...extra]=args;if(group!=='jev-settings'||extra.length||action!==undefined&&!['show','save','test'].includes(action))invalid();if(options.help)return {help:true};if(!action)invalid();if(action==='save'?!options.request:options.request!==undefined)invalid();return {action,options};
}
export async function runJevSettingsCli(argv,defaultRoot,{write=message=>process.stdout.write(message),env=process.env,fetchImpl=fetch}={}){
 const parsed=parseJevSettingsArgs(argv);if(parsed.help){write(jevSettingsUsage);return;}const root=path.resolve(parsed.options.root??defaultRoot);let result;
 if(parsed.action==='show')result=loadJevSettings(root,{env});else if(parsed.action==='save')result=await saveJevSettings(root,readJevSettingsRequest(path.resolve(parsed.options.request)),{env});else result=await testJevSettings(root,{env,fetchImpl});
 const output=JSON.stringify(result,null,parsed.options.json?undefined:2);if(Buffer.byteLength(output)>16384)throw Object.assign(Error('Jev settings result exceeds limit.'),{code:'jev_settings_output_limit'});write(output+'\n');return result;
}
