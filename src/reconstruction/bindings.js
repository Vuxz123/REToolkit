import {createHash} from 'node:crypto';
import {storedScriptBindings} from '../assets/graph-storage.js';

const MAX_SAMPLES=64,MAX_SAMPLE_BYTES=16384;
const preview=value=>typeof value==='string'?value.slice(0,256):value??null;
/** Counts and digest cover every row and edge. Samples never gate completeness. */
export function summarizeScriptBindings(asset,rows){
 const components=[],unresolvedBindings=[],digest=createHash('sha256');let componentCount=0,unresolvedBindingCount=0,traversedBindingCount=0,scriptEdgeCount=0,sampleBytes=0;
 digest.update(JSON.stringify({id:asset.id,guid:asset.guid??null,path:asset.path})+'\n');
 for(const {node,edges,duplicateNode=false}of rows){
  traversedBindingCount++;const ref=node.scriptRef;let edgeCount=0,firstEdge=null;
  digest.update(JSON.stringify({id:node.id,scriptRef:ref??null,duplicateNode})+'\n');
  for(const edge of edges){edgeCount++;scriptEdgeCount++;if(edgeCount===1)firstEdge=edge;digest.update(JSON.stringify({from:edge.from,to:edge.to??null,kind:edge.kind,field:edge.field,guid:edge.guid??null,fileID:edge.fileID??null,status:edge.status})+'\n');}
  const supported=!duplicateNode&&asset.path.endsWith('.cs')&&Boolean(asset.guid)&&ref?.guid===asset.guid&&ref.fileID==='11500000'&&edgeCount===1&&firstEdge.from===node.id&&firstEdge.kind==='script'&&firstEdge.field==='m_Script'&&firstEdge.status==='resolved'&&firstEdge.to===asset.id&&firstEdge.guid===asset.guid&&firstEdge.fileID===ref.fileID;
  if(supported){componentCount++;const bytes=Buffer.byteLength(JSON.stringify(node.id));if(components.length<MAX_SAMPLES&&sampleBytes+bytes<=MAX_SAMPLE_BYTES){components.push(node.id);sampleBytes+=bytes;}}
  else{
   unresolvedBindingCount++;const error={componentId:preview(node.id),guid:preview(ref?.guid),fileID:preview(ref?.fileID),status:duplicateNode||edgeCount!==1?'ambiguous':preview(firstEdge.status),reason:!asset.path.endsWith('.cs')?'DLL local script bindings require an explicit migration':duplicateNode?'Duplicate component identity':'Unsupported or unresolved local script fileID/binding'};
   const bytes=Buffer.byteLength(JSON.stringify(error));
   // Retain at least one error for existing fail-closed .length consumers.
   if(unresolvedBindings.length<MAX_SAMPLES&&(!unresolvedBindings.length||sampleBytes+bytes<=MAX_SAMPLE_BYTES)){unresolvedBindings.push(error);sampleBytes+=bytes;}
  }
 }
 return {components,unresolvedBindings,componentCount,unresolvedBindingCount,traversedBindingCount,scriptEdgeCount,traversalComplete:true,componentsTruncated:componentCount>components.length,unresolvedBindingsTruncated:unresolvedBindingCount>unresolvedBindings.length,bindingSha256:digest.digest('hex')};
}

/** A GUID identifies an asset; its resolved local reference binds a component. */
export function scriptBindings(graph,asset){
 const attested=storedScriptBindings(graph,asset);if(attested)return attested;
 if(!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))throw Object.assign(new Error('Complete binding graph or authenticated streamed traversal required'),{code:'asset_graph_invalid'});
 const bySource=new Map(),claimed=new Set(),counts=new Map();
 for(const edge of graph.edges)if(edge.kind==='script'||edge.field==='m_Script'){
  if(!bySource.has(edge.from))bySource.set(edge.from,[]);bySource.get(edge.from).push(edge);
  if(edge.to===asset.id||asset.guid&&edge.guid===asset.guid)claimed.add(edge.from);
 }
 for(const node of graph.nodes)counts.set(node.id,(counts.get(node.id)??0)+1);
 return summarizeScriptBindings(asset,(function*(){
  for(const node of graph.nodes)if(claimed.has(node.id)||asset.guid&&node.scriptRef?.guid===asset.guid)yield {node,edges:bySource.get(node.id)??[],duplicateNode:counts.get(node.id)>1};
  for(const id of claimed)if(!counts.has(id))yield {node:{id},edges:bySource.get(id)??[]};
 })());
}
