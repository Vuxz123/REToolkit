import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertNoLinks,snapshotTree} from '../../src/toolchain/manifest.js';
import {privateArchive,extractChecked,matches} from '../../src/toolchain/archive-io.js';

const invalid=()=>Object.assign(new Error('Extension archive metadata/layout does not match the bridge and installed Ghidra.'),{code:'MCP_EXTENSION_INVALID'});
async function properties(file){await assertNoLinks(file);const stat=await fs.lstat(file);if(!stat.isFile()||stat.size>1024**2)throw invalid();const bytes=await fs.readFile(file);if(bytes.length>1024**2)throw invalid();const values={};for(const line of bytes.toString('utf8').replace(/^\uFEFF/,'').split(/\r?\n/)){const pair=line.match(/^([^#!\s=]+)\s*=\s*(.*)$/);if(pair){if(Object.hasOwn(values,pair[1]))throw invalid();values[pair[1]]=pair[2].trim();}}return values;}
export async function inspectExtensionZip(file,ghidra,bridgeVersion,scratch){
 try{
  await assertNoLinks(file);const stat=await fs.lstat(file);if(!stat.isFile()||stat.size<1||stat.size>256*1024**2)throw invalid();
  const hash=createHash('sha256'),handle=await fs.open(file,'r');try{for await(const bytes of handle.createReadStream({autoClose:false}))hash.update(bytes);}finally{await handle.close();}const source={size:stat.size,sha256:hash.digest('hex')};
  await assertNoLinks(scratch);await fs.mkdir(scratch,{recursive:false});const archive=await privateArchive(file,path.join(scratch,'extension.zip'),source),unpacked=path.join(scratch,'unpacked');await extractChecked(archive,unpacked);
  const inventory=await snapshotTree(unpacked),candidates=inventory.filter(f=>f.path.endsWith('/extension.properties')||f.path==='extension.properties');if(candidates.length!==1)throw invalid();
  const prefix=path.posix.dirname(candidates[0].path),folder=path.join(unpacked,...(prefix==='.'?[]:prefix.split('/'))),metadata=await properties(path.join(folder,'extension.properties')),installed=await properties(path.join(ghidra,'Ghidra/application.properties'));
  const module=await fs.lstat(path.join(folder,'Module.manifest'));if(!module.isFile()||module.size>1024**2)throw invalid();
  if((await fs.readFile(path.join(folder,'Module.manifest'))).length>1024**2)throw invalid();
  const jarPrefix=prefix==='.'?'lib/':prefix+'/lib/',jars=inventory.filter(f=>f.path.startsWith(jarPrefix)&&f.path.endsWith('.jar')&&f.size>0);
  const pluginVersion=metadata.description?.match(/(?:^|\s)Plugin version (\d+(?:\.\d+)+)\.?$/)?.[1];
  if(metadata.name!=='GhidraMCP'||!jars.length||pluginVersion!==bridgeVersion||metadata.version!==installed['application.version']||!/^\d+(?:\.\d+){1,3}$/.test(metadata.version))throw invalid();
  if(!await matches(archive,source))throw invalid();
  return {state:'static-metadata-matching',sha256:source.sha256,size:source.size,bridgeVersion,pluginVersion,ghidraVersion:metadata.version,jarCount:jars.length,guiActivation:'not-qualified'};
 }catch(error){if(error.code?.startsWith('TOOLCHAIN_'))throw error;throw invalid();}
}
