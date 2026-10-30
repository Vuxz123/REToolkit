import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';

const moduleUrl=new URL('../src/agents/launcher.js',import.meta.url);
async function fixture(t,{missing=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"retk agents ' $() & "));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'re.js'),'// fixture');
 const workspace=path.join(root,'workspaces','Example');fs.mkdirSync(workspace,{recursive:true});
 fs.writeFileSync(path.join(workspace,'project.re.json'),JSON.stringify({name:'Example',secret:'must-not-copy'}));
 const skill=path.join(root,'skills','retoolkit-game-reconstruction');fs.mkdirSync(path.join(skill,'references'),{recursive:true});
 fs.writeFileSync(path.join(skill,'SKILL.md'),'# Bundled reconstruction workflow\nRead references/checkpoint.md\n');
 fs.writeFileSync(path.join(skill,'references','checkpoint.md'),'Retain failed runs.');
 const bin=path.join(root,'trusted-bin');fs.mkdirSync(bin);
 if(!missing)for(const name of ['codex','claude','gemini','opencode'])fs.writeFileSync(path.join(bin,name+'.exe'),'fixture executable');
 const calls=[];
 const {createAgentLauncher,harnesses}=await import(moduleUrl);
 const spawnImpl=(...args)=>{calls.push(args);const child=new EventEmitter();child.pid=4321;child.unref=()=>{};queueMicrotask(()=>{child.emit('spawn');child.emit('exit',0,null);});return child;};
 const launcher=createAgentLauncher(root,{node:process.execPath,platform:'win32',env:{PATH:bin,GEMINI_CLI_SYSTEM_SETTINGS_PATH:path.join(root,'system','settings.json')},spawnImpl});
 return {root,workspace,bin,calls,launcher,harnesses};
}

test('launcher exports only the four fixed harness choices and reports availability',async t=>{
 const {launcher,harnesses}=await fixture(t);
 assert.deepEqual(harnesses.map(h=>h.id),['codex','claude','gemini','opencode']);
 assert.ok((await launcher.list()).every(h=>h.available&&path.isAbsolute(h.executable)));
 const status=await launcher.status('Example','codex');assert.equal(status.name,'Example');assert.equal(status.available,true);
});
test('all harness bootstraps and terminal runners omit Jev credentials while retaining harness authentication',async t=>{
 const {root,workspace,bin}=await fixture(t),{createAgentLauncher}=await import(moduleUrl),{runAgentTerminal}=await import('../src/agents/terminal-runner.js');
 const env={PATH:bin,TYPESAFE_API_KEY:'private-gui-key',JEV_OLD_KEY:'old-private-key',typesafe_mixed:'mixed-private-key',jev_lower:'lower-private-key',OPENAI_API_KEY:'codex-auth',ANTHROPIC_API_KEY:'claude-auth',GEMINI_API_KEY:'gemini-auth',CODEX_THREAD_ID:'retained-thread',GEMINI_CLI_SYSTEM_SETTINGS_PATH:path.join(root,'system','settings.json')};
 const bootstrapCalls=[],launcher=createAgentLauncher(root,{node:process.execPath,platform:'win32',env,spawnImpl:(...call)=>{bootstrapCalls.push(call);const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('exit',0,null));return child;}});
 for(const harness of ['codex','claude','gemini','opencode']){
  const session=await launcher.launch('Example',harness),bootstrapEnv=bootstrapCalls.at(-1)[2].env;
  for(const key of ['TYPESAFE_API_KEY','JEV_OLD_KEY','typesafe_mixed','jev_lower'])assert.equal(bootstrapEnv[key],undefined,`${harness} bootstrap must omit ${key}`);
  let terminalEnv;runAgentTerminal(path.join(session.sessionDir,'launch.json'),{env,spawnImpl:(_file,_args,options)=>{terminalEnv=options.env;return new EventEmitter();}});
  for(const key of ['TYPESAFE_API_KEY','JEV_OLD_KEY','typesafe_mixed','jev_lower'])assert.equal(terminalEnv[key],undefined,`${harness} runner must omit ${key}`);
  for(const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','GEMINI_API_KEY','CODEX_THREAD_ID','PATH'])assert.equal(terminalEnv[key],env[key]);
  for(const file of ['launch.json','mcp.json','context.md'])assert(!fs.readFileSync(path.join(session.sessionDir,file),'utf8').includes('private-gui-key'));
 }
 assert.equal(env.TYPESAFE_API_KEY,'private-gui-key');assert(fs.existsSync(workspace));
});

