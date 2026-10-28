import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';

const exec = promisify(execFile);
const ANDROID = 'http://schemas.android.com/apk/res/android';
const DIST = 'http://schemas.android.com/apk/distribution';
const NONE = 0xffffffff;
const MANIFEST_LIMIT = 8 * 1024 * 1024;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sorted = values => [...new Set(values)].sort();
const failure = message => Object.assign(new Error(message), { code: 'APK_INSPECTION_INVALID' });

/** Parse bounded Android binary XML only. No XML entities, external resources or game code are evaluated. */
export function parseAndroidManifest(buffer) {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const need = (offset, length, end = b.length) => { if (!Number.isSafeInteger(offset) || length < 0 || offset < 0 || offset + length > end) throw failure('Malformed binary XML manifest bounds.'); };
  need(0, 8);
  if (b.length > MANIFEST_LIMIT || b.readUInt16LE(0) !== 3 || b.readUInt16LE(2) !== 8 || b.readUInt32LE(4) !== b.length) throw failure('Expected a bounded Android binary XML manifest.');
  let strings = null, resourceMap = false, root = null, closedRoot = false, nodes = 0;
  const stack = [], dependencies = [], deliveryModes = [], metadata = [];
  const string = index => { if (!strings || index >= strings.length) throw failure('Invalid binary XML string index.'); return strings[index]; };
  const optionalString = index => index === NONE ? '' : string(index);
  const readPool = (offset, header, size) => {
    if (strings || root || header < 28) throw failure('Invalid binary XML string pool.');
    const end = offset + size, count = b.readUInt32LE(offset + 8), styles = b.readUInt32LE(offset + 12), flags = b.readUInt32LE(offset + 16), start = b.readUInt32LE(offset + 20), styleStart = b.readUInt32LE(offset + 24);
    if (count > 200000 || styles > count || start < header + (count + styles) * 4 || start > size || (flags & ~0x101) || (styleStart && (styleStart < start || styleStart > size))) throw failure('Invalid binary XML string pool size or flags.');
    need(offset + header, (count + styles) * 4, end);
    const stringEnd = styleStart ? offset + styleStart : end;
    const utf8 = Boolean(flags & 0x100), decoder = new TextDecoder(utf8 ? 'utf-8' : 'utf-16le', { fatal: true });
    strings = []; let decodedBytes = 0;
    for (let i = 0; i < count; i++) {
      let p = offset + start + b.readUInt32LE(offset + header + i * 4);
      const length = () => {
        need(p, utf8 ? 1 : 2, stringEnd);
        let value = utf8 ? b[p++] : b.readUInt16LE(p); if (!utf8) p += 2;
        if (value & (utf8 ? 0x80 : 0x8000)) { need(p, utf8 ? 1 : 2, stringEnd); value = (value & (utf8 ? 0x7f : 0x7fff)) * (utf8 ? 256 : 65536) + (utf8 ? b[p++] : b.readUInt16LE(p)); if (!utf8) p += 2; }
        return value;
      };
      const units = length(), bytes = utf8 ? length() : units * 2;
      need(p, bytes + (utf8 ? 1 : 2), stringEnd);
      decodedBytes += units * 2;
      if (decodedBytes > 16 * 1024 * 1024) throw failure('Binary XML decoded string size limit exceeded.');
      if ((utf8 ? b[p + bytes] : b.readUInt16LE(p + bytes)) !== 0) throw failure('Unterminated binary XML string.');
      let value; try { value = decoder.decode(b.subarray(p, p + bytes)); } catch { throw failure('Invalid binary XML string encoding.'); }
      if (value.length !== units || value.includes('\0')) throw failure('Invalid binary XML string length.');
      strings.push(value);
    }
  };
  const get = (attrs, name, namespace = ANDROID) => attrs.get(`${namespace}\0${name}`);
  const text = (attrs, name, namespace = ANDROID, fallback = null) => {
    const value = get(attrs, name, namespace); if (!value) return fallback;
    if (value.type !== 3) throw failure(`Manifest ${name} must have string type.`); return value.value;
  };
  const integer = (attrs, name, fallback = 0) => { const a = get(attrs, name); if (!a) return fallback; if (a.type !== 0x10 && a.type !== 0x11) throw failure(`Manifest ${name} must have integer type.`); return a.data; };
  const boolean = (attrs, name, fallback = false) => { const a = get(attrs, name); if (!a) return fallback; if (a.type !== 0x12) throw failure(`Manifest ${name} must have boolean type.`); return a.data !== 0; };
  const name = (value, field, empty = false) => { if (value === null || (empty && value === '')) return value; if (typeof value !== 'string' || value.length > 255 || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(value)) throw failure(`Invalid manifest ${field}.`); return value; };
  const types = value => { if (value === null || value === '') return []; const values = value.split(',').map(v => v.trim()); if (values.length > 256 || values.some(v => !v || v.length > 255 || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(v))) throw failure('Invalid manifest split types.'); return sorted(values); };
  for (let offset = 8; offset < b.length;) {
    need(offset, 8); const type = b.readUInt16LE(offset), header = b.readUInt16LE(offset + 2), size = b.readUInt32LE(offset + 4), end = offset + size;
    if (header < 8 || size < header || end > b.length || ++nodes > 100000) throw failure('Invalid binary XML chunk size or count.');
    if (type === 1) readPool(offset, header, size);
    else if (type === 0x180) { if (!strings || resourceMap || root || header !== 8 || (size - 8) % 4 || (size - 8) / 4 > strings.length) throw failure('Invalid binary XML resource map.'); resourceMap = true; }
    else if (type === 0x100 || type === 0x101) { if (!strings || header !== 16 || size !== 24) throw failure('Invalid binary XML namespace chunk.'); optionalString(b.readUInt32LE(offset + 16)); string(b.readUInt32LE(offset + 20)); }
    else if (type === 0x102) {
      if (!strings || closedRoot || header !== 16) throw failure('Invalid binary XML start element.'); need(offset + 16, 20, end);
      const namespace = optionalString(b.readUInt32LE(offset + 16)), tag = string(b.readUInt32LE(offset + 20));
      const attrStart = b.readUInt16LE(offset + 24), attrSize = b.readUInt16LE(offset + 26), attrCount = b.readUInt16LE(offset + 28);
      if (attrStart < 20 || attrSize < 20 || attrCount > 4096 || stack.length >= 128) throw failure('Invalid binary XML attribute limits.');
      need(offset + 16 + attrStart, attrSize * attrCount, end); const attrs = new Map();
      for (let i = 0; i < attrCount; i++) {
        const p = offset + 16 + attrStart + i * attrSize, ns = optionalString(b.readUInt32LE(p)), key = `${ns}\0${string(b.readUInt32LE(p + 4))}`;
        if (attrs.has(key)) throw failure('Duplicate binary XML attribute.');
        const raw = b.readUInt32LE(p + 8), valueSize = b.readUInt16LE(p + 12), valueType = b[p + 15], data = b.readUInt32LE(p + 16);
        if (valueSize !== 8 || b[p + 14] !== 0) throw failure('Invalid binary XML typed attribute.');
        const value = valueType === 3 ? string(data) : data;
        if (raw !== NONE && (valueType === 3 ? string(raw) !== value : false)) throw failure('Conflicting binary XML raw and typed string.');
        if (raw !== NONE) string(raw);
        attrs.set(key, { type: valueType, data, value });
      }
      if (!stack.length) {
        if (root || namespace || tag !== 'manifest') throw failure('Expected one binary XML manifest root.');
        const packageName = text(attrs, 'package', '');
        if (!packageName || packageName.length > 255 || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName)) throw failure('Invalid manifest package name.');
        const requiredSplitTypes = types(text(attrs, 'requiredSplitTypes'));
        root = { packageName, versionCode: ((BigInt(integer(attrs, 'versionCodeMajor')) << 32n) | BigInt(integer(attrs, 'versionCode'))).toString(), splitName: name(text(attrs, 'split', ''), 'split name', true) || null,
          configForSplit: name(text(attrs, 'configForSplit', ''), 'configForSplit', true), usesSplits: dependencies,
          requiredSplitTypes, splitTypes: types(text(attrs, 'splitTypes')), isSplitRequired: boolean(attrs, 'isSplitRequired'), requiresSplits: boolean(attrs, 'isSplitRequired') || requiredSplitTypes.length > 0,
          isFeatureSplit: boolean(attrs, 'isFeatureSplit'), delivery: { coverage: 'unverified', modes: deliveryModes, metadata } };
      } else if (namespace === '' && stack.length === 1 && tag === 'uses-split') {
        const dependency = name(text(attrs, 'name'), 'uses-split'); if (!dependency || dependencies.includes(dependency)) throw failure('Missing or duplicate uses-split dependency.'); dependencies.push(dependency);
      } else if (namespace === '' && stack.length === 2 && stack[1].tag === 'application' && tag === 'meta-data') {
        const key = text(attrs, 'name'); if (key?.startsWith('com.android.vending.')) {
          if (key === 'com.android.vending.splits.required') root.requiresSplits ||= boolean(attrs, 'value');
          metadata.push(key);
        }
      } else if (namespace === DIST && ['install-time', 'fast-follow', 'on-demand'].includes(tag)) deliveryModes.push(tag);
      stack.push({ namespace, tag });
    } else if (type === 0x103) {
      if (header !== 16 || size !== 24 || !stack.length) throw failure('Invalid binary XML end element.');
      const top = stack.pop(); if (top.namespace !== optionalString(b.readUInt32LE(offset + 16)) || top.tag !== string(b.readUInt32LE(offset + 20))) throw failure('Mismatched binary XML element.');
      if (!stack.length) closedRoot = true;
    } else if (type === 0x104) { if (!stack.length || header !== 16 || size < 28) throw failure('Invalid binary XML text chunk.'); string(b.readUInt32LE(offset + 16)); }
    else throw failure('Unsupported binary XML chunk type.');
    offset = end;
  }
  if (!root || !closedRoot || stack.length) throw failure('Incomplete binary XML manifest.');
  root.usesSplits.sort(); root.delivery.modes = sorted(deliveryModes); root.delivery.metadata = sorted(metadata); return root;
}

