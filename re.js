#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createToolkit } from './src/toolkit.js';
import { isBridgeCommand,runBridgeCli,bridgeUsage } from './src/ghidra/cli.js';
import {isMilestoneCommand,runMilestoneCli} from './src/milestones-cli.js';
import {isToolchainCommand,runToolchainCli} from './src/toolchain/cli.js';
import {isPythonRuntimeCommand,runPythonRuntimeCli} from './src/python-runtime/cli.js';
import {prepareMcpCommand} from './src/python-runtime/launcher.js';
import {acquireToolchainRead} from './src/toolchain/lease.js';

const usage = `REToolkit JavaScript CLI (Node.js 24+)
  node re.js doctor [Game] [--task prepare|headless|mcp|assetripper] [--probe]
  node re.js init <Game>
  node re.js scan <Game> <folder> [--binary <relative-path>] [--metadata <relative-path>]
  node re.js add <Game> <APK/XAPK/AAB/ZIP-or-folder> [--binary <path>] [--metadata <path>]
  node re.js flow <Game> <source> [--resume] [--dry-run] [--no-open] [--reimport]
                             [--binary <path>] [--metadata <path>]
  node re.js dump <Game>
  node re.js import <Game> [--reimport]
  node re.js import <archive.re> [Game] [--force]
  node re.js export <Game> [output.re]
  node re.js analyze <Game>
  node re.js symbols <Game>
  node re.js open|path|status|notes|context|candidates <Game>
  node re.js mcp
  node re.js toolchain plan|install <lock.json> [--cache <folder>]
  node re.js toolchain verify
  node re.js python-runtime plan|install <lock.json> [--cache <folder>]
  node re.js python-runtime verify
  node re.js handoff create <Game> [--out <folder|zip>] [--evidence <folder>]
  node re.js handoff verify <folder|zip>
  node re.js evidence capture <Game> --kind decompile|xrefs|functions [--selector <name/address>]
  node re.js jev request <bundle> --questions <json> --out <request.json>
  node re.js jev run <request.json> --out <result.json>
  node re.js ghidra-gui|pyghidra-gui|il2cppdumper|assetripper|assetripper-cli|pull-ldplayer ...
Global: --root <toolkit-directory>, --json
Resume is the safe default. Dry-run does not create or change a workspace.
Existing Ghidra data requires a new workspace or explicit --reimport with backup.
Prepared does not mean analysis-ready: verify analysis, symbols and MCP program.
GUI/tool-launch adapters and the installer still use PowerShell during migration.
Native headless queries: session start, function, decompile, disasm, xrefs, strings, bytes.
Use session start --help for bridge commands; GUI GhidraMCP remains available.
`;

