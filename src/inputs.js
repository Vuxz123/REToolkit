import fs from 'node:fs';
import path from 'node:path';
import { fileIdentity, fingerprint, invalidateSteps, setStep, outputManifest } from './state.js';

export function within(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function walk(folder) {
  const files = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
    const full = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Linked paths are unsupported in build inventories: ${full}`);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

export function candidates(folder) {
  const files = walk(folder);
  return {
    binaries: files.filter(file => /^(libil2cpp\.so|GameAssembly\.dll)$/i.test(path.basename(file))),
    metadata: files.filter(file => path.basename(file).toLowerCase() === 'global-metadata.dat'),
  };
}

export function selectInput(folder, choices, explicit, previous, kind) {
  if (explicit) {
    const selected = path.resolve(folder, explicit);
    if (!choices.includes(selected)) throw new Error(`Selected ${kind} is not a candidate under ${folder}: ${explicit}`);
    return selected;
  }
  if (previous && choices.includes(previous)) return previous;
  if (choices.length === 1) return choices[0];
  if (!choices.length) throw new Error(`No IL2CPP ${kind} found under ${folder}`);
  throw new Error(`Ambiguous ${kind}; select --${kind} explicitly (relative paths accepted):\n${choices.join('\n')}`);
}

export function binaryAbi(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(64); const length = fs.readSync(fd, header, 0, 64, 0);
    if (length >= 20 && header.subarray(0,4).equals(Buffer.from([127,69,76,70]))) {
      const machine = header[5] === 2 ? header.readUInt16BE(18) : header.readUInt16LE(18);
      return ({183:'arm64-v8a',40:'armeabi-v7a',62:'x86_64',3:'x86'})[machine] ?? 'unknown';
    }
    if (length === 64 && header.toString('ascii',0,2) === 'MZ') {
      const pe = Buffer.alloc(6);
      if (fs.readSync(fd, pe, 0, 6, header.readUInt32LE(60)) === 6 && pe.readUInt32LE(0) === 0x4550) {
        return ({0x8664:'windows-x64',0x14c:'windows-x86',0xaa64:'windows-arm64'})[pe.readUInt16LE(4)] ?? 'unknown';
      }
    }
    return 'unknown';
  } finally { fs.closeSync(fd); }
}

export const ABI_PRIORITY = Object.freeze(['arm64-v8a','armeabi-v7a','x86_64','x86']);
export function inputPolicy(value = 'prefer-arm64') {
  if (!['prefer-arm64','manual'].includes(value)) throw Object.assign(new Error('Input policy must be prefer-arm64 or manual'),{code:'INPUT_POLICY_INVALID'});
  return value;
}
export function recommendInputs(binaries, metadata, selection = {}, policy = 'prefer-arm64') {
  policy=inputPolicy(policy);
  let binary=binaries.find(item=>item.path===selection.binary),reason=binary?'current':null;
  const meta=metadata.find(item=>item.path===selection.metadata)??(metadata.length===1?metadata[0]:null);
  if(!binary&&binaries.length===1){binary=binaries[0];reason='unique';}
  if(!binary&&policy!=='manual'&&binaries.length>1&&binaries.every(item=>ABI_PRIORITY.includes(item.abi))){
    const preferred=ABI_PRIORITY.find(abi=>binaries.some(item=>item.abi===abi));
    const choices=binaries.filter(item=>item.abi===preferred);
    if(choices.length===1){binary=choices[0];reason='abi-preference';}
  }
  return {binary:binary?.path??null,metadata:meta?.path??null,abi:binary?.abi??null,reason:reason??(!binaries.length||!metadata.length?'missing-input':policy==='manual'?'manual-selection-required':'ambiguous-inputs'),resolvable:Boolean(binary&&meta)};
}

export function updateIdentity(project) {
  const native = { ...fileIdentity(project.nativeBinary), abi: binaryAbi(project.nativeBinary) };
  const metadata = fileIdentity(project.metadata);
  const changed = project.identities.native?.sha256 !== native.sha256 || project.identities.metadata?.sha256 !== metadata.sha256;
  if (changed) invalidateSteps(project, ['dump','import','analyze','symbols','notes','assetripper']);
  project.identities.native = native; project.identities.metadata = metadata;
  project.platform = native.abi;
  return changed;
}

export function selectInputs(project, folder, options = {}) {
  folder = path.resolve(folder);
  const found = candidates(folder);
  const policy=inputPolicy(options.policy??project.inputPolicy);
  const retained=options.binary?selectInput(folder,found.binaries,options.binary,null,'binary'):found.binaries.includes(project.nativeBinary)?project.nativeBinary:null;
  const recommendation=retained?{binary:retained,reason:options.binary?'explicit':'current'}:recommendInputs(found.binaries.map(file=>({path:file,abi:binaryAbi(file)})),found.metadata.map(file=>({path:file})),{},policy);
  const binary = selectInput(folder, found.binaries, options.binary, recommendation.binary, 'binary');
  const metadata = selectInput(folder, found.metadata, options.metadata, project.metadata, 'metadata');
  const previous=project.selection, priorBinary=project.nativeBinary;
  project.extractedPath = folder; project.nativeBinary = binary; project.metadata = metadata;
  delete project.inputError;
  project.ghidraProgramName = path.basename(binary);
  const reason=options.binary?'explicit':binary===priorBinary?(previous?.reason??'current'):recommendation.reason;
  project.inputPolicy=policy;
  project.selection = { binary: path.relative(folder,binary), metadata: path.relative(folder,metadata), abi:binaryAbi(binary), reason, policy };
  updateIdentity(project);
  setStep(project, 'scan', 'succeeded', fingerprint({native: project.identities.native.sha256, metadata: project.identities.metadata.sha256}), outputManifest([binary,metadata]));
}

export function optionalIdentity(file) {
  if (!file || !fs.existsSync(file)) return { version:'unknown', sha256:null };
  const marker = path.join(path.dirname(file), '.retk-version');
  return { version: fs.existsSync(marker) ? fs.readFileSync(marker,'utf8').trim() : 'unknown', sha256:fileIdentity(file).sha256 };
}

export function runtimeIdentity(folder, pattern) {
  if(!fs.existsSync(folder)) return [];
  return walk(folder).filter(file=>pattern.test(path.relative(folder,file))).map(file=>{
    const identity=fileIdentity(file); return {path:path.relative(folder,file),size:identity.size,sha256:identity.sha256};
  });
}

export function stepFingerprint(project, name, tools, root) {
  const facts = { step:name, native:fileIdentity(project.nativeBinary).sha256 };
  if (!['import','analyze'].includes(name)) facts.metadata = fileIdentity(project.metadata).sha256;
  if (name === 'dump') {
    facts.tool = optionalIdentity(tools.dumper);
    facts.engine = runtimeIdentity(path.dirname(tools.dumper), /\.(dll|deps\.json|runtimeconfig\.json)$/i);
    const config = path.join(path.dirname(tools.dumper),'config.json');
    facts.configuration = fs.existsSync(config) ? JSON.parse(fs.readFileSync(config,'utf8').replace(/^\uFEFF/,'')) : {};
    // Effective automation settings are included before and after patching.
    facts.configuration.RequireAnyKey = false; facts.configuration.GenerateScript = true;
  }
  if (['import','analyze'].includes(name)) {
    facts.tool = optionalIdentity(tools.headless); facts.java = optionalIdentity(tools.java);
    facts.ghidra = optionalIdentity(path.join(tools.ghidra,'Ghidra/application.properties'));
    facts.engine = runtimeIdentity(tools.ghidra, /\.(jar|class|properties|bat)$/i);
    facts.jdk = optionalIdentity(path.join(tools.jdk??path.dirname(path.dirname(tools.java)),'release'));
    facts.project = project.ghidraProjectName; facts.program = project.ghidraProgramName;
  }
  if (name === 'symbols') facts.templates = ['ghidra.py','ghidra_with_struct.py'].map(name => optionalIdentity(path.join(root,'templates/Il2CppDumper',name)));
  return fingerprint(facts);
}
