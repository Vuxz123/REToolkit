import path from 'node:path';
import {supportsLibraryFacts} from '../assets/source-facts.js';
import { randomUUID } from 'node:crypto';
import { fingerprint } from '../state.js';
import { safeRelative } from '../toolchain/manifest.js';

const hashPattern = /^[a-f0-9]{64}$/;
const packageId = /^[a-z0-9][a-z0-9._-]{0,255}$/;
function fail(code, message) { const error = new Error(`${code}: ${message}`); error.code = code; throw error; }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function keys(value, allowed, label) {
  if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('invalid_library_requirements', label);
}
function normalizeRequirements(input = []) {
  if (!Array.isArray(input)) {
    keys(input, ['kind','schemaVersion','packages'], 'Invalid requirements DTO');
    if (input.kind !== 'retoolkit-library-requirements' || input.schemaVersion !== 1) fail('invalid_library_requirements', 'Unsupported requirements schema');
    input = input.packages;
  }
  if (!Array.isArray(input) || input.length > 256) fail('invalid_library_requirements', 'Requirements must be a bounded package array');
  return input.map(record => {
    keys(record, ['id','version','source','evidence'], 'Invalid requirements package');
    if (typeof record.id !== 'string' || !packageId.test(record.id) || typeof record.version !== 'string' || !record.version || record.version.length > 128) fail('invalid_library_requirements', 'An explicit package id and version are required');
    if (record.source !== undefined && !['explicit','project-manifest'].includes(record.source)) fail('invalid_library_requirements', 'Hints cannot authorize package requirements');
    if (record.evidence !== undefined && (!Array.isArray(record.evidence) || record.evidence.length > 256 || Buffer.byteLength(JSON.stringify(record.evidence)) > 65536)) fail('invalid_library_requirements','Invalid requirements evidence');
    return {id:record.id,version:record.version,source:record.source ?? 'explicit',evidence:structuredClone(record.evidence ?? [])};
  }).sort((a,b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version));
}
function assertInputs(graph, catalog) {
  if (!supportsLibraryFacts(graph) || !hashPattern.test(graph.revision) || !plain(graph.binding) || !Array.isArray(graph.files) || !Array.isArray(graph.assets)) fail('invalid_library_graph', 'A current asset graph is required');
  if (catalog?.kind !== 'retoolkit-library-catalog' || catalog.schemaVersion !== 1 || !hashPattern.test(catalog.revision) || !['indexed','unconfigured'].includes(catalog.state) || !Array.isArray(catalog.packages) || catalog.packages.length > 10000) fail('invalid_library_catalog', 'A library catalog is required');
}

function safePath(value, allowEmpty = false) {
  if (allowEmpty && value === '') return value;
  if (!safeRelative(value) || value.length > 4096) fail('unsafe_library_payload', 'Unsafe payload path');
  return value;
}

// Both planning and publication use this mapping; archive paths never become
// arbitrary caller-controlled destinations.
export function packagePayloadMappings(pkg) {
  if (!['upm','assets'].includes(pkg?.format)) fail('unsupported_library_payload', 'Only inspected UPM and Assets payloads can be imported');
  const root = safePath(pkg.root ?? '', true), prefix = root ? `${root}/` : '';
  if (!Array.isArray(pkg.payloadFiles) || !pkg.payloadFiles.length || pkg.payloadFiles.length > 100000) fail('unsafe_library_payload','Missing or oversized payload inventory');
  if (pkg.format === 'upm' && !packageId.test(pkg.identity?.packageId ?? '')) fail('unsafe_library_payload','Invalid UPM package id');
  const seen = new Set();
  const mappings = pkg.payloadFiles.map(file => {
    safePath(file.path);
    if (!file.path.startsWith(prefix) || !Number.isSafeInteger(file.size) || file.size < 0 || !hashPattern.test(file.sha256)) fail('unsafe_library_payload','Invalid payload inventory');
    const relative = file.path.slice(prefix.length);let targetPath;
    if (pkg.format === 'upm') targetPath = `Packages/${pkg.identity.packageId}/${relative}`;
    else {
      const parts = file.path.split('/'), index = parts.findIndex(part=>part.toLowerCase()==='assets');
      if (index < 0 || index === parts.length - 1) fail('unsupported_library_payload','Assets payload has an unmapped file');
      targetPath = ['Assets',...parts.slice(index+1)].join('/');
    }
    safePath(targetPath);const key=targetPath.toLowerCase();
    if (seen.has(key)) fail('library_path_collision','Duplicate payload destination');seen.add(key);
    return {...structuredClone(file),targetPath};
  });
  if (pkg.format === 'upm' && !mappings.some(file=>file.targetPath===`Packages/${pkg.identity.packageId}/package.json`)) fail('unsafe_library_payload','UPM payload needs package.json');
  return mappings;
}

