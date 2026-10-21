import {MAX_PACKAGE_BYTES, safeRelative, toolchainError, validateToolchainLock} from '../toolchain/manifest.js';

const DEFAULTS = Object.freeze({jdk: '21.0.11', ghidra: '12.1.2', dumper: '6.7.48', assetripper: '1.3.14'});
const ORDER = Object.keys(DEFAULTS);
const MAX_JSON_BYTES = 2 * 1024 ** 2;
const MAX_TOTAL_BYTES = 4 * MAX_JSON_BYTES;
const REQUEST_TIMEOUT_MS = 15000;
const TOTAL_TIMEOUT_MS = 60000;
const MAX_REDIRECTS = 3;
const fail = message => { throw toolchainError('SETUP_RELEASE_INVALID', `${message} Provide a reviewed existing toolchain lock with --lock.`); };

function selection(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid native component selection.');
  const {components, versions = {}} = input;
  if (!Array.isArray(components) || components.length < 1 || components.length > 4 || components.some(id => !ORDER.includes(id)) || new Set(components).size !== components.length) fail('Select one to four unique native components.');
  if (!versions || typeof versions !== 'object' || Array.isArray(versions) || Object.keys(versions).some(id => !ORDER.includes(id))) fail('Unsupported version selection.');
  const exact = {...DEFAULTS};
  for (const [id, version] of Object.entries(versions)) {
    if (typeof version !== 'string' || version.length > 32 || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(version) || (id === 'jdk' && !version.startsWith('21.'))) fail(`Component ${id} requires an exact ${id === 'jdk' ? 'JDK 21 patch ' : ''}version.`);
    exact[id] = version;
  }
  const selected = new Set(components);
  if (selected.has('ghidra')) selected.add('jdk');
  return {ids: ORDER.filter(id => selected.has(id)), versions: exact};
}

function githubSpec(id, version) {
  if (id === 'ghidra') return {repository: 'NationalSecurityAgency/ghidra', tag: `Ghidra_${version}_build`, match: name => typeof name === 'string' && new RegExp(`^ghidra_${version.replaceAll('.', '\\.')}_PUBLIC_\\d{8}\\.zip$`).test(name), root: `ghidra_${version}_PUBLIC`};
  if (id === 'dumper') return {repository: 'wklin8607/Il2CppDumper', tag: 'Il2CppDumper', match: name => name === `Il2CppDumper-v${version}-net8.0.zip`, root: ''};
  return {repository: 'AssetRipper/AssetRipper', tag: version, match: name => name === 'AssetRipper_win_x64.zip', root: ''};
}

// Each request includes body consumption in its deadline. Redirects stay on the
// original official metadata endpoint; no archive URL is ever fetched here.
async function metadata(url, fetchImpl, budget) {
  const initial = new URL(url);
  let current = initial;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const remaining = budget.deadline - Date.now();
    if (remaining <= 0) fail('Release metadata time limit exceeded.');
    const controller = new AbortController();
    let response;
    let reader;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        if (reader) void reader.cancel().catch(() => {});
        reject(toolchainError('SETUP_RELEASE_TIMEOUT', 'Release metadata time limit exceeded. Provide a reviewed existing toolchain lock with --lock.'));
      }, Math.min(REQUEST_TIMEOUT_MS, remaining));
    });
    try {
      const result = await Promise.race([timeout, (async () => {
        response = await fetchImpl(current.href, {redirect: 'manual', signal: controller.signal, headers: {accept: 'application/json', 'user-agent': 'REToolkit-setup'}});
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          let next;
          try { next = new URL(location, current); } catch { fail('Invalid metadata redirect.'); }
          if (!location || redirects === MAX_REDIRECTS || next.origin !== initial.origin || next.pathname !== initial.pathname || next.username || next.password || next.hash) fail('Unsafe metadata redirect or redirect limit exceeded.');
          return {next};
        }
        if (response.status !== 200) fail(`Release metadata HTTP ${response.status}.`);
        const declared = response.headers.get('content-length');
        if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_JSON_BYTES || Number(declared) + budget.bytes > MAX_TOTAL_BYTES)) fail('Release metadata exceeds size limit.');
        if (!response.body || typeof response.body.getReader !== 'function') fail('Release metadata body is unavailable.');
        reader = response.body.getReader();
        const chunks = [];
        let bytes = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          budget.bytes += chunk.value.byteLength;
          if (bytes > MAX_JSON_BYTES || budget.bytes > MAX_TOTAL_BYTES) fail('Release metadata exceeds size limit.');
          chunks.push(Buffer.from(chunk.value));
        }
        try { return {json: JSON.parse(Buffer.concat(chunks).toString('utf8'))}; }
        catch { fail('Release metadata is invalid JSON.'); }
      })()]);
      if (result.next) { current = result.next; continue; }
      return result.json;
    } catch (error) {
      if (error.code?.startsWith('SETUP_')) throw error;
      fail(`Release metadata request failed: ${error.message}`);
    } finally {
      clearTimeout(timer);
      controller.abort();
      // Cancellation must not extend the bounded request deadline.
      if (reader) void reader.cancel().catch(() => {});
      else if (response?.body) void response.body.cancel().catch(() => {});
    }
  }
}

