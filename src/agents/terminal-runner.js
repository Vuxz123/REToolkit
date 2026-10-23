import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {assertGeminiBinding} from './gemini-binding.js';

// Run inside the newly opened terminal. Only the main-process launcher writes
// this bounded manifest; argv and environment values are passed as data.
export function runAgentTerminal(file,{spawnImpl=spawn,env=process.env}={}){
 const stat=fs.statSync(file);if(!stat.isFile()||stat.size>128*1024)throw Error('Invalid Agent launch manifest');
 const config=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!['codex','claude','gemini','opencode'].includes(config.harness)||!path.isAbsolute(config.command)||!path.isAbsolute(config.cwd)||!Array.isArray(config.args)||config.args.some(arg=>typeof arg!=='string'))throw Error('Invalid Agent launch configuration');
 if(Object.keys(config.env??{}).some(key=>!['GEMINI_CLI_HOME','OPENCODE_CONFIG_CONTENT'].includes(key)))throw Error('Unsupported Agent launch environment');
 if(config.harness==='gemini')assertGeminiBinding(config.cwd,{...env,...config.env});
 const status=path.join(path.dirname(file),'terminal-status.json');
 const record=value=>fs.writeFileSync(status,JSON.stringify({...value,at:new Date().toISOString()},null,2)+'\n',{mode:0o600});
 const child=spawnImpl(config.command,config.args,{cwd:config.cwd,env:{...env,...config.env},shell:false,stdio:'inherit',windowsHide:false});
 child.once('spawn',()=>record({state:'running',pid:child.pid??null}));
 child.once('error',error=>{record({state:'failed',message:String(error.message).slice(0,2000)});process.stderr.write(`AI Agent could not start: ${error.message}\n`);});
 child.once('exit',(code,signal)=>record({state:code===0?'exited':'failed',exitCode:code,signal}));
 return child;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{runAgentTerminal(process.argv[2]);}catch(error){process.stderr.write(`AI Agent could not start: ${error.message}\n`);process.exitCode=1;}
}