function parse(argv) {
  const options={}; const positionals=[];
  const values=new Set(['binary','metadata','root']);
  const flags=new Set(['resume','dry-run','no-open','reimport','force','json','help']);
  for(let i=0;i<argv.length;i++) {
    const arg=argv[i];
    if(arg==='--') { positionals.push(...argv.slice(i+1)); break; }
    if(!arg.startsWith('--')) { positionals.push(arg); continue; }
    const equal=arg.indexOf('='); const name=arg.slice(2,equal===-1?undefined:equal);
    if(values.has(name)) {
      const value=equal===-1?argv[++i]:arg.slice(equal+1);
      if(!value||value.startsWith('--')) throw new Error(`--${name} requires a value`);
      options[name]=value;
    } else if(flags.has(name)&&equal===-1) options[name.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return {options,positionals};
}

async function main() {
  const raw=process.argv.slice(2);
  if(isPythonRuntimeCommand(raw))return runPythonRuntimeCli(raw,path.dirname(fileURLToPath(import.meta.url)));
  if(isToolchainCommand(raw))return runToolchainCli(raw,path.dirname(fileURLToPath(import.meta.url)));
  if(isMilestoneCommand(raw))return runMilestoneCli(raw,path.dirname(fileURLToPath(import.meta.url)));
  if(isBridgeCommand(raw))return runBridgeCli(raw,path.dirname(fileURLToPath(import.meta.url)));
  // Explicitly retained Windows launchers pass their arguments through verbatim.
  const adapters=new Set(['ghidra-gui','pyghidra-gui','il2cppdumper','assetripper','asset-ripper','assetripper-cli','pull-ldplayer']);
  if(adapters.has(raw[0])) {
    const root=path.dirname(fileURLToPath(import.meta.url)); const toolkit=createToolkit(root);
    await toolkit.compat(raw[0],raw.slice(1));
    return;
  }
  const {options,positionals}=parse(raw); const [command,name,source,...extra]=positionals;
  if(!command||['help','-h','--help'].includes(command)||options.help) { console.log(usage); return; }
  const root=path.resolve(options.root??path.dirname(fileURLToPath(import.meta.url)));
  const toolkit=createToolkit(root,{log:options.json?message=>console.error(message):console.log});
  const print=value=>console.log(typeof value==='string'?value:JSON.stringify(value,null,2));
  const noArgs=new Set(['doctor','mcp']);
  if(noArgs.has(command)&&name) throw new Error(`Too many arguments for ${command}`);
  if(!noArgs.has(command)&&!name) throw new Error(`${command} requires a workspace name or archive path`);
  if(extra.length) throw new Error(`Too many arguments for ${command}`);
  const sourceCommands=new Set(['scan','add','flow']);
  if(sourceCommands.has(command)&&!source) throw new Error(`${command} requires an input path`);
  const allowed={flow:['resume','dryRun','noOpen','reimport','binary','metadata'],scan:['binary','metadata'],add:['binary','metadata'],import:['force','reimport']};
  for(const key of Object.keys(options)) if(!['root','json','help',...(allowed[command]??[])].includes(key)) throw new Error(`Option ${key} is not supported by ${command}`);
  if(!sourceCommands.has(command)&&!['import','export'].includes(command)&&source) throw new Error(`Too many arguments for ${command}`);
  switch(command) {
    case 'doctor': {
      const checks=Object.fromEntries(Object.entries(toolkit.tools).map(([key,file])=>[key,{path:file,exists:fs.existsSync(file)}]));
      print({node:process.version,root,checks,notice:'Tool presence does not establish analysis or MCP readiness'}); break;
    }
    case 'init': print(await toolkit.init(name)); break;
    case 'scan': print(await toolkit.scan(name,source,options)); break;
    case 'add': print(await toolkit.add(name,source,options)); break;
    case 'flow': print(await toolkit.flow(name,source,options)); break;
    case 'dump': print(await toolkit.dump(name)); break;
    case 'import':
      if(/\.(re|zip)$/i.test(name)||fs.existsSync(name)&&fs.statSync(name).isFile()) {
        if(options.reimport) throw new Error('--reimport is for Ghidra programs, use --force for archive replacement');
        print(await toolkit.importArchive(name,source,options));
      } else { if(source||options.force) throw new Error('Use import <Game> [--reimport] for Ghidra'); print(await toolkit.importProgram(name,options)); }
      break;
    case 'export': print(await toolkit.exportArchive(name,source)); break;
    case 'analyze': print(await toolkit.analyze(name)); break;
    case 'symbols': {
      const p=toolkit.read(name);
      print(`Open ${p.ghidraProjectDir} / ${p.ghidraProjectName}, verify Auto Analysis, run ${path.join(p.il2cppDumperOutput,'ghidra.py')} and select ${path.join(p.il2cppDumperOutput,'script.json')}. Completion is not verified by this command.`); break;
    }
    case 'status': print(await toolkit.status(name)); break;
    case 'path': { const p=toolkit.read(name); print({directory:p.ghidraProjectDir,url:new URL(`file:///${p.ghidraProjectDir.replaceAll('\\','/')}`).href,project:p.ghidraProjectName,program:p.ghidraProgramName}); break; }
    case 'open': await toolkit.open(name); break;
    case 'notes': case 'context': case 'candidates': await toolkit.notes(name); print(path.join(toolkit.workspace(name),'04_Notes')); break;
    case 'mcp': {
      const lease=acquireToolchainRead(root);
      try{const command=await prepareMcpCommand(toolkit);await toolkit.run(command.file,command.args,{cwd:root,env:command.env,inherit:true,toolchainRoot:root});}
      finally{lease.release();}break;
    }
    case 'ghidra': case 'ghidra-cli': case 'summary': case 'strings': case 'functions': case 'stats': throw new Error('Use live GhidraMCP: list_instances, connect_instance, then load the relevant tool groups.');
    default: throw new Error(`Unknown command: ${command}\n${usage}`);
  }
}
main().catch(error=>{ console.error(process.argv.includes('--json')?JSON.stringify({ok:false,error:{code:error.code??'operation_failed',message:error.message}}):`REToolkit${error.code?` [${error.code}]`:''}: ${error.message}`); process.exitCode=1; });