test('invalid project, missing project and arbitrary harness fail before spawn or session writes',async t=>{
 const {launcher,workspace,calls}=await fixture(t);
 for(const name of ['../Example','Example; calc','CON','Example.'])await assert.rejects(()=>launcher.launch(name,'codex'),/workspace name/i);
 await assert.rejects(()=>launcher.launch('Absent','codex'),/project.*exist/i);
 await assert.rejects(()=>launcher.launch('Example','cmd.exe'),/harness/i);
 assert.equal(calls.length,0);assert.equal(fs.existsSync(path.join(workspace,'04_Notes')),false);
});

test('missing harness is explicit and ignores relative or workspace-controlled PATH entries',async t=>{
 const {root,workspace,launcher,calls}=await fixture(t,{missing:true});
 const {createAgentLauncher}=await import(moduleUrl);
 fs.writeFileSync(path.join(workspace,'codex.exe'),'target executable');
 const untrusted=createAgentLauncher(root,{platform:'win32',env:{PATH:['.',workspace].join(';')}});
 assert.equal((await untrusted.list())[0].available,false);
 await assert.rejects(()=>launcher.launch('Example','codex'),/Codex CLI.*not found.*PATH/i);assert.equal(calls.length,0);
});

test('PATH aliases cannot turn workspace target files into a trusted harness',async t=>{
 const {root,workspace}=await fixture(t,{missing:true});const {createAgentLauncher}=await import(moduleUrl);
 const target=path.join(workspace,'target-bin');fs.mkdirSync(target);fs.writeFileSync(path.join(target,'codex.exe'),'untrusted target');
 const alias=path.join(root,'path-alias');fs.symlinkSync(target,alias,'junction');
 const launcher=createAgentLauncher(root,{platform:'win32',env:{PATH:alias}});
 assert.equal((await launcher.list())[0].available,false);
});

