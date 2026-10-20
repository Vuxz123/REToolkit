// Real offline CPython/pip qualification with source-owned packages only.
// This never activates a profile in the checkout or modifies the source Python.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';
import yazl from 'yazl';
import {installPythonRuntime} from '../src/python-runtime/installer.js';
import {verifyPythonRuntime} from '../src/python-runtime/verify.js';
import {prepareMcpCommand} from '../src/python-runtime/launcher.js';
import {executePython} from '../src/python-runtime/runner.js';
import {acquireToolchainRead} from '../src/toolchain/lease.js';

const checkout=fileURLToPath(new URL('..',import.meta.url));
const candidates=[process.argv[2],path.join(checkout,'runtime/python/python-3.12'),path.resolve(checkout,'../..','runtime/python/python-3.12')].filter(Boolean);
const sourcePython=candidates.find(folder=>fs.existsSync(path.join(folder,'python.exe'))&&fs.existsSync(path.join(folder,'Lib/ensurepip/_bundled/pip-25.0.1-py3-none-any.whl')));
assert.ok(sourcePython,'Provide a CPython 3.12 x64 directory with bundled pip 25.0.1 as the first argument.');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retk-python-offline-smoke-'));
const root=path.join(temporary,'toolkit'),cache=path.join(temporary,'cache');fs.mkdirSync(root);fs.mkdirSync(cache);
let success=false,downloads=0;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function zipBuffers(file,entries){const zip=new yazl.ZipFile();for(const [name,bytes] of Object.entries(entries))zip.addBuffer(Buffer.from(bytes),name);zip.end();await pipeline(zip.outputStream,fs.createWriteStream(file));}
function seed(file,url){const bytes=fs.readFileSync(file),sha256=digest(bytes);fs.copyFileSync(file,path.join(cache,`${sha256}.zip`));return {url,sha256,size:bytes.length,verification:'recorded-download'};}
async function wheel(name,version,files,extraMetadata='',entryPoints=''){
 const filename=`${name.replaceAll('-','_')}-${version}-py3-none-any.whl`,info=`${name.replaceAll('-','_')}-${version}.dist-info`;
 const entries={...files,[`${info}/METADATA`]:`Metadata-Version: 2.1\nName: ${name}\nVersion: ${version}\n${extraMetadata}\n`,[`${info}/WHEEL`]:'Wheel-Version: 1.0\nGenerator: REToolkit source-owned smoke\nRoot-Is-Purelib: true\nTag: py3-none-any\n'};
 if(entryPoints)entries[`${info}/entry_points.txt`]=entryPoints;
 entries[`${info}/RECORD`]=Object.entries(entries).map(([file,value])=>`${file},sha256=${crypto.createHash('sha256').update(value).digest('base64url')},${Buffer.byteLength(value)}\n`).join('')+`${info}/RECORD,,\n`;
 const file=path.join(temporary,filename);await zipBuffers(file,entries);
 return {name,version,filename,source:seed(file,`https://example.invalid/source-owned/1.0.0/${filename}`)};
}

