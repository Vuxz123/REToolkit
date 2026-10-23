import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const api=()=>import('../src/bootstrap/index.js');
const repo=path.resolve(import.meta.dirname,'..');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-quick-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'config'));for(const file of ['package.json','package-lock.json','config/native-windows-x64.lock.json','config/desktop-windows-x64.lock.json'])fs.copyFileSync(path.join(repo,file),path.join(root,file));return root;}
test('cold quickstart plan is offline, write-free and includes separate MCP and GUI runtimes',async t=>{
 const root=fixture(t),before=fs.readdirSync(root),{planQuickstart}=await api();const report=planQuickstart(root,{});
 assert.equal(report.profile,'full');assert.deepEqual(report.stages.map(s=>s.id),['dependencies','gui','native','mcp','desktop-runtime','command','diagnostics']);assert.match(report.locks.native,/^[a-f0-9]{64}$/);assert.deepEqual(fs.readdirSync(root),before);assert.equal(fs.existsSync(path.join(root,'.cache')),false);
 assert.deepEqual(planQuickstart(root,{profile:'cli'}).stages.map(s=>s.id),['dependencies','command']);assert.deepEqual(planQuickstart(root,{profile:'desktop'}).stages.map(s=>s.id),['dependencies','gui','command']);
});
test('quickstart rejects malformed options before creating state',async t=>{
 const root=fixture(t),{planQuickstart}=await api();for(const options of [{profile:'anything'},{noPath:'true'},{cache:'bad\npath'},{shell:'cmd.exe'}])assert.throws(()=>planQuickstart(root,options));assert.equal(fs.existsSync(path.join(root,'.cache')),false);
});
test('quickstart stages stop on failure, preserve receipt and never run dependent handlers',async t=>{
 const root=fixture(t),{runQuickstart}=await api(),called=[];const handlers=Object.fromEntries(['dependencies','gui','native','mcp','desktop-runtime','command','diagnostics'].map(id=>[id,async()=>{called.push(id);if(id==='native')throw Object.assign(Error('fixture download failure'),{code:'FIXTURE_FAILED'});return {state:'verified'};}]));
 const result=await runQuickstart(root,{noPath:true},{platform:'win32',arch:'x64',preflight:async()=>{},handlers});assert.equal(result.state,'failed');assert.equal(result.ok,false);assert.deepEqual(called,['dependencies','gui','native']);assert.equal(result.stages.find(s=>s.id==='native').error.code,'FIXTURE_FAILED');assert.equal(result.stages.find(s=>s.id==='mcp').state,'not-started');assert.ok(fs.existsSync(result.reportPath));assert.equal(fs.existsSync(path.join(root,'.cache/quickstart/lock')),false);assert.equal(JSON.parse(fs.readFileSync(result.reportPath)).state,'failed');
});
test('rerun executes real checks again and excludes concurrent or interrupted installers',async t=>{
 const root=fixture(t),{runQuickstart}=await api();let count=0;const deps={platform:'win32',arch:'x64',preflight:async()=>{},handlers:{dependencies:async()=>{count++;return {state:'verified'};},command:async()=>({state:'ready',pathState:'skipped'})}};
 assert.equal((await runQuickstart(root,{profile:'cli',noPath:true},deps)).ok,true);assert.equal((await runQuickstart(root,{profile:'cli',noPath:true},deps)).ok,true);assert.equal(count,2);
 fs.mkdirSync(path.join(root,'.cache/quickstart/lock'));await assert.rejects(runQuickstart(root,{profile:'cli'},deps),{code:'QUICKSTART_BUSY'});assert.equal(count,2);
});
test('preflight refuses an active GUI before npm can replace its files',async t=>{
 const root=fixture(t),{runQuickstart}=await api();await assert.rejects(runQuickstart(root,{profile:'desktop'},{platform:'win32',arch:'x64',preflight:async()=>{throw Error('Close REToolkit GUI');},handlers:{dependencies:()=>assert.fail('no npm while GUI running')}}),/Close REToolkit GUI/);assert.equal(fs.existsSync(path.join(root,'.cache')),false);
});
test('runtime reuse is based on fresh verification and matching lock, never a previous success flag',async()=>{
 const {ensureLockedRuntime}=await api();let installs=0,checks=0;const deps={inspect:async()=>({present:true,fingerprint:'same'}),verify:async()=>{checks++;return {ok:true};},install:async()=>{installs++;},expected:'same'};
 assert.equal((await ensureLockedRuntime(deps)).state,'reused');assert.equal(checks,1);assert.equal(installs,0);
 await assert.rejects(ensureLockedRuntime({...deps,verify:async()=>({ok:false})}),{code:'QUICKSTART_RUNTIME_CHANGED'});assert.equal(installs,0);
 await assert.rejects(ensureLockedRuntime({...deps,expected:'another'}),{code:'QUICKSTART_LOCK_MISMATCH'});assert.equal(installs,0);
 const absent={...deps,inspect:async()=>({present:installs===1,fingerprint:installs===1?'same':null}),verify:async()=>({ok:installs===1}),install:async()=>{installs++;}};assert.equal((await ensureLockedRuntime(absent)).state,'installed');assert.equal(installs,1);
});
test('summary limits are explicit and no-path instructions do not claim global registration',async t=>{
 const root=fixture(t),{runQuickstart}=await api();const result=await runQuickstart(root,{profile:'cli',noPath:true},{platform:'win32',arch:'x64',preflight:async()=>{},handlers:{dependencies:async()=>({state:'verified',inventory:'x'.repeat(100000)}),command:async()=>({state:'ready'})}});
 assert.equal(result.ok,true);assert.equal(result.stages[0].summary.truncated,true);assert.ok(Buffer.byteLength(JSON.stringify(result))<16000);assert.match(result.followUp[0],/PATH unchanged/);
});
test('unsupported platform fails before npm or report writes',async t=>{
 const root=fixture(t),{runQuickstart}=await api();await assert.rejects(runQuickstart(root,{profile:'cli'},{platform:'linux',arch:'x64'}),/Windows x64/);assert.equal(fs.existsSync(path.join(root,'.cache')),false);
});
test('retained runtime gates or unfinished journals block dependency changes even when receipts match',async t=>{
 const root=fixture(t),{runQuickstart}=await api(),writer=path.join(root,'.cache/toolchain/writer');fs.mkdirSync(writer,{recursive:true});
 const deps={platform:'win32',arch:'x64',preflight:async()=>{},handlers:{dependencies:()=>assert.fail('do not replace dependencies during uncertain runtime work')}};
 await assert.rejects(runQuickstart(root,{profile:'cli'},deps),{code:'QUICKSTART_RECOVERY_REQUIRED'});assert.equal(fs.existsSync(writer),true);fs.rmdirSync(writer);
 const tx=path.join(root,'.cache/desktop-runtime/transactions/fixture');fs.mkdirSync(tx,{recursive:true});fs.writeFileSync(path.join(tx,'journal.json'),JSON.stringify({state:'recovery-required'}));
 await assert.rejects(runQuickstart(root,{profile:'cli'},deps),{code:'QUICKSTART_RECOVERY_REQUIRED'});assert.equal(fs.existsSync(path.join(root,'.cache/quickstart')),false);
});
test('default CLI handler repairs missing module entry points instead of trusting package versions',async t=>{
 const root=fixture(t),{runQuickstart,runQuickstartProcess}=await api();let installs=0;const pkg={name:'retoolkit',version:'0.2.0',dependencies:{fixture:'1.0.0'}};
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(pkg));fs.writeFileSync(path.join(root,'package-lock.json'),JSON.stringify({name:'retoolkit',lockfileVersion:3}));fs.writeFileSync(path.join(root,'re.js'),"import './node_modules/fixture/index.js'; console.log('0.2.0');");
 const run=async(file,args,options)=>{if(args[0].endsWith('npm-cli.js')){installs++;const folder=path.join(root,'node_modules/fixture');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'package.json'),JSON.stringify({name:'fixture',version:'1.0.0'}));fs.writeFileSync(path.join(folder,'index.js'),'export const fixture=true;');return {code:0,stdout:'',stderr:''};}return runQuickstartProcess(file,args,options);};
 const deps={platform:'win32',arch:'x64',preflight:async()=>{},run};assert.equal((await runQuickstart(root,{profile:'cli',noPath:true},deps)).ok,true);assert.equal(installs,1);
 fs.unlinkSync(path.join(root,'node_modules/fixture/index.js'));assert.equal((await runQuickstart(root,{profile:'cli',noPath:true},deps)).ok,true);assert.equal(installs,2);
});
