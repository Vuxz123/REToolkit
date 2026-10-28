import test from 'node:test';
import assert from 'node:assert/strict';
import {compareDataSnapshots,validateDataSnapshot} from '../src/data/contracts.js';
import {dataSnapshot} from './helpers/scriptable-data.js';
const guid='a'.repeat(32),row=data=>({assetId:'asset:'+data.objects[0].guid,data}),policy={referencePolicy:'persistent-object-reference-v1'};
function snapshot(){const d=dataSnapshot();d.objects[0].properties.push({path:'m_Script',kind:'ObjectReference',type:'PPtr<MonoScript>',value:guid+':11500000'},{path:'m_Script.m_FileID',kind:'Integer',type:'int',value:'2672'},{path:'m_Script.m_PathID',kind:'Integer',type:'long',value:'11500000'});return d;}
test('atomic references ignore only descendants of a real persistent reference parent; legacy stays exact',()=>{
 const a=snapshot(),b=structuredClone(a);b.objects[0].properties.find(p=>p.path==='m_Script.m_FileID').value='2676';assert.equal(compareDataSnapshots([row(a)],[row(b)]).differenceCount,1);const result=compareDataSnapshots([row(a)],[row(b)],policy);assert.equal(result.dataPreserved,true);assert.equal(result.normalization.excludedBefore,2);assert.equal(result.normalization.excludedAfter,2);
});
test('real GUID/local fileID changes and user/orphan m_FileID fields are never hidden',()=>{
 const a=snapshot();for(const value of ['b'.repeat(32)+':11500000',guid+':11500001']){const b=structuredClone(a);b.objects[0].properties.find(p=>p.path==='m_Script').value=value;const r=compareDataSnapshots([row(a)],[row(b)],policy);assert.equal(r.dataPreserved,false);assert.equal(r.counts.references,1);}
 for(const parent of [null,'Generic']){const x=snapshot();x.objects[0].properties=x.objects[0].properties.filter(p=>p.path!=='m_Script'||parent);if(parent)x.objects[0].properties.find(p=>p.path==='m_Script').kind=parent;const y=structuredClone(x);y.objects[0].properties.find(p=>p.path==='m_Script.m_FileID').value='88';assert.equal(compareDataSnapshots([row(x)],[row(y)],policy).dataPreserved,false);}
});
test('v2 collector packets omit reference descendants and compare safely against v1',()=>{
 const a=snapshot(),b=structuredClone(a);b.policy='scriptable-data-v2';b.objects[0].properties=b.objects[0].properties.filter(p=>!p.path.startsWith('m_Script.'));assert.doesNotThrow(()=>validateDataSnapshot(b));assert.equal(compareDataSnapshots([row(a)],[row(b)],policy).dataPreserved,true);b.objects[0].properties.push({path:'m_Script.m_FileID',kind:'Integer',type:'int',value:'1'});assert.throws(()=>validateDataSnapshot(b),/reference|atomic/i);
});
test('atomic policy requires a persistent parent identity and preserves similarly named array/orphan values',()=>{
 const bad=snapshot();bad.objects[0].properties.find(p=>p.path==='m_Script').value='not-a-persistent-reference';assert.throws(()=>compareDataSnapshots([row(bad)],[row(bad)],policy),/identity|reference/i);
 const a=snapshot();a.objects[0].properties.push({path:'refs.Array.data[1]',kind:'ObjectReference',type:'PPtr<Object>',value:guid+':9007199254740993'},{path:'refs.Array.data[1].m_FileID',kind:'Integer',type:'int',value:'1'},{path:'refs.Array.data[10].m_FileID',kind:'Integer',type:'int',value:'1'});const b=structuredClone(a);b.objects[0].properties.find(p=>p.path==='refs.Array.data[1].m_FileID').value='2';assert.equal(compareDataSnapshots([row(a)],[row(b)],policy).dataPreserved,true);b.objects[0].properties.find(p=>p.path==='refs.Array.data[10].m_FileID').value='2';assert.equal(compareDataSnapshots([row(a)],[row(b)],policy).dataPreserved,false);
});
test('normalization cannot upgrade unsupported pointer-child coverage',()=>{const a=snapshot();a.complete=false;a.unsupportedProperties=1;a.objects[0].complete=false;a.objects[0].properties.find(p=>p.path==='m_Script.m_FileID').value=null;const r=compareDataSnapshots([row(a)],[row(a)],policy);assert.equal(r.complete,false);assert.equal(r.dataPreserved,false);});
