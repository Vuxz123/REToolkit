import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDataSnapshot,compareDataSnapshots,canonicalData,valuePreview} from '../src/data/contracts.js';

import {dataSnapshot} from './helpers/scriptable-data.js';

const row=data=>({assetId:'asset:'+'b'.repeat(32),path:'Assets/Level.asset',data});
test('ScriptableObject data captures exact nested arrays, types and large reference identities',()=>{
 const a=dataSnapshot();assert.equal(validateDataSnapshot(a,'asset:'+'b'.repeat(32)),a);assert.equal(compareDataSnapshots([row(a)],[row(structuredClone(a))]).dataPreserved,true);
 const shuffled=structuredClone(a);shuffled.objects[0].properties.reverse();assert.deepEqual(canonicalData(a),canonicalData(shuffled));
});
test('schema, list order/size and reference changes are counted without numeric coercion',()=>{
 const a=dataSnapshot(),b=structuredClone(a);b.objects[0].properties[1].value='1';b.objects[0].properties[2].value='9';b.objects[0].properties[3].type='long';b.objects[0].properties[4].value='cccccccccccccccccccccccccccccccc:9007199254740994';
 const result=compareDataSnapshots([row(a)],[row(b)]);assert.equal(result.dataPreserved,false);assert.equal(result.differenceCount,4);assert(result.differences.some(d=>d.kind==='property_type_changed'));assert.equal(result.counts.references,1);
});
test('hidden object identity and compiled type changes cannot pass data verification',()=>{
 const a=dataSnapshot(),b=structuredClone(a);b.objects.push({...structuredClone(b.objects[0]),fileID:'2',properties:[]});b.objects[0].fullName='Game.Other';
 const result=compareDataSnapshots([row(a)],[row(b)]);assert.equal(result.differenceCount,2);assert.equal(result.dataPreserved,false);
});
test('incomplete or unsupported observations never establish preserved data',()=>{
 const a=dataSnapshot();a.complete=false;a.objects[0].complete=false;a.objects[0].properties.push({path:'curve',kind:'AnimationCurve',type:'AnimationCurve',value:null});a.unsupportedProperties=1;
 assert.doesNotThrow(()=>validateDataSnapshot(a,'asset:'+'b'.repeat(32)));assert.equal(compareDataSnapshots([row(a)],[row(a)]).dataPreserved,false);
 for(const mutate of [s=>s.complete=true,s=>s.unsupportedProperties=0,s=>s.objects[0].properties[0].value=2,s=>s.objects.push(s.objects[0]),s=>s.objects[0].guid='c'.repeat(32),s=>s.objects[0].fileID=9007199254740993,s=>s.objects[0].properties.push(s.objects[0].properties[0])]){const bad=structuredClone(a);mutate(bad);assert.throws(()=>validateDataSnapshot(bad,'asset:'+'b'.repeat(32)));}
});
test('bounded diff previews retain exact total beyond the returned sample',()=>{
 const a=dataSnapshot(),b=structuredClone(a);a.objects[0].properties=[];b.objects[0].properties=Array.from({length:1100},(_,i)=>({path:'data.Array.data['+i+']',kind:'String',type:'string',value:'x'.repeat(100)}));
 const result=compareDataSnapshots([row(a)],[row(b)]);assert.equal(result.differenceCount,1100);assert.equal(result.differences.length,1000);assert.equal(result.differencesTruncated,true);
});
test('float comparisons preserve IEEE bits while previews retain readable signed zero',()=>{
 const a=dataSnapshot(),b=structuredClone(a);a.objects[0].properties.push({path:'mass',kind:'Float',type:'float',value:'f32:80000000'});b.objects[0].properties.push({path:'mass',kind:'Float',type:'float',value:'f32:00000000'});
 assert.equal(compareDataSnapshots([row(a)],[row(b)]).dataPreserved,false);assert.equal(valuePreview('f32:80000000','Float').display,'-0');assert.equal(valuePreview('f32:3f800000','Float').display,'1');assert.equal(valuePreview('f32:80000000','String').display,undefined);
});
test('removed references and enum/managed type definitions remain schema differences',()=>{
 const a=dataSnapshot(),b=structuredClone(a);b.objects[0].properties.pop();assert.equal(compareDataSnapshots([row(a)],[row(b)]).counts.references,1);
 a.objects[0].properties.push({path:'mode',kind:'Enum',type:'Mode',value:'0:One\u001fTwo'});b.objects[0].properties=structuredClone(a.objects[0].properties);b.objects[0].properties.at(-1).value='0:Different\u001fTwo';assert.equal(compareDataSnapshots([row(a)],[row(b)]).counts.schema,1);
});
