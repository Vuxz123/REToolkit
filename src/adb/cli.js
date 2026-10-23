import path from 'node:path';
import {createInterface} from 'node:readline/promises';
import {createToolkit} from '../toolkit.js';
import {createAdbClient,resolveAdbPath} from './client.js';
import {parseAdbArgs,adbUsage} from './options.js';
export {isAdbCommand,parseAdbArgs} from './options.js';

export async function runAdbCli(argv,defaultRoot){
 const parsed=parseAdbArgs(argv);if(parsed.help){process.stdout.write(adbUsage);return;}
 if(parsed.command==='pull'&&!parsed.options.skipLaunch&&(parsed.json||!process.stdin.isTTY||!process.stdout.isTTY))throw Object.assign(new Error('Interactive game launch requires a terminal; use --skip-launch for JSON or unattended capture'),{code:'ADB_INTERACTIVE_REQUIRED'});
 const root=path.resolve(parsed.root??defaultRoot),toolkit=createToolkit(root,{log:message=>process.stderr.write(message+'\n')});
 let result;
 if(['devices','packages'].includes(parsed.command)){
  const file=resolveAdbPath(parsed.options.adb),client=createAdbClient({file,run:toolkit.run,runOptions:{cwd:root,toolchainRoot:root}});
  if(parsed.command==='devices')result={kind:'retoolkit-adb-devices',schemaVersion:1,adb:file,devices:await client.devices()};
  else{const serial=await client.selectDevice(parsed.options.serial);result={kind:'retoolkit-adb-packages',schemaVersion:1,serial,packages:await client.packages(serial)};}
 }else{
  const options={...parsed.options};
  if(!options.skipLaunch)options.confirm=async()=>{
   const terminal=createInterface({input:process.stdin,output:process.stderr});
   try{await terminal.question('Wait for game downloads to finish, then press Enter to capture: ');}finally{terminal.close();}
  };
  result=await toolkit.pullLdPlayer(parsed.game,parsed.packageName,options);
 }
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