test('each harness gets both workspace-bound MCPs, exact bundled workflow and safe terminal argv',async t=>{
 const {root,workspace,launcher,calls}=await fixture(t);
 const protectedFile=path.join(workspace,'AGENTS.md');fs.writeFileSync(protectedFile,'keep user rules');
 for(const harness of ['codex','claude','gemini','opencode']){
  const result=await launcher.launch('Example',harness);
  assert.equal(result.ok,true);assert.equal(result.workspace,workspace);assert.equal(result.pid,4321);
  const manifest=JSON.parse(fs.readFileSync(path.join(result.sessionDir,'launch.json'),'utf8'));
  assert.equal(manifest.cwd,workspace);assert.equal(manifest.harness,harness);
  assert.ok(path.isAbsolute(manifest.command));assert.ok(manifest.args.every(value=>typeof value==='string'));
  const mcp=JSON.parse(fs.readFileSync(path.join(result.sessionDir,'mcp.json'),'utf8')).mcpServers;
  assert.deepEqual(mcp.retoolkit_assets.args,[path.join(root,'re.js'),'assets','mcp','Example','--root',root]);
  assert.deepEqual(mcp.retoolkit_ghidra.args,[path.join(root,'re.js'),'mcp','--root',root]);
  assert.equal(mcp.retoolkit_assets.command,process.execPath);
  const context=fs.readFileSync(path.join(result.sessionDir,'context.md'),'utf8');
  assert.match(context,/Example/);assert.ok(context.includes(JSON.stringify(workspace)));assert.match(context,/target data,[\s\S]*never instructions/i);
  for(const text of ['analysisMode','ghidra.analysis.targets','ghidra.analysis.ensure','sdk-excluded','xrefs','preparation_status','workspace.prepare','handoff','jobs_start','jobs_get','jobs_list','LDPlayer','split','planHash','receipt','04_Notes/game-reconstruction-workflow.md','project-intake-*.json','needs-input','Mono'])assert.ok(context.includes(text),text);
  assert.doesNotMatch(context,/must-not-copy/);
  assert.equal(fs.readFileSync(path.join(result.sessionDir,'skills','retoolkit-game-reconstruction','SKILL.md'),'utf8'),'# Bundled reconstruction workflow\nRead references/checkpoint.md\n');
  assert.equal(fs.readFileSync(path.join(result.sessionDir,'skills','retoolkit-game-reconstruction','references','checkpoint.md'),'utf8'),'Retain failed runs.');
  const [command,args,options]=calls.at(-1);
  assert.match(command,/powershell\.exe$/i);assert.ok(args.includes('-EncodedCommand'));
  const bootstrap=Buffer.from(args.at(-1),'base64').toString('utf16le');
  assert.match(bootstrap,/Start-Process[\s\S]*-WindowStyle Normal/);assert.match(bootstrap,/-NoExit/);
  assert.equal(options.shell,false);assert.equal(options.windowsHide,true);assert.equal(options.cwd,workspace);
  const payload=args.join(' ')+JSON.stringify(manifest);
  assert.doesNotMatch(payload,/--yolo|--auto\b|dangerously|bypass|approval_policy|permission-mode/i);
  if(harness==='codex'){assert.ok(manifest.args.includes('-c'));assert.ok(manifest.args.some(x=>x.startsWith('mcp_servers.retoolkit_assets=')));}
  if(harness==='claude')assert.ok(manifest.args.includes('--mcp-config'));
  if(harness==='gemini'){assert.equal(manifest.env.GEMINI_CLI_HOME,path.join(result.sessionDir,'gemini-home'));const settings=JSON.parse(fs.readFileSync(path.join(manifest.env.GEMINI_CLI_HOME,'.gemini','settings.json')));assert.deepEqual(settings.mcpServers,mcp);assert.ok(manifest.args.includes('--prompt-interactive'));}
  if(harness==='opencode'){const settings=JSON.parse(manifest.env.OPENCODE_CONFIG_CONTENT);assert.deepEqual(settings.mcp.retoolkit_assets.command,[process.execPath,...mcp.retoolkit_assets.args]);assert.ok(manifest.args.includes('--prompt'));}
 }
 assert.equal(fs.readFileSync(protectedFile,'utf8'),'keep user rules');
 assert.equal(fs.existsSync(path.join(workspace,'.gemini')),false);assert.equal(fs.existsSync(path.join(workspace,'.mcp.json')),false);
});

test('Claude keeps the initial prompt outside its variadic MCP config list through the terminal runner',async t=>{
 const {launcher,workspace}=await fixture(t);
 const result=await launcher.launch('Example','claude');
 const file=path.join(result.sessionDir,'launch.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));
 // Claude --mcp-config <configs...> consumes every following non-option until --.
 // A quoted prompt is still one more config without this boundary.
 const boundary=manifest.args.indexOf('--');
 const mcpStart=manifest.args.indexOf('--mcp-config');assert.equal(boundary,mcpStart+2,'end the MCP config list before the positional prompt');
 assert.deepEqual(manifest.args.slice(mcpStart,boundary),['--mcp-config',path.join(result.sessionDir,'mcp.json')]);
 assert.equal(manifest.args.length,boundary+2);
 const prompt=manifest.args[boundary+1];assert.match(prompt,/^Continue the REToolkit project Example\./);
 assert.ok(prompt.includes(JSON.stringify(path.join(result.sessionDir,'context.md'))));
 assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(manifest.args[mcpStart+1],'utf8')).mcpServers).sort(),['retoolkit_assets','retoolkit_ghidra']);
 const {runAgentTerminal}=await import('../src/agents/terminal-runner.js');
 const calls=[],child=new EventEmitter();
 runAgentTerminal(file,{env:{},spawnImpl:(...args)=>{calls.push(args);return child;}});
 assert.deepEqual(calls[0][1],manifest.args);
 assert.equal(calls[0][2].cwd,workspace);assert.equal(calls[0][2].shell,false);
});

