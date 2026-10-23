import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {assertAssetPath,assetError} from '../assets/context.js';
import {resolveUnityEditor} from '../unity/validation.js';

const MiB=1024**2, maximumOutput=2*MiB;
const helperPath=fileURLToPath(new URL('../../templates/CSharp/REToolkitSourceContract.cs',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const check=(ok,message,code='source_contract_invalid')=>{if(!ok)throw assetError(code,message);};
const abort=signal=>{if(signal?.aborted)throw Object.assign(new Error('Source contract analysis cancelled'),{name:'AbortError',code:'ABORT_ERR'});};

function textSource(source){
 if(Buffer.isBuffer(source)||source instanceof Uint8Array){
  check(source.byteLength<=MiB,'Source exceeds 1 MiB');
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(source);}catch{throw assetError('source_contract_invalid','Source must be strict UTF-8');}
 }
 check(typeof source==='string'&&source.isWellFormed()&&Buffer.byteLength(source)<=MiB,'Source must be strict UTF-8 and at most 1 MiB');
 return source;
}
function readStable(file,limit=256*MiB){
 assertAssetPath(file);const before=fs.lstatSync(file);
 check(before.isFile()&&before.size<=limit,'Parser input must be a bounded regular file','source_contract_parser_unavailable');
 const bytes=fs.readFileSync(file),after=fs.lstatSync(file);
 check(bytes.length<=limit&&before.size===bytes.length&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ino===after.ino,'Parser input changed while reading','source_contract_parser_unavailable');
 return {bytes,identity:{path:path.resolve(file),size:bytes.length,sha256:sha(bytes)}};
}
function filesBelow(directory,limit=1024,directories=[]){
 assertAssetPath(directory);const files=[];
 let entries=0;
 const walk=(dir,depth=0)=>{check(depth<=64,'Parser runtime directory nesting exceeds 64','source_contract_parser_unavailable');for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){check(++entries<=4096,'Parser runtime inventory exceeds 4096 entries','source_contract_parser_unavailable');const file=assertAssetPath(path.join(dir,entry.name),directory);check(!entry.isSymbolicLink(),'Linked parser files are unsupported','source_contract_parser_unavailable');if(entry.isDirectory()){directories.push(file);walk(file,depth+1);}else{check(entry.isFile()&&files.length<limit,'Parser runtime file inventory is unsupported','source_contract_parser_unavailable');files.push(file);}}};
 walk(directory);return files;
}
function resolveParser(projectDir,editorPath){
 const versionFile=assertAssetPath(path.join(projectDir,'ProjectSettings/ProjectVersion.txt'),projectDir);
 const projectVersion=readStable(versionFile,65536),version=new TextDecoder('utf-8',{fatal:true}).decode(projectVersion.bytes).match(/^m_EditorVersion:\s*(\d{4}\.\d+\.\d+[abfp]\d+)\s*$/m)?.[1];
 check(version,'Project has no exact supported Unity Editor version','source_contract_parser_unavailable');
 let editor;
 try{editor=resolveUnityEditor(version,editorPath?{unityEditorPath:editorPath}:{});}catch(error){throw assetError('source_contract_parser_unavailable',`Exact Unity Editor could not be verified: ${error.message}`);}
 check(editor,'Install the exact project Unity Editor to analyze existing source','source_contract_parser_unavailable');
 const data=path.join(path.dirname(editor),'Data'),runtimeRoot=path.join(data,'NetCoreRuntime'),roslyn=path.join(data,'DotNetSdkRoslyn');
 const compiler=path.join(roslyn,'csc.dll'),dotnet=path.join(runtimeRoot,process.platform==='win32'?'dotnet.exe':'dotnet');
 const runtimeConfigurationFile=path.join(roslyn,'csc.runtimeconfig.json'),depsFile=path.join(roslyn,'csc.deps.json');
 const configurationRead=readStable(runtimeConfigurationFile,65536);
 const config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(configurationRead.bytes)),framework=config.runtimeOptions?.framework;
 check(framework?.name==='Microsoft.NETCore.App'&&/^\d+\.\d+\.\d+$/.test(framework.version),'Unsupported bundled Roslyn runtime','source_contract_parser_unavailable');
 const runtime=path.join(runtimeRoot,'shared/Microsoft.NETCore.App',framework.version),host=path.join(runtimeRoot,'host/fxr');
 const references=fs.readdirSync(assertAssetPath(runtime)).filter(name=>/^(?:System\..*|mscorlib|netstandard)\.dll$/.test(name)&&!name.includes('.Native.')).sort().map(name=>path.join(runtime,name));
 check(references.length>=10&&references.length<=512,'Bundled runtime references unavailable','source_contract_parser_unavailable');
 const managed=[path.join(roslyn,'Microsoft.CodeAnalysis.dll'),path.join(roslyn,'Microsoft.CodeAnalysis.CSharp.dll')];
 // The muxer selects hostfxr independently of shared-framework roll-forward.
 // Attest every installed host version, and recheck these directory manifests
 // after execution so a newly introduced higher version cannot go unnoticed.
 const inventoryOf=directory=>{const directories=[];return {directory,files:filesBelow(directory,1024,directories),directories};};
 const inventories=[runtime,host,roslyn].map(inventoryOf);
 const inputs=[versionFile,editor,dotnet,compiler,runtimeConfigurationFile,depsFile,...managed,...inventories.flatMap(inventory=>inventory.files),helperPath];
 const identities=new Map();let total=0;
 for(const file of [...new Set(inputs)]){const read=readStable(file);total+=read.bytes.length;check(total<=1024*MiB,'Parser runtime exceeds 1 GiB','source_contract_parser_unavailable');identities.set(path.resolve(file),read.identity);}
 check(identities.get(versionFile)?.sha256===projectVersion.identity.sha256,'Project version changed during parser resolution','source_contract_parser_unavailable');
 check(identities.get(path.resolve(runtimeConfigurationFile))?.sha256===configurationRead.identity.sha256,'Compiler configuration changed during parser resolution','source_contract_parser_unavailable');
 const identity=file=>identities.get(path.resolve(file));
 const runtimeFiles=[...identities.values()].filter(row=>row.path.startsWith(path.resolve(runtimeRoot)+path.sep));
 const runtimeDirectories=inventories.filter(inventory=>inventory.directory.startsWith(runtimeRoot+path.sep)).flatMap(inventory=>inventory.directories);
 const toolchainInputs=[...identities.values()].filter(row=>row.path!==path.resolve(versionFile)&&row.path!==path.resolve(helperPath));
 return {version,editor,dotnet,compiler,managed,references,framework,identities,inventories,inventoryOf,
  parser:{kind:'unity-bundled-roslyn-syntax',policy:'existing-executable-bodies-v1',unityVersion:version,editor:identity(editor),compiler:identity(compiler),compilerConfiguration:[runtimeConfigurationFile,depsFile].map(identity),toolchainSha256:sha(JSON.stringify({inputs:toolchainInputs,inventories})),dotnet:identity(dotnet),helperSha256:identity(helperPath).sha256,runtime:{version:framework.version,sha256:sha(JSON.stringify({files:runtimeFiles,directories:runtimeDirectories}))},roslyn:managed.map(identity)}};
}
function run(file,args,{cwd,input,signal,deadline}){
 abort(signal);const remaining=deadline-Date.now();check(remaining>0,'Source contract analysis timed out','source_contract_timeout');
 return new Promise((resolve,reject)=>{
  // Avoid inherited profiler/startup hook configuration executing arbitrary code.
  const env={SystemRoot:process.env.SystemRoot??'C:/Windows',WINDIR:process.env.WINDIR??'C:/Windows',TEMP:os.tmpdir(),TMP:os.tmpdir(),DOTNET_ROOT:path.dirname(file),DOTNET_MULTILEVEL_LOOKUP:'0',DOTNET_ROLL_FORWARD:'Disable',DOTNET_EnableDiagnostics:'0',DOTNET_NOLOGO:'1'};
  const child=spawn(file,args,{cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  const output=[],errors=[];let size=0,errorSize=0,failure=null,settled=false;
  const stop=error=>{failure??=error;child.kill();};
  const onAbort=()=>stop(Object.assign(new Error('Source contract analysis cancelled'),{name:'AbortError',code:'ABORT_ERR'}));
  signal?.addEventListener('abort',onAbort,{once:true});
  const timer=setTimeout(()=>stop(assetError('source_contract_timeout','Source contract analysis timed out')),remaining);timer.unref();
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);error?reject(error):resolve(value);};
  child.on('error',error=>finish(assetError('source_contract_parser_unavailable',`Bundled parser process could not run: ${error.code??'unknown'}`)));
  child.stdout.on('data',bytes=>{size+=bytes.length;if(size>maximumOutput)stop(assetError('source_contract_invalid','Parser output exceeds 2 MiB'));else output.push(bytes);});
  child.stderr.on('data',bytes=>{errorSize+=bytes.length;if(errorSize>maximumOutput)stop(assetError('source_contract_invalid','Parser diagnostics exceed 2 MiB'));else errors.push(bytes);});
  child.stdin.on('error',()=>{});
  child.on('close',code=>{
   if(failure)return finish(failure);
   if(code!==0)return finish(assetError('source_contract_parser_unavailable',`Bundled syntax analyzer failed (exit ${code}): ${Buffer.concat([...output,...errors]).toString('utf8').slice(0,4096)}`));
   try{finish(null,new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(output)));}catch{finish(assetError('source_contract_invalid','Parser output must be strict UTF-8'));}
  });
  child.stdin.end(input??'');
  if(signal?.aborted)onAbort();
 });
}