function versionTuple(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value ?? '');
  if (!match) return null;const tuple = match.slice(1).map(Number);
  return tuple.every(Number.isSafeInteger) ? tuple : null;
}
function compare(a,b) { for (let i=0;i<3;i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; }
function rangeMatcher(range) {
  const operator = range[0] === '^' || range[0] === '~' ? range[0] : '', base = versionTuple(operator ? range.slice(1) : range);
  if (!base) return null;
  if (!operator) return version => { const value = versionTuple(version);return value !== null && compare(value,base) === 0; };
  let upper;
  if (operator === '~') upper = [base[0],base[1]+1,0];
  else if (base[0]) upper = [base[0]+1,0,0];
  else if (base[1]) upper = [0,base[1]+1,0];
  else upper = [0,0,base[2]+1];
  return version => { const value=versionTuple(version);return value!==null && compare(value,base)>=0 && compare(value,upper)<0; };
}
function compatibilityProblem(pkg,graph) {
  const compatibility = pkg.compatibility ?? {};
  if (compatibility.unity) {
    // UPM's unity field is a minimum editor release, not an npm range.
    const minimum=/^(\d+)\.(\d+)(?:\.(\d+)(?:[abfp]\d+)?)?$/.exec(compatibility.unity), current=/^(\d+)\.(\d+)\.(\d+)(?:[abfp]\d+)?$/.exec(graph.unityVersion ?? '');
    if (!minimum || !current) return 'Unity compatibility cannot be established';
    if (compare(current.slice(1,4).map(Number),[Number(minimum[1]),Number(minimum[2]),Number(minimum[3]??0)])<0) return 'Unity editor is older than the package minimum';
  }
  for (const [field, fact] of [['platforms',graph.platform ?? graph.targetPlatform],['pipelines',graph.renderPipeline]]) {
    if (compatibility[field]?.length && (!fact || !compatibility[field].some(value=>value.toLowerCase()===fact.toLowerCase()))) return `${field} compatibility is unknown or incompatible`;
  }
  if (compatibility.renderPipeline && compatibility.renderPipeline !== graph.renderPipeline) return 'Render pipeline compatibility is unknown or incompatible';
  return null;
}
function exactInventory(pkg,graph) {
  let mappings;try { mappings=packagePayloadMappings(pkg); } catch { return false; }
  const files = new Map(graph.files.map(file=>[file.path,file]));
  if (pkg.format==='upm') {
    const prefix=`Packages/${pkg.identity.packageId}/`,known=new Set(mappings.map(file=>file.targetPath));
    if(graph.files.some(file=>file.path.toLowerCase().startsWith(prefix.toLowerCase())&&!known.has(file.path)))return false;
  }
  return mappings.every(file => {const actual=files.get(file.targetPath);return actual?.sha256===file.sha256 && actual?.size===file.size;});
}
function packageHints(pkg,graph,budget) {
  const identity = pkg.identity ?? {}, evidence=[],types=new Set(identity.types??[]),assemblies=new Set(identity.assemblies??[]),namespaces=new Set(identity.namespaces??[]);
  let bytes=0,truncated=false;
  function observe(record) {
    const size=Buffer.byteLength(JSON.stringify(record));
    if(evidence.length>=20||bytes+size>64*1024||size>budget.bytes){truncated=true;if(size>budget.bytes)budget.exhausted=true;return false;}
    evidence.push(record);bytes+=size;budget.bytes-=size;
    if(evidence.length===20){truncated=true;return false;}return true;
  }
  if(budget.exhausted)return {evidence,truncated:true};
  scan: {
  for (const asset of graph.assets) {
    if (asset.script) {
      if (assemblies.has(asset.script.assembly)&&!observe({kind:'assembly-hint',path:asset.path,value:asset.script.assembly}))break scan;
      for (const type of asset.script.types ?? []) {
        const name = typeof type === 'string' ? type : type.fullName;
        if (types.has(name)){if(!observe({kind:'type-hint',path:asset.path,value:name}))break scan;}
        else if(namespaces.has(type.namespace)&&!observe({kind:'namespace-hint',path:asset.path,value:type.namespace}))break scan;
      }
    } else if (asset.path?.toLowerCase().endsWith('.dll') && [...assemblies].some(name=>`${name}.dll`.toLowerCase()===path.posix.basename(asset.path).toLowerCase())&&!observe({kind:'dll-name-hint',path:asset.path,value:path.posix.basename(asset.path)}))break scan;
  }
  for(const declaration of graph.libraryDeclarations?.types??[])if(types.has(declaration.fullName)&&!observe({kind:'type-hint',path:declaration.path,value:declaration.fullName}))break scan;
  }
  return {evidence,truncated};
}

export function identifyLibraries(graph,catalog,{requirements=graph.packageManifestRequirements??[]}={}) {
  assertInputs(graph,catalog);requirements=normalizeRequirements(requirements);
  const installed=[],candidates=[],budget={bytes:1024**2,exhausted:false};let hintsTruncated=false;
  for (const pkg of catalog.packages) {
    if (pkg.recognition==='confirmed' && exactInventory(pkg,graph)) installed.push(structuredClone(pkg));
    else {const hints=packageHints(pkg,graph,budget);hintsTruncated ||= hints.truncated;if(hints.evidence.length || requirements.some(record=>record.id===pkg.libraryId)) candidates.push({...structuredClone(pkg),evidence:[...(pkg.evidence??[]),...hints.evidence],hintEvidenceCount:hints.evidence.length,hintsTruncated:hints.truncated});}
  }
  return {kind:'retoolkit-library-identification',schemaVersion:1,graphRevision:graph.revision,catalogRevision:catalog.revision,requirements,installed,candidates,limitations:[...(catalog.limitations??[]),'Assembly, namespace and type hints do not authorize imports; installed status requires exact payload hashes.',...(hintsTruncated?['Hint observations were truncated to 20 records/64 KiB per package and 1 MiB aggregate; counts report retained observations only.']:[])]};
}

function pathIndex(files=[]) {
  const root={children:new Map(),file:false};
  function insert(file) {
    let node=root;for(const part of file.toLowerCase().split('/')){if(!node.children.has(part))node.children.set(part,{children:new Map(),file:false});node=node.children.get(part);}node.file=true;
  }
  function overlaps(file) {
    let node=root;for(const part of file.toLowerCase().split('/')) {if(node.file)return true;node=node.children.get(part);if(!node)return false;}return node.file || node.children.size>0;
  }
  for(const file of files)insert(file);
  return {insert,overlaps};
}
function collisionIssues(selected,graph,add) {
  const paths=pathIndex(),existingPaths=pathIndex(graph.files.map(file=>file.path)),guids=new Map(),types=new Map(),assemblies=new Map();
  const existingGuids=new Set(graph.assets.filter(asset=>asset.guid).map(asset=>asset.guid.toLowerCase())),existingTypes=new Set(),existingAssemblies=new Set();
  for(const asset of graph.assets) {
    for(const type of asset.script?.types??[])existingTypes.add(typeof type==='string'?type:type.fullName);
    if(asset.script?.assembly)existingAssemblies.add(asset.script.assembly.toLowerCase());
    if(asset.path?.toLowerCase().endsWith('.dll'))existingAssemblies.add(path.posix.basename(asset.path).slice(0,-4).toLowerCase());
  }
  for(const type of graph.libraryDeclarations?.types??[])existingTypes.add(type.fullName);
  for(const assembly of graph.libraryDeclarations?.assemblies??[])existingAssemblies.add(assembly.name.toLowerCase());
  for(const metadata of graph.libraryDeclarations?.guids??[])existingGuids.add(metadata.guid.toLowerCase());
  const provenInstalledSources=new Set();
  for(const pkg of selected)if(pkg.identity?.types?.length&&!(pkg.evidence??[]).some(record=>record.kind==='unsupported-source-declarations')&&exactInventory(pkg,graph))for(const file of packagePayloadMappings(pkg))if(file.targetPath.toLowerCase().endsWith('.cs'))provenInstalledSources.add(file.targetPath);
  const unknownExistingSource=graph.assets.some(asset=>(asset.kind==='script'||asset.path?.toLowerCase().endsWith('.cs'))&&(asset.script?.supported!==true||!Array.isArray(asset.script.types))) || Boolean(graph.libraryDeclarations?.unknownSources?.length) || (!graph.libraryDeclarations&&graph.files.some(file=>/^Packages\/.*\.cs$/i.test(file.path)&&!provenInstalledSources.has(file.path)));
  for (const pkg of selected) {
    const installed=exactInventory(pkg,graph);
    let mappings;try {mappings=packagePayloadMappings(pkg);} catch(error) {add(error.code,error.message,pkg.libraryId);continue;}
    const hasSource=mappings.some(file=>file.path.toLowerCase().endsWith('.cs'));
    if(!installed && hasSource) {
      if(!pkg.identity?.types?.length || (pkg.evidence??[]).some(record=>record.kind==='unsupported-source-declarations') || (pkg.limitations??[]).some(message=>/unsupported.*(?:source|declarations)|multiple C# namespace|source.*(?:unproven|unsupported|opaque)/i.test(message))) add('unknown_source_identity','Source declarations are not fully proven; automatic import cannot rule out duplicate implementations',pkg.libraryId);
      if(graph.assets.some(asset=>/\.(?:dll|winmd)$/i.test(asset.path??'')&&!asset.assembly?.types)) add('unknown_assembly_collision','Existing DLL type inventory is unknown; source replacement requires a separate migration',pkg.libraryId);
      if(graph.libraryDeclarations?.unknownAssemblies?.length)add('unknown_assembly_collision','Existing package assembly inventory is unknown; duplicate implementations cannot be ruled out',pkg.libraryId);
      if(unknownExistingSource)add('unknown_source_collision','Existing source declarations are unsupported or uninspected; duplicate implementations cannot be ruled out',pkg.libraryId);
    }
    if(mappings.some(file=>/\.(?:dll|winmd)$/i.test(file.path)) || (pkg.evidence??[]).some(record=>record.kind==='unsupported-managed-metadata'))add('unknown_assembly_identity','DLL managed type inventory is uninspected; duplicate implementations cannot be ruled out',pkg.libraryId);
    if((pkg.evidence??[]).some(record=>record.kind==='unsupported-assembly-definition'))add('unknown_assembly_definition','Assembly definitions are malformed or unsupported; compilation boundaries cannot be established',pkg.libraryId);
    if((pkg.evidence??[]).some(record=>record.kind==='unsupported-guid-inventory'))add('unknown_guid_inventory','Provided metadata GUID inventory is opaque or malformed; GUID collisions cannot be ruled out',pkg.libraryId);
    if(!installed&&pkg.guidInventory?.length&&(graph.libraryDeclarations?.unknownMetadata?.length||(!graph.libraryDeclarations&&graph.files.some(file=>/^Packages\/.*\.meta$/i.test(file.path)))))add('unknown_guid_collision','Existing package metadata is opaque or uninspected; provided GUID uniqueness cannot be established',pkg.libraryId);
    if(mappings.some(file=>{
      const relative=pkg.format==='upm'?file.targetPath.split('/').slice(2).join('/'):file.targetPath;
      return /\.(?:so(?:\.\d+)*|dylib|a|aar|jar|lib)$|\.(?:bundle|framework|xcframework)(?:\/|$)/i.test(relative);
    }) || (pkg.evidence??[]).some(record=>record.kind==='unsupported-native-plugin'))add('unsupported_native_plugin','Native plugin ABI and platform compatibility are uninspected',pkg.libraryId);
    for (const file of mappings) {
      if (paths.overlaps(file.targetPath) || (!installed && existingPaths.overlaps(file.targetPath))) add('path_collision',`Existing payload path ${file.targetPath}; replacement requires a separate migration`,pkg.libraryId);
      paths.insert(file.targetPath);
    }
    for (const record of pkg.guidInventory ?? []) {
      const guid=record.guid.toLowerCase();
      if (guids.has(guid) || (!installed && existingGuids.has(guid))) add('guid_collision',`GUID ${guid} already exists; replacement requires a separate migration`,pkg.libraryId);
      guids.set(guid,pkg.libraryId);
    }
    for (const type of pkg.identity?.types ?? []) {
      if (types.has(type) || (!installed && existingTypes.has(type))) add('type_collision',`Type ${type} already exists; stub replacement requires a separate migration`,pkg.libraryId);
      types.set(type,pkg.libraryId);
    }
    for (const assembly of pkg.identity?.assemblies ?? []) {
      const key=assembly.toLowerCase();
      if (assemblies.has(key) || (!installed && existingAssemblies.has(key))) add('assembly_collision',`Assembly ${assembly} already exists; DLL/source replacement requires a separate migration`,pkg.libraryId);
      assemblies.set(key,pkg.libraryId);
    }
  }
}

export function createLibraryPlan({graph,catalog,requirements=graph.packageManifestRequirements??[]}) {
  assertInputs(graph,catalog);requirements=normalizeRequirements(requirements);
  const issues=[],selected=[],constraints=new Map(),chosen=new Map(),visiting=new Set(),visited=new Set();
  const add=(code,message,libraryId)=>{if(!issues.some(issue=>issue.code===code&&issue.libraryId===libraryId&&issue.message===message))issues.push({code,message,...(libraryId?{libraryId}:{})});};
  if(catalog.state==='unconfigured')add('libraries_unconfigured','No library roots are configured');
  if(!requirements.length)add('no_explicit_requirements','Explicit versioned requirements are required; inferred hints cannot authorize import');
  function constrain(id,version) {
    if(!packageId.test(id)){add('unsupported_dependency','Invalid package dependency id',id);return false;}
    if(!constraints.has(id)&&constraints.size>=256){add('dependency_limit','Dependency closure exceeds 256 packages');return false;}
    const ranges=constraints.get(id)??new Set(),before=ranges.size;ranges.add(version);constraints.set(id,ranges);return ranges.size!==before;
  }
  function choose(id,ranges) {
    const matches=[];
    for(const range of ranges) {
      const matcher=typeof range==='string'?rangeMatcher(range):null;
      if(!matcher)return {code:'unsupported_version_range',message:`Unsupported version constraint ${range}`};
      matches.push(matcher);
    }
    const available=catalog.packages.filter(pkg=>pkg.libraryId===id);
    if(!available.length)return {code:'missing_library',message:'No catalog package matches the requirement'};
    const known=available.filter(pkg=>versionTuple(pkg.version));
    if(!known.length)return {code:'unknown_version',message:'Package version is unknown or unsupported'};
    const versions=known.filter(pkg=>matches.every(test=>test(pkg.version)));
    if(!versions.length)return {code:'version_conflict',message:'No catalog package satisfies all requested versions'};
    const confirmed=versions.filter(pkg=>pkg.recognition==='confirmed');
    if(!confirmed.length)return {code:'unconfirmed_library',message:'Package identity is not confirmed'};
    const compatible=confirmed.filter(pkg=>!compatibilityProblem(pkg,graph));
    if(!compatible.length)return {code:'incompatible_library',message:compatibilityProblem(confirmed[0],graph)};
    if(compatible.length!==1)return {code:'ambiguous_library',message:'Multiple compatible catalog packages match; latest is never selected'};
    return {pkg:compatible[0]};
  }
  for(const requirement of requirements)constrain(requirement.id,requirement.version);
  // Delay missing/ambiguous errors until all uniquely selected ancestors have
  // contributed their constraints. A later dependency may narrow an earlier
  // ambiguous range without ever authorizing a highest-version preference.
  let changed=true;
  while(changed) {
    changed=false;
    for(const [id,ranges]of constraints) {
      const result=choose(id,ranges);
      if(!result.pkg){chosen.delete(id);continue;}
      const pkg=result.pkg;chosen.set(id,pkg);
      if(!plain(pkg.dependencies))continue;
      for(const [dependency,range]of Object.entries(pkg.dependencies).sort(([a],[b])=>a.localeCompare(b)))if(constrain(dependency,range))changed=true;
    }
  }
  for(const [id,ranges]of [...constraints].sort(([a],[b])=>a.localeCompare(b))) {
    const result=choose(id,ranges);if(!result.pkg)add(result.code,result.message,id);
    else if(!plain(result.pkg.dependencies))add('unsupported_dependency','Package dependencies are unproven',id);
  }
  function visit(id) {
    if(visiting.has(id)){add('dependency_cycle','Dependency graph contains a cycle',id);return;}
    if(visited.has(id)||!chosen.has(id))return;
    const pkg=chosen.get(id);visiting.add(id);
    if(plain(pkg.dependencies))for(const dependency of Object.keys(pkg.dependencies).sort())visit(dependency);
    visiting.delete(id);visited.add(id);selected.push(structuredClone(pkg));
  }
  for(const requirement of requirements)visit(requirement.id);
  collisionIssues(selected,graph,add);
  const plan={kind:'retoolkit-library-plan',schemaVersion:1,operationId:randomUUID(),graphRevision:graph.revision,binding:structuredClone(graph.binding),catalogRevision:catalog.revision,
    state:issues.length?'blocked':selected.every(pkg=>exactInventory(pkg,graph))?'satisfied':'ready',selected,requirements,issues,compileReady:false,bindingsVerified:false,uiVerified:false};
  return {...plan,payloadSha256:fingerprint(plan)};
}

export function validateLibraryPlan(plan,graph,catalog) {
  if(!plain(plan) || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(plan.operationId??''))fail('library_plan_invalid','Invalid plan operation id');
  const {payloadSha256,...payload}=plan;
  if(payloadSha256!==fingerprint(payload))fail('library_plan_invalid','Plan payload hash mismatch');
  if(plan.graphRevision!==graph.revision || plan.catalogRevision!==catalog.revision || fingerprint(plan.binding)!==fingerprint(graph.binding))fail('stale_library_plan','Plan graph, binding or catalog changed');
  let expected;try {expected=createLibraryPlan({graph,catalog,requirements:plan.requirements});} catch(error) {fail('library_plan_invalid',error.message);}
  const {operationId:actualId,...actualIntent}=payload;
  const {operationId:expectedId,payloadSha256:expectedHash,...expectedIntent}=expected;
  if(fingerprint(actualIntent)!==fingerprint(expectedIntent))fail('library_plan_invalid','Plan differs from recomputed semantic intent');
  return true;
}
