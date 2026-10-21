import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { initializeState, syncLegacyStatus, fileIdentity, fingerprint, outputManifest, validManifest, setStep, invalidateSteps, reusable, recoverSteps, withWorkspaceLock,ownsWorkspaceLock } from './state.js';
import { candidates, selectInputs, updateIdentity, stepFingerprint, optionalIdentity, within, walk } from './inputs.js';
import { extractBuild, exportWorkspace } from './archive.js';
import { runProcess } from './process.js';
import { restoreWorkspace } from './workspace-archive.js';
import { activeSession,assertNoSession } from './ghidra/runtime.js';
import { sessionStatus } from './ghidra/provider.js';
import {acquireToolchainRead} from './toolchain/lease.js';
import {inspectManagedPython} from './python-runtime/verify.js';
import {createAdbClient,resolveAdbPath,validatePackageName,validateSerial} from './adb/client.js';
import {captureBundle} from './adb/capture.js';
import {parseAdbArgs} from './adb/options.js';
import {rejectOutputLinks} from './artifacts.js';
import {startDesktopLauncher} from './desktop-launch/index.js';
import {inspectDesktopRuntime,verifyDesktopRuntime,desktopRuntimeEnvironment} from './desktop-runtime/index.js';

const directories = ['00_OriginalBuild','01_Extracted','02_Il2CppDumperOutput','03_GhidraProject','04_Notes','05_ReconstructedSource'];
const id = () => `${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID()}`;
const json = file => JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file),{recursive:true}); const temporary = `${file}.tmp-${crypto.randomUUID()}`;
  try { fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'}); fs.renameSync(temporary,file); }
  finally { fs.rmSync(temporary,{force:true}); }
}
function publish(stage,destination) {
  const previous = `${destination}.previous-${id()}`; const existed = fs.existsSync(destination);
  if(existed) fs.renameSync(destination,previous);
  try { fs.renameSync(stage,destination); }
  catch(error) { if(existed&&!fs.existsSync(destination)) fs.renameSync(previous,destination); throw error; }
  return existed ? previous : null;
}

