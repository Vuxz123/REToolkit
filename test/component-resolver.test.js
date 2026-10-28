import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './reconstruction-fixture.js';
import {indexUnityProject} from '../src/assets/graph.js';
const api=()=>import('../src/components/resolver.js');
const guid='a'.repeat(32), other='b'.repeat(32);
const node=(id,classID=114)=>({id:'object:'+id,assetId:'asset:x',classID,type:classID===114?'MonoBehaviour':'Transform',fields:{m_GameObject:{fileID:'1'}},scriptRef:classID===114?{guid,fileID:'11500000'}:undefined});
test('component scan counts the whole iterable, bounds samples and excludes standalone ScriptableObjects',async()=>{
 const {inventoryComponents}=await api();
 function* nodes(){for(let i=0;i<2000;i++)yield node(String(i));yield node('native',4);yield {...node('data'),fields:{m_GameObject:{fileID:'0'}}};}
 const value=inventoryComponents(nodes(),{sampleLimit:8});
 assert.equal(value.total,2001);assert.equal(value.groups.length,2);assert.equal(value.groups.find(g=>g.classID===114).count,2000);assert.equal(value.groups.find(g=>g.classID===114).instances.length,8);assert.equal(value.samplesComplete,false);
});
test('resolver distinguishes exact observed binding, native preservation and ambiguous type matches',async()=>{
 const {resolveComponents}=await api();const from={guid,fileID:'11500000',assembly:'Old',fullName:'Game.Item'},to={...from,guid:other,assembly:'New'};
 const graph={nodes:[node('1'),node('2',4)],assets:[{guid,path:'Assets/Item.cs'}]};
 const observed={components:[{componentId:'object:1',script:from},{componentId:'object:2',native:true,fullName:'UnityEngine.Transform',assembly:'UnityEngine.CoreModule'}],scripts:[{...from,path:'Assets/Item.cs'},{...to,path:'Packages/lib/Item.cs'}]};
 let result=resolveComponents({graph,observation:observed,targets:observed.scripts});
 assert.equal(result.decisions[0].state,'conflict');assert.equal(result.decisions[1].state,'preserve');
 result=resolveComponents({graph,observation:{...observed,scripts:[observed.scripts[0]]},targets:[observed.scripts[0]]});assert.equal(result.decisions[0].state,'preserve');
 assert.equal(resolveComponents({graph,targets:[]}).decisions[0].state,'unverified');
});
test('private registry includes inventoried package source identities without changing public graph',async t=>{
 const f=await fixture(t),root=path.join(f.projectDir,'Packages/com.example.ui');await fs.mkdir(root,{recursive:true});
 await fs.writeFile(path.join(root,'package.json'),JSON.stringify({name:'com.example.ui',version:'1.0.0'}));
 await fs.writeFile(path.join(root,'Runtime.asmdef'),JSON.stringify({name:'Example.UI'}));
 await fs.writeFile(path.join(root,'Widget.cs'),'namespace Example { public class Widget : UnityEngine.MonoBehaviour { public int health; } }');
 await fs.writeFile(path.join(root,'Widget.cs.meta'),'guid: '+other+'\n');
 const graph=await indexUnityProject(f.projectDir),before=JSON.stringify(graph),{enrichComponentGraph,componentTargets}=await api();
 const enriched=await enrichComponentGraph(f.projectDir,graph),target=enriched.assets.find(a=>a.guid===other);
 assert.equal(JSON.stringify(graph),before);assert.equal(target.path,'Packages/com.example.ui/Widget.cs');assert.equal(target.script.assembly,'Example.UI');assert.equal(target.script.supported,true);
 assert.equal(componentTargets(enriched).find(a=>a.guid===other).implementation,'unverified');
 await fs.writeFile(path.join(root,'Other.cs'),'namespace Example { public class Other : UnityEngine.MonoBehaviour {} }');await fs.writeFile(path.join(root,'Other.cs.meta'),'guid: '+other+'\n');const duplicate=await indexUnityProject(f.projectDir);await assert.rejects(enrichComponentGraph(f.projectDir,duplicate),/duplicate|ambiguous/i);
});
test('catalog hints use real available versions and never claim installation or stub certainty',async()=>{
 const {libraryHints}=await api();const catalog={packages:[{id:'zip1',libraryId:'textmeshpro',version:'3.0.6',identity:{types:['TMPro.TextMeshProUGUI'],assemblies:['Unity.TextMeshPro']}}]};
 const hints=libraryHints({fullName:'TMPro.TextMeshProUGUI'},catalog);
 assert.equal(hints.available[0].version,'3.0.6');assert.equal(hints.available[0].installed,false);assert.equal(hints.versionPolicy,'available-first');assert.equal(hints.nextAction.operation,'libraries.plan');
 assert.equal(libraryHints({fullName:'Unknown.Type'},catalog).available.length,0);
});
test('explicitly preserving one of two duplicate full types remains a conflict',async()=>{
 const {resolveComponents,targetId}=await api(),from={guid,fileID:'11500000',assembly:'Old',fullName:'Game.Item'},to={...from,guid:other,assembly:'New'},target={...from,path:'Assets/Item.cs',writable:true};target.targetId=targetId(target);
 const result=resolveComponents({graph:{nodes:[node('1')]},observation:{components:[{componentId:'object:1',script:from}],scripts:[from,to]},targets:[target,{...to,path:'Packages/Item.cs'}],mappings:[{componentId:'object:1',targetId:target.targetId}]});assert.equal(result.decisions[0].state,'conflict');
});
test('native identity mismatch is not reported as preserved',async()=>{
 const {resolveComponents}=await api(),result=resolveComponents({graph:{nodes:[node('native',4)]},observation:{components:[{componentId:'object:native',native:true,fullName:'UnityEngine.Rigidbody',assembly:'UnityEngine.PhysicsModule'}],scripts:[]}});assert.equal(result.decisions[0].state,'conflict');
});
test('namespaced native Unity types can be preserved without guessing an assembly',async()=>{
 const {resolveComponents}=await api(),result=resolveComponents({graph:{nodes:[{...node('native',195),type:'NavMeshAgent'}]},observation:{components:[{componentId:'object:native',native:true,fullName:'UnityEngine.AI.NavMeshAgent',assembly:'UnityEngine.AIModule'}],scripts:[]}});assert.equal(result.decisions[0].state,'preserve');
});
test('component observer opt-in includes native selectors and authenticates its control request',async t=>{
 const f=await fixture(t);await fs.appendFile(path.join(f.projectDir,'Assets/Main.unity'),'--- !u!4 &2\nTransform:\n  m_GameObject: {fileID: 1}\n');await fs.writeFile(path.join(f.projectDir,'Assets/Main.unity.meta'),'guid: '+'c'.repeat(32)+'\n');
 const graph=await indexUnityProject(f.projectDir),{stageMigrationObservation}=await import('../src/reconstruction/migration-observation.js');
 const stage=await stageMigrationObservation({...f,graph,componentMode:true,runDir:path.join(f.root,'components'),templateRoot:path.resolve('templates')});
 assert.equal(stage.request.componentMode,true);assert.equal(stage.request.components.some(c=>c.fileID==='2'),true);assert.match(stage.requestSha256,/^[a-f0-9]{64}$/);
 const helper=await fs.readFile(path.join(stage.projectDir,'Assets/REToolkitValidation/Editor/REToolkitValidation.cs'),'utf8');assert.match(helper,/GetAllRuntimeMonoScripts/);assert.match(helper,/public bool native/);
});
