import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,replacement} from './reconstruction-fixture.js';
import {fingerprint} from '../src/state.js';
const api=()=>import('../src/reconstruction/plan.js');
test('stub replacement preserves YAML/meta and verified repeated receipt; compile stays unknown',async t=>{
  const f=await fixture(t);const {createReconstructionPlan,applyReconstructionPlan,verifyReconstruction}=await api();
  const plan=await createReconstructionPlan(f);assert.equal(JSON.stringify(plan).includes(f.projectDir),false);
  const receipt=await applyReconstructionPlan({...f,plan});assert.equal(receipt.compileReady,false);
  assert.equal(await fs.readFile(path.join(f.projectDir,'Assets/Player.cs'),'utf8'),replacement);
  for(const name of ['Assets/Player.cs.meta','Assets/Main.unity'])assert.equal(await fs.readFile(path.join(f.projectDir,name),'utf8'),f.files[name]);
  assert.deepEqual(await applyReconstructionPlan({...f,plan}),receipt);
  assert.equal((await verifyReconstruction({...f,receipt})).valid,true);
  await fs.appendFile(path.join(f.projectDir,'Assets/Main.unity'),'# edit');
  assert.equal((await verifyReconstruction({...f,receipt})).valid,false);
  await assert.rejects(applyReconstructionPlan({...f,plan}),/receipt|changed|stale/i);
});
test('plans refuse type, serialized field, Editor and malformed request changes',async t=>{
  const f=await fixture(t);const {createReconstructionPlan}=await api();
  for(const source of [replacement.replace('Game','Else'),replacement.replace('int health','float health'),replacement.replace('MonoBehaviour','ScriptableObject'),'#if X\n'+replacement+'\n#endif']){
    await assert.rejects(createReconstructionPlan({...f,request:{...f.request,changes:[{scriptId:f.scriptMap.scripts[0].scriptId,source}]}}),/identity|field|supported|declaration|syntax/i);
  }
  await assert.rejects(createReconstructionPlan({...f,request:{...f.request,extra:true}}),/request/i);
});
test('apply rejects changed inventory and tampered candidate even with recalculated hash',async t=>{
  const f=await fixture(t);const {createReconstructionPlan,applyReconstructionPlan}=await api();const plan=await createReconstructionPlan(f);
  await fs.appendFile(path.join(f.projectDir,'Assets/Player.cs.meta'),'# changed');
  await assert.rejects(applyReconstructionPlan({...f,plan}),/stale|changed/i);
});
test('all staged changes rollback on partial publication; external interference is never overwritten',async t=>{
  for(const interfere of [false,true]){
    const f=await fixture(t,true);const {createReconstructionPlan,applyReconstructionPlan}=await api();const plan=await createReconstructionPlan(f);let seen=0;
    await assert.rejects(applyReconstructionPlan({...f,plan,onEvent:async event=>{if(event.phase==='published'&&++seen===1){if(interfere)await fs.writeFile(path.join(f.projectDir,event.path),'external edit');throw Error('injected');}}}),e=>interfere?e.code==='reconstruction_recovery_required':/injected/.test(e.message));
    if(interfere)assert.equal(await fs.readFile(path.join(f.projectDir,plan.changes[0].path),'utf8'),'external edit');
    else for(const c of plan.changes)assert.equal(await fs.readFile(path.join(f.projectDir,c.path),'utf8'),f.files[c.path]);
  }
});
test('forged JSON plan hash cannot authorize field, target, path or assembly changes',async t=>{
  const f=await fixture(t);const {createReconstructionPlan,applyReconstructionPlan}=await api();const original=await createReconstructionPlan(f);
  for(const mutate of [p=>p.changes[0].source=p.changes[0].source.replace('int health','float health'),p=>p.changes[0].path='../outside.cs',p=>p.changes[0].identity.assembly='Other',p=>p.changes[0].guid='b'.repeat(32),p=>p.changes.push(structuredClone(p.changes[0]))]){
    const plan=structuredClone(original);mutate(plan);const {payloadSha256,...rest}=plan;plan.payloadSha256=fingerprint(rest);
    await assert.rejects(applyReconstructionPlan({...f,plan}),/field|identity|hash|Duplicate/i);
  }
});
test('source, prefab, added-file and staged-byte races are guarded before publication',async t=>{
  const {createReconstructionPlan,applyReconstructionPlan}=await api();
  for(const race of ['source','prefab','added','stage']){
    const f=await fixture(t);const plan=await createReconstructionPlan(f);
    await assert.rejects(applyReconstructionPlan({...f,plan,onEvent:async e=>{if(e.phase!=='staged')return;
      if(race==='source')await fs.appendFile(path.join(f.projectDir,'Assets/Player.cs'),'// external');
      if(race==='prefab')await fs.appendFile(path.join(f.projectDir,'Assets/Main.unity'),'# external');
      if(race==='added')await fs.writeFile(path.join(f.projectDir,'Assets/New.asset'),'new file');
      if(race==='stage')await fs.writeFile(path.join(f.journalDir,plan.operationId,'0.stage'),'tampered');
    }}),/stale|changed/i);
    if(race!=='source')assert.equal(await fs.readFile(path.join(f.projectDir,'Assets/Player.cs'),'utf8'),f.files['Assets/Player.cs']);
  }
});
test('replacement preserves declaration context and serialized attributes',async t=>{
  const f=await fixture(t);const {createReconstructionPlan}=await api();
  for(const source of ['using UnityEngine = Other;\n'+replacement,replacement.replace('public int health','[System.NonSerialized] public int health'),replacement.replace('public int health','[UnityEngine.SerializeReference] public int health')]){
    await assert.rejects(createReconstructionPlan({...f,request:{...f.request,changes:[{scriptId:f.scriptMap.scripts[0].scriptId,source}]}}),/field|identity|declaration|context/i);
  }
});
test('multiple exported declarations for one assembly/full type cannot be replaced',async t=>{
  const f=await fixture(t);const {createReconstructionPlan}=await api();const duplicate=structuredClone(f.graph.assets.find(a=>a.script));duplicate.id='asset:'+'b'.repeat(32);duplicate.path='Assets/Duplicate.cs';f.graph.assets.push(duplicate);
  await assert.rejects(createReconstructionPlan(f),/ambiguous/i);
});
test('Editor, DLL and opaque targets are explicit unsupported migrations',async t=>{
  for(const mode of ['editor','dll','opaque']){
    const f=await fixture(t),{createReconstructionPlan}=await api(),script=f.graph.assets.find(a=>a.script);
    if(mode==='editor')script.path='Assets/Editor/Player.cs';if(mode==='dll')script.path='Assets/Player.dll';if(mode==='opaque')script.guid=null;
    await assert.rejects(createReconstructionPlan(f),/Unsupported|Editor|DLL|ambiguous/i);
  }
});
test('current source declarations are revalidated during apply',async t=>{
  const f=await fixture(t),{createReconstructionPlan,applyReconstructionPlan}=await api(),plan=await createReconstructionPlan(f);
  f.graph.assets.find(a=>a.script).script.types[0].fields=[];plan.changes[0].identity.serializedFields=[];
  plan.changes[0].source='namespace Game { public class Player : UnityEngine.MonoBehaviour { public void Run() {} } }';
  const {createHash}=await import('node:crypto');plan.changes[0].afterSha256=createHash('sha256').update(plan.changes[0].source).digest('hex');plan.changes[0].afterSize=Buffer.byteLength(plan.changes[0].source);
  const {payloadSha256,...rest}=plan;plan.payloadSha256=fingerprint(rest);
  await assert.rejects(applyReconstructionPlan({...f,plan}),/declaration|identity/i);
  assert.equal(await fs.readFile(path.join(f.projectDir,'Assets/Player.cs'),'utf8'),f.files['Assets/Player.cs']);
});
test('unresolved local script fileIDs refuse planning and forged plan application',async t=>{
  const f=await fixture(t),{createReconstructionPlan,applyReconstructionPlan}=await api(),plan=await createReconstructionPlan(f);
  await fs.writeFile(path.join(f.projectDir,'Assets/Main.unity'),f.files['Assets/Main.unity'].replace('fileID: 11500000','fileID: 123'));
  const {indexUnityProject}=await import('../src/assets/graph.js'),{buildScriptMap}=await import('../src/reconstruction/map.js');
  const graph=await indexUnityProject(f.projectDir,{binding:f.graph.binding}),scriptMap=await buildScriptMap(graph,{projectDir:f.projectDir});
  const request={...f.request,graphRevision:graph.revision};
  await assert.rejects(createReconstructionPlan({...f,graph,scriptMap,request}),/binding|fileID/i);
  plan.graphRevision=graph.revision;plan.inventory=graph.files;const {payloadSha256,...rest}=plan;plan.payloadSha256=fingerprint(rest);
  await assert.rejects(applyReconstructionPlan({...f,graph,plan}),/binding|fileID/i);
});
