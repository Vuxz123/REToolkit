import test from 'node:test';
import assert from 'node:assert/strict';
import {validateToolchainLock} from '../src/toolchain/manifest.js';
import {resolveNativeLock} from '../src/setup/releases.js';

const hash = 'ab'.repeat(32);
const urls = {
  jdk: 'https://api.adoptium.net/v3/assets/version/%5B21.0.11%2C21.0.12%29?architecture=x64&heap_size=normal&image_type=jdk&jvm_impl=hotspot&os=windows&project=jdk&vendor=eclipse',
  ghidra: 'https://api.github.com/repos/NationalSecurityAgency/ghidra/releases/tags/Ghidra_12.1.2_build',
  dumper: 'https://api.github.com/repos/wklin8607/Il2CppDumper/releases/tags/Il2CppDumper',
  assetripper: 'https://api.github.com/repos/AssetRipper/AssetRipper/releases/tags/1.3.14'
};
function asset(repository, tag, name) {
  return {name, size: 12345, digest: `sha256:${hash}`, browser_download_url: `https://github.com/${repository}/releases/download/${tag}/${name}`};
}
function fixtures() {
  return {
    jdk: [{release_name: 'jdk-21.0.11+10', release_type: 'ga', version_data: {semver: '21.0.11+10.0.LTS'}, binaries: [{architecture: 'x64', os: 'windows', image_type: 'jdk', jvm_impl: 'hotspot', heap_size: 'normal', project: 'jdk', package: {name: 'OpenJDK21U-jdk_x64_windows_hotspot_21.0.11_10.zip', checksum: hash, size: 23456, link: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.11%2B10/OpenJDK21U-jdk_x64_windows_hotspot_21.0.11_10.zip'}}]}],
    ghidra: {tag_name: 'Ghidra_12.1.2_build', draft: false, prerelease: false, assets: [asset('NationalSecurityAgency/ghidra', 'Ghidra_12.1.2_build', 'ghidra_12.1.2_PUBLIC_20260605.zip')]},
    dumper: {tag_name: 'Il2CppDumper', draft: false, prerelease: false, assets: [asset('wklin8607/Il2CppDumper', 'Il2CppDumper', 'Il2CppDumper-v6.7.48-net8.0.zip')]},
    assetripper: {tag_name: '1.3.14', draft: false, prerelease: false, assets: [asset('AssetRipper/AssetRipper', '1.3.14', 'AssetRipper_win_x64.zip')]}
  };
}
async function resolve(selection, data = fixtures(), handler) {
  const calls = [];
  const result = await resolveNativeLock(selection, {fetchImpl: async (url, options) => {
    calls.push(String(url));
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal instanceof AbortSignal);
    if (handler) return handler(String(url), options, calls);
    const id = Object.keys(urls).find(id => urls[id] === String(url));
    assert.ok(id, `unexpected metadata URL: ${url}`);
    return Response.json(data[id]);
  }});
  return {result, calls};
}
test('resolves all defaults in dependency order into an existing valid lock', async () => {
  const {result, calls} = await resolve({components: ['assetripper', 'dumper', 'ghidra', 'jdk']});
  assert.deepEqual(result, validateToolchainLock(result));
  assert.deepEqual(result.packages.map(p => [p.id, p.version, p.archiveRoot]), [
    ['jdk', '21.0.11', 'jdk-21.0.11+10'], ['ghidra', '12.1.2', 'ghidra_12.1.2_PUBLIC'],
    ['dumper', '6.7.48', ''], ['assetripper', '1.3.14', '']
  ]);
  assert.deepEqual(calls, Object.values(urls));
  assert.ok(result.packages.every(p => p.source.sha256 === hash && p.source.verification === 'publisher-checksum'));
});
test('Ghidra includes JDK exactly once and derives its root from a real dated asset', async () => {
  const {result} = await resolve({components: ['ghidra']});
  assert.deepEqual(result.packages.map(p => p.id), ['jdk', 'ghidra']);
  assert.match(result.packages[1].source.url, /20260605\.zip$/);
});
test('rejects unsupported or duplicate components and invalid versions before networking', async () => {
  const invalid = [undefined, {}, {components: []}, {components: ['latest']}, {components: ['jdk', 'jdk']}, {components: 'jdk'}, {components: ['__proto__']},
    {components: ['jdk'], versions: {jdk: 'latest'}}, {components: ['jdk'], versions: {jdk: '21.0.11/../../other'}},
    {components: ['jdk'], versions: {jdk: '22.0.1'}}, {components: ['jdk'], versions: {unknown: '1.2.3'}},
    {components: ['jdk'], versions: {jdk: '21.0.11+10'}}, {components: ['assetripper'], versions: {assetripper: '1.3.x'}}];
  for (const selection of invalid) await assert.rejects(resolve(selection, undefined, () => assert.fail('invalid selection performed networking')), /component|version|selection/i);
});
test('uses exact version overrides without latest endpoints', async () => {
  const data = fixtures();
  data.assetripper.tag_name = '1.3.15';
  data.assetripper.assets = [asset('AssetRipper/AssetRipper', '1.3.15', 'AssetRipper_win_x64.zip')];
  const {result, calls} = await resolve({components: ['assetripper'], versions: {assetripper: '1.3.15'}}, data, url => {
    assert.equal(url, urls.assetripper.replace('1.3.14', '1.3.15'));
    return Response.json(data.assetripper);
  });
  assert.equal(result.packages[0].version, '1.3.15');
  assert.equal(calls.length, 1);
});
test('rejects missing or ambiguous assets, wrong release tags and prereleases', async () => {
  for (const mutate of [d => d.assets.push({...d.assets[0]}), d => d.assets.splice(0), d => {d.tag_name = '1.3.15';}, d => {d.prerelease = true;}, d => {d.draft = true;}]) {
    const data = fixtures(); mutate(data.assetripper);
    await assert.rejects(resolve({components: ['assetripper']}, data), /release|asset|ambiguous/i);
  }
});
test('rejects missing or invalid digest and size with reviewed lock guidance', async () => {
  for (const mutate of [a => delete a.digest, a => {a.digest = `md5:${hash}`;}, a => {a.digest = 'sha256:abc';}, a => {a.size = 0;}, a => {a.size = 8 * 1024 ** 3 + 1;}, a => {a.size = '12345';}]) {
    const data = fixtures(); mutate(data.dumper.assets[0]);
    await assert.rejects(resolve({components: ['dumper']}, data), /reviewed.*lock/i);
  }
});
test('requires asset URLs to match official repository, exact release and asset name', async () => {
  for (const url of ['https://evil.example/AssetRipper_win_x64.zip', 'http://github.com/AssetRipper/AssetRipper/releases/download/1.3.14/AssetRipper_win_x64.zip', 'https://github.com/other/AssetRipper/releases/download/1.3.14/AssetRipper_win_x64.zip', 'https://github.com/AssetRipper/AssetRipper/releases/download/1.3.15/AssetRipper_win_x64.zip', 'https://github.com/AssetRipper/AssetRipper/releases/download/1.3.14/AssetRipper_win_x64.zip?token=bad']) {
    const data = fixtures(); data.assetripper.assets[0].browser_download_url = url;
    await assert.rejects(resolve({components: ['assetripper']}, data), /source|asset|URL/i);
  }
});
test('JDK requires unique GA exact patch metadata and safe release roots', async () => {
  for (const mutate of [d => d.push(structuredClone(d[0])), d => {d[0].version_data.semver = '21.0.12+1';}, d => {d[0].release_type = 'ea';}, d => {d[0].release_name = '../jdk';}, d => {d[0].binaries[0].package.checksum = null;}, d => {d[0].binaries[0].package.link = 'https://evil.example/jdk.zip';}, d => {d[0].binaries[0].architecture = 'aarch64';}]) {
    const data = fixtures(); mutate(data.jdk);
    await assert.rejects(resolve({components: ['jdk']}, data), /JDK|jdk|source|checksum|ambiguous/i);
  }
});
test('Adoptium exact patch range selects its single GA among actual EA-shaped records', async () => {
  const data = fixtures();
  const ga = data.jdk[0];
  ga.vendor = 'eclipse';
  ga.version_data = {build: 10, major: 21, minor: 0, security: 11, openjdk_version: '21.0.11+10-LTS', optional: 'LTS', semver: '21.0.11+10.0.LTS'};
  const ea = structuredClone(ga);
  Object.assign(ea, {release_name: 'jdk-21.0.11+10-ea-beta', release_type: 'ea'});
  ea.version_data.semver = '21.0.11-beta+10.0.ea';
  const otherPatch = structuredClone(ga);
  otherPatch.version_data.semver = '21.0.12+1.0.LTS';
  data.jdk.push(ea, otherPatch);
  const {result, calls} = await resolve({components: ['jdk']}, data);
  assert.deepEqual(calls, [urls.jdk]);
  assert.equal(result.packages[0].version, '21.0.11');
  assert.equal(result.packages[0].archiveRoot, 'jdk-21.0.11+10');
});
test('bounds declared and streamed metadata before parsing JSON', async () => {
  await assert.rejects(resolve({components: ['assetripper']}, undefined, () => new Response('{}', {headers: {'content-length': String(2 * 1024 ** 2 + 1)}})), /metadata.*limit|metadata.*large/i);
  await assert.rejects(resolve({components: ['assetripper']}, undefined, () => new Response(' '.repeat(2 * 1024 ** 2 + 1))), /metadata.*limit|metadata.*large/i);
});
test('rejects HTTP failures and malformed metadata', async () => {
  await assert.rejects(resolve({components: ['assetripper']}, undefined, () => new Response('{}', {status: 429})), /429/);
  await assert.rejects(resolve({components: ['assetripper']}, undefined, () => new Response('bad json')), /JSON/i);
});
test('rejects unsafe redirects and bounds redirects even within an official endpoint', async () => {
  await assert.rejects(resolve({components: ['assetripper']}, undefined, () => new Response(null, {status: 302, headers: {location: 'https://evil.example/metadata'}})), /redirect/i);
  await assert.rejects(resolve({components: ['assetripper']}, undefined, () => new Response(null, {status: 302, headers: {location: 'https://api.github.com/binary.zip'}})), /redirect/i);
  let count = 0;
  await assert.rejects(resolve({components: ['assetripper']}, undefined, () => {
    count++;
    return new Response(null, {status: 302, headers: {location: `${urls.assetripper}?page=${count}`}});
  }), /redirect/i);
  assert.equal(count, 4);
});
test('Ghidra dated asset names have one exact PUBLIC separator', async () => {
  const data = fixtures();
  data.ghidra.assets[0] = asset('NationalSecurityAgency/ghidra', 'Ghidra_12.1.2_build', 'ghidra_12.1.2__PUBLIC_20260605.zip');
  await assert.rejects(resolve({components: ['ghidra']}, data), /Missing.*ghidra.*asset/i);
});
test('follows an official metadata redirect and never follows its ZIP source', async () => {
  const data = fixtures();
  const {result, calls} = await resolve({components: ['assetripper']}, data, (url, options, calls) => {
    if (calls.length === 1) return new Response(null, {status: 307, headers: {location: '?page=1'}});
    assert.equal(url, `${urls.assetripper}?page=1`);
    return Response.json(data.assetripper);
  });
  assert.equal(calls.length, 2);
  assert.equal(result.packages[0].source.url, data.assetripper.assets[0].browser_download_url);
});
test('bounds metadata body consumption even when its stream never finishes', async () => {
  let canceled = false;
  const started = Date.now();
  await assert.rejects(resolve({components: ['assetripper']}, undefined, () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{')); },
    cancel() { canceled = true; }
  }))), /time limit/i);
  assert.ok(canceled);
  assert.ok(Date.now() - started < 20000);
});
