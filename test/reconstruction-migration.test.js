import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './reconstruction-fixture.js';
import {indexUnityProject} from '../src/assets/graph.js';
import {fingerprint} from '../src/state.js';
const api=async()=>{try{return await import('../src/reconstruction/migration.js');}catch(e){assert.fail(`Migration implementation unavailable: ${e.message}`);}};
const a='a'.repeat(32),b='b'.repeat(32);
async function setup(t){
 const f=await fixture(t,true);
 await fs.writeFile(path.join(f.projectDir,'Assets/Other.cs'),'namespace Game { public class Other : UnityEngine.MonoBehaviour { public int score; public UnityEngine.Object friend; } }');
 f.original='%YAML 1.1\r\n%TAG !u! tag:unity3d.com,2011:\r\n--- !u!114 &9007199254740993\r\nMonoBehaviour:\r\n  m_Script: {fileID: 9223372036854775806, guid: '+a+', type: 3} # untouched\r\n  health: 42 # exact comment\r\n  friend: {fileID: 9007199254740997}\r\n  unknown: "Unicode 雪"\r\n';
 await fs.writeFile(path.join(f.projectDir,'Assets/Main.unity'),f.original);
 await fs.writeFile(path.join(f.projectDir,'Assets/Main.unity.meta'),'fileFormatVersion: 2\nguid: '+ 'c'.repeat(32)+'\n');
 f.graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding});
 f.componentId=f.graph.nodes[0].id;
 const identity=(guid,fileID,fullName)=>({assembly:'Assembly-CSharp',fullName,guid,fileID});
 f.from=identity(a,'9223372036854775806','Game.Player');f.to=identity(b,'12345678901234567','Game.Other');
 f.observations={kind:'retoolkit-migration-observation',schemaVersion:1,graphRevision:f.graph.revision,inventorySha256:fingerprint(f.graph.files),unityVersion:f.graph.unityVersion,complete:true,compilation:{state:'succeeded'},scripts:[{...f.from,path:'Assets/Player.cs',fields:[{name:'health',type:'System.Int32',propertyType:'Integer'}]},{...f.to,path:'Assets/Other.cs',fields:[{name:'score',type:'System.Int32',propertyType:'Integer'},{name:'friend',type:'UnityEngine.Object',propertyType:'ObjectReference'}]}],components:[{componentId:f.componentId,fields:[{name:'health',type:'System.Int32',propertyType:'Integer',valueJson:'42'}]}]};
 f.request={kind:'retoolkit-migration-request',schemaVersion:1,graphRevision:f.graph.revision,rebindings:[{componentId:f.componentId,from:f.from,to:f.to}],fieldRenames:[{componentId:f.componentId,from:'health',to:'score',type:'System.Int32',expectedValue:42}]};f.runDir=path.join(f.root,'migration');return f;
}
test('explicit observed identities and field keys apply only in an atomically published fresh copy',async t=>{
 const f=await setup(t),m=await api(),plan=await m.createMigrationPlan(f);
 assert.equal(plan.observationsSha256,fingerprint(f.observations));
 const receipt=await m.applyMigrationPlan({...f,plan,onEvent:async e=>{if(e.phase==='staged')await assert.rejects(fs.stat(path.join(f.runDir,'project')),e=>e.code==='ENOENT');}});
 assert.equal(await fs.readFile(path.join(f.projectDir,'Assets/Main.unity'),'utf8'),f.original);
 const expected=f.original.replace('9223372036854775806','12345678901234567').replace(a,b).replace('  health:','  score:');
 assert.equal(await fs.readFile(path.join(f.runDir,'project/Assets/Main.unity'),'utf8'),expected);
 assert.equal(await fs.readFile(path.join(f.runDir,'project/Assets/Player.cs.meta'),'utf8'),f.files['Assets/Player.cs.meta']);
 const verified=await m.verifyMigration({projectDir:path.join(f.runDir,'project'),receipt});assert.equal(verified.valid,true);assert.equal(verified.bindingsVerified,false);assert.equal(verified.migratedValuesVerified,false);
 assert.deepEqual(await m.applyMigrationPlan({...f,plan}),receipt);
 await fs.appendFile(path.join(f.runDir,'project/Assets/Main.unity'),'# changed');assert.equal((await m.verifyMigration({projectDir:path.join(f.runDir,'project'),receipt})).valid,false);
});
test('missing, ambiguous and invented target identities fail closed',async t=>{
 const f=await setup(t),m=await api();
 for(const mutate of [o=>o.scripts.pop(),o=>o.scripts.push(structuredClone(o.scripts[1])),o=>o.scripts[1].fileID='11500000',o=>o.inventorySha256='0'.repeat(64),o=>o.complete=false]){
  const observations=structuredClone(f.observations);mutate(observations);await assert.rejects(m.createMigrationPlan({...f,observations}),/identity|observation|ambiguous|inventory/i);
 }
});
test('rename assertions, collisions, managed references, type conversions and binary targets are blocked',async t=>{
 const f=await setup(t),m=await api();
 for(const mutate of [r=>r.fieldRenames[0].expectedValue=99,r=>r.fieldRenames[0].to='friend',r=>r.fieldRenames[0].type='System.Single',r=>r.fieldRenames[0].from='m_Script',r=>r.removeAssemblies=['Assets/Stub.dll']]){
  const request=structuredClone(f.request);mutate(request);await assert.rejects(m.createMigrationPlan({...f,request}),/assert|collision|type|field|coverage|unsupported/i);
 }
 const observations=structuredClone(f.observations);observations.scripts[0].fields[0].propertyType='ManagedReference';await assert.rejects(m.createMigrationPlan({...f,observations}),/unsupported|type/i);
});
test('stale plans, observation changes and forged patch bytes cannot authorize writes',async t=>{
 const f=await setup(t),m=await api(),plan=await m.createMigrationPlan(f);
 const forged=structuredClone(plan);forged.changes[0].after='arbitrary';const {payloadSha256,...rest}=forged;forged.payloadSha256=fingerprint(rest);
 await assert.rejects(m.applyMigrationPlan({...f,plan:forged}),/plan|hash|patch/i);
 const observations=structuredClone(f.observations);observations.scripts[1].fileID='10';await assert.rejects(m.applyMigrationPlan({...f,observations,plan}),/observation|identity/i);
 await fs.appendFile(path.join(f.projectDir,'Assets/Main.unity'),'# edit');await assert.rejects(m.applyMigrationPlan({...f,plan}),/stale|changed/i);
 await assert.rejects(fs.stat(f.runDir),e=>e.code==='ENOENT');
});
test('failure before publication preserves source and exact backups and does not publish a partial project',async t=>{
 const f=await setup(t),m=await api(),plan=await m.createMigrationPlan(f);
 await assert.rejects(m.applyMigrationPlan({...f,plan,onEvent:async e=>{if(e.phase==='staged')throw Error('injected failure');}}),/injected/);
 assert.equal(await fs.readFile(path.join(f.projectDir,'Assets/Main.unity'),'utf8'),f.original);
 assert.equal(await fs.readFile(path.join(f.runDir,'backups/Assets/Main.unity'),'utf8'),f.original);
 await assert.rejects(fs.stat(path.join(f.runDir,'project')),e=>e.code==='ENOENT');
 assert.equal(JSON.parse(await fs.readFile(path.join(f.runDir,'journal.json'),'utf8')).state,'rolled-back');
});
test('staging and source races block publication and occupied or overlapping run roots are refused',async t=>{
 const m=await api();
 for(const race of ['stage','source','added']){const f=await setup(t),plan=await m.createMigrationPlan(f);await assert.rejects(m.applyMigrationPlan({...f,plan,onEvent:async e=>{if(e.phase!=='staged')return;if(race==='stage')await fs.appendFile(path.join(f.runDir,'.project.stage/Assets/Main.unity'),'# tamper');if(race==='source')await fs.appendFile(path.join(f.projectDir,'Assets/Player.cs.meta'),'# edit');if(race==='added')await fs.writeFile(path.join(f.runDir,'.project.stage/Assets/extra.asset'),'extra');}}),/stale|changed/i);await assert.rejects(fs.stat(path.join(f.runDir,'project')),e=>e.code==='ENOENT');}
 const f=await setup(t),plan=await m.createMigrationPlan(f);await assert.rejects(m.applyMigrationPlan({...f,plan,runDir:path.join(f.projectDir,'migration')}),/overlap/i);await fs.mkdir(f.runDir);await assert.rejects(m.applyMigrationPlan({...f,plan}),/fresh|exist/i);
});
test('retained DLL identities may explicitly rebind to a distinct observed C# type without inventing a DLL conversion',async t=>{
 const f=await setup(t),m=await api();await fs.rename(path.join(f.projectDir,'Assets/Player.cs'),path.join(f.projectDir,'Assets/Stub.dll'));await fs.rename(path.join(f.projectDir,'Assets/Player.cs.meta'),path.join(f.projectDir,'Assets/Stub.dll.meta'));
 f.graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding});f.from.assembly='Stub';f.observations.scripts[0].path='Assets/Stub.dll';f.observations.scripts[0].assembly='Stub';f.observations.graphRevision=f.request.graphRevision=f.graph.revision;f.observations.inventorySha256=fingerprint(f.graph.files);
 const plan=await m.createMigrationPlan(f),receipt=await m.applyMigrationPlan({...f,plan});assert.equal((await fs.readFile(path.join(f.runDir,'project/Assets/Stub.dll'))).length>0,true);assert.equal(receipt.compileReady,false);
 f.to.fullName=f.observations.scripts[1].fullName=f.from.fullName;f.graph.assets.find(a=>a.guid===b).script.types[0].fullName=f.from.fullName;await assert.rejects(m.createMigrationPlan(f),/duplicate|ambiguous/i);
});
test('two fields cannot collide on the same new key even when their original assertions match',async t=>{
 const f=await setup(t),m=await api();await fs.appendFile(path.join(f.projectDir,'Assets/Main.unity'),'  health2: 42\r\n');f.graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding});f.observations.graphRevision=f.request.graphRevision=f.graph.revision;f.observations.inventorySha256=fingerprint(f.graph.files);
 f.request.fieldRenames.push({...f.request.fieldRenames[0],from:'health2'});f.observations.scripts[0].fields.push({...f.observations.scripts[0].fields[0],name:'health2'});f.observations.components[0].fields.push({...f.observations.components[0].fields[0],name:'health2'});
 await assert.rejects(m.createMigrationPlan(f),/collision/i);
});
test('post-migration Editor evidence verifies exact bindings and serialized values independently from bytes',async t=>{
 const f=await setup(t),m=await api(),plan=await m.createMigrationPlan(f),receipt=await m.applyMigrationPlan({...f,plan});const graph=await indexUnityProject(path.join(f.runDir,'project'),{binding:f.graph.binding});
 const observations={...f.observations,graphRevision:graph.revision,inventorySha256:fingerprint(graph.files),components:[{componentId:f.componentId,script:f.to,fields:[{name:'score',type:'System.Int32',propertyType:'Integer',valueJson:'42'}]}]};
 const result=await m.verifyMigration({projectDir:path.join(f.runDir,'project'),receipt,observations});assert.equal(result.valid,true);assert.equal(result.compileReady,true);assert.equal(result.bindingsVerified,true);assert.equal(result.migratedValuesVerified,true);
 observations.components.push(structuredClone(observations.components[0]));assert.equal((await m.verifyMigration({projectDir:path.join(f.runDir,'project'),receipt,observations})).migratedValuesVerified,false);observations.components.pop();
 observations.components[0].fields[0].valueJson='43';const changed=await m.verifyMigration({projectDir:path.join(f.runDir,'project'),receipt,observations});assert.equal(changed.bindingsVerified,true);assert.equal(changed.migratedValuesVerified,false);
});
test('value assertions are checked against source YAML tokens even if graph metadata is forged',async t=>{
 const f=await setup(t),m=await api();f.graph.nodes[0].fields.health=99;f.request.fieldRenames[0].expectedValue=99;f.observations.components[0].fields[0].valueJson='99';await assert.rejects(m.createMigrationPlan(f),/assertion|source YAML/i);
});
test('retained complex and managed-reference fields block rebinding rather than promising value preservation',async t=>{
 const f=await setup(t),m=await api();f.observations.scripts[0].fields.push({name:'settings',type:'Owned.Settings',propertyType:'Generic'});f.observations.scripts[1].fields.push({name:'settings',type:'Owned.Settings',propertyType:'Generic'});await assert.rejects(m.createMigrationPlan(f),/unsupported|complex/i);
});
test('object-reference field renames retain exact local 64-bit tokens and UTF-8 BOM',async t=>{
 const f=await setup(t),m=await api();f.original='\ufeff'+f.original;await fs.writeFile(path.join(f.projectDir,'Assets/Main.unity'),f.original);await fs.writeFile(path.join(f.projectDir,'Assets/Other.cs'),'namespace Game { public class Other : UnityEngine.MonoBehaviour { public int score; public UnityEngine.Object buddy; } }');f.graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding});f.observations.graphRevision=f.request.graphRevision=f.graph.revision;f.observations.inventorySha256=fingerprint(f.graph.files);
 f.request.fieldRenames.push({componentId:f.componentId,from:'friend',to:'buddy',type:'UnityEngine.Object',expectedValue:{fileID:'9007199254740997'}});f.observations.scripts[0].fields.push({name:'friend',type:'UnityEngine.Object',propertyType:'ObjectReference'});f.observations.scripts[1].fields[1].name='buddy';f.observations.components[0].fields.push({name:'friend',type:'UnityEngine.Object',propertyType:'ObjectReference',valueJson:'{"fileID":"9007199254740997"}'});
 const plan=await m.createMigrationPlan(f);await m.applyMigrationPlan({...f,plan});const bytes=await fs.readFile(path.join(f.runDir,'project/Assets/Main.unity'));assert.deepEqual([...bytes.subarray(0,3)],[239,187,191]);assert.equal(bytes.toString('utf8'),f.original.replace('9223372036854775806','12345678901234567').replace(a,b).replace('  health:','  score:').replace('  friend:','  buddy:'));
});
test('post-publication failure rolls the exact project back and external interference retains recovery evidence',async t=>{
 const m=await api();for(const external of [false,true]){const f=await setup(t),plan=await m.createMigrationPlan(f);await assert.rejects(m.applyMigrationPlan({...f,plan,onEvent:async e=>{if(e.phase!=='before-receipt')return;if(external)await fs.appendFile(path.join(f.runDir,'project/Assets/Main.unity'),'# external');throw Error('late failure');}}),e=>external?e.code==='migration_recovery_required':/late failure/.test(e.message));assert.equal(await fs.readFile(path.join(f.projectDir,'Assets/Main.unity'),'utf8'),f.original);const journal=JSON.parse(await fs.readFile(path.join(f.runDir,'journal.json'),'utf8'));assert.equal(journal.state,external?'recovery-required':'rolled-back');if(external)assert.match(await fs.readFile(path.join(f.runDir,'project/Assets/Main.unity'),'utf8'),/# external$/);else await assert.rejects(fs.stat(path.join(f.runDir,'project')),e=>e.code==='ENOENT');}
});
test('runtime components cannot bind to Editor-only source types',async t=>{
 const f=await setup(t),m=await api();await fs.mkdir(path.join(f.projectDir,'Assets/Editor'));for(const suffix of ['', '.meta'])await fs.rename(path.join(f.projectDir,'Assets/Other.cs'+suffix),path.join(f.projectDir,'Assets/Editor/Other.cs'+suffix));f.graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding});f.observations.graphRevision=f.request.graphRevision=f.graph.revision;f.observations.inventorySha256=fingerprint(f.graph.files);f.to.assembly=f.observations.scripts[1].assembly='Assembly-CSharp-Editor';f.observations.scripts[1].path='Assets/Editor/Other.cs';await assert.rejects(m.createMigrationPlan(f),/Editor|unsupported/i);
});
test('Unity numeric Boolean tokens migrate and verify as Editor Boolean values without rewriting their bytes',async t=>{
 const f=await setup(t),m=await api();f.original=f.original.replace('health: 42','health: 1');await fs.writeFile(path.join(f.projectDir,'Assets/Main.unity'),f.original);for(const name of ['Player','Other']){const file=path.join(f.projectDir,'Assets/'+name+'.cs');await fs.writeFile(file,(await fs.readFile(file,'utf8')).replace(name==='Player'?'int health':'int score',name==='Player'?'bool health':'bool score'));}f.graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding});f.observations.graphRevision=f.request.graphRevision=f.graph.revision;f.observations.inventorySha256=fingerprint(f.graph.files);for(const s of f.observations.scripts){s.fields[0].type='System.Boolean';s.fields[0].propertyType='Boolean';}Object.assign(f.observations.components[0].fields[0],{type:'System.Boolean',propertyType:'Boolean',valueJson:'true'});Object.assign(f.request.fieldRenames[0],{type:'System.Boolean',expectedValue:1});const plan=await m.createMigrationPlan(f),receipt=await m.applyMigrationPlan({...f,plan}),graph=await indexUnityProject(path.join(f.runDir,'project'),{binding:f.graph.binding}),observations={...f.observations,graphRevision:graph.revision,inventorySha256:fingerprint(graph.files),components:[{componentId:f.componentId,script:f.to,fields:[{name:'score',type:'System.Boolean',propertyType:'Boolean',valueJson:'true'}]}]};assert.match(await fs.readFile(path.join(f.runDir,'project/Assets/Main.unity'),'utf8'),/score: 1 # exact comment/);assert.equal((await m.verifyMigration({projectDir:path.join(f.runDir,'project'),receipt,observations})).migratedValuesVerified,true);
});
