// Explicit real-vendor qualification. All installation and bridge state is Temp-owned.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {readPythonLock,pythonLockFingerprint} from '../src/python-runtime/manifest.js';
import {installPythonRuntime} from '../src/python-runtime/installer.js';
import {verifyPythonRuntime} from '../src/python-runtime/verify.js';
import {prepareMcpCommand} from '../src/python-runtime/launcher.js';
import {pythonInstallEnvironment} from '../src/python-runtime/runner.js';
import {acquireToolchainRead} from '../src/toolchain/lease.js';
import {qualifyMcpTransport} from './helpers/mcp-handshake.mjs';
import {inspectExtensionZip} from './helpers/mcp-extension.mjs';

let diagnostics;
async function main(){
const args=process.argv.slice(2);
if(args.length!==4)throw Error('Usage: npm run test:vendor-mcp -- <python-lock.json> <cache> <extension.zip> <installed-ghidra>');
const [lockFile,cache,extensionZip,ghidra]=args.map(value=>path.resolve(value)),lock=await readPythonLock(lockFile),bridgeVersion=lock.wheels.find(w=>w.name==='ghidra-mcp-bridge').version;
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'retk-vendor-mcp-')),root=path.join(temporary,'toolkit');await fs.mkdir(root);
diagnostics=temporary;
let success=false,lease,preserve=false,downloads=0;
try{
 const extension=await inspectExtensionZip(extensionZip,ghidra,bridgeVersion,path.join(temporary,'extension-inspection'));
 const receipt=await installPythonRuntime(root,lock,{cache,fetchImpl:async()=>{downloads++;throw Error('Offline qualification refuses network.');},inspectProcesses:async()=>({state:'idle',processes:[]})});
 if(lock.wheels.some(w=>w.name==='pywin32'))assert.ok(receipt.files.some(f=>f.path==='site/pywin32.pth'),'Reviewed pywin32 hook is missing from sealed inventory.');
 // This idle seam applies only to our fresh, private root above, never the user's
 // toolkit. No existing runtimes, GUI/project or system process is replaced.
 lease=acquireToolchainRead(root);
 const command=await prepareMcpCommand({root,tools:{bridge:'legacy-disabled-in-qualification'},env:pythonInstallEnvironment(path.join(temporary,'bridge-environment'))});
 const transport=await qualifyMcpTransport(command,{cwd:temporary,timeoutMs:30000});
 assert.ok(transport.tools.length>0,'Vendor bridge advertised no tools.');
 assert.ok((await verifyPythonRuntime(root)).ok,'Vendor launch mutated its sealed generation.');
 lease.release();lease=null;success=true;
 console.log(JSON.stringify({passed:true,lockFingerprint:pythonLockFingerprint(lock),python:receipt.probe.pythonVersion,distributions:receipt.probe.distributions.length,bridgeVersion,extension,transport:{protocolVersion:transport.protocolVersion,serverVersion:transport.serverVersion,toolCount:transport.tools.length,requests:transport.requests,closed:transport.closed},downloads,productionActivation:false,targetQueries:0,guiCompatibility:'not-qualified'}));
}catch(error){preserve=error.preserveToolchainGate===true;throw error;}
finally{
 if(lease&&!preserve)lease.release();
 if(success){const resolved=path.resolve(temporary);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('retk-vendor-mcp-'));await fs.rm(resolved,{recursive:true,force:true});}
}
}
main().catch(error=>{process.exitCode=1;console.error(JSON.stringify({passed:false,code:/^[A-Z][A-Z0-9_]+$/.test(error?.code??'')?error.code:'VENDOR_QUALIFICATION_FAILED',message:'Vendor qualification failed; inspect private diagnostics when available.',...(diagnostics?{diagnostics}:{})}));});
