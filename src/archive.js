import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';
import yazl from 'yazl';

async function statIfExists(file) {
  try { return await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function isWithin(root, file) {
  const relative = path.relative(root.toLowerCase(), file.toLowerCase());
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function entryParts(name) {
  const normalized = name.replaceAll('\\', '/');
  const parts = normalized.replace(/\/$/, '').split('/');
  if (!normalized || normalized.startsWith('/') || parts.some(part =>
    !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) ||
    /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error(`Unsafe ZIP entry path: ${name}`);
  }
  return parts;
}

async function extractionRoot(destination) {
  const resolved = path.resolve(destination);
  const existing = await statIfExists(resolved);
  if (existing?.isSymbolicLink()) throw new Error(`Refusing symbolic link destination: ${resolved}`);
  if (existing && !existing.isDirectory()) throw new Error(`Destination directory conflict: ${resolved}`);
  await fs.mkdir(resolved, { recursive: true });
  return fs.realpath(resolved);
}

// Match Windows path identity on every platform; resource files differing only
// by case must retain the legacy last-entry-wins behavior.
async function entryTarget(root, parts, directory) {
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const names = await fs.readdir(current);
    const matches = names.filter(name => name.toLowerCase() === part.toLowerCase());
    if (matches.length > 1) throw new Error(`Ambiguous case-colliding destination entries in ${current}`);
    const next = path.join(current, matches[0] ?? part);
    if (!isWithin(root, next)) throw new Error(`ZIP entry extracts outside destination: ${parts.join('/')}`);
    const stat = await statIfExists(next);
    if (stat?.isSymbolicLink()) throw new Error(`Refusing symbolic link or junction in extraction path: ${next}`);
    const needsDirectory = directory || index < parts.length - 1;
    if (needsDirectory) {
      if (stat && !stat.isDirectory()) throw new Error(`File/directory conflict: ${next}`);
      if (!stat) await fs.mkdir(next);
    } else if (stat && !stat.isFile()) {
      throw new Error(`File/directory conflict: ${next}`);
    }
    current = next;
  }
  return current;
}

function openZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: true, validateEntrySizes: true }, (error, zip) => {
      if (error) reject(error); else resolve(zip);
    });
  });
}

async function extractZipContents(archivePath, destination) {
  const root = await extractionRoot(destination);
  const archive = await openZip(path.resolve(archivePath));
  const files = new Map();
  const abort = new AbortController();
  await new Promise((resolve, reject) => {
    let settled = false;
    const fail = error => {
      if (settled) return;
      settled = true;
      abort.abort();
      archive.close();
      reject(error);
    };
    archive.on('error', fail);
    archive.on('end', () => { settled = true; resolve(); });
    archive.on('entry', entry => {
      const extract = async () => {
        const parts = entryParts(entry.fileName);
        const type = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (type !== 0 && type !== 0o100000 && type !== 0o040000) {
          throw new Error(`Unsupported ZIP entry type (symbolic links are forbidden): ${entry.fileName}`);
        }
        const directory = entry.fileName.endsWith('/') || type === 0o040000;
        const target = await entryTarget(root, parts, directory);
        if (directory) {
          if (entry.uncompressedSize !== 0) throw new Error(`Invalid ZIP directory content: ${entry.fileName}`);
          return;
        }
        const input = await new Promise((res, rej) => archive.openReadStream(entry, (err, stream) => err ? rej(err) : res(stream)));
        let checksum = 0;
        const verify = new Transform({
          transform(chunk, encoding, callback) { checksum = crc32(chunk, checksum); callback(null, chunk); },
          flush(callback) { callback(checksum === entry.crc32 ? null : new Error(`CRC checksum mismatch: ${entry.fileName}`)); },
        });
        // Replace atomically after validation, avoiding partial files and writes
        // through an existing hard link when a duplicate entry overwrites it.
        const temporary = path.join(path.dirname(target), `.retk-extract-${randomUUID()}.tmp`);
        try {
          await pipeline(input, verify, createWriteStream(temporary, { flags: 'wx' }), { signal: abort.signal });
          await fs.rename(temporary, target);
        } finally {
          await fs.rm(temporary, { force: true });
        }
        files.set(target.toLowerCase(), target);
      };
      extract().then(() => { if (!settled) archive.readEntry(); }, fail);
    });
    archive.readEntry();
  });
  return { destination: root, files: [...files.values()] };
}

/** Stream a ZIP-compatible archive into a caller-owned staging directory. */
export async function extractZip(archivePath, destination) {
  return (await extractZipContents(archivePath, destination)).destination;
}