export function createToolkit(root, dependencies = {}) {
  root = path.resolve(root); const workspaces = path.join(root,'workspaces');
  const log = dependencies.log ?? console.log; const run = dependencies.run ?? runProcess;
  const javaBase = path.join(root,'runtime/java');
  const jdk = fs.existsSync(path.join(javaBase,'jdk-21/bin/java.exe')) ? 'jdk-21' :
    (fs.existsSync(javaBase) ? fs.readdirSync(javaBase).filter(name=>/^jdk-/.test(name)&&fs.existsSync(path.join(javaBase,name,'bin/java.exe'))).sort().at(-1) : null) ?? 'jdk-21';
  const tools = {
    dumper:path.join(root,'tools/Il2CppDumper/Il2CppDumper.exe'),
    ghidra:path.join(root,'tools/ghidra'), headless:path.join(root,'tools/ghidra/support/analyzeHeadless.bat'),
    java:path.join(javaBase,jdk,'bin/java.exe'), jdk:path.join(javaBase,jdk),
    python:path.join(root,'runtime/python/python-3.12/python.exe'),
    pyghidra:path.join(root,'runtime/python/pyghidra-venv/Scripts/python.exe'),
    bridge:path.join(root,'tools/ghidra-mcp/.venv/Scripts/bridge-mcp-ghidra.exe'),
    assetripper:path.join(root,'tools/AssetRipper/AssetRipper.exe'),
  };
  const env = {...process.env,JAVA_HOME:tools.jdk,JAVA_HOME_OVERRIDE:tools.jdk,GHIDRA_INSTALL_DIR:tools.ghidra,
    PYGHIDRA_PYTHON:tools.pyghidra,PATH:`${path.join(tools.jdk,'bin')}${path.delimiter}${process.env.PATH??''}`};
  const legacyBridge=tools.bridge;
  Object.defineProperty(tools,'bridge',{enumerable:true,get(){const selected=inspectManagedPython(root);return selected.state==='selected'?selected.python:legacyBridge;}});
  function workspace(name) {
    if(!/^[A-Za-z0-9_.-]{1,64}$/.test(name)||name.endsWith('.')||['.','..'].includes(name)||/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) throw new Error('Invalid workspace name');
    const directory = path.join(workspaces,name);
    if(!within(directory,workspaces)) throw new Error('Workspace must stay inside workspaces');
    if(fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink()) throw new Error('Workspace links/junctions are unsupported');
    return directory;
  }
  const projectPath = name => path.join(workspace(name),'project.re.json');
  function fresh(name) { return initializeState({ name, platform:null,extractedPath:null,nativeBinary:null,metadata:null,
    il2cppDumperOutput:path.join(workspace(name),'02_Il2CppDumperOutput'),
    ghidraProjectDir:path.join(workspace(name),'03_GhidraProject'),ghidraProjectName:name,ghidraProgramName:null,
    reconstructedSourceDir:path.join(workspace(name),'05_ReconstructedSource'),status:{} }); }
  function read(name) { return initializeState(json(projectPath(name))); }
  function saveNow(name,project) {
    const file = projectPath(name);
    if(fs.existsSync(file)) { const old=json(file); if(!old.schemaVersion||old.schemaVersion<2) fs.copyFileSync(file,`${file}.bak.${id()}`,fs.constants.COPYFILE_EXCL); }
    initializeState(project); syncLegacyStatus(project); atomicJson(file,project);
  }
  const locked = async(name,action) => {
    const directory=workspace(name);
    const toolLease=acquireToolchainRead(root);
    try{if(fs.existsSync(directory)&&!ownsWorkspaceLock(directory))assertNoSession({root,workspace},name);return await withWorkspaceLock(directory,action);}
    finally{toolLease.release();}
  };
  function engineOptions(name,logFile) {
    const appdata=path.join(workspace(name),'04_Notes','.engine-runtime','appdata');
    const local=path.join(workspace(name),'04_Notes','.engine-runtime','local');
    fs.mkdirSync(appdata,{recursive:true}); fs.mkdirSync(local,{recursive:true});
    return {cwd:root,env:{...env,APPDATA:appdata,LOCALAPPDATA:local},logFile,leaseDirectory:path.join(workspace(name),'.retk-lock'),toolchainRoot:root};
  }
  async function save(name,project) { return locked(name,()=>saveNow(name,project)); }
  async function init(name) { return locked(name,()=>{
    for(const directory of directories) fs.mkdirSync(path.join(workspace(name),directory),{recursive:true});
    if(!fs.existsSync(projectPath(name))) saveNow(name,fresh(name));
    return read(name);
  }); }
  function refresh(project) {
    recoverSteps(project); updateIdentity(project);
    const dependents={dump:['dump','symbols','notes'],import:['import','analyze','symbols'],analyze:['analyze'],symbols:['symbols']};
    for(const name of ['dump','import','analyze','symbols']) {
      const step=project.steps[name];
      if(step.state==='succeeded'&&(step.fingerprint!==stepFingerprint(project,name,tools,root)||!validManifest(step.outputs))) invalidateSteps(project,dependents[name]);
    }
  }
  async function scan(name,source,options={}) { return locked(name,async()=>{
    await init(name); const project=read(name); selectInputs(project,source,options); saveNow(name,project);
    log(`Selected ${project.platform}: ${project.nativeBinary}\nMetadata: ${project.metadata}\nPair compatibility is not independently verified.`);
    return project;
  }); }
  async function status(name) {
    if(activeSession({root,workspace},name))return {...read(name),session:await sessionStatus({root,workspace,read},name)};
    return locked(name,()=>{
    const project=read(name);
    if(project.nativeBinary&&project.metadata) {
      try { refresh(project); }
      catch(error) { invalidateSteps(project,['scan','dump','import','analyze','symbols','notes']); project.inputError=error.message; }
    }
    saveNow(name,project); return project;
  }); }
  async function add(name,source,options={}) { return locked(name,async()=>{
    source=path.resolve(source); if(fs.statSync(source).isDirectory()) return scan(name,source,options);
    await init(name); let project=read(name); recoverSteps(project);
    const archive=fileIdentity(source); const fp=fingerprint({archive:archive.sha256,extractor:1});
    const destination=path.join(workspace(name),'01_Extracted');
    const selection={binary:options.binary??project.selection?.binary,metadata:options.metadata??project.selection?.metadata};
    if(reusable(project,'extract',fp)) { project.identities.archive=archive; saveNow(name,project); return scan(name,destination,selection); }
    const stage=path.join(workspace(name),`.extract-${id()}`); fs.mkdirSync(stage);
    setStep(project,'extract','running',fp); saveNow(name,project);
    try {
      const result=await extractBuild(source,stage); for(const warning of result.warnings??[]) log(warning);
      // Validate candidate selection before publishing. Ambiguous stages remain
      // available for explicit folder selection; previous extraction is retained.
      selectInputs(project,stage,selection);
      if(fileIdentity(source).sha256!==archive.sha256) throw new Error('Archive changed during extraction');
      publish(stage,destination);
      selectInputs(project,destination,{binary:project.selection.binary,metadata:project.selection.metadata});
      project.identities.archive=archive;
      setStep(project,'extract','succeeded',fp,outputManifest([destination])); saveNow(name,project);
      return project;
    } catch(error) {
      project=read(name); setStep(project,'extract','failed',fp,[],`${error.message}; staging: ${stage}`); saveNow(name,project);
      throw new Error(`${error.message}\nExtracted staging (if available): ${stage}`);
    }
  }); }
  async function dump(name) { return locked(name,async()=>{
    let project=read(name); if(!project.nativeBinary||!project.metadata) throw new Error('Scan inputs before dump');
    refresh(project); const fp=stepFingerprint(project,'dump',tools,root);
    if(reusable(project,'dump',fp)) {
      if(syncTemplates(project,project.il2cppDumperOutput)) {
        setStep(project,'dump','succeeded',fp,outputManifest([project.il2cppDumperOutput]));
        setStep(project,'symbols','awaiting-user',stepFingerprint(project,'symbols',tools,root));
      }
      saveNow(name,project); log('Skip dump: fingerprint and output verified'); return project;
    }
    const stage=path.join(workspace(name),`.dump-${id()}`); fs.mkdirSync(stage);
    setStep(project,'dump','running',fp); saveNow(name,project);
    const logFile=path.join(workspace(name),'04_Notes',`dump-${project.steps.dump.runId}.log`);
    try {
      const config=path.join(path.dirname(tools.dumper),'config.json');
      if(fs.existsSync(config)) {
        const cfg=json(config); const text=JSON.stringify({...cfg,RequireAnyKey:false,GenerateScript:true},null,2);
        if(cfg.RequireAnyKey!==false||cfg.GenerateScript!==true) { fs.copyFileSync(config,`${config}.bak.${id()}`); atomicJson(config,JSON.parse(text)); }
      }
      const desktop=inspectDesktopRuntime(root);let dumpEnv=env;
      if(desktop.state==='invalid')throw Object.assign(new Error(desktop.error.message),{code:desktop.error.code});
      if(desktop.state==='selected'){const verified=await verifyDesktopRuntime(root);if(!verified.ok)throw Object.assign(new Error('Desktop runtime changed; verify or repair it before dumping'),{code:'DESKTOP_PROFILE_INVALID'});dumpEnv=desktopRuntimeEnvironment(verified.profile,env);}
      await run(tools.dumper,[project.nativeBinary,project.metadata,stage],{cwd:stage,env:dumpEnv,logFile,leaseDirectory:path.join(workspace(name),'.retk-lock'),toolchainRoot:root});
      for(const file of ['dump.cs','script.json']) {
        if(!fs.existsSync(path.join(stage,file))||fs.statSync(path.join(stage,file)).size===0) throw new Error(`Il2CppDumper did not produce ${file}`);
      }
      syncTemplates(project,stage);
      if(stepFingerprint(project,'dump',tools,root)!==fp) throw new Error('Inputs or tool configuration changed during dump; staged output was not published');
      publish(stage,project.il2cppDumperOutput);
      project.tools={...project.tools,dumper:optionalIdentity(tools.dumper)};
      setStep(project,'dump','succeeded',fp,outputManifest([project.il2cppDumperOutput]));
      if(project.steps.symbols.state==='pending') setStep(project,'symbols','awaiting-user',stepFingerprint(project,'symbols',tools,root));
      saveNow(name,project); return project;
    } catch(error) { project=read(name); setStep(project,'dump','failed',fp,[],`${error.message}; log: ${logFile}; stage: ${stage}`); saveNow(name,project); throw error; }
  }); }
  function syncTemplates(project,destination) {
    let changed=false;
    for(const file of ['ghidra.py','ghidra_with_struct.py']) {
      const template=path.join(root,'templates/Il2CppDumper',file); const output=path.join(destination,file);
      if(fs.existsSync(template)&&(!fs.existsSync(output)||fileIdentity(template).sha256!==fileIdentity(output).sha256)) {
        const staged=`${output}.tmp-${crypto.randomUUID()}`; fs.copyFileSync(template,staged); fs.renameSync(staged,output); changed=true;
      }
    }
    return changed;
  }
  const databaseExists = project => fs.existsSync(path.join(project.ghidraProjectDir,`${project.ghidraProjectName}.gpr`)) || fs.existsSync(path.join(project.ghidraProjectDir,`${project.ghidraProjectName}.rep`));
  function importReusable(project,fp) {
    return reusable(project,'import',fp)&&fs.existsSync(path.join(project.ghidraProjectDir,`${project.ghidraProjectName}.gpr`))&&fs.existsSync(path.join(project.ghidraProjectDir,`${project.ghidraProjectName}.rep`));
  }
  function receiptArguments(project,receipt) {
    return ['-scriptPath',path.join(root,'scripts/ghidra'),'-postScript','RetkProgramReceipt.java',receipt,project.identities.native.sha256,project.ghidraProgramName];
  }
  function checkAttestation(project,receipt) {
    if(!fs.existsSync(receipt)) throw new Error('Ghidra did not produce a program attestation receipt');
    const result=json(receipt);
    if(result.sha256!==project.identities.native.sha256||result.program!==project.ghidraProgramName) throw new Error('Ghidra program attestation does not match selected input');
    return result;
  }
  async function importProgram(name,{reimport=false}={}) { return locked(name,async()=>{
    let project=read(name); refresh(project); const fp=stepFingerprint(project,'import',tools,root);
    if(!reimport&&importReusable(project,fp)) {
      const receipt=path.join(workspace(name),'04_Notes',`verify-${id()}.json`);
      try {
        await run(tools.headless,[project.ghidraProjectDir,project.ghidraProjectName,'-process',project.ghidraProgramName,'-noanalysis','-readOnly',...receiptArguments(project,receipt)],
          engineOptions(name,receipt+'.log'));
        checkAttestation(project,receipt);
        if(stepFingerprint(project,'import',tools,root)!==fp) throw new Error('Native input or Ghidra tool changed during read-only verification');
        saveNow(name,project); log('Skip import: read-only Ghidra program identity verified'); return project;
      } catch(error) { invalidateSteps(project,['analyze','symbols']); setStep(project,'import','unknown',fp,project.steps.import.outputs,`Read-only program verification failed: ${error.message}. Close the owning GUI for headless verification, or inspect via its MCP server.`); saveNow(name,project); throw error; }
    }
    if(databaseExists(project)&&!reimport) { saveNow(name,project); throw new Error('Existing Ghidra project is protected. Use a new workspace or --reimport to back up and explicitly overwrite.'); }
    if(databaseExists(project)) {
      const locks=walk(project.ghidraProjectDir).filter(file=>/\.lock$|\.dbDirLock$/i.test(file));
      if(locks.length) throw new Error(`Ghidra project lock detected; save/close the GUI or use its MCP server: ${locks.join(', ')}`);
      const backup=path.join(workspace(name),'backups',`ghidra-${id()}`);
      fs.cpSync(project.ghidraProjectDir,backup,{recursive:true,errorOnExist:true,force:false});
      log(`Ghidra backup: ${backup}`);
    }
    fs.mkdirSync(project.ghidraProjectDir,{recursive:true});
    const args=[project.ghidraProjectDir,project.ghidraProjectName,'-import',project.nativeBinary];
    const attestation=path.join(workspace(name),'04_Notes',`program-${id()}.json`);
    if(reimport) args.push('-overwrite'); args.push('-noanalysis',...receiptArguments(project,attestation));
    invalidateSteps(project,['analyze','symbols']);
    setStep(project,'import','running',fp); saveNow(name,project);
    const logFile=path.join(workspace(name),'04_Notes',`import-${project.steps.import.runId}.log`);
    try {
      await run(tools.headless,args,engineOptions(name,logFile));
      if(!fs.existsSync(path.join(project.ghidraProjectDir,`${project.ghidraProjectName}.gpr`))||!fs.existsSync(path.join(project.ghidraProjectDir,`${project.ghidraProjectName}.rep`))) throw new Error('Ghidra exited without the expected project files');
      if(stepFingerprint(project,'import',tools,root)!==fp) throw new Error('Native input or Ghidra tool changed during import');
      checkAttestation(project,attestation);
      const receipt=path.join(workspace(name),'04_Notes','import-receipt.json');
      atomicJson(receipt,{fingerprint:fp,native:project.identities.native,project:project.ghidraProjectName,program:project.ghidraProgramName,attestation:checkAttestation(project,attestation),log:logFile});
      project.tools={...project.tools,ghidra:optionalIdentity(path.join(tools.ghidra,'Ghidra/application.properties')),java:optionalIdentity(tools.java)};
      setStep(project,'import','succeeded',fp,outputManifest([receipt]));
      setStep(project,'analyze','awaiting-user',stepFingerprint(project,'analyze',tools,root));
      setStep(project,'symbols','awaiting-user',stepFingerprint(project,'symbols',tools,root));
      saveNow(name,project); return project;
    } catch(error) { project=read(name); setStep(project,'import','failed',fp,[],`${error.message}; log: ${logFile}`); saveNow(name,project); throw error; }
  }); }
  async function analyze(name) { return locked(name,async()=>{
    let project=read(name); refresh(project);
    if(!importReusable(project,stepFingerprint(project,'import',tools,root))) throw new Error('A verified import is required before headless analysis; use GUI/MCP for legacy projects');
    const fp=stepFingerprint(project,'analyze',tools,root); setStep(project,'analyze','running',fp); saveNow(name,project);
    const logFile=path.join(workspace(name),'04_Notes',`analyze-${project.steps.analyze.runId}.log`);
    const attestation=path.join(workspace(name),'04_Notes',`analysis-program-${id()}.json`);
    try {
      await run(tools.headless,[project.ghidraProjectDir,project.ghidraProjectName,'-process',project.ghidraProgramName,...receiptArguments(project,attestation)],engineOptions(name,logFile));
      if(stepFingerprint(project,'analyze',tools,root)!==fp) throw new Error('Native input or analysis tool changed during analysis');
      checkAttestation(project,attestation);
      const receipt=path.join(workspace(name),'04_Notes','analysis-receipt.json'); atomicJson(receipt,{fingerprint:fp,attestation:checkAttestation(project,attestation),log:logFile});
      setStep(project,'analyze','succeeded',fp,outputManifest([receipt])); saveNow(name,project); return project;
    } catch(error) { project=read(name); setStep(project,'analyze','failed',fp,[],error.message); saveNow(name,project); throw error; }
  }); }
  function plan(name,source,options={}) {
    source=path.resolve(source); const project=fs.existsSync(projectPath(name))?read(name):fresh(name);
    const steps=[];
    if(fs.statSync(source).isDirectory()) { selectInputs(project,source,options); steps.push({name:'scan',action:'run',reason:'verify selected input hashes'}); }
    else {
      const fp=fingerprint({archive:fileIdentity(source).sha256,extractor:1});
      const skip=reusable(project,'extract',fp); steps.push({name:'extract',action:skip?'skip':'run',reason:skip?'archive and output verified':'staged extraction and explicit selection required'});
      if(!skip) return [...steps,{name:'dump',action:'pending',reason:'requires extracted inputs'},{name:'import',action:databaseExists(project)&&!options.reimport?'blocked':'pending',reason:'existing Ghidra data is preserved'}];
      selectInputs(project,path.join(workspace(name),'01_Extracted'),{binary:options.binary??project.selection?.binary,metadata:options.metadata??project.selection?.metadata});
    }
    refresh(project);
    steps.push({name:'dump',action:reusable(project,'dump',stepFingerprint(project,'dump',tools,root))?'skip':'run',reason:'content, effective settings and output manifest'});
    steps.push({name:'import',action:!options.reimport&&importReusable(project,stepFingerprint(project,'import',tools,root))?'skip':databaseExists(project)&&!options.reimport?'blocked':'run',reason:options.reimport?'explicit reimport with backup':'existing Ghidra data is preserved'});
    steps.push({name:'analyze',action:'awaiting-user',reason:'GUI or explicit analyze command'}, {name:'symbols',action:'awaiting-user',reason:'apply template in GUI; never inferred from import'});
    return steps;
  }
  async function notes(name) { return locked(name,()=>{
    const project=read(name); const folder=path.join(workspace(name),'04_Notes'); fs.mkdirSync(folder,{recursive:true});
    const dumpFile=path.join(project.il2cppDumperOutput,'dump.cs');
    const types=fs.existsSync(dumpFile)?[...fs.readFileSync(dumpFile,'utf8').matchAll(/\b(?:class|struct|interface|enum)\s+([A-Za-z_]\w*)/g)].map(match=>match[1]):[];
    fs.writeFileSync(path.join(folder,'candidates.md'),`# Candidate types\n\n${[...new Set(types)].map(name=>`- ${name}`).join('\n')}\n`);
    fs.writeFileSync(path.join(folder,'agent-context.md'),`# ${name}\n\nPrepared does not mean analysis-ready. Verify Auto Analysis, symbols and the connected MCP program.\n\nBinary: ${project.nativeBinary}\nMetadata: ${project.metadata}\n\n${Object.entries(project.steps).map(([name,step])=>`- ${name}: ${step.state}`).join('\n')}\n\nUse node re.js mcp, list_instances, connect_instance. dump.cs is a metadata skeleton; pseudocode is not original source.\n`);
    setStep(project,'notes','succeeded',fingerprint({native:project.identities.native?.sha256,metadata:project.identities.metadata?.sha256}),outputManifest([path.join(folder,'candidates.md'),path.join(folder,'agent-context.md')])); saveNow(name,project);
  }); }
  async function open(name) {
    assertNoSession({root,workspace},name);
    if(dependencies.open) return dependencies.open(name);
    return startDesktopLauncher({root,tools,env,workspace,read},{mode:'pyghidra',name});
  }
  async function compat(command,args=[]) {
    if(command==='pull-ldplayer'){
      const parsed=parseAdbArgs([command,...args]);
      if(parsed.help||parsed.root||parsed.json)throw new Error('Use the ADB CLI entrypoint for help, root and JSON options');
      return pullLdPlayer(parsed.game,parsed.packageName,parsed.options);
    }
    if(['ghidra-gui','pyghidra-gui'].includes(command)) {
      if(args.length>1||args.some(arg=>arg.startsWith('-')))throw Error('Use the typed Ghidra GUI command options');
      return startDesktopLauncher({root,tools,env,workspace,read},{mode:command==='ghidra-gui'?'ghidra':'pyghidra',...(args[0]?{name:args[0]}:{})});
    }
    const mutate=command==='assetripper-cli';
    const execute=async()=>{
      await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'re.ps1'),command,...args],
        {cwd:root,env,inherit:true,toolchainRoot:root,...(mutate?{leaseDirectory:path.join(workspace(args[0]),'.retk-lock')}:{})});
      if(mutate) {
        const project=read(args[0]);
        if(command==='assetripper-cli') {
          const output=project.reconstructedSourceDir;
          if(!output||!fs.existsSync(output)||!walk(output).length) throw new Error('AssetRipper adapter produced no verifiable output');
          setStep(project,'assetripper','succeeded',fingerprint({source:project.extractedPath,native:project.identities.native?.sha256,metadata:project.identities.metadata?.sha256}),outputManifest([output]));
        }
        saveNow(args[0],project);
      }
    };
    if(mutate) { if(!args[0]) throw new Error(`${command} requires a workspace`); return locked(args[0],execute); }
    return execute();
  }
  async function pullLdPlayer(name,packageName,options={}){
    rejectOutputLinks(workspace(name));validatePackageName(packageName);
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>!['adb','serial','skipLaunch','binary','metadata','confirm'].includes(key)))throw new Error('Invalid ADB capture options');
    if(options.serial!==undefined)validateSerial(options.serial);
    if(options.skipLaunch!==undefined&&typeof options.skipLaunch!=='boolean')throw new Error('Invalid skip-launch flag');
    if(!options.skipLaunch&&typeof options.confirm!=='function')throw Object.assign(new Error('Interactive launch requires confirmation; use --skip-launch for unattended capture'),{code:'ADB_INTERACTIVE_REQUIRED'});
    for(const key of ['binary','metadata'])if(options[key]!==undefined&&(typeof options[key]!=='string'||!options[key]||options[key].length>4096||/[\x00-\x1f]/.test(options[key])))throw new Error('Invalid explicit input selection');
    const file=resolveAdbPath(options.adb);
    return locked(name,async()=>{
      await init(name);
      const client=createAdbClient({file,run,runOptions:{cwd:root,env,leaseDirectory:path.join(workspace(name),'.retk-lock'),toolchainRoot:root}});
      const serial=await client.selectDevice(options.serial);
      const capture=await captureBundle({workspace:workspace(name),packageName,serial,client,skipLaunch:Boolean(options.skipLaunch),confirm:options.confirm});
      try{
        const project=await add(name,capture.bundle,{binary:options.binary,metadata:options.metadata});
        project.ldplayerCapture={runId:capture.runId,packageName,serial,bundle:capture.bundle,manifest:capture.manifest,sha256:capture.archive.sha256};saveNow(name,project);
        return {kind:'retoolkit-adb-result',schemaVersion:1,state:'prepared',capture,project,notice:'Captured inputs are selected; binary/metadata compatibility, dumping and Ghidra analysis remain unverified.'};
      }catch(error){error.message+=`\nSaved capture: ${capture.bundle}\nSelect inputs with add <Game> <bundle> --binary <path> --metadata <path>.`;throw error;}
    });
  }
  async function flow(name,source,options={}) {
    if(options.dryRun) return plan(name,source,options);
    const prepared=await locked(name,async()=>{
      await init(name); await add(name,source,options); await dump(name); await importProgram(name,options); await notes(name);
      log('Prepared. Auto Analysis, symbols and the MCP connection still require verification.'); return read(name);
    });
    if(!options.noOpen)await open(name);return prepared;
  }
  async function exportArchive(name,out) { return locked(name,async()=>{
    const destination=path.resolve(out??path.join(root,'exports',`${name}.re`));
    if(within(destination,workspace(name))) throw new Error('Archive destination must be outside the workspace');
    fs.mkdirSync(path.dirname(destination),{recursive:true}); const stage=`${destination}.tmp-${id()}`;
    try { await exportWorkspace(workspace(name),stage); if(fs.existsSync(destination)) throw new Error('Archive already exists; choose a new output path'); fs.renameSync(stage,destination); return destination; }
    finally { fs.rmSync(stage,{force:true}); }
  }); }
  async function importArchive(archive,name,{force=false}={}) {
    return restoreWorkspace({root,workspaces,archivePath:archive,name,force,initializeState,invalidateSteps,saveProject:saveNow,log});
  }

  return {root,tools,legacyBridge,workspace,projectPath,read,save,init,status,scan,add,dump,importProgram,analyze,plan,flow,notes,open,compat,pullLdPlayer,exportArchive,importArchive,candidates,env,run,log};
}
