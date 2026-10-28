import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fileIdentity,fingerprint} from '../state.js';
import {assertAssetPath,assetError} from '../assets/context.js';
const helper=fileURLToPath(new URL('../../templates/CSharp/REToolkitManagedInspector.cs',import.meta.url));
const check=(ok,message)=>{if(!ok)throw assetError('runtime_inspector_failed',message);};
function identity(file){assertAssetPath(file);const stat=fs.lstatSync(file);check(stat.isFile()&&stat.size<=128*1024**2,'Invalid metadata inspector input');const {size,sha256}=fileIdentity(file);return {size,sha256};}
async function run(file,args,cwd,env){return new Promise((resolve,reject)=>{const child=spawn(file,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',failure;const timer=setTimeout(()=>{failure=Error('Managed inspection exceeded 60 seconds');child.kill();},60000);const read=data=>{if(output.length<65536)output+=data.toString();else{failure=Error('Managed inspector output limit exceeded');child.kill();}};child.stdout.on('data',read);child.stderr.on('data',read);child.on('error',e=>{failure=e;});child.on('close',code=>{clearTimeout(timer);if(failure||code!==0)reject(failure??Error(output||'Managed inspector failed'));else resolve();});});}
export async function inspectManagedAssembly({toolkitRoot,editorPath,assemblyPath}){
 const data=path.join(path.dirname(editorPath),'Data'),roslyn=path.join(data,'DotNetSdkRoslyn'),runtimeRoot=path.join(data,'NetCoreRuntime');
 const dotnet=path.join(runtimeRoot,process.platform==='win32'?'dotnet.exe':'dotnet'),compiler=path.join(roslyn,'csc.dll'),config=path.join(roslyn,'csc.runtimeconfig.json'),cecil=path.join(toolkitRoot,'tools/Il2CppDumper/Mono.Cecil.dll');
 const framework=JSON.parse(fs.readFileSync(assertAssetPath(config),'utf8')).runtimeOptions?.framework;check(framework?.name==='Microsoft.NETCore.App'&&/^\d+\.\d+\.\d+$/.test(framework.version),'Unsupported bundled runtime');
 const runtime=assertAssetPath(path.join(runtimeRoot,'shared/Microsoft.NETCore.App',framework.version));
 const references=fs.readdirSync(runtime).filter(n=>/^(System\..*|mscorlib|netstandard)\.dll$/.test(n)&&!n.includes('.Native.')).map(n=>path.join(runtime,n));check(references.length>=10&&references.length<=512,'Bundled compiler references unavailable');
 const inputs=[editorPath,dotnet,compiler,config,cecil,helper,assemblyPath,...references],proof=inputs.map(file=>({path:path.resolve(file),...identity(file)}));
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'retk-managed-inspect-'));
 try{
  const executable=path.join(temp,'Inspector.dll'),output=path.join(temp,'metadata.json');
  fs.copyFileSync(cecil,path.join(temp,'Mono.Cecil.dll'));fs.copyFileSync(config,path.join(temp,'Inspector.runtimeconfig.json'));
  const env={SystemRoot:process.env.SystemRoot??'C:/Windows',WINDIR:process.env.WINDIR??'C:/Windows',TEMP:os.tmpdir(),TMP:os.tmpdir(),DOTNET_ROOT:runtimeRoot,DOTNET_MULTILEVEL_LOOKUP:'0',DOTNET_ROLL_FORWARD:'Disable',DOTNET_EnableDiagnostics:'0',DOTNET_NOLOGO:'1'};
  await run(dotnet,[compiler,'-nologo','-target:exe','-out:'+executable,...references.map(r=>'-r:'+r),'-r:'+cecil,helper],temp,env);
  await run(dotnet,[executable,path.resolve(assemblyPath),output],temp,env);
  check(fs.statSync(output).size<=32*1024**2,'Managed metadata exceeds output limit');const metadata=JSON.parse(fs.readFileSync(output,'utf8'));
  for(const item of proof)check(fingerprint(identity(item.path))===fingerprint({size:item.size,sha256:item.sha256}),'Inspector or target bytes changed during inspection');
  return {metadata,input:identity(assemblyPath),inspector:{helperSha256:identity(helper).sha256,cecil:identity(cecil),editor:identity(editorPath),compiler:identity(compiler),runtimeVersion:framework.version},targetExecuted:false};
 }finally{check(path.dirname(temp)===path.resolve(os.tmpdir())&&path.basename(temp).startsWith('retk-managed-inspect-'),'Unsafe inspector cleanup');fs.rmSync(temp,{recursive:true,force:true});}
}
