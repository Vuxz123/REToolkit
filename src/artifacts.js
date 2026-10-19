import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {within} from './inputs.js';

export function artifactError(code,message){return Object.assign(new Error(message),{code});}
export function rejectOutputLinks(target){
  let current=path.resolve(target);
  for(;;){if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw artifactError('output_link','Output links/junctions are unsupported');const parent=path.dirname(current);if(parent===current)break;current=parent;}
}
export function externalOutput(toolkit,target){
  const absolute=path.resolve(target);rejectOutputLinks(absolute);
  if(within(absolute,path.join(toolkit.root,'workspaces')))throw artifactError('output_in_workspace','Output must be outside toolkit workspaces');
  return absolute;
}
// Same-volume hard-link publication is atomic and has no overwrite race. Keep
// the old file on all failures, including when another writer wins publication.
export function publishJson(file,value,{maxBytes=32*1024*1024}={}){
  const absolute=path.resolve(file);rejectOutputLinks(absolute);
  if(fs.existsSync(absolute))throw artifactError('output_exists','Output already exists; choose a new file');
  const data=Buffer.from(JSON.stringify(value,null,2)+'\n');
  if(data.length>maxBytes)throw artifactError('artifact_too_large',`Artifact exceeds ${maxBytes} byte limit`);
  fs.mkdirSync(path.dirname(absolute),{recursive:true});const temporary=path.join(path.dirname(absolute),`.retk-artifact-${randomUUID()}.tmp`);
  let descriptor;
  try{descriptor=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(descriptor,data);fs.fsyncSync(descriptor);fs.closeSync(descriptor);descriptor=undefined;
    try{fs.linkSync(temporary,absolute);}catch(error){if(error.code==='EEXIST')throw artifactError('output_exists','Output already exists; choose a new file');throw error;}
  }finally{if(descriptor!==undefined)fs.closeSync(descriptor);fs.rmSync(temporary,{force:true});}
  return absolute;
}
