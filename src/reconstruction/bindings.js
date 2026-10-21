/** A GUID identifies an asset; only its resolved local script reference binds a component. */
export function scriptBindings(graph,asset){
  const components=[],unresolvedBindings=[];
  for(const node of graph.nodes.filter(n=>asset.guid&&n.scriptRef?.guid===asset.guid)){
    const ref=node.scriptRef,edges=graph.edges.filter(e=>e.from===node.id&&e.kind==='script'&&e.field==='m_Script');
    const supported=asset.path.endsWith('.cs')&&ref.fileID==='11500000'&&edges.length===1&&edges[0].status==='resolved'&&edges[0].to===asset.id&&edges[0].guid===asset.guid&&edges[0].fileID===ref.fileID;
    if(supported)components.push(node.id);
    else unresolvedBindings.push({componentId:node.id,guid:ref.guid,fileID:ref.fileID,status:edges.length===1?edges[0].status:'ambiguous',reason:asset.path.endsWith('.cs')?'Unsupported or unresolved local script fileID/binding':'DLL local script bindings require an explicit migration'});
  }
  return {components,unresolvedBindings};
}
