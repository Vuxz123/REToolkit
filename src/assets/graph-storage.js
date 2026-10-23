import path from 'node:path';
import fs from 'node:fs';
import {assertAssetPath,assetError} from './context.js';
import {openSqliteGraph} from './sqlite-store.js';
import {fingerprint} from '../state.js';
import {summarizeScriptBindings} from '../reconstruction/bindings.js';

const scriptAttestations=new WeakMap();
const sameStat=(a,b)=>b.isFile()&&!b.isSymbolicLink()&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
/** Only reductions from authenticated bytes enter this private registry. */
export function assertScriptBindingsFresh(graph){
 const attestation=scriptAttestations.get(graph);if(!attestation){if(graph?.coverage?.materialization==='streamed-script-bindings')throw assetError('asset_graph_invalid','Authenticated streamed binding attestation is missing; traverse the sealed database again');return;}
 const {file,stat,identity}=attestation;assertAssetPath(file);
 if(!sameStat(stat,fs.lstatSync(file))||fingerprint(graph)!==identity)throw assetError('sqlite_graph_changed','Database or streamed graph identity changed after binding traversal');
 for(const suffix of ['-journal','-wal','-shm'])try{fs.lstatSync(file+suffix);throw assetError('sqlite_graph_changed','Sealed binding database gained a journal');}catch(error){if(error.code!=='ENOENT')throw error;}
}
export function storedScriptBindings(graph,asset){
 assertScriptBindingsFresh(graph);const attestation=scriptAttestations.get(graph);if(!attestation)return null;
 const summary=attestation.summaries.get(asset.id);
 if(!summary||fingerprint(asset)!==attestation.assets.get(asset.id))throw assetError('graph_scope_limit','Script was not included in the authenticated binding traversal');
 return structuredClone(summary);
}

/** Complete script validation with bounded samples, preserving all inventory.
 * Every query/plan/apply operation constructs a fresh focus. */
export function focusStoredScriptGraph(graph,graphFile,{scriptIds}={}){
 assertGraphManifest(graph);if(!isSqliteGraph(graph))return graph;
 if(!Array.isArray(scriptIds)||scriptIds.length>1000||scriptIds.some(id=>typeof id!=='string'))throw assetError('graph_scope_limit','Select at most 1000 script assets for complete streamed validation');
 const file=storedDatabasePath(graph,graphFile),stat=fs.lstatSync(file),reader=openStoredGraph(graph,graphFile),summaries=new Map(),assets=new Map();
 try{for(const id of new Set(scriptIds)){
  const matches=graph.assets.filter(a=>a.id===id);if(matches.length!==1)throw assetError('asset_graph_invalid','Missing or ambiguous selected script asset');const asset=matches[0];
  summaries.set(id,summarizeScriptBindings(asset,reader.readScriptBindings({id:asset.id,guid:asset.guid})));assets.set(id,fingerprint(asset));
 }}finally{reader.close();}
 const focused={...graph,schemaVersion:1,storage:undefined,nodes:[],edges:[],coverage:{...graph.coverage,materialization:'streamed-script-bindings'}};
 scriptAttestations.set(focused,{file,stat,summaries,assets,identity:fingerprint(focused)});assertScriptBindingsFresh(focused);return focused;
}

export const isSqliteGraph=graph=>graph?.kind==='retoolkit-asset-graph'&&graph.schemaVersion===2&&graph.storage?.kind==='sqlite';
export function assertGraphManifest(graph,{expectedStorage}={}){
 if(graph?.kind!=='retoolkit-asset-graph'||!Array.isArray(graph.files)||!Array.isArray(graph.assets)||!(graph.schemaVersion===1&&!graph.storage&&graph.profile?.storage!=='sqlite'&&Array.isArray(graph.nodes)&&Array.isArray(graph.edges)||isSqliteGraph(graph)))throw assetError('asset_graph_invalid','Expected a supported complete graph manifest');
 if(expectedStorage!==undefined&&(!['json','sqlite'].includes(expectedStorage)||(isSqliteGraph(graph)?'sqlite':'json')!==expectedStorage))throw assetError('asset_graph_invalid','Saved graph storage differs from the selected workspace; index or plan again');
 return graph;
}
export function storedDatabasePath(graph,graphFile){
 assertGraphManifest(graph);
 const relative=graph.storage?.relativePath;
 if(!isSqliteGraph(graph)||typeof relative!=='string'||!/^indexes\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\/graph\.sqlite$/.test(relative))throw assetError('asset_graph_invalid','Invalid saved graph database generation');
 const base=path.dirname(assertAssetPath(graphFile));return assertAssetPath(path.join(base,...relative.split('/')),base);
}
export function openStoredGraph(graph,graphFile){return openSqliteGraph({file:storedDatabasePath(graph,graphFile),receipt:graph.storage,graph});}
export function verifyStoredGraph(graph,graphFile,options){assertGraphManifest(graph,options);if(isSqliteGraph(graph)){const reader=openStoredGraph(graph,graphFile);reader.close();}return true;}

/** Explicitly bounded materialization for existing reconstruction algorithms.
 * Every source declaration stays present to retain ambiguity/assembly checks.
 * Bindings are always derived from the sealed database for the requested IDs.
 */
export function focusStoredGraph(graph,graphFile,{scriptIds,nodeIds,maxNodes=20000,maxBytes=64*1024**2}={}){
 assertGraphManifest(graph);if(!isSqliteGraph(graph))return graph;
 const reader=openStoredGraph(graph,graphFile),nodes=[],edges=[];let bytes=0;
 function account(row){bytes+=Buffer.byteLength(JSON.stringify(row));if(bytes>maxBytes)throw assetError('graph_scope_limit','Selected bindings exceed the materialization budget; narrow the requested scope');}
 try{
  const scriptGuids=scriptIds?.map(id=>graph.assets.find(a=>a.id===id)?.guid).filter(Boolean);
  // An unknown requested ID must not accidentally select all nodes.
  const selector=scriptIds?{scriptGuids}:nodeIds?{ids:nodeIds}:{};
  if(scriptIds&&!scriptGuids.length)return {...graph,schemaVersion:1,storage:undefined,nodes,edges};
  for(const node of reader.readNodes(selector)){if(nodes.length>=maxNodes)throw assetError('graph_scope_limit','Selected graph exceeds 20000 nodes; narrow the requested scope');account(node);nodes.push(node);}
  // Keep the lookup bounded even if a hostile graph has many references.
  const ids=nodes.map(n=>n.id);
  if(ids.length)for(const edge of reader.readEdges({fromIds:ids})){if(edges.length>=1000000)throw assetError('graph_scope_limit','Selected graph exceeds its reference budget');account(edge);edges.push(edge);}
  return {...graph,schemaVersion:1,storage:undefined,nodes,edges,coverage:{...graph.coverage,materialization:'explicit-scope'}};
 }finally{reader.close();}
}