test('terminal creation waits for the bootstrap result rather than reporting a process spawn as success',async t=>{
 const {root}=await fixture(t);const {createAgentLauncher}=await import(moduleUrl);
 const launcher=createAgentLauncher(root,{node:process.execPath,platform:'win32',env:{PATH:path.join(root,'trusted-bin')},spawnImpl:()=>{const child=new EventEmitter();queueMicrotask(()=>{child.emit('spawn');child.emit('exit',1,null);});return child;}});
 await assert.rejects(()=>launcher.launch('Example','codex'),/terminal.*exit.*1/i);
});

test('Gemini refuses project settings that replace either workspace-bound MCP before creating a terminal',async t=>{
 const {workspace,launcher,calls}=await fixture(t);
 const directory=path.join(workspace,'.gemini');fs.mkdirSync(directory);
 const file=path.join(directory,'settings.json'),original=JSON.stringify({ui:{theme:'keep'},mcpServers:{retoolkit_assets:{command:'node',args:['other-workspace']}}});fs.writeFileSync(file,original);
 await assert.rejects(()=>launcher.launch('Example','gemini'),/Gemini.*retoolkit_assets.*conflict/i);
 assert.equal(calls.length,0);assert.equal(fs.readFileSync(file,'utf8'),original);assert.equal(fs.existsSync(path.join(workspace,'04_Notes')),false);
});

test('Gemini preserves managed policy and refuses conflicting system settings or MCP restrictions',async t=>{
 const {root,workspace,launcher,calls}=await fixture(t),system=path.join(root,'system');fs.mkdirSync(system);
 const file=path.join(system,'settings.json');
 for(const config of [{mcpServers:{retoolkit_ghidra:{httpUrl:'https://example.invalid/other'}}},{mcp:{serverCommand:'other'}},{mcp:{excluded:['retoolkit_assets']}},{mcp:{allowed:['other']}},{mcpServers:null},{mcp:{allowed:'retoolkit_assets'}},{admin:{mcp:{enabled:false}}},{admin:{mcp:{config:{unrelated:{url:'https://example.invalid'}}}}},{admin:{mcp:{requiredConfig:{retoolkit_assets:{url:'https://example.invalid'}}}}}]){
  const original=JSON.stringify(config);fs.writeFileSync(file,original);
  await assert.rejects(()=>launcher.launch('Example','gemini'),/Gemini.*conflict/i);assert.equal(fs.readFileSync(file,'utf8'),original);
 }
 assert.equal(calls.length,0);assert.equal(fs.existsSync(path.join(workspace,'04_Notes')),false);
});

test('Gemini checks system defaults and rechecks project settings inside the terminal before harness spawn',async t=>{
 const {root,workspace,launcher,calls}=await fixture(t),directory=path.join(root,'system');fs.mkdirSync(directory);
 const defaults=path.join(directory,'system-defaults.json');fs.writeFileSync(defaults,JSON.stringify({mcpServers:{retoolkit_assets:{env:{REDIRECT:'other'}}}}));
 await assert.rejects(()=>launcher.launch('Example','gemini'),/Gemini.*conflict/i);assert.equal(calls.length,0);fs.unlinkSync(defaults);
 const result=await launcher.launch('Example','gemini');
 const configDirectory=path.join(workspace,'.gemini');fs.mkdirSync(configDirectory);fs.writeFileSync(path.join(configDirectory,'settings.json'),JSON.stringify({mcpServers:{retoolkit_assets:{command:'other'}}}));
 const {runAgentTerminal}=await import('../src/agents/terminal-runner.js');let spawned=false;
 assert.throws(()=>runAgentTerminal(path.join(result.sessionDir,'launch.json'),{env:{GEMINI_CLI_SYSTEM_SETTINGS_PATH:path.join(directory,'settings.json')},spawnImpl:()=>{spawned=true;}}),/Gemini.*conflict/i);
 assert.equal(spawned,false);
});

