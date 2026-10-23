import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const names=['retoolkit-install','retoolkit-flow','retoolkit-mcp-analysis','retoolkit-game-reconstruction'];
const hash=bytes=>bytes===null?null:createHash('sha256').update(bytes).digest('hex');
const knownLaunch=text=>/REToolkit|re\.ps1|bridge[_-]mcp[_-]ghidra|ghidra[_-]mcp[_-]bridge/i.test(text);
const launcher=root=>path.resolve(root,'re.js').replaceAll('\\','/');

// Mask strings and comments without changing offsets or newlines. Header-like
// text in a multiline instruction must never be interpreted as configuration.
function scanToml(text){
 const masked=text.split(''),strings=[];
 const hide=(start,end)=>{for(let k=start;k<end;k++)if(text[k]!=='\n'&&text[k]!=='\r')masked[k]=' ';};
 for(let i=0;i<text.length;){
  if(text[i]==='#'){const end=text.indexOf('\n',i);hide(i,end<0?text.length:end);i=end<0?text.length:end;continue;}
  if(text[i]!=='"'&&text[i]!=="'"){i++;continue;}
  const start=i,quote=text[i],triple=text.slice(i,i+3)===quote.repeat(3);i+=triple?3:1;let closed=false;
  while(i<text.length){
   if(quote==='"'&&text[i]==='\\'){i+=2;continue;}
   if(text[i]===quote){
    if(!triple){i++;closed=true;break;}
    let count=0;while(text[i+count]===quote)count++;
    if(count>=3){i+=count;closed=true;break;}i+=count;continue;
   }
   if(!triple&&/[\r\n]/.test(text[i]))throw Error('Invalid TOML string; manual review required');
   i++;
  }
  if(!closed)throw Error('Unterminated TOML string; manual review required');
  strings.push({start,end:i,text:text.slice(start,i)});hide(start,i);
 }
 return {masked:masked.join(''),strings};
}
function argsRange(masked){
 const matches=[...masked.matchAll(/^[ \t]*args[ \t]*=[ \t]*/gm)];
 if(matches.length!==1)throw Error('Expected one Ghidra args assignment');
 const start=matches[0].index;let cursor=start+matches[0][0].length;
 while(/\s/.test(masked[cursor]??'')&&cursor<masked.length)cursor++;
 if(masked[cursor]!=='[')throw Error('Expected a Ghidra argument array');
 let depth=0;
 for(let i=cursor;i<masked.length;i++){if(masked[i]==='[')depth++;if(masked[i]===']'&&--depth===0)return {start,end:i+1};}
 throw Error('Unterminated Ghidra argument array');
}
export function migrateCodexConfig(text,root){
 const document=scanToml(text);
 const headers=[...document.masked.matchAll(/^\[([^\]\r\n]+)\][ \t]*\r?$/gm)];
 const found=headers.filter(item=>item[1]==='mcp_servers.ghidra');
 if(!found.length)return text;
 if(found.length!==1)throw Error('Duplicate Ghidra MCP table');
 const header=found[0],next=headers.find(item=>item.index>header.index),end=next?.index??text.length;
 let block=text.slice(header.index,end);const scanned=scanToml(block);
 const commands=[...scanned.masked.matchAll(/^[ \t]*command[ \t]*=[^\r\n]*/gm)];
 if(!commands.length)return text;
 if(commands.length!==1)throw Error('Expected one Ghidra command assignment');
 const command={start:commands[0].index,end:commands[0].index+commands[0][0].length},args=argsRange(scanned.masked);
 const launchStrings=scanned.strings.filter(item=>[command,args].some(range=>item.start>=range.start&&item.end<=range.end));
 if(!knownLaunch(launchStrings.map(item=>item.text).join('\n')))return text;
 const edits=[{...command,text:'command = "node"'},{...args,text:'args = '+JSON.stringify([launcher(root),'mcp'])}].sort((a,b)=>b.start-a.start);
 for(const edit of edits)block=block.slice(0,edit.start)+edit.text+block.slice(edit.end);
 return text.slice(0,header.index)+block+text.slice(end);
}
export function migrateOpenCodeConfig(text,root){
 const config=JSON.parse(text.replace(/^\uFEFF/,'')),entry=config.mcp?.ghidra;
 if(entry?.type!=='local'||!Array.isArray(entry.command)||!knownLaunch(JSON.stringify(entry.command)))return text;
 const command=['node',launcher(root),'mcp'];
 if(JSON.stringify(entry.command)===JSON.stringify(command))return text;
 entry.command=command;
 return JSON.stringify(config,null,2)+'\n';
}

