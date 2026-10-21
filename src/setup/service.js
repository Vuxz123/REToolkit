import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readToolchainLock,validateToolchainLock,planToolchain,lockFingerprint,assertNoLinks,within,toolchainError} from '../toolchain/manifest.js';
import {installToolchain} from '../toolchain/installer.js';
import {verifyToolchain} from '../toolchain/verify.js';

const native=['jdk','ghidra','dumper','assetripper'];
const legacy=['python-gui','ghidra-mcp-gui','dotnet'];
const failure=(code,message)=>{throw toolchainError(code,message);};
const limitation='Native ZIP installation does not qualify GUI extensions, Python GUI setup, global .NET, or vendor engine execution.';
function selection(options){
 if(options.all&&!options.nativeOnly||options.requiredComponents?.length){
  const requested=options.all?legacy:options.requiredComponents;
  failure('SETUP_PROFILE_REQUIRED',`These components require separate reviewed setup: ${requested.join(', ')}. Use python-runtime install with its lock for MCP CLI; GUI extensions and global .NET are separate. For only native ZIP engines use --all --native-only.`);
 }
 if(options.nativeOnly&&!options.all)failure('SETUP_ARGUMENT_INVALID','--native-only requires --all');
 const selected=options.all?native:options.components??['jdk','ghidra'];
 if(!Array.isArray(selected)||!selected.length||selected.length>4||new Set(selected).size!==selected.length||selected.some(id=>!native.includes(id)))failure('SETUP_ARGUMENT_INVALID','Select unique supported native components');
 return native.filter(id=>selected.includes(id)||id==='jdk'&&selected.includes('ghidra'));
}
function validateOptions(action,options){
 if(!['resolve','plan','install','status'].includes(action)||!options||typeof options!=='object'||Array.isArray(options))failure('SETUP_ARGUMENT_INVALID','Invalid setup operation');
 const allowed=['components','versions','all','nativeOnly','requiredComponents','lock','out','cache','onProgress'];
 if(Object.keys(options).some(key=>!allowed.includes(key)))failure('SETUP_ARGUMENT_INVALID','Unknown setup option');
 for(const key of ['all','nativeOnly'])if(options[key]!==undefined&&typeof options[key]!=='boolean')failure('SETUP_ARGUMENT_INVALID','Invalid setup flag');
 for(const key of ['lock','out','cache'])if(options[key]!==undefined&&(typeof options[key]!=='string'||!options[key]||/[\0\r\n]/.test(options[key])))failure('SETUP_ARGUMENT_INVALID','Invalid setup path');
 if(options.out&&action!=='resolve'||options.cache&&action!=='install')failure('SETUP_ARGUMENT_INVALID','Output is for resolve; cache is for install');
 if(options.lock&&['components','versions','all','nativeOnly','requiredComponents'].some(key=>options[key]!==undefined))failure('SETUP_ARGUMENT_INVALID','An explicit lock defines its complete package selection');
 if(action==='status'&&Object.keys(options).length)failure('SETUP_ARGUMENT_INVALID','Status does not accept installation options');
 if(options.requiredComponents!==undefined&&(!Array.isArray(options.requiredComponents)||options.requiredComponents.length>3||options.requiredComponents.some(id=>!legacy.includes(id))))failure('SETUP_ARGUMENT_INVALID','Unknown required component');
 if(options.versions!==undefined&&(!options.versions||typeof options.versions!=='object'||Array.isArray(options.versions)||Object.keys(options.versions).some(id=>!native.includes(id))||Object.values(options.versions).some(version=>typeof version!=='string'||!/^\d+(?:\.\d+){1,3}$/.test(version)||version.length>64)))failure('SETUP_ARGUMENT_INVALID','Exact native release versions are required');
}
async function writeLock(root,file,lock){
 file=path.resolve(file);
 if(path.extname(file).toLowerCase()!=='.json'||['tools','runtime','workspaces','.cache'].some(relative=>within(path.join(root,relative),file)))failure('SETUP_OUTPUT_UNSAFE','Write resolved locks as .json files outside managed engine, runtime, workspace and cache trees');
 await assertNoLinks(file);
 try{await fs.lstat(file);failure('SETUP_OUTPUT_EXISTS','Resolved lock output already exists');}catch(error){if(error.code!=='ENOENT')throw error;}
 await fs.mkdir(path.dirname(file),{recursive:true});await assertNoLinks(path.dirname(file));
 const temporary=path.join(path.dirname(file),`.retk-lock-${randomUUID()}.tmp`);
 try{
  const handle=await fs.open(temporary,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(lock,null,2)+'\n');await handle.sync();}finally{await handle.close();}
  await assertNoLinks(file);
  try{await fs.link(temporary,file);}catch(error){if(error.code==='EEXIST')failure('SETUP_OUTPUT_EXISTS','Resolved lock output already exists');throw error;}
 }finally{await fs.rm(temporary,{force:true});}
 return file;
}
async function installedVersion(root,relative,pattern){
 try{const file=path.join(root,relative);await assertNoLinks(file);const stat=await fs.lstat(file);if(!stat.isFile()||stat.size>1024**2)return null;return pattern.exec(await fs.readFile(file,'utf8'))?.[1]??null;}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function status(root,verify){
 const result=await verify(root);
 return {kind:'retoolkit-setup-status',schemaVersion:1,state:result.state,ok:result.ok,
  versions:{jdk:await installedVersion(root,'runtime/java/jdk-21/release',/^JAVA_VERSION="([^"]+)"/m),ghidra:await installedVersion(root,'tools/ghidra/Ghidra/application.properties',/^application\.version\s*=\s*(\S+)/m)},
  packages:result.packages.map(pkg=>({id:pkg.id,version:pkg.version,state:pkg.state,counts:Object.fromEntries(['matching','missing','tampered','extra'].map(key=>[key,pkg[key]?.length??0]))})),errors:result.errors,limitations:[limitation,'Version metadata alone does not prove installed file integrity.']};
}
export async function runSetup(root,action,options={},dependencies={}){
 root=path.resolve(root);validateOptions(action,options);
 if(action==='status')return status(root,dependencies.verify??verifyToolchain);
 let lock;
 if(options.lock)lock=await readToolchainLock(options.lock);
 else{
  const components=selection(options);
  if(Object.keys(options.versions??{}).some(id=>!components.includes(id)))failure('SETUP_ARGUMENT_INVALID','A version was specified for an unselected component');
  const resolve=dependencies.resolve??(await import('./releases.js')).resolveNativeLock;
  lock=validateToolchainLock(await resolve({components,versions:options.versions??{}}));
 }
 if(action==='resolve'){
  if(!options.out)return lock;
  const lockFile=await writeLock(root,options.out,lock);
  return {state:'resolved',lockFile,lockFingerprint:lockFingerprint(lock),lock};
 }
 if(action==='plan')return {...planToolchain(root,lock),lock,resolution:options.lock?'explicit-lock':'exact-release-metadata',limitations:[limitation]};
 const install=dependencies.install??installToolchain;
 const receipt=await install(root,lock,{cache:options.cache,onProgress:options.onProgress});
 return {kind:'retoolkit-setup-result',schemaVersion:1,state:'installed',runId:receipt.runId,receipt:'.cache/toolchain/receipt.json',
  packages:receipt.packages.map(pkg=>({id:pkg.id,version:pkg.version,target:pkg.target,fileCount:pkg.files.length})),engineExecution:'unverified',limitations:[...receipt.limitations??[],limitation]};
}