/** Parse source as data using only the exact Editor's bundled Roslyn. No game assembly or Unity process is loaded. */
export async function analyzeSourceContracts({projectDir,documents,editorPath,signal,timeoutMs=60000}){
 abort(signal);check(Array.isArray(documents)&&documents.length>=1&&documents.length<=10000,'Expected 1..10000 source documents');
 check(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=120000,'Parser timeout must be 1..120000 ms');
 const deadline=Date.now()+timeoutMs,paths=new Set();let aggregate=0;
 const normalized=documents.map(document=>{
  check(document&&typeof document.path==='string'&&document.path.length>=1&&document.path.length<=2048&&!document.path.includes('\0')&&!paths.has(document.path),'Expected unique bounded source document paths');paths.add(document.path);
  const source=textSource(document.source);aggregate+=Buffer.byteLength(source);check(aggregate<=64*MiB,'Source inventory exceeds 64 MiB');
  const omitted=document.omitConstructors;
  if(omitted!==undefined)check(Array.isArray(omitted)&&omitted.length<=32&&omitted.every(c=>c&&Object.keys(c).length===2&&typeof c.fullName==='string'&&c.fullName.length>0&&c.fullName.length<=2048&&['static','instance'].includes(c.kind)),'Invalid omitted constructor selectors');
  return {path:document.path,source,...(omitted?{omitConstructors:omitted}:{})};
 });
 check(typeof projectDir==='string'&&projectDir.length>0,'Expected project directory');projectDir=assertAssetPath(path.resolve(projectDir));
 let toolchain;
 try{toolchain=resolveParser(projectDir,editorPath);}catch(error){if(error.code?.startsWith('source_contract_'))throw error;throw assetError('source_contract_parser_unavailable',`Exact bundled parser unavailable: ${error.message}`);}
 abort(signal);let directory;
 try{
  directory=fs.mkdtempSync(path.join(os.tmpdir(),'retk-csharp-contract-'));assertAssetPath(directory);
  const helper=path.join(directory,'REToolkitSourceContract.cs'),assembly=path.join(directory,'REToolkitSourceContract.dll');
  const copyInput=(file,destination)=>{const read=readStable(file);check(read.identity.sha256===toolchain.identities.get(path.resolve(file)).sha256,'Parser input changed before helper compilation','source_contract_parser_unavailable');fs.writeFileSync(destination,read.bytes,{flag:'wx'});};
  copyInput(helperPath,helper);
  for(const file of toolchain.managed)copyInput(file,path.join(directory,path.basename(file)));
  fs.writeFileSync(path.join(directory,'REToolkitSourceContract.runtimeconfig.json'),JSON.stringify({runtimeOptions:{tfm:`net${toolchain.framework.version.split('.').slice(0,2).join('.')}`,framework:toolchain.framework,rollForward:'Disable'}}),{flag:'wx'});
  await run(toolchain.dotnet,[toolchain.compiler,'-noconfig','-nologo','-target:exe','-langversion:latest','-nullable:disable','-nostdlib+',`-out:${assembly}`,...[...toolchain.references,...toolchain.managed].map(file=>`-r:${file}`),helper],{cwd:directory,signal,deadline});
  assertAssetPath(assembly,directory);
  const response=await run(toolchain.dotnet,[assembly],{cwd:directory,input:JSON.stringify(normalized),signal,deadline});
  // Bind fresh original compiler, runtime, helper and exact Editor bytes. There is
  // no persistent helper cache or cross-request mutable compiled executable.
  for(const [file,identity] of toolchain.identities){abort(signal);check(Date.now()<deadline,'Source contract analysis timed out','source_contract_timeout');check(readStable(file).identity.sha256===identity.sha256,'Parser inputs changed during analysis','source_contract_parser_unavailable');}
  for(const inventory of toolchain.inventories){abort(signal);check(JSON.stringify(toolchain.inventoryOf(inventory.directory))===JSON.stringify(inventory),'Parser input inventory changed during analysis','source_contract_parser_unavailable');}
  const parsed=JSON.parse(response);check(Array.isArray(parsed.documents)&&parsed.documents.length===normalized.length&&typeof parsed.languageVersion==='string','Invalid syntax analyzer response');
  const parser={...toolchain.parser,languageVersion:parsed.languageVersion};
  const result={parser,documents:parsed.documents.map((row,index)=>{
   check(row.path===normalized[index].path&&typeof row.supported==='boolean'&&Array.isArray(row.types),'Invalid source analyzer document response');
   return {...row,kind:'retoolkit-csharp-body-contract',schemaVersion:1,sourceSha256:sha(Buffer.from(normalized[index].source,'utf8'))};
  })};
  check(Buffer.byteLength(JSON.stringify(result))<=maximumOutput,'Source contract output exceeds 2 MiB');return result;
 }finally{
  // The path is allocated by mkdtemp in this call and never reused or supplied by a caller.
  if(directory&&path.dirname(directory)===path.resolve(os.tmpdir())&&path.basename(directory).startsWith('retk-csharp-contract-'))fs.rmSync(directory,{recursive:true,force:true});
 }
}

export async function createSourceContract({source,...options}){
 const result=await analyzeSourceContracts({...options,documents:[{path:'source.cs',source}]});
 const document=result.documents[0];check(document.supported,document.reason??'Source cannot be safely modeled');
 return {...document,parser:result.parser};
}

export async function assertBodyReplacement({before,after,...options}){
 const result=await analyzeSourceContracts({...options,documents:[{path:'before.cs',source:before},{path:'after.cs',source:after}]});
 const [original,replacement]=result.documents;
 for(const document of result.documents)check(document.supported,document.reason??'Source cannot be safely modeled');
 check(original.skeletonSha256===replacement.skeletonSha256,'Replacement changes non-body C# declaration tokens','source_contract_mismatch');
 return {...original,path:'source.cs',parser:result.parser,replacementSha256:replacement.sourceSha256};
}
