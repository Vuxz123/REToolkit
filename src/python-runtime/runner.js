import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {WINDOWS_SITE_SCRIPT} from './windows-site.js';

const MAX_OUTPUT=1024*1024;
const ENTRY_POINT='bridge_mcp_ghidra.cli:main';
const failure=(code,message,preserve=false)=>Object.assign(new Error(message),{code,...(preserve?{preserveToolchainGate:true}:{})});
const isolatedArgs=(script,...args)=>['-B','-I','-S','-c',script,...args];
const PREFLIGHT_SCRIPT=`# RETK_PYTHON_PREFLIGHT
import sys, struct, json
sys.path.insert(0, sys.argv[1])
import pip
print(json.dumps({'pythonVersion': '.'.join(map(str, sys.version_info[:3])), 'bits': struct.calcsize('P') * 8, 'implementation': sys.implementation.name, 'pipVersion': pip.__version__}))
`;
const PIP_SCRIPT=`# RETK_PYTHON_PIP
import sys, runpy
wheel, site = sys.argv[1:3]
sys.path.insert(0, site)
sys.path.insert(0, wheel)
sys.argv = ['pip'] + sys.argv[3:]
runpy.run_module('pip', run_name='__main__')
`;
const PROBE_SCRIPT=`# RETK_PYTHON_PROBE
${WINDOWS_SITE_SCRIPT}
import json, struct
if _retk_pywin32:
    import pywintypes, win32api, win32event
distributions = list(metadata.distributions(path=[site]))
canonical = lambda value: re.sub(r'[-_.]+', '-', value).lower()
found = [{'name': canonical(d.metadata['Name']), 'version': d.version} for d in distributions]
bridge = [d for d in distributions if canonical(d.metadata['Name']) == 'ghidra-mcp-bridge']
if len(bridge) != 1:
    raise RuntimeError('bridge distribution missing or duplicated')
entries = [e for e in bridge[0].entry_points if e.group == 'console_scripts' and e.name == 'bridge-mcp-ghidra']
if len(entries) != 1 or entries[0].value != 'bridge_mcp_ghidra.cli:main':
    raise RuntimeError('bridge entry metadata differs')
from bridge_mcp_ghidra.cli import main
if not callable(main) or entries[0].load() is not main:
    raise RuntimeError('bridge entry is not callable')
print(json.dumps({'pythonVersion': '.'.join(map(str, sys.version_info[:3])), 'bits': struct.calcsize('P') * 8, 'implementation': sys.implementation.name, 'distributions': sorted(found, key=lambda d: d['name']), 'entryPoint': 'bridge_mcp_ghidra.cli:main'}))
`;
const MCP_SCRIPT=`# RETK_PYTHON_MCP
${WINDOWS_SITE_SCRIPT}
sys.argv = ['bridge-mcp-ghidra'] + sys.argv[2:]
from bridge_mcp_ghidra.cli import main
raise SystemExit(main())
`;

function systemEnvironment(source) {
  const systemRoot=source.SystemRoot??source.SYSTEMROOT??'C:\\Windows';
  return {SystemRoot:systemRoot,WINDIR:systemRoot,PATH:path.join(systemRoot,'System32')};
}

export function pythonInstallEnvironment(transactionDir) {
  const base=path.resolve(transactionDir),env={...systemEnvironment(process.env),PIP_CONFIG_FILE:'NUL'};
  for(const [name,folder] of Object.entries({HOME:'home',USERPROFILE:'home',APPDATA:'appdata',LOCALAPPDATA:'localappdata',TEMP:'temp',TMP:'temp'})){
    env[name]=path.join(base,folder);fs.mkdirSync(env[name],{recursive:true});
  }
  return env;
}

export function pythonMcpEnvironment(toolkitEnv={}) {
  const env={...systemEnvironment(toolkitEnv),PIP_CONFIG_FILE:'NUL'};
  for(const name of ['JAVA_HOME','JAVA_HOME_OVERRIDE','GHIDRA_INSTALL_DIR','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TEMP','TMP'])if(typeof toolkitEnv[name]==='string')env[name]=toolkitEnv[name];
  if(env.JAVA_HOME)env.PATH=path.join(env.JAVA_HOME,'bin')+path.delimiter+env.PATH;
  return env;
}

export function managedMcpArgs(site) { return isolatedArgs(MCP_SCRIPT,site,'--transport','stdio'); }