test('Gemini accepts unrelated existing JSON-with-comments settings without rewriting them',async t=>{
 const {workspace,launcher}=await fixture(t),directory=path.join(workspace,'.gemini');fs.mkdirSync(directory);
 const file=path.join(directory,'settings.json'),original='// keep comment\n{"ui":{"theme":"keep"},"mcpServers":{"unrelated":{"command":"keep","args":["https://example.invalid/*literal*/"]}}}';fs.writeFileSync(file,original);
 assert.equal((await launcher.launch('Example','gemini')).ok,true);assert.equal(fs.readFileSync(file,'utf8'),original);
});

test('Gemini settings validation errors never echo malformed configuration contents',async t=>{
 const {workspace,launcher,calls}=await fixture(t),directory=path.join(workspace,'.gemini');fs.mkdirSync(directory);
 const file=path.join(directory,'settings.json');fs.writeFileSync(file,'SYNTHETIC_SECRET_FOR_TEST {"secret":true}');
 await assert.rejects(()=>launcher.launch('Example','gemini'),error=>{
  assert.equal(error.code,'AGENT_MCP_CONFIG_CONFLICT');assert.ok(error.message.includes(file));assert.doesNotMatch(error.message,/SYNTHETIC|"secret"/);return true;
 });
 assert.equal(calls.length,0);
});

test('standard npm shims resolve only contained installed files and keep shell metacharacters as argv data',async t=>{
 const {root,bin,calls}=await fixture(t);const {createAgentLauncher}=await import(moduleUrl);
 fs.unlinkSync(path.join(bin,'codex.exe'));
 const entry=path.join(bin,'node_modules','@openai','codex','bin','codex.js');fs.mkdirSync(path.dirname(entry),{recursive:true});fs.writeFileSync(entry,'// fixture package');
 fs.writeFileSync(path.join(bin,'codex.cmd'),'@echo off\n"%_prog%" "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\n');
 const child=()=>{const result=new EventEmitter();queueMicrotask(()=>{result.emit('spawn');result.emit('exit',0,null);});return result;};
 const launcher=createAgentLauncher(root,{node:process.execPath,platform:'win32',env:{PATH:bin},spawnImpl:(...args)=>{calls.push(args);return child();}});
 const result=await launcher.launch('Example','codex'),manifest=JSON.parse(fs.readFileSync(path.join(result.sessionDir,'launch.json')));
 assert.equal(manifest.command,process.execPath);assert.equal(manifest.args[0],entry);
 const bootstrap=Buffer.from(calls.at(-1)[1].at(-1),'base64').toString('utf16le');
 assert.equal(bootstrap.includes(root),false);
 fs.writeFileSync(path.join(bin,'codex.cmd'),'@echo off\ncmd.exe /c calc\n');
 assert.equal((await launcher.list())[0].available,false);
});

test('terminal runner forwards manifest argv exactly without executing a real harness',async t=>{
 const {root,workspace}=await fixture(t);const {runAgentTerminal}=await import('../src/agents/terminal-runner.js');
 const file=path.join(root,'test-launch.json'),args=['spaces and "quotes"',"$(Write-Output nope); & 'literal'",'next\nline'];
 fs.writeFileSync(file,JSON.stringify({harness:'codex',cwd:workspace,command:process.execPath,args,env:{}}));
 const calls=[],child=new EventEmitter();child.pid=4321;
 runAgentTerminal(file,{env:{KEEP:'retained'},spawnImpl:(...call)=>{calls.push(call);return child;}});
 assert.deepEqual(calls[0][1],args);assert.equal(calls[0][2].shell,false);assert.equal(calls[0][2].stdio,'inherit');assert.equal(calls[0][2].env.KEEP,'retained');
 child.emit('spawn');child.emit('exit',0,null);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'terminal-status.json'))).state,'exited');
});