function safeEntry(entry) {
  const name = entry.fileName, parts = name.replace(/\/$/, '').split('/');
  if (!name || name.length > 4096 || name.includes('\\') || name.startsWith('/') || parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw failure(`Unsafe APK ZIP entry: ${name}`);
  const type = (entry.externalFileAttributes >>> 16) & 0o170000;
  if (type && type !== 0o100000 && type !== 0o040000) throw failure('APK ZIP symbolic links and special entry types are forbidden.');
  if (entry.generalPurposeBitFlag & 1) throw failure('Encrypted APK ZIP entries are unsupported.');
  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > 16 * 1024 ** 3 || entry.uncompressedSize > Math.max(1024 * 1024, entry.compressedSize * 1000)) throw failure('APK ZIP expanded size or compression ratio limit exceeded.');
}

async function readApkManifest(file) {
  const archive = await new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => error ? reject(error) : resolve(zip)));
  const names = new Set(), nativeAbis = new Set(); let manifest = null, total = 0, entryCount = 0, hasUnityData = false, hasMetadata = false, hasIl2cpp = false;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = error => { if (!settled) { settled = true; archive.close(); reject(error); } };
    archive.on('error', fail);
    archive.on('end', () => { if (settled) return; settled = true; if (!manifest) reject(failure('APK AndroidManifest.xml is missing.')); else resolve({ manifest, delivery: { nativeAbis: sorted(nativeAbis), hasUnityData, hasMetadata, hasIl2cpp, coverage: 'unverified' } }); });
    archive.on('entry', entry => {
      (async () => {
        safeEntry(entry);
        // Read-only APK scanning never materializes members as Windows paths.
        // Case-distinct Android resources are separate entries.
        const key = entry.fileName.replace(/\/$/, '');
        if (key.toLowerCase() === 'androidmanifest.xml' && entry.fileName !== 'AndroidManifest.xml') throw failure('Duplicate or ambiguous APK manifest casing.');
        if (names.has(key)) throw failure(`Duplicate APK ZIP entry: ${entry.fileName}`); names.add(key);
        total += entry.uncompressedSize;
        if (++entryCount > 200000 || total > 64 * 1024 ** 3) throw failure('APK ZIP aggregate size or entry count limit exceeded.');
        const abi = /^lib\/([^/]+)\/[^/]+\.so$/.exec(entry.fileName); if (abi) nativeAbis.add(abi[1]);
        hasIl2cpp ||= /^lib\/[^/]+\/libil2cpp\.so$/.test(entry.fileName);
        hasUnityData ||= /^assets\/bin\/Data\//.test(entry.fileName);
        hasMetadata ||= /(?:^|\/)global-metadata\.dat$/.test(entry.fileName);
        if (entry.fileName !== 'AndroidManifest.xml') return;
        if (entry.uncompressedSize > MANIFEST_LIMIT) throw failure('APK manifest size limit exceeded.');
        const stream = await new Promise((res, rej) => archive.openReadStream(entry, (error, result) => error ? rej(error) : res(result)));
        const chunks = []; let size = 0, checksum = 0;
        for await (const chunk of stream) { size += chunk.length; if (size > MANIFEST_LIMIT) { stream.destroy(); throw failure('APK manifest size limit exceeded.'); } checksum = crc32(chunk, checksum); chunks.push(chunk); }
        if (size !== entry.uncompressedSize || checksum !== entry.crc32) throw failure('APK manifest CRC checksum or size mismatch.'); manifest = Buffer.concat(chunks);
      })().then(() => { if (!settled) archive.readEntry(); }, fail);
    });
    archive.readEntry();
  });
}

