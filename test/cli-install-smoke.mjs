// Isolated real npm-link/CMD-shim integration. No registry or engine installation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {launchSpec} from '../src/process.js';
const root=path.resolve(import.meta.dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'retk global command '));
const prefix=path.join(temporary,'npm-prefix'),caller=path.join(temporary,'different-cwd'),data=path.join(temporary,'explicit-toolkit'),cache=path.join(temporary,'npm-cache');fs.mkdirSync(caller);
const npmCli=process.env.npm_execpath??path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
assert(fs.existsSync(npmCli),'Run via npm run test:cli-install to identify npm-cli.js');
const packageJson=path.join(root,'package.json'),before=fs.readFileSync(packageJson),lockBefore=fs.readFileSync(path.join(root,'package-lock.json'));let linked=false,success=false;
const env={...process.env};
for(const key of Object.keys(env))if(['npm_config_prefix','npm_config_cache','path'].includes(key.toLowerCase()))delete env[key];
// CLI --prefix changes npm's source project as well. The environment setting
// isolates the global destination while preserving the checkout as localPrefix.
Object.assign(env,{PATH:prefix+path.delimiter+(process.env.PATH??process.env.Path??''),npm_config_prefix:prefix,npm_config_cache:cache});
const npm=(...args)=>{const result=spawnSync(process.execPath,[npmCli,...args,'--offline','--ignore-scripts','--no-audit','--no-fund'],{cwd:root,env,encoding:'utf8',timeout:60000,windowsHide:true});assert.equal(result.status,0,result.stderr||result.error?.message);return result;};
const retk=(args,expected=0)=>{
 const shim=process.platform==='win32'?'retk.cmd':path.join(prefix,'bin/retk'),spec=launchSpec(shim,args);
 const result=spawnSync(spec.file,spec.args,{...spec.options,cwd:caller,env,encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(result.status,expected,result.stderr||result.error?.message);return result;
};
try{
 npm('run','cli:install');linked=true;
 if(process.platform==='win32')for(const name of ['retk','retk.cmd','retk.ps1'])assert(fs.statSync(path.join(prefix,name)).isFile());
 assert.equal(retk(['--version']).stdout.trim(),JSON.parse(before).version);assert.match(retk(['--help']).stdout,/retk doctor/);
 const doctorSpec=launchSpec(process.platform==='win32'?'retk.cmd':path.join(prefix,'bin/retk'),['doctor','--json']);
 const doctor=spawnSync(doctorSpec.file,doctorSpec.args,{...doctorSpec.options,cwd:caller,env,encoding:'utf8',windowsHide:true,timeout:30000});assert([0,1].includes(doctor.status),doctor.stderr);
 assert.equal(JSON.parse(doctor.stdout).checks.dumper.path,path.join(root,'tools/Il2CppDumper/Il2CppDumper.exe'),'Linked invocation must retain the source toolkit root from any cwd');
 assert.equal(JSON.parse(retk(['init','OwnedFixture','--root',data,'--json']).stdout).name,'OwnedFixture');
 assert.equal(JSON.parse(retk(['init','../escape','--root',data,'--json'],1).stderr).ok,false);retk(['--version','extra'],1);
 assert.deepEqual(fs.readdirSync(caller),[]);assert.deepEqual(fs.readFileSync(packageJson),before);assert.deepEqual(fs.readFileSync(path.join(root,'package-lock.json')),lockBefore);
 npm('unlink','--global','retoolkit');linked=false;
 assert(fs.existsSync(path.join(root,'re.js')));assert(!fs.existsSync(path.join(prefix,process.platform==='win32'?'retk.cmd':'bin/retk')));
 success=true;console.log(JSON.stringify({passed:true,fixture:'isolated npm global prefix and caller directory',npmLink:true,windowsCmdShim:process.platform==='win32',version:JSON.parse(before).version,linkedRoot:'preserved',exitCodes:'forwarded',sourceBytes:'unchanged',unlinked:true,registryAccess:false,vendorExecution:false}));
}finally{
 if(linked)try{npm('unlink','--global','retoolkit');linked=false;}catch{}
 assert.equal(path.dirname(temporary).toLowerCase(),os.tmpdir().toLowerCase());
 if(success&&!linked&&!process.env.RETK_KEEP_FIXTURE)fs.rmSync(temporary,{recursive:true,force:true});else console.error('CLI installation diagnostics retained: '+temporary);
}
