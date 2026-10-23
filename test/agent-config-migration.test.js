import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {migrateCodexConfig,migrateOpenCodeConfig,planAgentCleanup,applyAgentCleanup} from '../src/agents/config-migration.js';

const root='C:/Tools/REToolkit';
test('Codex migration replaces multiline legacy launch and preserves other settings and disabled state',()=>{
 const input='model = "keep"\n\n[mcp_servers.ghidra]\ncommand = "powershell.exe"\nargs = [\n "-NoProfile",\n "C:/Tools/REToolkit/re.ps1",\n "mcp"\n]\nenabled = false\nstartup_timeout_sec = 45\n\n[mcp_servers.ghidra.env]\nRETOOLKIT_ROOT = "C:/Tools/REToolkit"\nCUSTOM = "keep"\n\n[mcp_servers.other]\ncommand = "other.exe"\n';
 const next=migrateCodexConfig(input,root);
 assert.match(next,/command = "node"/);
 assert.match(next,/args = \["C:\/Tools\/REToolkit\/re.js","mcp"\]/);
 assert.doesNotMatch(next,/powershell|re\.ps1|-NoProfile/);
 assert.match(next,/enabled = false\nstartup_timeout_sec = 45/);
 assert.match(next,/CUSTOM = "keep"/);
 assert.ok(next.endsWith('[mcp_servers.other]\ncommand = "other.exe"\n'));
 assert.equal(migrateCodexConfig(next,root),next);
});

test('configuration cleanup leaves absent and unrelated Ghidra registrations untouched',()=>{
 for(const input of ['model = "keep"\n','[mcp_servers.ghidra]\nurl = "https://example.invalid"\n','[mcp_servers.ghidra]\ncommand = "unrelated.exe"\nargs = []\n',
  '[mcp_servers.ghidra]\n# REToolkit migration note\ncommand = "unrelated.exe"\nargs = ["keep"]\n',
  'notes = """\n[mcp_servers.ghidra]\ncommand = "powershell.exe"\nargs = ["C:/Tools/REToolkit/re.ps1","mcp"]\n"""\n',
 ])assert.equal(migrateCodexConfig(input,root),input);
 const input=JSON.stringify({mcp:{ghidra:{type:'remote',url:'https://example.invalid'}}});
 assert.equal(migrateOpenCodeConfig(input,root),input);
});

test('Codex scanner preserves multiline strings, comments and brackets inside launch strings',()=>{
 const prefix='notes = \'\'\'\n[mcp_servers.fake]\ncommand = "keep"\n\'\'\'\n';
 const input=prefix+'[mcp_servers.ghidra]\ncommand = "powershell.exe"\nargs = ["C:/Tools/REToolkit/re.ps1", "]", # bracket comment ]\n "mcp"]\n';
 const next=migrateCodexConfig(input,root);
 assert.ok(next.startsWith(prefix));assert.match(next,/command = "node"/);assert.doesNotMatch(next,/powershell/);
});

test('OpenCode migration replaces downloaded uv bridge without changing credentials or other servers',()=>{
 const config={model:'keep',mcp:{ghidra:{type:'local',command:['uv','run','--script','C:/Downloads/ghidra mcp/bridge_mcp_ghidra.py'],enabled:false,timeout:45000,environment:{CUSTOM:'keep'}},other:{type:'local',command:['other']}}};
 const next=migrateOpenCodeConfig(JSON.stringify(config),root),parsed=JSON.parse(next);
 assert.deepEqual(parsed.mcp.ghidra.command,['node',root+'/re.js','mcp']);
 assert.equal(parsed.mcp.ghidra.enabled,false);
 assert.deepEqual(parsed.mcp.ghidra.environment,config.mcp.ghidra.environment);
 assert.deepEqual(parsed.mcp.other,config.mcp.other);
 assert.equal(parsed.model,'keep');
 assert.equal(migrateOpenCodeConfig(next,root),next);
});

