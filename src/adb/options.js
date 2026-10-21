import {validatePackageName,validateSerial} from './client.js';
const fail=message=>{throw Object.assign(new Error(message),{code:'ADB_ARGUMENT_INVALID'});};
const aliases={'-DeviceSerial':'--serial','-AdbPath':'--adb','-SkipLaunch':'--skip-launch'};
export const adbUsage=`Native ADB capture (Node24+)
  adb devices [--adb <adb.exe>] [--json]
  pull-ldplayer <Game> <package> [--serial <id>] [--adb <adb.exe>] --skip-launch
                  [--binary <relative-path>] [--metadata <relative-path>]
Global: --root <toolkit>, --json, --help
Without --skip-launch, an interactive terminal launches the game and waits for Enter.
JSON/noninteractive callers must use --skip-launch. Multiple devices require --serial.
Retained aliases: -DeviceSerial, -AdbPath, -SkipLaunch.
`;
export const isAdbCommand=argv=>['adb','pull-ldplayer'].includes(argv[0]);
export function parseAdbArgs(argv){
 const options={},positionals=[],seen=new Set();let root,json=false,help=false;
 for(let index=0;index<argv.length;index++){
  const token=aliases[argv[index]]??argv[index];
  if(!token.startsWith('-')){positionals.push(token);continue;}
  if(!['--serial','--adb','--binary','--metadata','--root','--skip-launch','--json','--help'].includes(token))fail('Unknown ADB option');
  if(seen.has(token))fail('Duplicate ADB option');seen.add(token);
  if(token==='--help'){help=true;continue;}
  if(token==='--json'){json=true;continue;}
  if(token==='--skip-launch'){options.skipLaunch=true;continue;}
  const value=argv[++index];if(!value||value.startsWith('-')||value.length>4096||/[\x00-\x1f]/.test(value))fail('Missing or invalid ADB option value');
  if(token==='--root')root=value;else options[token.slice(2)]=value;
 }
 if(help)return {help:true};
 let command,game,packageName;
 if(positionals[0]==='adb'&&positionals[1]==='devices'&&positionals.length===2){
  command='devices';if(Object.keys(options).some(key=>key!=='adb'))fail('Device discovery accepts only --adb and global options');
 }else if(positionals[0]==='pull-ldplayer'&&positionals.length===3){
  [,game,packageName]=positionals;command='pull';
  if(!/^[A-Za-z0-9_.-]{1,64}$/.test(game)||game.endsWith('.')||['.','..'].includes(game)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(game))fail('Invalid workspace name');
  validatePackageName(packageName);if(options.serial)validateSerial(options.serial);
 }else fail('Expected adb devices or pull-ldplayer <Game> <package>');
 return {command,game,packageName,options,root,json};
}