async function regular(file) { if (typeof file !== 'string' || !path.isAbsolute(file) || /[\x00-\x1f]/.test(file)) return false; try { const s = await fs.lstat(file); return s.isFile() && !s.isSymbolicLink(); } catch { return false; } }

/** Discover only locally installed SDK/JDK tools. Never resolve executable code from the APK or PATH. */
export async function resolveApkVerifier({ toolkitRoot = ROOT, apksignerPath, javaPath } = {}) {
  if (apksignerPath === null || javaPath === null) return null;
  const javaCandidates = javaPath === undefined ? [path.join(toolkitRoot, 'runtime/java/jdk-21/bin/java.exe')] : [javaPath];
  const signerCandidates = apksignerPath === undefined ? [] : [apksignerPath];
  if (apksignerPath === undefined) {
    const hub = path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Unity/Hub/Editor');
    const versions = await fs.readdir(hub).catch(() => []);
    for (const version of versions.sort().reverse()) {
      const player = path.join(hub, version, 'Editor/Data/PlaybackEngines/AndroidPlayer');
      const buildTools = path.join(player, 'SDK/build-tools');
      for (const build of (await fs.readdir(buildTools).catch(() => [])).sort().reverse()) signerCandidates.push(path.join(buildTools, build, 'lib/apksigner.jar'));
      if (javaPath === undefined) javaCandidates.push(path.join(player, 'OpenJDK/bin/java.exe'));
    }
  }
  let selectedJava = null, selectedSigner = null;
  for (const candidate of javaCandidates) if (await regular(candidate)) { selectedJava = await fs.realpath(candidate); break; }
  for (const candidate of signerCandidates) if (/apksigner\.jar$/i.test(candidate ?? '') && await regular(candidate)) { selectedSigner = await fs.realpath(candidate); break; }
  return selectedJava && selectedSigner ? { javaPath: selectedJava, apksignerPath: selectedSigner } : null;
}

