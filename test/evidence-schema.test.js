import test from 'node:test';
import assert from 'node:assert/strict';

const api=()=>import('../src/evidence-schema.js');
const uuid='11111111-1111-4111-8111-111111111111';
function evidence(method='functions.decompile') {
  const params=method==='functions.decompile'?{selector:'Name',limit:2}:method==='references.list'?{address:'ram:0xffffffffffffffff',direction:'to',limit:2}:{query:'Name',limit:2};
  const items=method==='functions.decompile'?[{line:1,text:'void Name() {}'}]:method==='references.list'?[{from:'ram:0x1000',to:'ram:0xffffffffffffffff',type:'UNCONDITIONAL_CALL'}]:[{address:'ram:0xffffffffffffffff',name:'Name',qualifiedName:'Namespace::Name',signature:'void Name(void)',bodySize:1,comments:{eol:null,pre:null,post:null,plate:'observed',repeatable:null}}];
  return {kind:'retoolkit-evidence',schemaVersion:1,query:{method,params},build:{native:{sha256:'a'.repeat(64),size:100,abi:'unknown'},metadata:{sha256:'b'.repeat(64),size:100}},programIdentity:{program:'libil2cpp.so',projectName:'Game',sha256:'a'.repeat(64),imageBase:'ram:0x1000',programPath:'/libil2cpp.so',language:'AARCH64:LE:64:v8A',compiler:'default',addressSpace:'ram',ghidraVersion:'12.0',analysisStatus:'unknown'},runId:uuid,revision:4,collectedAt:'2026-10-19T00:00:00.000Z',result:{items,nextCursor:null,...(method==='functions.decompile'?{address:'ram:0xffffffffffffffff'}:{})},coverage:{state:'observed',source:'loaded-program',explanation:'Only this query was observed'},limitations:['synthetic fixture'],dataTrust:'untrusted-target-content'};
}
function cursor(value,offset=2) {const {cursor,limit,...binding}=value.query.params;return Buffer.from(JSON.stringify({runId:value.runId,method:value.query.method,revision:value.revision,offset,binding})).toString('base64url');}

test('evidence schema accepts exact provider page shapes and preserves values',async()=>{
  const {validateEvidence}=await api();for(const [method,classification] of [['functions.decompile','pseudocode'],['references.list','references'],['functions.list','observations']]) {
    const value=evidence(method),before=structuredClone(value);assert.equal(validateEvidence(value),classification);assert.deepEqual(value,before);
    value.result.nextCursor=cursor(value);value.coverage.state='partial';assert.equal(validateEvidence(value),classification);
  }
});

test('evidence rejects unknown keys and invalid query/identity/coverage/trust envelopes',async()=>{
  const {validateEvidence}=await api();const cases=[
    v=>v.token='private',v=>v.query.token='private',v=>v.query.params.token='private',v=>v.query.params.config={token:'private'},
    v=>v.build.native.path='C:/private/input',v=>v.build.metadata.config={},v=>v.programIdentity.token='private',v=>v.programIdentity.analysisStatus='complete',
    v=>v.coverage.state='complete',v=>v.coverage.token='private',v=>v.coverage.source='whole-program',v=>v.coverage.state='partial',v=>v.coverage.explanation=7,
    v=>v.dataTrust='trusted',v=>v.runId='aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaaaaa',v=>v.revision=0.5,v=>v.collectedAt='yesterday',
    v=>v.query.params.limit=0,v=>v.query.params.limit=1001,v=>v.query.params.selector='',v=>v.query.params.direction='from',
    v=>v.build.native.abi='imaginary',v=>v.build.native.sha256='A'.repeat(64),v=>v.build.metadata.size=-1,v=>v.programIdentity.imageBase=4096,
    v=>v.programIdentity.sha256='c'.repeat(64),v=>v.limitations=[{token:'private'}],v=>v.query.method='functions.rename'
  ];
  for(const mutate of cases){const value=evidence();mutate(value);assert.throws(()=>validateEvidence(value),/evidence/i);}
});

test('evidence rejects result properties or types absent from actual Java pages',async()=>{
  const {validateEvidence}=await api();const cases=[
    v=>v.result.config={token:'private'},v=>v.result.items[0].token='private',v=>v.result.items[0].line=1.5,v=>v.result.items[0].text={token:'private'},
    v=>v.result.address=9007199254740992,v=>v.result.nextCursor='cursor',v=>v.result.items=[{address:'ram:0x1000',text:'fake decompile'}],v=>v.result.items=[...v.result.items,...v.result.items,...v.result.items],
  ];for(const mutate of cases){const value=evidence();mutate(value);assert.throws(()=>validateEvidence(value),/evidence/i);}
  const functions=evidence('functions.list');functions.result.items[0].comments.env={token:'private'};assert.throws(()=>validateEvidence(functions),/evidence/i);
  const refs=evidence('references.list');refs.result.items[0].from=4096;assert.throws(()=>validateEvidence(refs),/evidence/i);
});

test('evidence validates optional cursor binding and current expected project/build',async()=>{
  const {validateEvidence}=await api();const value=evidence();value.result.nextCursor=cursor(value);value.coverage.state='partial';
  assert.equal(validateEvidence(value,{build:value.build,program:'libil2cpp.so',projectName:'Game'}),'pseudocode');
  assert.throws(()=>validateEvidence(value,{build:{...value.build,metadata:{sha256:'c'.repeat(64),size:100}},program:'libil2cpp.so',projectName:'Game'}),/binding|match/i);
  assert.throws(()=>validateEvidence(value,{build:value.build,program:'Wrong',projectName:'Game'}),/binding|match/i);
  const bad=JSON.parse(Buffer.from(value.result.nextCursor,'base64url'));bad.token='private';value.result.nextCursor=Buffer.from(JSON.stringify(bad)).toString('base64url');assert.throws(()=>validateEvidence(value),/evidence/i);
});
