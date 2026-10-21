// Explicit vendor-runtime acceptance; never activates a checkout/main profile or opens a GUI.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {installDesktopRuntime,verifyDesktopRuntime,inspectDesktopRuntime,desktopRuntimeEnvironment,desktopLockFingerprint} from '../src/desktop-runtime/index.js';
import {executePython,pythonInstallEnvironment} from '../src/python-runtime/runner.js';
import {acquireToolchainRead} from '../src/toolchain/lease.js';
const checkout=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);if(args.length!==3)throw Error('Usage: node test/real-desktop-runtime.mjs <desktop-lock.json> <verified-cache> <reference-toolkit-root>');
const [lockFile,cache,referenceRoot]=args.map(s=>path.resolve(s)),root=path.join(checkout,'.cache/desktop-runtime-acceptance',randomUUID().slice(0,8)),reportFile=path.join(root,'acceptance.json');
await fs.mkdir(root,{recursive:true});
const hash=file=>fs.readFile(file).then(b=>createHash('sha256').update(b).digest('hex')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
const sentinelPaths=['runtime/python/active.json','runtime/desktop/active.json','tools/ghidra/Ghidra/application.properties','tools/Il2CppDumper/Il2CppDumper.exe','tools/AssetRipper/AssetRipper.exe','runtime/java/jdk-21/bin/java.exe','tools/ghidra-mcp/.venv/Scripts/python.exe'];
const sentinels=Object.fromEntries(await Promise.all(sentinelPaths.map(async relative=>[relative,await hash(path.join(referenceRoot,relative))])));
const report={kind:'retoolkit-desktop-runtime-acceptance',schemaVersion:1,root,startedAt:new Date().toISOString(),passed:false,productionActivation:false,guiActivation:'unverified',gameQueries:0,sentinels,downloads:0};let lease,preserve=false;
try{
 const lock=JSON.parse(await fs.readFile(lockFile,'utf8'));report.lockFingerprint=desktopLockFingerprint(lock);
 await fs.mkdir(path.join(root,'tools/ghidra/Ghidra'),{recursive:true});await fs.copyFile(path.join(referenceRoot,'tools/ghidra/Ghidra/application.properties'),path.join(root,'tools/ghidra/Ghidra/application.properties'));
 // This idleness seam applies only to a unique, private empty root. Main
 // processes, engines, settings and active pointers are never replaced.
 const receipt=await installDesktopRuntime(root,lock,{cache,fetchImpl:async()=>{report.downloads++;throw Error('Offline vendor acceptance refuses network.');},inspectProcesses:async()=>({state:'idle',processes:[]})});
 report.python={version:lock.pythonLock.python.version,distributions:lock.pythonLock.wheels.length,nativeImports:receipt.probe};report.extension={version:lock.extension.version,ghidraVersion:lock.ghidraVersion,guiActivation:'unverified'};
 lease=acquireToolchainRead(root);const selected=inspectDesktopRuntime(root);assert.equal(selected.state,'selected');const output=await executePython(path.join(selected.dotnet,'dotnet.exe'),['--info'],{cwd:root,env:desktopRuntimeEnvironment(selected,pythonInstallEnvironment(path.join(root,'dotnet-environment'))),timeoutMs:30000});
 assert.equal(output.exitCode,0);assert.match(output.stdout,new RegExp('Version:\\s+'+lock.dotnet.version.replaceAll('.','\\.')));report.dotnet={version:lock.dotnet.version,info:output.stdout};const verified=await verifyDesktopRuntime(root);assert.equal(verified.ok,true);report.profile={generation:selected.generation,receiptSha256:selected.receiptSha256,state:verified.state};lease.release();lease=null;
 for(const relative of sentinelPaths)assert.equal(await hash(path.join(referenceRoot,relative)),sentinels[relative],'Reference engine or profile changed: '+relative);
 report.referenceSentinelsUnchanged=true;report.passed=true;
}catch(error){preserve=error.preserveToolchainGate===true;report.error={code:error.code??'DESKTOP_ACCEPTANCE_FAILED',message:String(error.message??error)};process.exitCode=1;}
finally{if(!preserve)lease?.release();report.completedAt=new Date().toISOString();await fs.writeFile(reportFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,root,reportFile,error:report.error,python:report.python,profile:report.profile,dotnet:report.dotnet?.version,productionActivation:false,guiActivation:'unverified',referenceSentinelsUnchanged:report.referenceSentinelsUnchanged}));}
