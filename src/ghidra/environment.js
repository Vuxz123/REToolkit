import fs from 'node:fs';
import path from 'node:path';
import { fileIdentity, fingerprint, reusable } from '../state.js';
import { stepFingerprint, within,walk } from '../inputs.js';
import { BridgeError } from './protocol.js';

export function validateProject(toolkit,name) {
  const project=toolkit.read(name);const workspace=fs.realpathSync(toolkit.workspace(name));
  if(!project.nativeBinary||!project.metadata||!project.ghidraProgramName)throw new BridgeError('program_mismatch','Scan inputs and import the selected program before session start');
  if(/[\\/*?\r\n]/.test(project.ghidraProgramName)||!project.ghidraProgramName||!within(project.ghidraProjectDir,workspace))throw new BridgeError('program_mismatch','Project/program path is outside the workspace or contains a wildcard');
  const projectDir=fs.realpathSync(project.ghidraProjectDir);
  if(!within(projectDir,workspace))throw new BridgeError('program_mismatch','Project links outside workspace are unsupported');
  if(!/^[A-Za-z0-9_.-]{1,64}$/.test(project.ghidraProjectName)||['.','..'].includes(project.ghidraProjectName))throw new BridgeError('program_mismatch','Invalid Ghidra project name');
  for(const ext of ['.gpr','.rep'])if(!fs.existsSync(path.join(projectDir,project.ghidraProjectName+ext)))throw new BridgeError('program_mismatch','Existing Ghidra project files are required; session start does not import');
  const native=fileIdentity(project.nativeBinary);const metadata=fileIdentity(project.metadata);
  if(project.identities.native?.sha256!==native.sha256||project.identities.metadata?.sha256!==metadata.sha256)throw new BridgeError('input_changed','Selected inputs changed; scan/import the matching build before starting a session');
  return {project,workspace,native,metadata,projectDir};
}
export function projectLocks(projectDir) {
  return walk(projectDir).filter(file=>/\.lock$|\.dbDirLock$/i.test(file));
}
export function sessionProfile(toolkit,project,native,metadata) {
  const scriptPath=path.resolve(project.il2cppDumperOutput,'script.json');
  const dumperFingerprint=stepFingerprint(project,'dump',toolkit.tools,toolkit.root);
  const verified=within(scriptPath,toolkit.workspace(project.name))&&reusable(project,'dump',dumperFingerprint)&&fs.existsSync(scriptPath);
  const toolInputs=fs.existsSync(path.dirname(toolkit.tools.dumper))?walk(path.dirname(toolkit.tools.dumper)).filter(file=>/\.(exe|dll|json)$/i.test(file)).map(file=>{const identity=fileIdentity(file);return {path:identity.path,sha256:identity.sha256};}):[];
  return {scriptPath,profile:{id:'explicit-address-mode-v1',dumpVerified:verified,
    nativeSha256:native.sha256,metadataSha256:metadata.sha256,
    scriptSha256:verified?fileIdentity(scriptPath).sha256:null,dumperFingerprint,toolInputs}};
}
export function engineEnvironment(toolkit,workspace) {
  const appdata=path.join(workspace,'04_Notes/.engine-runtime/appdata');
  const local=path.join(workspace,'04_Notes/.engine-runtime/local');
  fs.mkdirSync(appdata,{recursive:true});fs.mkdirSync(local,{recursive:true});
  return {JAVA_HOME:toolkit.tools.jdk,JAVA_HOME_OVERRIDE:toolkit.tools.jdk,GHIDRA_INSTALL_DIR:toolkit.tools.ghidra,
    PATH:toolkit.env.PATH,APPDATA:appdata,LOCALAPPDATA:local};
}
export function verifyBinding(config,toolkit,name) {
  const current=validateProject(toolkit,name);
  if(current.workspace!==config.workspace||current.native.sha256!==config.native.sha256||current.metadata.sha256!==config.metadata.sha256||
    current.projectDir!==config.projectDir||current.project.ghidraProjectName!==config.projectName||current.project.ghidraProgramName!==config.program)
    throw new BridgeError('input_changed','Session binding changed. Stop the session and scan/import the matching build');
  return current;
}
