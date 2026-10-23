import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { binaryManifest, writeApk, ANDROID } from './fixtures/apk-fixture.js';
import { inspectApk, inspectApkSet, parseAndroidManifest, compareApkSetIdentity, resolveApkVerifier } from '../src/adb/apk-inspection.js';

async function fixture(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'retk-apk-inspection-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
const unsigned = { apksignerPath: null };

test('binary manifest reads typed version, split declarations and dependencies', () => {
  const result = parseAndroidManifest(binaryManifest({ versionCode: 0xffffffff, versionCodeMajor: 2, splitName: 'feature', configForSplit: 'parent', requiredSplitTypes: 'config.abi,config.density', splitTypes: 'feature', requiresSplits: true, usesSplits: ['parent'] }));
  assert.equal(result.packageName, 'com.example.game'); assert.equal(result.versionCode, '12884901887');
  assert.equal(result.splitName, 'feature'); assert.equal(result.configForSplit, 'parent');
  assert.deepEqual(result.usesSplits, ['parent']); assert.deepEqual(result.requiredSplitTypes, ['config.abi', 'config.density']); assert.equal(result.requiresSplits, true);
});

test('rejects plain text, malformed binary XML and wrong typed identity attributes', () => {
  assert.throws(() => parseAndroidManifest(Buffer.from('<!DOCTYPE manifest [<!ENTITY x SYSTEM "file:///secret">]><manifest/>')), /binary|XML/i);
  const broken = binaryManifest(); broken.writeUInt32LE(0xffffffff, 8 + 4); assert.throws(() => parseAndroidManifest(broken), /manifest|chunk|XML/i);
  assert.throws(() => parseAndroidManifest(binaryManifest({ extraAttributes: [['versionCode', '8', ANDROID]] })), /duplicate|type/i);
  assert.throws(() => parseAndroidManifest(binaryManifest({ versionCode: 'not-a-number' })), /version|integer|type/i);
});

test('APK inspection hashes actual bytes and never trusts a certificate ZIP entry or filename', async t => {
  const root = await fixture(t); const apk = await writeApk(path.join(root, 'wrong.package.999.apk'), {}, [['META-INF/FAKE.RSA', 'fake certificate'], ['lib/arm64-v8a/libil2cpp.so', 'native']]);
  const result = await inspectApk(apk, unsigned);
  assert.equal(result.packageName, 'com.example.game'); assert.equal(result.versionCode, '7'); assert.equal(result.signing.state, 'unverified'); assert.deepEqual(result.signing.certificateSha256, []);
  assert.match(result.sha256, /^[a-f0-9]{64}$/); assert.deepEqual(result.delivery.nativeAbis, ['arm64-v8a']); assert.equal(result.delivery.coverage, 'unverified');
});

test('declared dependencies and global split types reveal omissions without demanding every device configuration', async t => {
  const root = await fixture(t); const base = await writeApk(path.join(root, 'base.apk'), { requiredSplitTypes: 'config.abi', usesSplits: ['feature'] });
  const arm = await writeApk(path.join(root, 'arm.apk'), { splitName: 'config.arm64_v8a', splitTypes: 'config.abi' });
  let result = await inspectApkSet([base, arm], unsigned); assert.equal(result.state, 'missing-splits'); assert.deepEqual(result.missingSplits, ['feature']); assert.deepEqual(result.missingSplitTypes, []);
  const feature = await writeApk(path.join(root, 'feature.apk'), { splitName: 'feature', requiredSplitTypes: 'feature.config.abi' });
  result = await inspectApkSet([base, arm, feature], unsigned); assert.equal(result.state, 'missing-splits'); assert.deepEqual(result.missingSplitTypes, ['feature.config.abi']);
  const config = await writeApk(path.join(root, 'feature-arm.apk'), { splitName: 'feature.config.arm64_v8a', configForSplit: 'feature', splitTypes: 'feature.config.abi' });
  result = await inspectApkSet([base, arm, feature, config], unsigned); assert.equal(result.state, 'unverified'); assert.deepEqual(result.missingSplits, []); assert.deepEqual(result.missingSplitTypes, []);
});

test('requiredSplitTypes are satisfied by the global provided-type union as Android installs require', async t => {
  const root = await fixture(t); const base = await writeApk(path.join(root, 'base.apk'), { requiredSplitTypes: 'config.abi' });
  const feature = await writeApk(path.join(root, 'feature.apk'), { splitName: 'feature', requiredSplitTypes: 'config.abi' });
  const arm = await writeApk(path.join(root, 'arm.apk'), { splitName: 'config.arm', splitTypes: 'config.abi' });
  const result = await inspectApkSet([base, feature, arm], unsigned); assert.deepEqual(result.missingSplitTypes, []); assert.equal(result.state, 'unverified');
});

test('unsigned universal APK and unspecified split-required packages remain explicit about uncertainty', async t => {
  const root = await fixture(t); const base = await writeApk(path.join(root, 'base.apk'));
  const result = await inspectApkSet([base], unsigned); assert.equal(result.state, 'unverified'); assert.deepEqual(result.missingSplits, []); assert.equal(result.delivery.coverage, 'unverified');
  const required = await writeApk(path.join(root, 'required.apk'), { requiresSplits: true }); const unknown = await inspectApkSet([required], unsigned); assert.equal(unknown.state, 'missing-splits'); assert.equal(unknown.missingUnspecifiedSplit, true); assert.match(unknown.reasons.join(' '), /split/i);
});

test('set rejects mixed identities, duplicate splits and missing base', async t => {
  const root = await fixture(t); const base = await writeApk(path.join(root, 'base.apk')); const version = await writeApk(path.join(root, 'version.apk'), { splitName: 'config.arm', versionCode: 8 });
  assert.equal((await inspectApkSet([base, version], unsigned)).state, 'invalid');
  assert.equal((await inspectApkSet([base, base], unsigned)).state, 'invalid');
  assert.equal((await inspectApkSet([version], unsigned)).state, 'invalid');
});

test('cyclic feature dependencies are invalid rather than declared complete', async t => {
  const root = await fixture(t); const base = await writeApk(path.join(root, 'base.apk'));
  const first = await writeApk(path.join(root, 'first.apk'), { splitName: 'first', usesSplits: ['second'] });
  const second = await writeApk(path.join(root, 'second.apk'), { splitName: 'second', usesSplits: ['first'] });
  const result = await inspectApkSet([base, first, second], unsigned); assert.equal(result.state, 'invalid'); assert.match(result.reasons.join(' '), /cycle|cyclic/i);
});

test('string pool repeated offsets cannot amplify a small manifest into unbounded decoded strings', () => {
  const source = binaryManifest(); const poolEnd = 8 + source.readUInt32LE(12); const oldPool = source.subarray(8, poolEnd);
  const longString = Buffer.from('x'.repeat(127)); const count = 150000; const pool = Buffer.alloc(28 + count * 4 + 130);
  pool.writeUInt16LE(1, 0); pool.writeUInt16LE(28, 2); pool.writeUInt32LE(pool.length, 4); pool.writeUInt32LE(count, 8); pool.writeUInt32LE(0x100, 16); pool.writeUInt32LE(28 + count * 4, 20);
  const start = 28 + count * 4; pool[start] = 127; pool[start + 1] = 127; longString.copy(pool, start + 2);
  const manifest = Buffer.concat([source.subarray(0, 8), pool, source.subarray(8 + oldPool.length)]); manifest.writeUInt32LE(manifest.length, 4);
  assert.throws(() => parseAndroidManifest(manifest), /decoded|string.*limit/i);
});

test('ZIP guards reject duplicate manifest, traversal, symlinks and oversized manifest', async t => {
  const root = await fixture(t);
  for (const [name, entries] of [['duplicate', [['AndroidManifest.xml', 'fake']]], ['case', [['androidmanifest.xml', 'fake']]], ['link', [['link', 'target', { mode: 0o120777 }]]]]) {
    const apk = await writeApk(path.join(root, `${name}.apk`), {}, entries); await assert.rejects(inspectApk(apk, unsigned), /duplicate|symbolic|type/i);
  }
  const oversize = await writeApk(path.join(root, 'large.apk'), Buffer.alloc(8 * 1024 * 1024 + 1)); await assert.rejects(inspectApk(oversize, unsigned), /limit|size|ratio/i);
  const unsafe = await writeApk(path.join(root, 'unsafe.apk'), {}, [['aa/bb', 'bad']]); const bytes = await fs.readFile(unsafe); await fs.writeFile(unsafe, Buffer.from(bytes.toString('latin1').replaceAll('aa/bb', '../bb'), 'latin1')); await assert.rejects(inspectApk(unsafe, unsigned), /unsafe|relative|invalid/i);
});

test('remote identity comparison requires matching actual base digest and verified signer', () => {
  const set = { state: 'complete-for-declared-requirements', packageName: 'com.example.game', versionCode: '7', baseSha256: 'a'.repeat(64), signing: { state: 'verified', certificateSha256: ['b'.repeat(64)] } };
  assert.equal(compareApkSetIdentity(set, structuredClone(set)).compatible, true);
  for (const changed of [{ baseSha256: 'c'.repeat(64) }, { versionCode: '8' }, { signing: { state: 'unverified', certificateSha256: [] } }, { signing: { state: 'verified', certificateSha256: ['c'.repeat(64)] } }]) assert.equal(compareApkSetIdentity(set, { ...set, ...changed }).compatible, false);
});

test('installed verifier discovery stays local and returns real paths or unavailable', async () => {
  const verifier = await resolveApkVerifier({ toolkitRoot: process.cwd() });
  if (verifier) { assert.equal((await fs.stat(verifier.javaPath)).isFile(), true); assert.equal((await fs.stat(verifier.apksignerPath)).isFile(), true); }
});

test('real installed apksigner verifies signed APKs and rejects different or tampered signers', async t => {
  const verifier = await resolveApkVerifier({ toolkitRoot: process.cwd() });
  if (!verifier) { t.skip('Locally installed Android SDK apksigner/JDK unavailable.'); return; }
  const root = await fixture(t), run = promisify(execFile), keytool = path.join(path.dirname(verifier.javaPath), 'keytool.exe');
  // Windows sandbox JDKs may fall back to a very slow timing entropy generator.
  // Use fresh OS-backed Node random bytes for these temporary test keys only.
  const entropy = path.join(root, 'entropy.bin'); await fs.writeFile(entropy, randomBytes(1024 * 1024));
  const entropyOption = `-Djava.security.egd=${pathToFileURL(entropy).href}`;
  const sign = async (name, alias, manifest = {}) => {
    const key = path.join(root, `${alias}.p12`);
    try { await fs.stat(key); } catch {
      await run(keytool, [`-J${entropyOption}`, '-genkeypair', '-alias', alias, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '2', '-dname', 'CN=REToolkit test fixture', '-keystore', key, '-storepass', 'fixture-password', '-keypass', 'fixture-password'], { windowsHide: true, timeout: 30000 });
    }
    const apk = await writeApk(path.join(root, `${name}.apk`), manifest, [['assets/test-signing-payload.bin', 'unique plaintext signed fixture payload', { compress: false }]]);
    await run(verifier.javaPath, [entropyOption, '-jar', verifier.apksignerPath, 'sign', '--ks', key, '--ks-key-alias', alias, '--ks-pass', 'pass:fixture-password', '--key-pass', 'pass:fixture-password', '--min-sdk-version', '21', apk], { windowsHide: true, timeout: 30000 });
    return apk;
  };
  const base = await sign('base', 'first');
  const inspected = await inspectApk(base, verifier); assert.equal(inspected.signing.state, 'verified', JSON.stringify(inspected.signing)); assert.match(inspected.signing.certificateSha256[0], /^[a-f0-9]{64}$/);
  assert.equal((await inspectApkSet([base], verifier)).state, 'complete-for-declared-requirements');
  const other = await sign('other', 'second', { splitName: 'config.arm' });
  const mixed = await inspectApkSet([base, other], verifier); assert.equal(mixed.state, 'invalid'); assert.match(mixed.reasons.join(' '), /signer/i);
  const matching = await sign('matching', 'first', { splitName: 'config.arm' }); assert.equal((await inspectApkSet([base, matching], verifier)).state, 'complete-for-declared-requirements');
  const bytes = await fs.readFile(base); const marker = bytes.indexOf(Buffer.from('unique plaintext signed fixture payload')); assert.ok(marker > 0); bytes[marker] ^= 1; await fs.writeFile(base, bytes);
  assert.equal((await inspectApk(base, verifier)).signing.state, 'unverified');
});