function fixture(t){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'retk-agent-clean-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
 const toolkit=path.join(base,'toolkit'),home=path.join(base,'home');fs.mkdirSync(toolkit);fs.mkdirSync(home);fs.writeFileSync(path.join(toolkit,'re.js'),'');
 for(const name of ['retoolkit-install','retoolkit-flow','retoolkit-mcp-analysis','retoolkit-game-reconstruction']){const dir=path.join(toolkit,'skills',name,'agents');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'..','SKILL.md'),`---\nname: ${name}\n---\nCurrent workflow\n`);fs.writeFileSync(path.join(dir,'openai.yaml'),'interface: {}\n');}
 const config=path.join(home,'.codex','config.toml');fs.mkdirSync(path.dirname(config),{recursive:true});fs.writeFileSync(config,'[mcp_servers.ghidra]\ncommand = "powershell.exe"\nargs = ["C:/REToolkit/re.ps1", "mcp"]\n');
 const old=path.join(home,'.codex','skills','ghidra-reverse-engineering-cli');fs.mkdirSync(path.join(old,'agents'),{recursive:true});fs.writeFileSync(path.join(old,'SKILL.md'),'---\nname: ghidra-reverse-engineering-cli\n---\nUse REToolkit re.ps1 ghidra-cli\n');fs.writeFileSync(path.join(old,'agents','openai.yaml'),'interface: {}\n');
 return {toolkit,home,config,old};
}
test('cleanup dry-run is read-only, apply backs up originals and repeat plan is empty',t=>{
 const f=fixture(t),original=fs.readFileSync(f.config),plan=planAgentCleanup(f.toolkit,f.home);
 assert.equal(fs.readFileSync(f.config).equals(original),true);
 assert.ok(fs.existsSync(path.join(f.old,'SKILL.md')));
 const result=applyAgentCleanup(plan);
 assert.ok(fs.readFileSync(path.join(result.backup,'files',path.relative(f.home,f.config))).equals(original));
 assert.equal(fs.existsSync(f.old),false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(result.backup,'manifest.json'),'utf8')).find(item=>item.file===path.join(f.old,'SKILL.md')).afterHash,null);
 assert.ok(fs.existsSync(path.join(f.home,'.codex','skills','retoolkit-mcp-analysis','SKILL.md')));
 assert.equal(planAgentCleanup(f.toolkit,f.home).changes.length,0);
});

test('cleanup backs up complete existing skill folders including unchanged custom support files',t=>{
 const f=fixture(t),dir=path.join(f.home,'.claude','skills','retoolkit-flow');
 fs.mkdirSync(path.join(dir,'agents'),{recursive:true});
 fs.writeFileSync(path.join(dir,'SKILL.md'),'Previous workflow');
 fs.writeFileSync(path.join(dir,'agents','openai.yaml'),'interface: {}\n');
 fs.writeFileSync(path.join(dir,'local-notes.md'),'Keep local customization');
 const result=applyAgentCleanup(planAgentCleanup(f.toolkit,f.home));
 for(const relative of ['SKILL.md','agents/openai.yaml','local-notes.md'])assert.ok(fs.existsSync(path.join(result.backup,'files',path.relative(f.home,dir),relative)));
 assert.equal(fs.readFileSync(path.join(dir,'local-notes.md'),'utf8'),'Keep local customization');
});

test('bundle refresh installs reconstruction workflow and references into clients already using REToolkit',t=>{
 const f=fixture(t),existing=path.join(f.home,'.claude','skills','retoolkit-flow');
 fs.mkdirSync(existing,{recursive:true});fs.writeFileSync(path.join(existing,'SKILL.md'),'Previous workflow');
 const reference=path.join(f.toolkit,'skills','retoolkit-game-reconstruction','references','steps.md');fs.mkdirSync(path.dirname(reference),{recursive:true});fs.writeFileSync(reference,'Current branch verification rules');
 applyAgentCleanup(planAgentCleanup(f.toolkit,f.home));
 for(const client of ['.codex','.claude']){
  const installed=path.join(f.home,client,'skills','retoolkit-game-reconstruction');
  assert.ok(fs.existsSync(path.join(installed,'SKILL.md')));
  assert.equal(fs.readFileSync(path.join(installed,'references','steps.md'),'utf8'),'Current branch verification rules');
 }
 assert.equal(fs.existsSync(path.join(f.home,'.config','opencode','skills')),false);
 assert.equal(planAgentCleanup(f.toolkit,f.home).changes.length,0);
});

test('cleanup refuses to overwrite configurations changed after planning',t=>{
 const f=fixture(t),plan=planAgentCleanup(f.toolkit,f.home);fs.appendFileSync(f.config,'# user edit\n');
 assert.throws(()=>applyAgentCleanup(plan),/changed/i);
 assert.ok(fs.existsSync(path.join(f.old,'SKILL.md')));
});

test('cleanup rejects linked configuration paths before mutation',t=>{
 const f=fixture(t);fs.renameSync(path.join(f.home,'.codex'),path.join(f.home,'elsewhere'));fs.symlinkSync(path.join(f.home,'elsewhere'),path.join(f.home,'.codex'),'junction');
 assert.throws(()=>planAgentCleanup(f.toolkit,f.home),/link|junction/i);
});
