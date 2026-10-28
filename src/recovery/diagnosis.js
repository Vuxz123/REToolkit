import fs from 'node:fs';
import {assetPaths} from '../assets/context.js';
import {readAssetJson,runAssetOperation} from '../assets/service.js';
import {verifyStoredGraph,focusStoredScriptGraph,isSqliteGraph,openStoredGraph} from '../assets/graph-storage.js';
import {buildScriptMap} from '../reconstruction/map.js';
import {fingerprint} from '../state.js';
import {page} from './artifacts.js';

/** Diagnostic observations do not establish implementation or compatibility. */
export async function diagnoseArtifact(toolkit,name,params,identity){
 const paths=assetPaths(toolkit,name);
 if(!fs.existsSync(paths.graphFile))await runAssetOperation(toolkit,name,'assets.index',{storage:'sqlite'});
 // Reuse the domain service's current binding/inventory checks and sealed DB.
 await runAssetOperation(toolkit,name,'assets.list',{limit:1});
 const graph=readAssetJson(paths.graphFile,512*1024**2);verifyStoredGraph(graph,paths.graphFile);
 const issues=[];
 for(const asset of graph.assets){
  if(asset.path.endsWith('.cs'))issues.push({code:'source_logic_unverified',category:'source',scriptId:asset.id,path:asset.path,state:'unverified',declarations:asset.script?.supported?'parsed':'requires-exact-parser',nextAction:{operation:'assets.scripts',params:{query:asset.path,limit:1}},explanation:'Inspect source capabilities and same-build native evidence for the requested feature. Constructor/body completeness and behavior have not been established.'});
 }
 for(const file of graph.files.filter(f=>/\.dll$/i.test(f.path)))issues.push({code:'runtime_implementation_unverified',category:'runtime',assetId:graph.assets.find(a=>a.path===file.path)?.id??null,path:file.path,sha256:file.sha256,state:'unverified',nextAction:{operation:'libraries.identify',params:{section:'candidates',query:file.path.split('/').at(-1).replace(/\.dll$/i,''),limit:10}},explanation:'Managed API, implementation and compatibility require inspection. Filename and empty bodies alone do not prove a stub; catalog candidates are hints.'});
 if(graph.coverage.missingReferences)issues.push({code:'serialized_references_missing',category:'binding',state:'blocked',count:graph.coverage.missingReferences,nextAction:{operation:'assets.list',params:{limit:50}},explanation:'The graph has unresolved serialized references; inspect affected assets and their refs before editing bindings.'});
 if(graph.coverage.opaqueAssets||graph.coverage.unsupportedScripts)issues.push({code:'static_coverage_partial',category:'coverage',state:'partial',opaqueAssets:graph.coverage.opaqueAssets,unsupportedScripts:graph.coverage.unsupportedScripts,nextAction:{operation:'reconstruct.validate',params:{}},explanation:'Unity observations are needed; compiler success alone does not establish complete serialized binding coverage.'});
 issues.push({code:'unity_validation_required',category:'validation',state:'unverified',nextAction:{operation:'reconstruct.validate',params:{}},explanation:'Run fresh validation on this artifact. Compilation, binding and gameplay outcomes are independent.'});
 const counts={};for(const row of issues)counts[row.category]=(counts[row.category]??0)+1;
 const paged=page(issues,params,fingerprint({identity,graph:graph.revision,issues})),ids=paged.items.filter(r=>r.category==='source').map(r=>r.scriptId);
 if(ids.length){
  const focused=isSqliteGraph(graph)?focusStoredScriptGraph(graph,paths.graphFile,{scriptIds:ids}):graph;
  const map=await buildScriptMap(focused,{scriptIds:ids});
  paged.items=paged.items.map(row=>{const script=map.scripts.find(s=>s.scriptId===row.scriptId);return script?{...row,identity:script.identity,componentCount:script.componentCount,unresolvedBindingCount:script.unresolvedBindingCount,bindingTraversalComplete:script.traversalComplete,sourceCapabilities:script.sourceCapabilities,blockers:script.unresolvedBindingCount?['source_bindings_unresolved']:[]}:row;});
 }
 const missing=paged.items.find(r=>r.code==='serialized_references_missing');
 if(missing){
  const reader=isSqliteGraph(graph)?openStoredGraph(graph,paths.graphFile):null,examples=[];
  try{for(const edge of reader?reader.readEdges():graph.edges)if(edge.status==='missing'){
   examples.push(Object.fromEntries(['from','field','guid','fileID'].map(key=>[key,typeof edge[key]==='string'?edge[key].slice(0,512):null])));if(examples.length===16)break;
  }}finally{reader?.close();}
  missing.examples=examples;missing.examplesTruncated=missing.count>examples.length;
  if(examples.length)missing.nextAction={operation:'assets.refs',params:{id:examples[0].from,direction:'outgoing',limit:20}};
 }
 return {kind:'retoolkit-recovery-diagnosis',schemaVersion:1,...identity,graphRevision:graph.revision,counts,coverage:graph.coverage,compileReady:false,bindingsVerified:false,gameplay:'unverified',dependencyClosure:'unverified',...paged,limitations:['Static diagnosis is not proof that code is a stub or that a feature works.','Library candidates require the catalog identify/plan checks; no runtime was replaced.']};
}
