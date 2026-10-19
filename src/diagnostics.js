import fs from 'node:fs';
import path from 'node:path';
import {fileIdentity,reusable} from './state.js';
import {stepFingerprint,within} from './inputs.js';
import {sessionStatus} from './ghidra/provider.js';
import {probeMcp as defaultProbeMcp} from './mcp-probe.js';

const exists=file=>typeof file==='string'&&fs.existsSync(file);
const properties=file=>{
  if(!exists(file))return {};
  return Object.fromEntries(fs.readFileSync(file,'utf8').split(/\r?\n/).map(line=>line.match(/^([^#!\s=]+)\s*=\s*(.*)$/)).filter(Boolean).map(match=>[match[1],match[2].trim()]));
};
function extensionFacts(toolkit,extraPaths) {
  const app=properties(path.join(toolkit.tools.ghidra,'Ghidra/application.properties'));
  const version=app['application.version']??'unknown';
  const user=process.env.APPDATA?path.join(process.env.APPDATA,'ghidra',`ghidra_${version}_${app['application.release.name']??'PUBLIC'}/Extensions/GhidraMCP`):null;
  const candidates=extraPaths??[path.join(toolkit.root,'tools/ghidra-mcp/extension/GhidraMCP'),path.join(toolkit.tools.ghidra,'Ghidra/Extensions/GhidraMCP'),user];
  const found=candidates.filter(Boolean).filter(directory=>exists(path.join(directory,'extension.properties'))&&exists(path.join(directory,'Module.manifest'))).map(directory=>{
    const metadata=properties(path.join(directory,'extension.properties'));
    return {path:directory,ghidraVersion:metadata.version??'unknown',pluginVersion:metadata.description?.match(/Plugin version ([\d.]+)\.?/)?.[1]?.replace(/\.$/,'')??'unknown'};
  });
  // The extension version property is the Ghidra compatibility version, not the
  // bridge/plugin release. Keep these separate and do not invent a version pin.
  const bridgeDir=path.dirname(path.dirname(toolkit.tools.bridge));
  let bridgeVersion='unknown';
  const site=path.join(bridgeDir,'Lib/site-packages');
  if(exists(site)){
    const metadata=fs.readdirSync(site).filter(name=>/^ghidra_mcp.*\.dist-info$/i.test(name));
    if(metadata.length===1)bridgeVersion=fs.readFileSync(path.join(site,metadata[0],'METADATA'),'utf8').match(/^Version:\s*(.+)$/m)?.[1]?.trim()??'unknown';
  }
  return {ghidraVersion:version,bridgeVersion,extensions:found};
}
function locks(directory,depth=0){
  if(!exists(directory))return [];
  if(depth>24)throw Error('Project tree exceeds inspection depth');
  const result=[];
  for(const item of fs.readdirSync(directory,{withFileTypes:true})){
    const file=path.join(directory,item.name);if(/\.lock$|\.dbDirLock$/i.test(item.name))result.push(file);
    else if(item.isSymbolicLink())throw Error('Linked project tree is unsupported');
    else if(item.isDirectory())result.push(...locks(file,depth+1));
  }
  return result;
}
function covers(step,file){
  const target=path.resolve(file);
  return step?.outputs?.some(root=>root.type==='file'?path.resolve(root.path)===target:root.files.some(entry=>path.resolve(root.path,entry.path)===target));
}
function outputEvidence(toolkit,name,project,step,fp){
  if(!reusable(project,step,fp))return false;
  const workspace=toolkit.workspace(name);
  if(step==='dump')return ['dump.cs','script.json'].every(filename=>{
    const file=path.join(project.il2cppDumperOutput,filename);
    return within(file,workspace)&&exists(file)&&fs.statSync(file).size>0&&covers(project.steps.dump,file);
  });
  if(step==='import'){
    const receiptPath=path.join(workspace,'04_Notes/import-receipt.json');
    if(!within(project.ghidraProjectDir,workspace)||!['.gpr','.rep'].every(extension=>exists(path.join(project.ghidraProjectDir,project.ghidraProjectName+extension)))||!covers(project.steps.import,receiptPath))return false;
    const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
    return receipt.fingerprint===fp&&receipt.project===project.ghidraProjectName&&receipt.program===project.ghidraProgramName&&receipt.native?.sha256===project.identities.native.sha256&&receipt.native?.size===project.identities.native.size&&receipt.attestation?.sha256===project.identities.native.sha256&&receipt.attestation?.program===project.ghidraProgramName;
  }
  return true;
}

export async function diagnose(toolkit,{name,task='prepare',probe=false,getSessionStatus=sessionStatus,probeMcp=defaultProbeMcp,extensionPaths,timeoutMs}={}){
  if(!['prepare','headless','mcp','assetripper'].includes(task))throw Error('Unknown diagnostic task');
  const checks=Object.fromEntries(Object.entries(toolkit.tools).map(([key,value])=>[key,{path:value,exists:exists(value)}]));
  const tasks=Object.fromEntries(['prepare','headless','mcp','assetripper','analysis','symbols'].map(key=>[key,{state:'unknown',diagnosticIds:[]}]));
  const diagnostics=[];
  const add=(id,code,status,message,action,evidence={},affected=[])=>{
    diagnostics.push({id,code,status,message,action,evidence});for(const key of affected)tasks[key].diagnosticIds.push(id);
  };
  const toolsFor={prepare:['dumper','java','headless','ghidra'],headless:['java','headless','ghidra'],mcp:['bridge'],assetripper:['assetripper']};
  for(const [key,check]of Object.entries(checks)){
    const affected=Object.keys(toolsFor).filter(task=>toolsFor[task].includes(key));
    add('tool.'+key,check.exists?'TOOL_AVAILABLE':key==='java'?'JAVA_RUNTIME_MISSING':key==='bridge'?'MCP_BRIDGE_MISSING':key==='assetripper'?'ASSETRIPPER_MISSING':key==='python'?'PYTHON_RUNTIME_MISSING':'TOOL_MISSING',check.exists?'available':'blocked',`${key}: ${check.exists?'available on disk; execution not verified':'not found'}`,check.exists?null:`Install or configure ${key}.`,{path:check.path},affected);
  }
  for(const [key,required]of Object.entries(toolsFor))if(required.some(tool=>!checks[tool]?.exists))tasks[key].state='blocked';
  const bridgePython=path.join(path.dirname(toolkit.tools.bridge),'python.exe');
  if(!exists(bridgePython)&&!checks.python?.exists){tasks.mcp.state='blocked';add('mcp.python','MCP_RUNTIME_MISSING','blocked','No configured Python runtime is available for the MCP bridge.','Install the toolkit MCP bridge virtual environment.',{},['mcp']);}
  let facts;
  try {facts=extensionFacts(toolkit,extensionPaths);}
  catch {facts={ghidraVersion:'unknown',bridgeVersion:'unknown',extensions:[]};}
  if(!facts.extensions.length){tasks.mcp.state='blocked';add('mcp.extension','MCP_EXTENSION_MISSING','blocked','No installed GhidraMCP extension was found in the configured install locations.','Install the matching GhidraMCP extension and enable its server in Ghidra.',facts,['mcp']);}
  else {
    add('mcp.extension','MCP_EXTENSION_AVAILABLE','available','GhidraMCP extension files are available; plugin activation remains unverified.',null,facts,['mcp']);
    if(facts.ghidraVersion!=='unknown'&&facts.extensions.every(extension=>extension.ghidraVersion!=='unknown'&&extension.ghidraVersion!==facts.ghidraVersion)){
      tasks.mcp.state='blocked';add('mcp.compatibility','MCP_EXTENSION_VERSION_MISMATCH','blocked','Observed extension compatibility version differs from installed Ghidra.','Install an extension built for the installed Ghidra version.',facts,['mcp']);
    }
    if(facts.bridgeVersion!=='unknown'&&facts.extensions.every(extension=>extension.pluginVersion!=='unknown'&&extension.pluginVersion!==facts.bridgeVersion)){
      tasks.mcp.state='blocked';add('mcp.release','MCP_BRIDGE_EXTENSION_VERSION_MISMATCH','blocked','Observed MCP bridge and extension releases differ.','Install matching bridge and extension releases.',facts,['mcp']);
    }
  }
  let project,inputsValid=false;
  if(name){
    try{project=toolkit.read(name);}
    catch{add('workspace','WORKSPACE_UNREADABLE','blocked','The workspace project could not be read.','Check the workspace name and project.re.json.',{},['prepare','headless']);tasks.prepare.state=tasks.headless.state='blocked';}
  }
  if(project){
    inputsValid=true;
    for(const [kind,field]of [['native','nativeBinary'],['metadata','metadata']]){
      let actual;try{actual=fileIdentity(project[field]);}catch{}
      const expected=project.identities?.[kind];const valid=Boolean(actual&&expected&&actual.sha256===expected.sha256&&actual.size===expected.size);
      if(!valid)inputsValid=false;
      add('input.'+kind,valid?`${kind.toUpperCase()}_INPUT_VERIFIED`:actual?`${kind.toUpperCase()}_INPUT_STALE`:`${kind.toUpperCase()}_INPUT_MISSING`,valid?'ready':'blocked',`${kind} ${valid?'hash and size match the recorded build':'input lacks matching content evidence'}`,valid?null:'Scan the selected build and prepare its dependent outputs again.',{expected:expected?{sha256:expected.sha256,size:expected.size}:null,actual:actual?{sha256:actual.sha256,size:actual.size}:null},['prepare','headless']);
    }
    let prepared=inputsValid;
    for(const step of ['dump','import','analyze','symbols']){
      let valid=false;try{valid=inputsValid&&outputEvidence(toolkit,name,project,step,stepFingerprint(project,step,toolkit.tools,toolkit.root));}catch{}
      const key=step==='analyze'?'analysis':step;
      const affected=['dump','import'].includes(step)?['prepare']:[key];
      const state=valid?'ready':['dump','import'].includes(step)?'blocked':'unknown';
      add('step.'+step,valid?`${step.toUpperCase()}_EVIDENCE_VERIFIED`:`${step.toUpperCase()}_EVIDENCE_${['dump','import'].includes(step)?'STALE':'UNVERIFIED'}`,state,`${step}: ${valid?'fingerprint and output manifest verified':'current fingerprint and outputs are not verified'}`,valid?null:`Verify ${step} for the selected build.`,{recordedState:project.steps?.[step]?.state??'unknown'},affected);
      if(['dump','import'].includes(step))prepared&&=valid;else tasks[key].state=state;
    }
    if(tasks.prepare.state!=='blocked')tasks.prepare.state=prepared?'ready':'blocked';
    if(exists(path.join(toolkit.workspace(name),'.retk-lock'))){
      tasks.prepare.state='blocked';
      add('workspace.busy','WORKSPACE_BUSY','blocked','A workspace lease marker is present; output preparation must wait for its owner.','Wait for its operation, or stop the owning native session; inspect ambiguous ownership without deleting the lock.',{},['prepare']);
    }
    if(!inputsValid)tasks.headless.state='blocked';
    let session;
    try{session=await getSessionStatus(toolkit,name);}catch{add('native.session','NATIVE_SESSION_UNAVAILABLE','unknown','Native session health could not be observed.','Inspect session status; stop the session before changing its build.',{},['headless']);}
    const live=session?.live;const identity=live?.programIdentity;
    const active=session?.state&&!['stopped','failed'].includes(session.state);
    const healthy=session?.state==='ready'&&!session.bindingError&&!session.liveError&&live?.ok===true&&live?.runId===session.runId&&live?.result?.state==='ready';
    const matches=identity?.projectName===project.ghidraProjectName&&identity?.program===project.ghidraProgramName&&identity?.sha256===project.identities?.native?.sha256;
    if(active){
      const mismatched=identity&&[['projectName',project.ghidraProjectName],['program',project.ghidraProgramName],['sha256',project.identities?.native?.sha256]].some(([key,value])=>typeof identity[key]==='string'&&identity[key]!==value);
      const status=healthy&&matches&&inputsValid?'ready':mismatched||session.bindingError?'blocked':'unknown';
      add('native.binding',status==='ready'?'NATIVE_SESSION_VERIFIED':status==='blocked'?'NATIVE_PROGRAM_MISMATCH':'NATIVE_SESSION_UNVERIFIED',status,status==='ready'?'Live native session has the exact project, Program and native hash binding.':'Native session identity or health is not verified.','Inspect session status; stop the session before selecting or preparing another build.',{state:session.state,program:identity?.program??null,project:identity?.projectName??null,sha256:identity?.sha256??null},['headless']);
      if(tasks.headless.state!=='blocked')tasks.headless.state=status;
    }else add('native.session','NATIVE_SESSION_NOT_RUNNING','unknown','No healthy native session has been observed.','Start an explicit native session after preparing the selected Program.',{},['headless']);
    // The healthy native engine itself owns project/lease locks. Do not call
    // these GUI locks or block its read-only queries.
    if(!(healthy&&matches&&inputsValid))try{
      const found=locks(project.ghidraProjectDir);
      if(found.length){tasks.headless.state='blocked';add('project.lock','GHIDRA_PROJECT_LOCKED','blocked','Ghidra project lock is present.','Save and close the owning GUI project, or stop its native session; never delete the lock.',{paths:found},['headless']);}
    }catch{tasks.headless.state='blocked';add('project.lock','GHIDRA_PROJECT_INSPECTION_FAILED','blocked','Ghidra project locks could not be safely inspected.','Inspect the project tree and close its owner before headless use.',{},['headless']);}
  }else if(!name){
    if(tasks.prepare.state!=='blocked')tasks.prepare.state='available';
    add('workspace','WORKSPACE_UNSELECTED','unknown','No workspace was selected; prepared outputs and Program identity are unknown.','Pass a workspace name to inspect build evidence.',{},['prepare','headless']);
  }
  if(tasks.assetripper.state!=='blocked')tasks.assetripper.state='available';
  if(probe){
    let observed;try{observed=await probeMcp(toolkit,{project:project?.ghidraProjectName,program:project?.ghidraProgramName,nativeSha256:project?.identities?.native?.sha256,timeoutMs});}
    catch{observed={code:'MCP_PROBE_FAILED',state:'unknown',message:'The explicit MCP probe failed.',evidence:{}};}
    add('mcp.probe',observed.code,observed.state,observed.message,'Open the exact project and Program, enable the GhidraMCP server, then verify identity.',observed.evidence??{},['mcp']);
    if(tasks.mcp.state!=='blocked')tasks.mcp.state=observed.state;
  }else add('mcp.probe','MCP_PROBE_NOT_REQUESTED','unknown','MCP transport and GUI Program identity were not probed.','Use doctor --task mcp --probe for explicit bounded discovery.',{},['mcp']);
  return {schemaVersion:1,task,name:name??null,ok:tasks[task].state==='ready',readiness:tasks[task].state,checks,tasks,diagnostics,limitations:['Tool file presence establishes availability only; execution and engine readiness require separate evidence.','Prepared does not imply verified analysis, symbols, or MCP Program identity.','Local version facts may be unknown; no unobserved release compatibility is asserted.']};
}

export function formatDiagnostics(report){
  return [`${report.name??'Toolkit'}: ${report.task} ${report.readiness}`,...report.diagnostics.map(item=>`[${item.status}] ${item.code}: ${item.message}${item.action?`\n  Action: ${item.action}`:''}`),...report.limitations.map(item=>`Limit: ${item}`)].join('\n');
}
