import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';

export const ANDROID = 'http://schemas.android.com/apk/res/android';

// Small actual Android binary XML fixture, with typed values independent of raw strings.
export function binaryManifest({ packageName = 'com.example.game', versionCode = 7, versionCodeMajor = 0,
  splitName, configForSplit, requiredSplitTypes, splitTypes, requiresSplits = false, usesSplits = [],
  extraAttributes = [], extraElements = [] } = {}) {
  const strings = [];
  const index = value => { if (!strings.includes(value)) strings.push(value); return strings.indexOf(value); };
  const no = 0xffffffff;
  const attr = (name, value, namespace = ANDROID, type = typeof value === 'boolean' ? 0x12 : typeof value === 'number' ? 0x10 : 0x03) => {
    const b = Buffer.alloc(20); b.writeUInt32LE(namespace ? index(namespace) : no, 0); b.writeUInt32LE(index(name), 4);
    b.writeUInt32LE(type === 3 ? index(value) : no, 8); b.writeUInt16LE(8, 12); b[15] = type;
    b.writeUInt32LE(type === 3 ? index(value) : Number(value) >>> 0, 16); return b;
  };
  const start = (name, attrs = []) => {
    const nameIndex = index(name); const encoded = attrs.map(args => attr(...args));
    const b = Buffer.alloc(36); b.writeUInt16LE(0x102, 0); b.writeUInt16LE(16, 2); b.writeUInt32LE(36 + encoded.length * 20, 4);
    b.writeUInt32LE(no, 12); b.writeUInt32LE(no, 16); b.writeUInt32LE(nameIndex, 20);
    b.writeUInt16LE(20, 24); b.writeUInt16LE(20, 26); b.writeUInt16LE(encoded.length, 28);
    return Buffer.concat([b, ...encoded]);
  };
  const end = name => { const b = Buffer.alloc(24); b.writeUInt16LE(0x103, 0); b.writeUInt16LE(16, 2); b.writeUInt32LE(24, 4); b.writeUInt32LE(no, 12); b.writeUInt32LE(no, 16); b.writeUInt32LE(index(name), 20); return b; };
  const attrs = [['package', packageName, null], ['versionCode', versionCode], ['versionCodeMajor', versionCodeMajor], ['isSplitRequired', requiresSplits]];
  for (const [name, value, ns] of [['split', splitName, null], ['configForSplit', configForSplit, null], ['requiredSplitTypes', requiredSplitTypes, ANDROID], ['splitTypes', splitTypes, ANDROID]]) if (value !== undefined) attrs.push([name, value, ns]);
  attrs.push(...extraAttributes);
  const nodes = [start('manifest', attrs), start('uses-sdk', [['minSdkVersion', 21]]), end('uses-sdk')];
  for (const name of usesSplits) nodes.push(start('uses-split', [['name', name]]), end('uses-split'));
  nodes.push(start('application'));
  for (const [name, attributes] of extraElements) nodes.push(start(name, attributes), end(name));
  nodes.push(end('application'), end('manifest'));
  const encoded = strings.map(value => { const s = Buffer.from(value); if (s.length > 127) throw Error('Fixture string too long'); return Buffer.concat([Buffer.from([value.length, s.length]), s, Buffer.from([0])]); });
  const poolHeader = Buffer.alloc(28 + strings.length * 4); let cursor = 0;
  poolHeader.writeUInt16LE(1, 0); poolHeader.writeUInt16LE(28, 2); poolHeader.writeUInt32LE(strings.length, 8); poolHeader.writeUInt32LE(0x100, 16); poolHeader.writeUInt32LE(poolHeader.length, 20);
  for (let i = 0; i < strings.length; i++) { poolHeader.writeUInt32LE(cursor, 28 + i * 4); cursor += encoded[i].length; }
  const padding = Buffer.alloc((4 - cursor % 4) % 4); poolHeader.writeUInt32LE(poolHeader.length + cursor + padding.length, 4);
  const pool = Buffer.concat([poolHeader, ...encoded, padding]);
  const resources = Buffer.alloc(8 + strings.length * 4); resources.writeUInt16LE(0x180, 0); resources.writeUInt16LE(8, 2); resources.writeUInt32LE(resources.length, 4);
  const ids = { name: 0x01010003, minSdkVersion: 0x0101020c, versionCode: 0x0101021b, versionCodeMajor: 0x01010576, isSplitRequired: 0x01010591 };
  for (let i = 0; i < strings.length; i++) resources.writeUInt32LE(ids[strings[i]] ?? 0, 8 + i * 4);
  const header = Buffer.alloc(8); header.writeUInt16LE(3, 0); header.writeUInt16LE(8, 2); header.writeUInt32LE(8 + pool.length + resources.length + nodes.reduce((n, b) => n + b.length, 0), 4);
  return Buffer.concat([header, pool, resources, ...nodes]);
}

export async function writeApk(file, manifestOptions = {}, entries = []) {
  const archive = new yazl.ZipFile(); const done = pipeline(archive.outputStream, createWriteStream(file));
  archive.addBuffer(Buffer.isBuffer(manifestOptions) ? manifestOptions : binaryManifest(manifestOptions), 'AndroidManifest.xml');
  for (const [name, data, options] of entries) archive.addBuffer(Buffer.from(data), name, options);
  archive.end(); await done; return file;
}