try{
 const pythonZip=path.join(temporary,'source-python.zip'),zip=new yazl.ZipFile();
 const excluded=new Set(['site-packages','__pycache__','test','tests','idlelib','tkinter','turtledemo']);
 function add(folder,relative=''){
  for(const item of fs.readdirSync(folder,{withFileTypes:true})){
   if(excluded.has(item.name.toLowerCase()))continue;
   const rel=relative?`${relative}/${item.name}`:item.name,absolute=path.join(folder,item.name);assert.ok(!item.isSymbolicLink(),'Source Python must not contain links.');
   if(item.isDirectory())add(absolute,rel);else if(item.isFile()&&!/\.py[co]$/i.test(item.name))zip.addFile(absolute,`python/${rel}`);
  }
 }
 for(const name of ['python.exe','python3.dll','python312.dll','vcruntime140.dll','vcruntime140_1.dll','LICENSE.txt']){const file=path.join(sourcePython,name);if(fs.existsSync(file))zip.addFile(file,`python/${name}`);}
 add(path.join(sourcePython,'Lib'),'Lib');add(path.join(sourcePython,'DLLs'),'DLLs');zip.end();
 await pipeline(zip.outputStream,fs.createWriteStream(pythonZip));
 const pipFilename='pip-25.0.1-py3-none-any.whl',pipFile=path.join(sourcePython,'Lib/ensurepip/_bundled',pipFilename);
 const dependency=await wheel('retk-smoke-dependency','1.0.0',{'retk_smoke_dependency.py':"MARKER = 'source-owned-offline-stdio'\n"});
 const bridge=await wheel('ghidra-mcp-bridge','6.0.0',{'bridge_mcp_ghidra/__init__.py':'','bridge_mcp_ghidra/cli.py':"import sys\nfrom retk_smoke_dependency import MARKER\ndef main():\n    if sys.argv[1:] != ['--transport', 'stdio']:\n        raise RuntimeError('wrong fixed transport')\n    print(MARKER)\n"},'Requires-Dist: retk-smoke-dependency==1.0.0\n','[console_scripts]\nbridge-mcp-ghidra = bridge_mcp_ghidra.cli:main\n');
 const lock={kind:'retoolkit-python-lock',schemaVersion:1,platform:'win32-x64',python:{version:'3.12.10',archiveRoot:'python',source:seed(pythonZip,'https://example.invalid/source-owned/3.12.10/python.zip')},pip:{name:'pip',version:'25.0.1',filename:pipFilename,source:seed(pipFile,`https://example.invalid/source-owned/25.0.1/${pipFilename}`)},wheels:[bridge,dependency]};
 const receipt=await installPythonRuntime(root,lock,{cache,fetchImpl:async()=>{downloads++;throw Error('Network use is forbidden in the offline smoke.');},inspectProcesses:async()=>({state:'idle',processes:[]})});
 assert.equal(downloads,0);assert.equal(receipt.probe.pythonVersion,'3.12.10');assert.equal(receipt.probe.entryPoint,'bridge_mcp_ghidra.cli:main');assert.equal(receipt.probe.distributions.length,2);
 let verified=await verifyPythonRuntime(root);assert.equal(verified.ok,true,JSON.stringify(verified.errors));
 const before=JSON.stringify(receipt.files),lease=acquireToolchainRead(root);
 try{const command=await prepareMcpCommand({root,tools:{bridge:'unused'},env:{SystemRoot:process.env.SystemRoot}});const result=await executePython(command.file,command.args,{cwd:root,env:command.env});assert.equal(result.stdout.trim(),'source-owned-offline-stdio');assert.equal(result.stderr,'');}finally{lease.release();}
 verified=await verifyPythonRuntime(root);assert.equal(verified.ok,true,'Launch must not mutate the sealed generation.');assert.equal(JSON.stringify(verified.profile.receipt.files),before);
 const moduleFile=path.join(verified.profile.site,'retk_smoke_dependency.py'),original=fs.readFileSync(moduleFile);fs.appendFileSync(moduleFile,'# tampered\n');assert.equal((await verifyPythonRuntime(root)).state,'changed');fs.writeFileSync(moduleFile,original);assert.equal((await verifyPythonRuntime(root)).ok,true);
 success=true;console.log(JSON.stringify({passed:true,python:'copied CPython 3.12.10 x64',pip:'bundled 25.0.1',packages:'two source-owned wheels',downloads,offlineInstall:'verified',fixedEntryPoint:'callable and launched with stdio transport',sealedLaunch:'unchanged',tamper:'detected',productionActivation:false,vendorBridgeCompatibility:'not-qualified'}));
}finally{
 assert.equal(path.dirname(temporary).toLowerCase(),os.tmpdir().toLowerCase());
 if(success&&!process.env.RETK_KEEP_FIXTURE)fs.rmSync(temporary,{recursive:true,force:true});else console.error(`Smoke diagnostics retained: ${temporary}`);
}