function identity(url, digest, size, expectedUrl, id) {
  if (typeof url !== 'string' || url !== expectedUrl || url.length > 8192) fail(`Invalid official ${id} source URL.`);
  let parsed;
  try { parsed = new URL(url); } catch { fail(`Invalid ${id} source URL.`); }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || /[\x00-\x20\\]/.test(url)) fail(`Invalid official ${id} source URL.`);
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/i.test(digest) || !Number.isSafeInteger(size) || size < 1 || size > MAX_PACKAGE_BYTES) fail(`Missing or invalid publisher checksum/size for ${id}.`);
  return {url, sha256: digest.toLowerCase(), size, verification: 'publisher-checksum'};
}

async function githubPackage(id, version, fetchImpl, budget) {
  const spec = githubSpec(id, version);
  const release = await metadata(`https://api.github.com/repos/${spec.repository}/releases/tags/${spec.tag}`, fetchImpl, budget);
  if (!release || release.tag_name !== spec.tag || release.draft !== false || release.prerelease !== false || !Array.isArray(release.assets)) fail(`Invalid or prerelease ${id} release metadata.`);
  const candidates = release.assets.filter(asset => asset && spec.match(asset.name));
  if (candidates.length !== 1) fail(`Missing or ambiguous ${id} release asset.`);
  const asset = candidates[0];
  const digest = typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') ? asset.digest.slice(7) : null;
  const source = identity(asset.browser_download_url, digest, asset.size, `https://github.com/${spec.repository}/releases/download/${spec.tag}/${asset.name}`, id);
  return {id, version, source, archiveRoot: spec.root};
}

async function jdkPackage(version, fetchImpl, budget) {
  // Adoptium matches build-qualified releases through a semver range; a bare
  // patch returns 404. Filter below still requires one GA for the exact patch.
  const parts = version.split('.');
  const upper = `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
  const range = encodeURIComponent(`[${version},${upper})`).replace(')', '%29');
  const releases = await metadata(`https://api.adoptium.net/v3/assets/version/${range}?architecture=x64&heap_size=normal&image_type=jdk&jvm_impl=hotspot&os=windows&project=jdk&vendor=eclipse`, fetchImpl, budget);
  if (!Array.isArray(releases)) fail('Invalid JDK release metadata.');
  const candidates = [];
  for (const release of releases) {
    if (!release || release.release_type !== 'ga' || typeof release.version_data?.semver !== 'string' || release.version_data.semver.split('+')[0] !== version || !Array.isArray(release.binaries)) continue;
    for (const binary of release.binaries) {
      if (binary && binary.architecture === 'x64' && binary.os === 'windows' && binary.image_type === 'jdk' && binary.jvm_impl === 'hotspot' && binary.heap_size === 'normal' && binary.project === 'jdk') candidates.push({release, binary});
    }
  }
  if (candidates.length !== 1) fail('Missing or ambiguous exact JDK release asset.');
  const {release, binary} = candidates[0];
  const root = release.release_name;
  if (typeof root !== 'string' || !safeRelative(root) || root.includes('/') || !root.startsWith(`jdk-${version}+`) || !/^jdk-\d+\.\d+\.\d+\+\d+(?:\.\d+)*$/.test(root)) fail('Unsafe or mismatched JDK release root.');
  const pkg = binary.package;
  if (!pkg || typeof pkg.name !== 'string' || !safeRelative(pkg.name) || pkg.name.includes('/') || !pkg.name.endsWith('.zip')) fail('Invalid JDK package metadata.');
  const expected = `https://github.com/adoptium/temurin21-binaries/releases/download/${encodeURIComponent(root)}/${pkg.name}`;
  const source = identity(pkg.link, pkg.checksum, pkg.size, expected, 'jdk');
  return {id: 'jdk', version, source, archiveRoot: root};
}

export async function resolveNativeLock(input, {fetchImpl = fetch} = {}) {
  const {ids, versions} = selection(input);
  if (typeof fetchImpl !== 'function') fail('Invalid metadata fetch implementation.');
  const budget = {bytes: 0, deadline: Date.now() + TOTAL_TIMEOUT_MS};
  const packages = [];
  for (const id of ids) packages.push(await (id === 'jdk' ? jdkPackage(versions[id], fetchImpl, budget) : githubPackage(id, versions[id], fetchImpl, budget)));
  return validateToolchainLock({kind: 'retoolkit-toolchain-lock', schemaVersion: 1, platform: 'win32-x64', packages});
}