async function verifySigning(file, options) {
  const verifier = await resolveApkVerifier(options);
  if (!verifier) return { state: 'unverified', certificateSha256: [], reason: 'installed-apksigner-unavailable' };
  try {
    // Java option environment variables can inject agents/classes; remove them for this trusted verifier.
    const env = { ...process.env }; for (const key of Object.keys(env)) if (['_JAVA_OPTIONS', 'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', 'CLASSPATH'].includes(key.toUpperCase())) delete env[key];
    const { stdout } = await exec(verifier.javaPath, ['-jar', verifier.apksignerPath, 'verify', '--verbose', '--print-certs', file], { env, windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024, encoding: 'utf8' });
    const certificates = [...stdout.matchAll(/^Signer #[1-9][0-9]* certificate SHA-256 digest: ([a-fA-F0-9]{64})\r?$/gm)].map(match => match[1].toLowerCase());
    if (!/^Verifies\r?$/m.test(stdout) || !certificates.length) return { state: 'unverified', certificateSha256: [], reason: 'verifier-output-incomplete' };
    return { state: 'verified', certificateSha256: sorted(certificates), verifier: { ...verifier } };
  } catch (error) { return { state: 'unverified', certificateSha256: [], reason: 'apk-signature-verification-failed', diagnostic: String(error.stderr || error.message).slice(0, 2048) }; }
}

export async function inspectApk(file, options = {}) {
  file = path.resolve(file); if (!await regular(file)) throw failure('APK must be an existing regular file.');
  const before = await fs.stat(file); const archive = await readApkManifest(file); const manifest = parseAndroidManifest(archive.manifest);
  const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
  const signing = await verifySigning(file, options); const after = await fs.stat(file);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== after.ino) throw failure('APK changed during inspection.');
  return { file, ...manifest, sha256: hash.digest('hex'), size: before.size, signing, delivery: { ...manifest.delivery, ...archive.delivery } };
}

export async function inspectApkSet(files, options = {}) {
  const apks = [], reasons = [], missingSplits = [], missingSplitTypes = [];
  if (!Array.isArray(files) || !files.length || files.length > 1024) return { state: 'invalid', apks, reasons: ['APK set must contain 1 to 1024 files.'], missingSplits, missingSplitTypes, signing: { state: 'unverified', certificateSha256: [] }, delivery: { coverage: 'unverified' } };
  for (const file of files) { try { apks.push(await inspectApk(file, options)); } catch (error) { reasons.push(`${path.basename(String(file))}: ${error.message}`); } }
  const base = apks.find(apk => apk.splitName === null), reference = base ?? apks[0]; const splits = new Map();
  for (const apk of apks) {
    const key = apk.splitName ?? ''; if (splits.has(key)) reasons.push(`Duplicate APK split identity: ${key || 'base'}.`); splits.set(key, apk);
    if (reference && (apk.packageName !== reference.packageName || apk.versionCode !== reference.versionCode)) reasons.push('APK package names or version codes differ.');
  }
  if (!base) reasons.push('APK set has no base APK.');
  const visited = new Set(), visiting = new Set(); let cyclic = false;
  const visit = key => {
    if (visiting.has(key)) { cyclic = true; return; } if (visited.has(key)) return;
    const apk = splits.get(key); if (!apk) return; visiting.add(key);
    for (const dependency of [...apk.usesSplits, ...(apk.configForSplit ? [apk.configForSplit] : [])]) visit(dependency);
    visiting.delete(key); visited.add(key);
  };
  for (const key of splits.keys()) visit(key);
  if (cyclic) reasons.push('APK split dependency cycle detected.');
  const signing = { state: 'unverified', certificateSha256: [] };
  if (apks.length && apks.every(apk => apk.signing.state === 'verified')) {
    const expected = JSON.stringify(apks[0].signing.certificateSha256);
    if (apks.some(apk => JSON.stringify(apk.signing.certificateSha256) !== expected)) reasons.push('APK signer certificates differ.');
    else Object.assign(signing, { state: 'verified', certificateSha256: apks[0].signing.certificateSha256 });
  }
  const result = { state: 'invalid', packageName: reference?.packageName ?? null, versionCode: reference?.versionCode ?? null, baseSha256: base?.sha256 ?? null, apks, missingSplits, missingSplitTypes, missingUnspecifiedSplit: false, signing, reasons,
    delivery: { coverage: 'unverified', nativeAbis: sorted(apks.flatMap(apk => apk.delivery.nativeAbis)), hasIl2cpp: apks.some(apk => apk.delivery.hasIl2cpp), hasMetadata: apks.some(apk => apk.delivery.hasMetadata), hasUnityData: apks.some(apk => apk.delivery.hasUnityData), modes: sorted(apks.flatMap(apk => apk.delivery.modes)) } };
  if (reasons.length) return result;
  // Android's installer compares the union of all provided and required types;
  // feature-specific types encode their feature in the type string itself.
  const provided = new Set(apks.flatMap(apk => apk.splitTypes));
  for (const apk of apks) {
    for (const dependency of [...apk.usesSplits, ...(apk.configForSplit ? [apk.configForSplit] : [])]) if (!splits.has(dependency)) missingSplits.push(dependency);
    for (const type of apk.requiredSplitTypes) if (!provided.has(type)) missingSplitTypes.push(type);
  }
  result.missingSplits = sorted(missingSplits); result.missingSplitTypes = sorted(missingSplitTypes);
  if (missingSplits.length || missingSplitTypes.length) result.state = 'missing-splits';
  else if (base.requiresSplits && apks.length === 1 && !base.requiredSplitTypes.length) { result.state = 'missing-splits'; result.missingUnspecifiedSplit = true; reasons.push('Manifest requires a split but does not identify its name or type.'); }
  else if (signing.state !== 'verified') { result.state = 'unverified'; reasons.push('APK signer certificates have not been verified.'); }
  else result.state = 'complete-for-declared-requirements';
  return result;
}

/** Guard a merge before consuming any installed package payloads. Exact original base bytes are mandatory. */
export function compareApkSetIdentity(local, remote) {
  const reasons = [];
  if (!local || !remote || local.state === 'invalid' || remote.state === 'invalid') reasons.push('Invalid APK set identity.');
  if (!local?.baseSha256 || !remote?.baseSha256 || !/^[a-f0-9]{64}$/.test(local.baseSha256) || local.baseSha256 !== remote.baseSha256) reasons.push('Installed base APK SHA-256 differs from the original input base.');
  if (!local?.packageName || local.packageName !== remote?.packageName) reasons.push('Installed package name differs.');
  if (!local?.versionCode || local.versionCode !== remote?.versionCode) reasons.push('Installed package version code differs.');
  const trusted = value => value?.state === 'verified' && Array.isArray(value.certificateSha256) && value.certificateSha256.length > 0 && value.certificateSha256.every(digest => /^[a-f0-9]{64}$/.test(digest));
  if (!trusted(local?.signing) || !trusted(remote?.signing)) reasons.push('Verified APK signer certificates are required.');
  else if (JSON.stringify(sorted(local.signing.certificateSha256)) !== JSON.stringify(sorted(remote.signing.certificateSha256))) reasons.push('Installed APK signer certificates differ.');
  return { compatible: reasons.length === 0, reasons };
}
