import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const api = await import('../src/adb/data-client.js').catch(() => ({}));
const serial = 'emulator-5554', pkg = 'com.example.game';
const external = `/sdcard/Android/data/${pkg}`, privateRoot = `/data/user/0/${pkg}`;
const canonical = `/storage/emulated/0/Android/data/${pkg}`;
const stat = (size = 4, mode = '81a4', time = 1) => `${mode}|${size}|${time}|2|3`;
const listing = (root = canonical, entries = [['save.bin', 4]]) => `RETK_DATA_V1\nROOT|${root}\nR|41ed|4096|1|2|3\n${entries.map(([name,size,mode='81a4',resolved]) => `E|${stat(size,mode)}|${root}/${name}|${resolved ?? `${root}/${name}`}\n`).join('')}END\n`;
const denied = root => Object.assign(new Error('adb failed'), { exitCode: 1, stderr: `stat: '${root}': Permission denied\n` });
const missing = root => Object.assign(new Error('adb failed'), { exitCode: 1, stderr: `stat: '${root}': No such file or directory\n` });
const runAsDenied = () => Object.assign(new Error(`run-as: package not debuggable: ${pkg}`), {exitCode:1});
function fake(responses) {
  const calls=[];
  const run=async (...args) => { calls.push(args); const item=responses.shift(); assert.notEqual(item,undefined,'Unexpected process call'); if(item instanceof Error) throw item; if(typeof item==='function') return item(...args); return typeof item==='string'?{exitCode:0,stdout:item,stderr:''}:item; };
  return {run,calls};
}
function client(fake, runOptions={}) { assert.equal(typeof api.createAdbDataClient,'function','Missing data transport factory'); return api.createAdbDataClient({file:'adb.exe',run:fake.run,runOptions}); }
function temp(t) { const root=fs.mkdtempSync(path.join(os.tmpdir(),'retk-data-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true})); return path.join(root,'save.bin'); }
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fileInfo=(bytes,time=1,root=canonical) => `RETK_FILE_V1\nROOT|${root}\nS|${stat(bytes.length,'81a4',time)}\nH|${hash(bytes)}\nEND\n`;
const chunk = bytes => `RETK_CHUNK_V1\n${bytes.toString('base64')}\nEND\n`;
const code = value => error => error.code === value;

test('pending owned process cleanup remains uncertain and retains its unpublished pull stage',async t=>{
 const pending=()=>Object.assign(new Error('private diagnostics'),{code:'cleanup_pending'});
 await assert.rejects(client(fake([pending()])).inspect(serial,pkg),cause=>cause.code==='cleanup_pending'&&!cause.message.includes('private diagnostics'));
 const bytes=Buffer.from('data'),local=temp(t),f=fake([listing(),missing(privateRoot),missing(`/data/data/${pkg}`),fileInfo(bytes),(_file,args)=>{fs.writeFileSync(args.at(-1),'partial');throw pending();}]);
 const c=client(f);await c.inspect(serial,pkg);
 await assert.rejects(c.pull(serial,pkg,'external','save.bin',local),code('cleanup_pending'));
 assert.equal(fs.existsSync(local),false);const stages=fs.readdirSync(path.dirname(local)).filter(name=>name.startsWith('.retk-data-'));assert.equal(stages.length,1);assert.equal(fs.readFileSync(path.join(path.dirname(local),stages[0],'part'),'utf8'),'partial');
});

test('inspect permits root aliases and retains available and genuinely absent scopes',async()=>{
  const f=fake([listing(),missing(privateRoot),missing(`/data/data/${pkg}`)]), options={leaseDirectory:'lease',toolchainRoot:'tools'};
  const result=await client(f,options).inspect(serial,pkg);
  assert.deepEqual(result,{scopes:[{id:'external',root:external,access:'shell',state:'available',files:[{relative:'save.bin',size:4}]},{id:'private',root:`/data/data/${pkg}`,access:'none',state:'absent',files:[]}]});
  assert.ok(f.calls.every(call=>call[2]===options));
  assert.ok(f.calls.every(call=>call[1][0]==='-s' && call[1][1]===serial && call[1][2]==='shell' && call[1].length===4));
});

test('private permission falls back to run-as without trying alias on denied',async()=>{
  const f=fake([listing(),denied(privateRoot),listing(privateRoot)]);
  const result=await client(f).inspect(serial,pkg);
  assert.equal(result.scopes[1].access,'run-as');
  assert.match(f.calls[2][1][3],/^run-as com\.example\.game sh -c /);
  assert.ok(!f.calls.some(call=>call[1].join(' ').includes(`/data/data/${pkg}`)));
});

test('existing su is bounded and only used after shell and run-as deny',async()=>{
  const f=fake([listing(),denied(privateRoot),runAsDenied(),'RETK_TIMEOUT_OK\n',listing(privateRoot)]);
  const result=await client(f).inspect(serial,pkg);
  assert.equal(result.scopes[1].access,'su');
  assert.match(f.calls[4][1][3],/^timeout 10 su -c /);
});

test('missing su or missing Android timeout reports explicitly denied',async()=>{
  for(const response of ['RETK_SU_MISSING\n','RETK_TIMEOUT_MISSING\n']) {
    const f=fake([listing(),denied(privateRoot),runAsDenied(),response]);
    const result=await client(f).inspect(serial,pkg);
    assert.deepEqual(result.scopes[1],{id:'private',root:privateRoot,access:'none',state:'denied',files:[]});
    assert.equal(f.calls.length,4);
  }
});

test('disconnect, cancellation and unknown failures never become denied or absent',async()=>{
  for(const error of [new Error('device offline'), Object.assign(new Error('cancelled'),{code:'ERR_PROCESS_CANCELLED'}),new Error('I/O error'),Object.assign(new Error('stat: bad'),{stderr:'unrecognized error',exitCode:1})]) {
    const f=fake([error]); await assert.rejects(client(f).inspect(serial,pkg),code('ADB_DATA_PROCESS_FAILED')); assert.equal(f.calls.length,1);
  }
});

test('metadata rejects traversal, links, special files, escaping canonical paths and truncation',async()=>{
  for(const output of [listing(canonical,[['../bad',4]]),listing(canonical,[['bad name',4]]),listing(canonical,[['save.bin',4,'a1ff']]),listing(canonical,[['save.bin',4,'11a4']]),listing(canonical,[['save.bin',4,'81a4','/outside/save.bin']]),listing().slice(0,-4),'x'.repeat(1024*1024),listing(canonical,[['a|b',4]])]) {
    await assert.rejects(client(fake([output])).inspect(serial,pkg),error=>/^ADB_DATA_/.test(error.code));
  }
});

test('metadata enforces file, count and aggregate limits',async()=>{
  for(const entries of [[['big',8*1024**3+1]],Array.from({length:1025},(_,i)=>[`file${i}`,1]),Array.from({length:5},(_,i)=>[`file${i}`,8*1024**3])]) {
    await assert.rejects(client(fake([listing(canonical,entries)])).inspect(serial,pkg),code('ADB_DATA_LIMIT'));
  }
});

test('all caller identities and output logging are rejected before process use',async()=>{
  const f=fake([]), c=client(f);
  for(const [s,p] of [['a;id',pkg],[serial,'com.a;id']]) await assert.rejects(c.inspect(s,p));
  for(const options of [{logFile:'secret.log'},{inherit:true},{forwardOutput:true}]) assert.throws(()=>client(f,options),code('ADB_DATA_LOGGING_UNSAFE'));
  assert.equal(f.calls.length,0);
});

test('shell pull uses native adb pull and verifies binary bytes and remote metadata',async t=>{
  const bytes=Buffer.from([0,255,13,10]), local=temp(t);
  const f=fake([listing(),missing(privateRoot),missing(`/data/data/${pkg}`),fileInfo(bytes),(_exe,args)=>{assert.equal(args[2],'pull');fs.writeFileSync(args[4],bytes);return {exitCode:0,stdout:'1 file pulled\n',stderr:''};},fileInfo(bytes)]);
  const c=client(f), {scopes}=await c.inspect(serial,pkg);
  await c.pull(serial,pkg,scopes[0],scopes[0].files[0],local);
  assert.deepEqual(fs.readFileSync(local),bytes);
});

test('run-as transfers bounded base64 chunks preserving binary NULs',async t=>{
  const bytes=Buffer.alloc(393216+8,255); bytes[0]=0; bytes[393217]=0;
  const local=temp(t), f=fake([listing(canonical,[]),denied(privateRoot),listing(privateRoot,[['save.bin',bytes.length]]),fileInfo(bytes,1,privateRoot),chunk(bytes.subarray(0,393216)),chunk(bytes.subarray(393216)),fileInfo(bytes,1,privateRoot)]);
  const c=client(f);await c.inspect(serial,pkg);await c.pull(serial,pkg,'private','save.bin',local);
  assert.deepEqual(fs.readFileSync(local),bytes);
  assert.ok(f.calls.filter(call=>call[1][3]?.includes('RETK_CHUNK_V1')).every(call=>call[1][3].includes('bs=393216')));
});

test('truncated or malformed base64 is rejected and no destination is published',async t=>{
  for(const bad of ['RETK_CHUNK_V1\nAA==\n','RETK_CHUNK_V1\nAB==\nEND\n','RETK_CHUNK_V1\n%%%%\nEND\n',chunk(Buffer.from([0]))]) {
    const local=temp(t),bytes=Buffer.from([0,1,2,3]),f=fake([listing(canonical,[]),denied(privateRoot),listing(privateRoot),fileInfo(bytes,1,privateRoot),bad]);
    const c=client(f);await c.inspect(serial,pkg);await assert.rejects(c.pull(serial,pkg,'private','save.bin',local));assert.ok(!fs.existsSync(local));
  }
});

test('remote races or mismatched bytes fail without publishing a partial destination',async t=>{
  for(const changed of ['remote','local']) {
    const local=temp(t),bytes=Buffer.from([0,1,2,3]);
    const f=fake([listing(),missing(privateRoot),missing(`/data/data/${pkg}`),fileInfo(bytes),(_exe,args)=>{fs.writeFileSync(args[4],changed==='local'?Buffer.alloc(4):bytes);return {exitCode:0,stdout:'',stderr:''};},fileInfo(bytes,changed==='remote'?2:1)]);
    const c=client(f);await c.inspect(serial,pkg);await assert.rejects(c.pull(serial,pkg,'external','save.bin',local),code('ADB_DATA_CHANGED'));assert.ok(!fs.existsSync(local));
  }
});

test('pull cannot use invented scope, unsafe filename or changed canonical root',async t=>{
  const bytes=Buffer.from([0,1,2,3]),f=fake([listing(),missing(privateRoot),missing(`/data/data/${pkg}`),fileInfo(bytes,1,'/elsewhere')]);
  const c=client(f);await c.inspect(serial,pkg);
  await assert.rejects(c.pull(serial,pkg,'private','save.bin',temp(t)));
  await assert.rejects(c.pull(serial,pkg,'external','../save.bin',temp(t)));
  await assert.rejects(c.pull(serial,pkg,'external','save.bin',temp(t)),code('ADB_DATA_CHANGED'));
});

test('generated listing bounds the completion marker and rejects root directory links',async()=>{
  const f=fake([listing(),missing(privateRoot),missing(`/data/data/${pkg}`)]);
  await client(f).inspect(serial,pkg);
  const script=f.calls[0][1][3];
  assert.ok(script.indexOf('END') < script.indexOf('head -c 900000'), 'completion marker must be inside the bounded producer');
  assert.match(script,/test ! -L/);
  assert.match(script,/RETK_READ_FAILED/);
});

test('mutable process options cannot enable private data output logging later',async()=>{
  const f=fake([]),options={},c=client(f,options);options.logFile='secret.log';
  await assert.rejects(c.inspect(serial,pkg),code('ADB_DATA_LOGGING_UNSAFE'));
  assert.equal(f.calls.length,0);
});

test('explicit child permission errors retry under run-as without accepting partial listings',async()=>{
  const cause=Object.assign(new Error('adb failed'),{exitCode:1,stdout:`RETK_DATA_V1\nROOT|${canonical}\nR|41ed|4096|1|2|3\n`,stderr:`find: '${canonical}/files': Permission denied\n`});
  const f=fake([cause,listing(),missing(privateRoot),missing(`/data/data/${pkg}`)]);
  const result=await client(f).inspect(serial,pkg);
  assert.equal(result.scopes[0].access,'run-as');
});

test('ordinary directory entries and empty files are supported',async t=>{
  const bytes=Buffer.alloc(0),f=fake([listing(canonical,[['files',4096,'41ed'],['files/empty',0]]),missing(privateRoot),missing(`/data/data/${pkg}`),fileInfo(bytes),(_exe,args)=>{fs.writeFileSync(args[4],bytes);return {exitCode:0,stdout:'',stderr:''};},fileInfo(bytes)]);
  const c=client(f),result=await c.inspect(serial,pkg);
  assert.deepEqual(result.scopes[0].files,[{relative:'files/empty',size:0}]);
  const local=temp(t);await c.pull(serial,pkg,'external','files/empty',local);assert.equal(fs.statSync(local).size,0);
});

test('message-only runner diagnostics recognize only exact permission and absence failures',async()=>{
  const f=fake([listing(),new Error(`adb.exe failed (1)\nstat: '${privateRoot}': Permission denied\n`),listing(privateRoot)]);
  assert.equal((await client(f).inspect(serial,pkg)).scopes[1].access,'run-as');
  const bad=fake([new Error(`adb.exe failed (1)\nstat: '${external}': No such file or directory\nerror: device offline\n`)]);
  await assert.rejects(client(bad).inspect(serial,pkg),code('ADB_DATA_PROCESS_FAILED'));
});

test('bounded su timeouts never become absent or permission success',async()=>{
  const f=fake([listing(),denied(privateRoot),runAsDenied(),'RETK_TIMEOUT_OK\n',Object.assign(new Error('adb failed'),{exitCode:124})]);
  await assert.rejects(client(f).inspect(serial,pkg),code('ADB_DATA_PROCESS_FAILED'));
});

test('hash output cannot leak from errors when a file command fails',async t=>{
  const f=fake([listing(),missing(privateRoot),missing(`/data/data/${pkg}`),new Error('PRIVATE_SECRET_FILE_BYTES')]);
  const c=client(f);await c.inspect(serial,pkg);
  await assert.rejects(c.pull(serial,pkg,'external','save.bin',temp(t)),error=>error.code==='ADB_DATA_PROCESS_FAILED' && !JSON.stringify(error).includes('PRIVATE_SECRET') && !String(error).includes('PRIVATE_SECRET') && error.cause===undefined);
});

test('known Android run-as policy denials allow existing su fallback',async()=>{
  for(const message of [`run-as: Package '${pkg}' is not debuggable`,'run-as: run-as is disabled from the kernel commandline']) {
    const f=fake([listing(),denied(privateRoot),new Error(message),'RETK_SU_MISSING\n']);
    assert.equal((await client(f).inspect(serial,pkg)).scopes[1].state,'denied');
  }
});