function noLinks(file){
 const absolute=path.resolve(file),base=path.parse(absolute).root;let cursor=base;
 for(const part of absolute.slice(base.length).split(path.sep).filter(Boolean)){
  cursor=path.join(cursor,part);try{if(fs.lstatSync(cursor).isSymbolicLink())throw Error('Linked paths or junctions require manual review');}catch(error){if(error.code==='ENOENT')return;throw error;}
 }
}
function bytesAt(file){
 noLinks(file);try{const stat=fs.statSync(file);if(!stat.isFile()||stat.size>4*1024**2)throw Error('Expected a bounded regular configuration file');return fs.readFileSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function listFiles(directory){
 noLinks(directory);if(!fs.existsSync(directory))return [];
 const files=[];function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name);noLinks(file);
  if(entry.isDirectory())walk(file);else{if(!entry.isFile())throw Error('Unsupported skill entry');files.push(file);if(files.length>200)throw Error('Skill folder exceeds cleanup limit');}
 }}walk(directory);return files;
}
export function planAgentCleanup(root,home,{codexHome=path.join(home,'.codex')}={}){
 root=path.resolve(root);home=path.resolve(home);codexHome=path.resolve(codexHome);
 if(!fs.existsSync(path.join(root,'re.js')))throw Error('Toolkit root is missing re.js');
 const changes=[],removeDirectories=[],warnings=[],backups=new Map();
 function remember(file){const before=bytesAt(file);if(before!==null)backups.set(file,{file,before,beforeHash:hash(before)});return before;}
 function change(file,next){const before=remember(file),after=next===null?null:Buffer.from(next);if(hash(before)!==hash(after))changes.push({file,before,after,beforeHash:hash(before),afterHash:hash(after)});}
 for(const [file,transform]of [[path.join(codexHome,'config.toml'),migrateCodexConfig],[path.join(home,'.config','opencode','opencode.json'),migrateOpenCodeConfig]]){
  const before=bytesAt(file);if(before!==null)change(file,transform(before.toString('utf8'),root));
 }
 const old=path.join(codexHome,'skills','ghidra-reverse-engineering-cli'),oldFiles=listFiles(old);
 if(oldFiles.length){
  const skill=bytesAt(path.join(old,'SKILL.md'))?.toString('utf8')??'';
  if(!/name:\s*ghidra-reverse-engineering-cli/.test(skill)||!knownLaunch(skill))throw Error('Legacy skill identity requires manual review');
  for(const file of oldFiles)change(file,null);
  removeDirectories.push(old);
 }
 const roots=[path.join(codexHome,'skills')];
 // Refresh the bundle only for clients already using it; new bundle skills are
 // installed there too, without registering additional clients or MCP servers.
 for(const rel of ['.claude/skills','.agents/skills','.config/opencode/skills']){
  const candidate=path.join(home,rel);if(names.some(name=>fs.existsSync(path.join(candidate,name))))roots.push(candidate);
 }
 for(const installed of roots)for(const name of names){
  const source=path.join(root,'skills',name),destination=path.join(installed,name);
  for(const file of listFiles(destination))remember(file);
  for(const file of listFiles(source)){const relative=path.relative(source,file);change(path.join(destination,relative),bytesAt(file));}
  const extra=listFiles(destination).filter(file=>!fs.existsSync(path.join(source,path.relative(destination,file))));
  if(extra.length)warnings.push({skill:name,extraFilesPreserved:extra.length});
 }
 return {root,home,codexHome,changes,removeDirectories,warnings,backups:[...backups.values()]};
}
function writeFile(file,bytes){
 noLinks(file);fs.mkdirSync(path.dirname(file),{recursive:true});
 const stage=file+'.retk-'+randomUUID();try{fs.writeFileSync(stage,bytes,{flag:'wx',mode:0o600});fs.renameSync(stage,file);}finally{if(fs.existsSync(stage))fs.unlinkSync(stage);}
}
export function applyAgentCleanup(plan){
 const validate=()=>{for(const item of [...plan.changes,...plan.backups])if(hash(bytesAt(item.file))!==item.beforeHash)throw Error('Configuration changed after planning; rerun cleanup');};
 validate();
 if(!plan.changes.length)return {changed:0,backup:null};
 const backup=path.join(plan.root,'.cache','agent-cleanup',randomUUID());noLinks(backup);fs.mkdirSync(backup,{recursive:true});
 const manifest=[];
 const backupItems=[...plan.backups.map(item=>{const change=plan.changes.find(change=>change.file===item.file);return {...item,afterHash:change?change.afterHash:item.beforeHash};}),...plan.changes.filter(item=>item.before===null)];
 for(const [index,item]of backupItems.entries()){
  const relative=path.relative(plan.home,item.file),underHome=relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);
  const saved=underHome?path.join('files',relative):path.join('external',String(index));
  if(item.before!==null)writeFile(path.join(backup,saved),item.before);
  if(item.before!==null&&hash(bytesAt(path.join(backup,saved)))!==item.beforeHash)throw Error('Backup verification failed');
  manifest.push({file:item.file,backup:item.before===null?null:saved,beforeHash:item.beforeHash,afterHash:item.afterHash});
 }
 writeFile(path.join(backup,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 validate();const applied=[];
 try{
  for(const item of plan.changes){if(hash(bytesAt(item.file))!==item.beforeHash)throw Error('Configuration changed during cleanup');if(item.after===null)fs.unlinkSync(item.file);else writeFile(item.file,item.after);applied.push(item);}
  for(const item of plan.changes)if(hash(bytesAt(item.file))!==item.afterHash)throw Error('Cleanup output verification failed');
  // Remove only empty directories inside the exact retired skill folder.
  for(const directory of plan.removeDirectories){noLinks(directory);const prune=dir=>{if(!fs.existsSync(dir))return;for(const entry of fs.readdirSync(dir,{withFileTypes:true}))if(entry.isDirectory())prune(path.join(dir,entry.name));if(!fs.readdirSync(dir).length)fs.rmdirSync(dir);};prune(directory);}
 }catch(error){
  for(const item of applied.reverse())if(hash(bytesAt(item.file))===item.afterHash){if(item.before===null)fs.unlinkSync(item.file);else writeFile(item.file,item.before);}
  throw error;
 }
 return {changed:plan.changes.length,backup};
}