// Own only this child, never a process discovered by PID or a process tree.
// Every path to resolution observes close, or explicitly retains the writer gate.
export async function executePython(file,args,{cwd,env,timeoutMs=120000}={}) {
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)throw failure('PYTHON_TIMEOUT_INVALID','Python deadline must be 1..600000ms.');
  return new Promise((resolve,reject)=>{
    let child;
    try{child=spawn(file,args,{cwd,env:env??pythonMcpEnvironment(),shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});}
    catch{reject(failure('PYTHON_START_FAILED','The locked Python process could not start.'));return;}
    const streams={stdout:[],stderr:[]},sizes={stdout:0,stderr:0};
    let problem,done=false,forceTimer,closeTimer;
    const finish=(error,result)=>{
      if(done)return;done=true;clearTimeout(deadline);clearTimeout(forceTimer);clearTimeout(closeTimer);
      process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);
      if(error){reject(error);}else resolve(result);
    };
    const stop=error=>{
      if(problem||done)return;problem=error;
      try{child.kill();}catch{/* close remains the only confirmed termination. */}
      forceTimer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}},250);
      closeTimer=setTimeout(()=>{
        child.stdout.destroy();child.stderr.destroy();child.unref();
        finish(failure(problem.code,problem.message,true));
      },1000);
    };
    const interrupt=()=>stop(failure('PYTHON_CANCELLED','The locked Python operation was cancelled; inspect retained installation ownership.',true));
    process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
    const deadline=setTimeout(()=>stop(failure('PYTHON_TIMEOUT','The locked Python deadline expired; inspect retained installation ownership.',true)),timeoutMs);
    for(const name of ['stdout','stderr'])child[name].on('data',chunk=>{
      sizes[name]+=chunk.length;
      if(sizes[name]>MAX_OUTPUT){stop(failure('PYTHON_OUTPUT_LIMIT','The locked Python process exceeded its output bound.'));return;}
      if(!problem)streams[name].push(chunk);
    });
    child.once('error',()=>{problem??=failure('PYTHON_START_FAILED','The locked Python process could not start.');});
    child.once('close',(exitCode,signal)=>{
      if(problem){finish(problem);return;}
      if(exitCode!==0||signal){finish(failure('PYTHON_PROCESS_FAILED','The locked Python process failed.'));return;}
      finish(null,{stdout:Buffer.concat(streams.stdout).toString('utf8'),stderr:Buffer.concat(streams.stderr).toString('utf8'),exitCode});
    });
  });
}

function exactKeys(value,keys) { return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(','); }
function parseReport(result,code) {
  if(result?.exitCode!==0||typeof result.stdout!=='string'||Buffer.byteLength(result.stdout)>MAX_OUTPUT)throw failure(code,'The locked Python report was invalid.');
  try{return JSON.parse(result.stdout);}catch{throw failure(code,'The locked Python report was invalid.');}
}
function validPython(value,expected) { return /^3\.12\.\d+$/.test(expected)&&value.pythonVersion===expected&&value.bits===64&&value.implementation==='cpython'; }
function validDistributions(actual,expected) {
  if(!Array.isArray(actual)||actual.length!==expected.length)return false;
  const names=new Set();
  return actual.every(item=>{
    if(!exactKeys(item,['name','version'])||typeof item.name!=='string'||typeof item.version!=='string'||names.has(item.name))return false;
    names.add(item.name);return expected.some(locked=>locked.name===item.name&&locked.version===item.version);
  });
}

export async function runPythonBuild({python,site,pipWheel,wheelhouse,requirements,expectedPython,wheels,transactionDir},{executePython:execute=executePython}={}) {
  const env=pythonInstallEnvironment(transactionDir);
  const run=async(script,args,code)=>{
    let result;
    try{result=await execute(python,isolatedArgs(script,...args),{cwd:transactionDir,env,timeoutMs:120000});}
    catch(error){throw failure(/^PYTHON_[A-Z_]+$/.test(error?.code??'')?error.code:code,'The locked Python build operation failed.',error?.preserveToolchainGate===true);}
    if(result?.exitCode!==0)throw failure(code,'The locked Python build operation failed.');
    return result;
  };
  if(!pipWheel||pipWheel.name!=='pip'||typeof pipWheel.version!=='string'||typeof pipWheel.path!=='string')throw failure('PYTHON_PREFLIGHT_INVALID','The pinned pip bootstrap is invalid.');
  const preflight=parseReport(await run(PREFLIGHT_SCRIPT,[pipWheel.path],'PYTHON_PREFLIGHT_INVALID'),'PYTHON_PREFLIGHT_INVALID');
  if(!exactKeys(preflight,['pythonVersion','bits','implementation','pipVersion'])||!validPython(preflight,expectedPython)||preflight.pipVersion!==pipWheel.version)throw failure('PYTHON_PREFLIGHT_INVALID','The locked Python or pinned pip does not match the lock.');
  await run(PIP_SCRIPT,[pipWheel.path,site,'--isolated','--disable-pip-version-check','install','--no-index','--no-deps','--only-binary=:all:','--require-hashes','--no-compile','--no-cache-dir','--no-input','--target',site,'--find-links',wheelhouse,'--requirement',requirements],'PYTHON_INSTALL_FAILED');
  await run(PIP_SCRIPT,[pipWheel.path,site,'--isolated','--disable-pip-version-check','--no-cache-dir','--no-input','check'],'PYTHON_DEPENDENCIES_INVALID');
  const probe=parseReport(await run(PROBE_SCRIPT,[site],'PYTHON_PROBE_INVALID'),'PYTHON_PROBE_INVALID');
  if(!exactKeys(probe,['pythonVersion','bits','implementation','distributions','entryPoint'])||!validPython(probe,expectedPython)||probe.entryPoint!==ENTRY_POINT||!validDistributions(probe.distributions,wheels))throw failure('PYTHON_PROBE_INVALID','The installed Python metadata or fixed entry point does not match the lock.');
  return {...probe,distributions:probe.distributions.map(({name,version})=>({name,version})).sort((a,b)=>a.name.localeCompare(b.name))};
}
