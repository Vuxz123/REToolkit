import path from 'node:path';
import {assertAssetPath,assetError} from './context.js';
import {openSqliteGraph} from './sqlite-store.js';

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
