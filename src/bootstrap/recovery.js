import fs from 'node:fs';import path from 'node:path';
import {noLinks,readJson} from './safety.js';
const refused=message=>Object.assign(Error(message),{code:'QUICKSTART_RECOVERY_REQUIRED'});
function entries(directory){noLinks(directory);try{const items=[],handle=fs.opendirSync(directory);try{for(let next;(next=handle.readSync());){if(items.length===4096)throw refused('Too many installation records to inspect safely');items.push(next.name);}return items;}finally{handle.closeSync();}}catch(error){if(error.code==='ENOENT')return [];throw error;}}
/** Read-only: a good receipt cannot overrule retained execution uncertainty. */
export function assertNoUncertainInstallState(root){
 try{
  for(const base of [root,path.join(root,'runtime/desktop/python')]){
   for(const relative of ['.cache/toolchain/writer','.cache/toolchain/readers']){const file=path.join(base,relative);noLinks(file);if(relative.endsWith('writer')?fs.existsSync(file):entries(file).length)throw refused('A retained toolchain gate requires inspection: '+file);}
   for(const relative of ['.cache/toolchain/transactions','.cache/python-runtime/transactions','.cache/desktop-runtime/transactions'])for(const name of entries(path.join(base,relative))){const file=path.join(base,relative,name,'journal.json');if(!['committed','rolled-back'].includes(readJson(file,128*1024**2).state))throw refused('An unfinished runtime journal requires inspection: '+file);}
  }
 }catch(error){if(error.code==='QUICKSTART_RECOVERY_REQUIRED')throw error;throw refused('Cannot safely inspect retained runtime state: '+error.message);}
}
