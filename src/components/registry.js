import {enrichLibraryGraph} from '../libraries/project-facts.js';
import {readUnitySourceMetadata,describeUnitySourceScript} from '../assets/graph.js';
import {fingerprint} from '../state.js';
import {check} from '../recovery/artifacts.js';
export async function enrichComponentGraph(projectDir,graph){
 const enriched=await enrichLibraryGraph(projectDir,graph),facts=enriched.libraryDeclarations;
 check(!facts.unknownMetadata.some(f=>/duplicate GUID/i.test(f.reason)),'Duplicate package GUID metadata is ambiguous','components_guid_conflict');
 const metadata=await readUnitySourceMetadata(projectDir,graph.files.filter(f=>/\.(asmdef|asmref)$/.test(f.path))),assets=[...graph.assets],guids=new Set(assets.filter(a=>a.guid).map(a=>a.guid)),byPath=new Map(facts.guids.map(g=>[g.path,g.guid]));
 for(const file of graph.files.filter(f=>/^Packages\/.*\.cs$/.test(f.path))){
  const guid=byPath.get(file.path);if(!guid)continue;
  check(!guids.has(guid),'Package and project contain duplicate script GUIDs','components_guid_conflict');guids.add(guid);
  const script=await describeUnitySourceScript(projectDir,file,metadata);
  // Package files with no resolved assembly definition cannot inherit the
  // project's predefined assembly as writable proof.
  if(!script.assemblyDefinition){script.supported=false;script.limitations.push('Package assembly requires an observed, resolved asmdef.');}
  assets.push({id:'asset:'+guid,guid,path:file.path,kind:'script',script});
 }
 return {...enriched,assets};
}
export const identityOf=row=>({assembly:row.assembly,fullName:row.fullName,guid:row.guid,fileID:row.fileID});
export const targetId=row=>fingerprint({path:row.path,...identityOf(row)});
export function componentTargets(graph,observation){
 const observed=observation?.scripts??[],result=[];
 for(const a of graph.assets){if(!a.script)continue;for(const type of a.script.types??[]){
  const matches=observed.filter(s=>s.path===a.path&&s.guid===a.guid&&s.fullName===type.fullName&&s.assembly===a.script.assembly);
  const row={path:a.path,guid:a.guid,fileID:null,fullName:type.fullName,assembly:a.script.assembly,origin:a.path.startsWith('Packages/')?'package':'project',implementation:'unverified',observed:false,writable:false};
  if(matches.length===1)Object.assign(row,identityOf(matches[0]),{observed:true,writable:a.script.supported&&a.script.types.length===1});
  row.targetId=targetId(row);result.push(row);
 }}
 for(const script of observed){if(result.some(r=>r.path===script.path&&r.guid===script.guid&&r.fileID===script.fileID))continue;const row={...identityOf(script),path:script.path,origin:script.path.startsWith('Packages/')?'package-cache':'assembly',implementation:'unverified',observed:true,writable:false};row.targetId=targetId(row);result.push(row);}
 check(result.length<=20000,'Component registry exceeds 20000 candidates','components_registry_limit');return result;
}