test('launch reports a terminal spawn failure and retains bounded session diagnostics',async t=>{
 const {root}=await fixture(t);const {createAgentLauncher}=await import(moduleUrl);
 const launcher=createAgentLauncher(root,{node:process.execPath,platform:'win32',env:{PATH:path.join(root,'trusted-bin')},spawnImpl:()=>{const child=new EventEmitter();queueMicrotask(()=>child.emit('error',Error('fixture terminal missing')));return child;}});
 await assert.rejects(()=>launcher.launch('Example','codex'),/terminal.*fixture terminal missing/i);
 const sessions=path.join(root,'workspaces','Example','04_Notes','agent-sessions');const session=path.join(sessions,fs.readdirSync(sessions)[0]);
 assert.equal(JSON.parse(fs.readFileSync(path.join(session,'launch-status.json'))).state,'failed');
});

test('explicit reconstruction launch starts the authorized workflow without asking for a task',async t=>{
 const {launcher}=await fixture(t),r=await launcher.launch('Example','codex',{mode:'reconstruct'});
 const manifest=JSON.parse(fs.readFileSync(path.join(r.sessionDir,'launch.json'))),context=fs.readFileSync(path.join(r.sessionDir,'context.md'),'utf8');
 assert.equal(manifest.mode,'reconstruct');assert.match(context,/explicitly requested.*reconstruction/i);assert.doesNotMatch(context,/Opening this terminal does not establish/);
 assert.match(manifest.args.at(-1),/Start.*reconstruction now/i);
});

test('resume uses an exact session ID and keeps project MCP configuration for all harnesses',async t=>{
 const {launcher}=await fixture(t);
 for(const harness of ['codex','claude','gemini','opencode']){
  const id=harness==='opencode'?'ses_example123':'019a30bb-f351-77ab-9e17-38b5755db88e';
  const original=harness==='gemini'?await launcher.launch('Example',harness):null;
  const r=await launcher.launch('Example',harness,{mode:'resume',sessionId:id,...(original?{sourceSession:path.basename(original.sessionDir)}:{})});
  const m=JSON.parse(fs.readFileSync(path.join(r.sessionDir,'launch.json')));
  assert(m.args.includes(id));assert.equal(m.mode,'resume');assert(!m.args.includes('--last'));assert(!m.args.includes('--continue'));
 }
 await assert.rejects(launcher.launch('Example','codex',{mode:'resume',sessionId:'--last'}));
});

test('Claude native session ID is retained and Gemini repeated resume reuses the original home',async t=>{
 const {launcher}=await fixture(t),claude=await launcher.launch('Example','claude');
 const rows=await launcher.sessions('Example','claude');assert.equal(rows.length,1);assert.match(rows[0].sessionId,/^[a-f0-9-]{36}$/);assert.equal(rows[0].id,path.basename(claude.sessionDir));
 const first=await launcher.launch('Example','gemini'),id='019a30bb-f351-77ab-9e17-38b5755db88e';
 const second=await launcher.launch('Example','gemini',{mode:'resume',sessionId:id,sourceSession:path.basename(first.sessionDir)});
 const third=await launcher.launch('Example','gemini',{mode:'resume',sessionId:id,sourceSession:path.basename(second.sessionDir)});
 const home=r=>JSON.parse(fs.readFileSync(path.join(r.sessionDir,'launch.json'))).env.GEMINI_CLI_HOME;
 assert.equal(home(first),home(third));
 await assert.rejects(launcher.launch('Example','gemini',{mode:'resume',sessionId:id,sourceSession:'../escape'}));
});