/** Expand split APKs and ZIP OBBs beside their containers, with bounded recursion. */
export async function extractBuild(archivePath, destination, { maxDepth = 8, maxArchives = 256 } = {}) {
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || !Number.isInteger(maxArchives) || maxArchives < 1) {
    throw new Error('Archive limits require maxDepth >= 0 and maxArchives >= 1.');
  }
  const warnings = [];
  const processed = new Set();
  let count = 0;
  const expand = async (file, output, depth) => {
    if (depth > maxDepth) throw new Error(`Nested archive depth limit exceeded: ${file}`);
    if (++count > maxArchives) throw new Error(`Nested archive count limit exceeded: ${file}`);
    let result;
    try { result = await extractZipContents(file, output); }
    catch (error) { throw new Error(`Extract failed for ${file}: ${error.message}`, { cause: error }); }
    for (const nested of result.files.filter(name => /\.(apk|obb)$/i.test(name)).sort()) {
      const key = nested.toLowerCase();
      if (processed.has(key)) continue;
      processed.add(key);
      if (/\.obb$/i.test(nested)) {
        const handle = await fs.open(nested, 'r');
        let header;
        try { header = (await handle.read(Buffer.alloc(4), 0, 4, 0)).buffer; }
        finally { await handle.close(); }
        if (header[0] !== 0x50 || header[1] !== 0x4b) {
          warnings.push(`Non-ZIP OBB retained without extraction: ${nested}`);
          continue;
        }
      }
      await expand(nested, nested.slice(0, -path.extname(nested).length), depth + 1);
      await fs.unlink(nested);
    }
    return result.destination;
  };
  return { destination: await expand(path.resolve(archivePath), destination, 0), warnings };
}

async function walkDirectory(root, visit, relative = '', skip = () => false) {
  for (const name of (await fs.readdir(path.join(root, relative))).sort()) {
    const child = path.join(relative, name);
    if (skip(child)) continue;
    const absolute = path.join(root, child);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links and junctions are not supported in workspace archives: ${absolute}`);
    if (!stat.isDirectory() && !stat.isFile()) throw new Error(`Unsupported workspace file type: ${absolute}`);
    await visit(absolute, child, stat);
    if (stat.isDirectory()) await walkDirectory(root, visit, child, skip);
  }
}

/** Write one workspace as a ZIP-backed .re archive, preserving its root folder. */
export async function exportWorkspace(workspace, archivePath) {
  const workspacePath = path.resolve(workspace);
  const stat = await fs.lstat(workspacePath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Workspace must be a directory: ${workspacePath}`);
  const root = await fs.realpath(workspacePath);
  const manifest = await fs.lstat(path.join(root, 'project.re.json'));
  if (!manifest.isFile()) throw new Error('Workspace project.re.json must be a regular file.');
  const requested = path.resolve(archivePath);
  if (isWithin(root, requested)) throw new Error(`Output archive cannot be inside the workspace: ${requested}`);
  await fs.mkdir(path.dirname(requested), { recursive: true });
  const target = path.join(await fs.realpath(path.dirname(requested)), path.basename(requested));
  if (isWithin(root, target)) throw new Error(`Output archive cannot be inside the workspace: ${target}`);
  const temporary = path.join(path.dirname(target), `.retk-export-${randomUUID()}.tmp`);
  const zip = new yazl.ZipFile();
  zip.on('error', error => zip.outputStream.destroy(error));
  const completion = pipeline(zip.outputStream, createWriteStream(temporary, { flags: 'wx' }));
  // A stream may fail while the source tree is still being enumerated.
  completion.catch(() => {});
  try {
    const prefix = path.basename(workspacePath);
    zip.addEmptyDirectory(prefix);
    await walkDirectory(root, async (absolute, relative, item) => {
      const entry = `${prefix}/${relative.split(path.sep).join('/')}`;
      if (item.isDirectory()) zip.addEmptyDirectory(entry);
      else zip.addFile(absolute, entry);
    }, '', relative => /^\.retk-lock(?:\.|$)/i.test(relative) && !relative.includes(path.sep));
    zip.end();
    await completion;
    await fs.rename(temporary, target);
  } catch (error) {
    zip.outputStream.destroy(error);
    await completion.catch(() => {});
    throw error;
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return requested;
}

/** Extract and identify exactly one root/top-level workspace; publication is the caller's job. */
export async function importWorkspaceArchive(archivePath, stage) {
  const root = await extractZip(archivePath, stage);
  const manifests = [];
  await walkDirectory(root, async (absolute, relative, stat) => {
    if (stat.isFile() && path.basename(relative).toLowerCase() === 'project.re.json') manifests.push({ absolute, relative });
  });
  if (manifests.length !== 1) throw new Error(`Workspace archive must contain exactly one project.re.json; found ${manifests.length}.`);
  const manifest = manifests[0];
  if (manifest.relative.split(path.sep).length > 2) throw new Error('Workspace project.re.json must be at archive root or in one top-level folder.');
  let project;
  try { project = JSON.parse((await fs.readFile(manifest.absolute, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) { throw new Error(`Invalid workspace JSON manifest: ${error.message}`, { cause: error }); }
  if (!project || typeof project !== 'object' || Array.isArray(project)) throw new Error('Invalid workspace JSON manifest: expected an object.');
  return path.dirname(manifest.absolute);
}
