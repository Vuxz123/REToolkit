import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const windows = process.platform === 'win32';
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const repository = path.resolve('.');
const psQuote = value => "'" + value.replaceAll("'", "''") + "'";
function ps(source, options = {}) {
  return spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 20000, ...options });
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'retk bootstrap '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.mkdir(path.join(root, 'config'));
  for (const file of ['install.cmd', 'scripts/bootstrap.ps1', 'scripts/bootstrap-functions.ps1', 'config/node-windows-x64.lock.json']) {
    await fs.copyFile(path.join(repository, file), path.join(root, file));
  }
  await fs.writeFile(path.join(root, 'scripts/quickstart.mjs'), 'throw new Error("plan must never execute Node");');
  return root;
}
async function tree(root) {
  const rows = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    rows.push([entry.name, entry.isDirectory() ? await tree(target) : (await fs.readFile(target)).toString('base64')]);
  }
  return rows;
}

test('Windows bootstrap scripts parse with Windows PowerShell 5.1', { skip: !windows }, () => {
  const result = ps(`$ErrorActionPreference='Stop'; foreach ($file in @('scripts/bootstrap.ps1','scripts/bootstrap-functions.ps1')) { $tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path ${psQuote(repository)} $file),[ref]$tokens,[ref]$errors); if ($errors.Count) { throw ($errors | Out-String) }; if (!(Test-Path (Join-Path ${psQuote(repository)} $file))) { throw 'bootstrap missing' } }`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('cold bootstrap help and each plan are offline, write-free and need no Node', { skip: !windows }, async t => {
  const root = await fixture(t);
  const before = await tree(root);
  const env = { ...process.env, PATH: '', Path: '' };
  for (const profile of ['cli', 'desktop', 'full']) {
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/bootstrap.ps1'), '--profile', profile, '--plan', '--no-path', '--cache', path.join(root, 'cache with spaces'), '--json'], { encoding: 'utf8', timeout: 20000, env });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.profile, profile);
    assert.equal(report.plan, true);
    assert.deepEqual(report.stages.map(stage => stage.id), profile === 'cli' ? ['dependencies', 'command'] : profile === 'desktop' ? ['dependencies', 'gui', 'command'] : ['dependencies', 'gui', 'native', 'mcp', 'desktop-runtime', 'command', 'diagnostics']);
    assert.equal(report.bootstrap.version, '24.15.0');
    assert.deepEqual(report.bootstrapWrites, ['.cache/bootstrap']);
    assert.ok(report.downstreamWrites.includes('node_modules'));
    assert.equal(report.downstreamWrites.includes('runtime/python'), profile === 'full');
    assert.equal(report.userPath, 'unchanged');
  }
  const help = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/bootstrap.ps1'), '--help'], { encoding: 'utf8', env });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--profile.*cli.*desktop.*full/);
  assert.deepEqual(await tree(root), before);
});

test('cold parser rejects unknown, duplicate and missing options before any writes', { skip: !windows }, async t => {
  const root = await fixture(t);
  const before = await tree(root);
  for (const args of [['--wat'], ['--profile'], ['--profile', 'nope'], ['--plan', '--plan'], ['--profile', 'cli', '--profile', 'full'], ['--cache'], ['--cache', '--plan'], ['--cache', '-x'], ['--cache', 'x'.repeat(4097)], ['--cache', 'cache\nline'], ['--help', '--wat']]) {
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/bootstrap.ps1'), ...args], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, args.join(' '));
    assert.match(result.stdout + result.stderr, /unknown|duplicate|requires|profile/i);
  }
  assert.deepEqual(await tree(root), before);
});

test('cold plan bounds and validates its local Node lock before reading it', { skip: !windows }, async t => {
  const root = await fixture(t);
  for (const bytes of [' '.repeat(16385), JSON.stringify({ version: '999.0.0' })]) {
    await fs.writeFile(path.join(root, 'config/node-windows-x64.lock.json'), bytes);
    const before = await tree(root);
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/bootstrap.ps1'), '--plan', '--json'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /lock/i);
    assert.deepEqual(await tree(root), before);
  }
});

test('cold bootstrap refuses linked checkout and config paths before Node probing or writes', { skip: !windows }, async t => {
  const root = await fixture(t);
  const result = ps(`
$ErrorActionPreference='Stop'
$root=${psQuote(root)}
$alias=Join-Path $root 'checkout-alias'
[void](New-Item -ItemType Junction -Path $alias -Value $root)
try {
  $output=& ${psQuote(powershell)} -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $alias 'scripts/bootstrap.ps1') --plan --json
  if ($LASTEXITCODE -eq 0 -or ($output -join '') -notmatch 'link|reparse') { throw 'linked checkout accepted' }
} finally { [IO.Directory]::Delete($alias) }
[IO.Directory]::Move((Join-Path $root 'config'),(Join-Path $root 'actual-config'))
$alias=Join-Path $root 'config'; [void](New-Item -ItemType Junction -Path $alias -Value (Join-Path $root 'actual-config'))
try {
  $output=& ${psQuote(powershell)} -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $root 'scripts/bootstrap.ps1') --plan --json
  if ($LASTEXITCODE -eq 0 -or ($output -join '') -notmatch 'link|reparse') { throw 'linked config accepted' }
} finally { [IO.Directory]::Delete($alias) }
if (Test-Path (Join-Path $root '.cache')) { throw 'unsafe checkout was written' }
'linked paths rejected'
`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('bootstrap ZIP checks reject traversal, links, foreign roots and collisions before extraction', { skip: !windows }, async t => {
  const root = await fixture(t);
  const result = ps(`
$ErrorActionPreference='Stop'
. ${psQuote(path.join(root, 'scripts/bootstrap-functions.ps1'))}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=${psQuote(root)}
$cases=@('../escape','node-fixture/../escape','/node-fixture/a','other/a','node-fixture/a:b','node-fixture/CON','node-fixture/a.','node-fixture/a\\b','node-fixture/a//','node-fixture/link','node-fixture/A|node-fixture/a','node-fixture/a|node-fixture/a/b')
$index=0
foreach ($case in $cases) {
  $zip=Join-Path $root ('unsafe-'+$index+'.zip'); $out=Join-Path $root ('out-'+$index); $index++
  $archive=[IO.Compression.ZipFile]::Open($zip,[IO.Compression.ZipArchiveMode]::Create)
  try { foreach ($name in (@('node-fixture/node.exe','node-fixture/node_modules/npm/bin/npm-cli.js') + $case.Split('|'))) { $entry=$archive.CreateEntry($name); if ($name.EndsWith('/link')) { $entry.ExternalAttributes = [int](-1577058304) }; $writer=New-Object IO.StreamWriter($entry.Open()); $writer.Write('fixture'); $writer.Dispose() } } finally { $archive.Dispose() }
  $lock=@{ size=(Get-Item $zip).Length; sha256=(Get-FileHash $zip -Algorithm SHA256).Hash; root='node-fixture' }
  $rejected=$false
  try { Expand-VerifiedNodeArchive -ArchivePath $zip -Destination $out -Lock $lock } catch { $rejected=$true }
  if (!$rejected) { throw ('accepted unsafe archive: '+$case) }
  if (Test-Path $out) { throw ('unsafe archive wrote destination: '+$case) }
}
'safe rejection fixtures passed'
`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /safe rejection fixtures passed/);
});

test('portable Node reuse compares all files against a verified archive and preserves uncertain state', { skip: !windows }, async t => {
  const root = await fixture(t);
  const result = ps(`
$ErrorActionPreference='Stop'
. ${psQuote(path.join(root, 'scripts/bootstrap-functions.ps1'))}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=${psQuote(root)}; $zip=Join-Path $root 'good.zip'; $out=Join-Path $root 'portable'
$archive=[IO.Compression.ZipFile]::Open($zip,[IO.Compression.ZipArchiveMode]::Create)
try { foreach($name in @('node-fixture/node.exe','node-fixture/node_modules/npm/bin/npm-cli.js')) { $entry=$archive.CreateEntry($name); $writer=New-Object IO.StreamWriter($entry.Open()); $writer.Write('fixture'); $writer.Dispose() } } finally { $archive.Dispose() }
$lock=@{ size=(Get-Item $zip).Length; sha256=(Get-FileHash $zip -Algorithm SHA256).Hash; root='node-fixture' }
Expand-VerifiedNodeArchive -ArchivePath $zip -Destination $out -Lock $lock
Assert-PortableNodeDirectory -ArchivePath $zip -Directory $out -Lock $lock
[IO.File]::WriteAllText((Join-Path $out 'node.exe'),'changed')
$rejected=$false; try { Assert-PortableNodeDirectory -ArchivePath $zip -Directory $out -Lock $lock } catch { $rejected=$true }
if (!$rejected) { throw 'changed node was accepted' }
if ([IO.File]::ReadAllText((Join-Path $out 'node.exe')) -ne 'changed') { throw 'uncertain state modified' }
[IO.File]::WriteAllText((Join-Path $out 'node.exe'),'fixture')
[IO.File]::WriteAllText((Join-Path $out 'foreign.txt'),'foreign')
$rejected=$false; try { Assert-PortableNodeDirectory -ArchivePath $zip -Directory $out -Lock $lock } catch { $rejected=$true }
if (!$rejected) { throw 'foreign file was accepted' }
$lock.sha256='0'*64; $rejected=$false
try { Expand-VerifiedNodeArchive -ArchivePath $zip -Destination (Join-Path $root 'bad-hash') -Lock $lock } catch { $rejected=$true }
if (!$rejected -or (Test-Path (Join-Path $root 'bad-hash'))) { throw 'unverified archive extracted' }
'reuse verification passed'
`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /reuse verification passed/);
});

test('CMD forwards spaced paths and bootstrap preserves the selected Node quickstart exit code', { skip: !windows || Number(process.versions.node.split('.')[0]) < 24 }, async t => {
  const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  try { await fs.access(npm); } catch { return t.skip('existing Node has no bundled npm'); }
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'scripts/quickstart.mjs'), 'console.log(JSON.stringify({args:process.argv.slice(2), node:process.execPath})); process.exitCode=37;');
  const env = { ...process.env, RETK_BOOTSTRAP_FIXTURE: path.join(root, 'install.cmd'), PATH: path.dirname(process.execPath), Path: path.dirname(process.execPath) };
  const args = ['--profile', 'cli', '--no-path', '--cache', path.join(root, 'cache with spaces'), '--json'];
  const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'call "%RETK_BOOTSTRAP_FIXTURE%" --profile cli --no-path --cache "%RETK_BOOTSTRAP_FIXTURE% cache" --json'], { encoding: 'utf8', env, windowsVerbatimArguments: true });
  assert.equal(result.status, 37, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.args, [...args.slice(0, 4), path.join(root, 'install.cmd') + ' cache', '--json']);
  assert.equal(report.node.toLowerCase(), process.execPath.toLowerCase());
  await assert.rejects(fs.access(path.join(root, '.cache')));
});

test('Node found inside the bootstrap cache cannot bypass portable verification through PATH', { skip: !windows || Number(process.versions.node.split('.')[0]) < 24 }, async t => {
  const root = await fixture(t);
  const portable = path.join(root, '.cache/bootstrap/node-fixture');
  await fs.mkdir(path.join(portable, 'node_modules/npm/bin'), { recursive: true });
  await fs.copyFile(process.execPath, path.join(portable, 'node.exe'));
  await fs.writeFile(path.join(portable, 'node_modules/npm/bin/npm-cli.js'), 'fixture');
  const result = ps(`$ErrorActionPreference='Stop'; . ${psQuote(path.join(root, 'scripts/bootstrap-functions.ps1'))}; $env:PATH=${psQuote(portable)}; $found=Find-BootstrapNode -Repository ${psQuote(root)}; if ($found) { throw ('unverified portable Node selected: '+$found) }; 'portable selection guarded'`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('bootstrap preserves stale locks and interrupted stages rather than resuming them', { skip: !windows }, async t => {
  const root = await fixture(t);
  const result = ps(`
$ErrorActionPreference='Stop'
. ${psQuote(path.join(root, 'scripts/bootstrap-functions.ps1'))}
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=${psQuote(root)}; $cache=Join-Path $root '.cache/bootstrap'; [void][IO.Directory]::CreateDirectory($cache)
$zip=Join-Path $cache 'fixture.zip'
$archive=[IO.Compression.ZipFile]::Open($zip,[IO.Compression.ZipArchiveMode]::Create)
try { foreach($name in @('node-fixture/node.exe','node-fixture/node_modules/npm/bin/npm-cli.js')) { $entry=$archive.CreateEntry($name); $writer=New-Object IO.StreamWriter($entry.Open()); $writer.Write('fixture'); $writer.Dispose() } } finally { $archive.Dispose() }
$lock=@{ filename='fixture.zip'; size=(Get-Item $zip).Length; sha256=(Get-FileHash $zip -Algorithm SHA256).Hash; root='node-fixture' }
$guard=Join-Path $cache '.install.lock'; [IO.File]::WriteAllText($guard,'stale')
$rejected=$false; try { Get-BootstrapPortableNode -Repository $root -Lock $lock } catch { $rejected=$true }
if (!$rejected -or [IO.File]::ReadAllText($guard) -ne 'stale') { throw 'stale lock not preserved' }
[IO.File]::Delete($guard)
$stage=Join-Path $cache 'stage-interrupted'; [void][IO.Directory]::CreateDirectory($stage)
$rejected=$false; try { Get-BootstrapPortableNode -Repository $root -Lock $lock } catch { $rejected=$true }
if (!$rejected -or !(Test-Path $stage) -or (Test-Path (Join-Path $cache 'node-fixture'))) { throw 'interrupted state was resumed' }
if (Test-Path $guard) { throw 'owned lock was not released' }
'uncertain state preserved'
`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('bootstrap download stream enforces exact length and never writes over the locked size', { skip: !windows }, async t => {
  const root = await fixture(t);
  const result = ps(`
$ErrorActionPreference='Stop'
. ${psQuote(path.join(root, 'scripts/bootstrap-functions.ps1'))}
foreach ($length in @(0,7,8,9,70000)) {
  $inputStream=New-Object IO.MemoryStream(,[byte[]](New-Object byte[] $length))
  $outputStream=New-Object IO.MemoryStream
  try {
    $rejected=$false
    try { $copied=Copy-BoundedBootstrapStream -Source $inputStream -Destination $outputStream -ExpectedSize 8 } catch { $rejected=$true }
    if ($length -eq 8) { if ($rejected -or $copied -ne 8 -or $outputStream.Length -ne 8) { throw 'exact download rejected' } }
    elseif (!$rejected) { throw ('wrong length accepted: '+$length) }
    if ($outputStream.Length -gt 8) { throw 'download exceeded write bound' }
  } finally { $inputStream.Dispose(); $outputStream.Dispose() }
}
$bytes=New-Object byte[] 131073; $inputStream=New-Object IO.MemoryStream(,$bytes); $outputStream=New-Object IO.MemoryStream
try { $copied=Copy-BoundedBootstrapStream -Source $inputStream -Destination $outputStream -ExpectedSize $bytes.Length; if ($copied -ne $bytes.Length -or $outputStream.Length -ne $bytes.Length) { throw 'chunked download failed' } } finally { $inputStream.Dispose(); $outputStream.Dispose() }
'bounded stream fixtures passed'
`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /bounded stream fixtures passed/);
  const source = await fs.readFile(path.join(repository, 'scripts/bootstrap-functions.ps1'), 'utf8');
  assert.match(source, /\.Timeout\s*=\s*15000/);
  assert.match(source, /\.ReadWriteTimeout\s*=\s*30000/);
  assert.match(source, /ContentLength/);
  assert.doesNotMatch(source, /WebClient|\.DownloadFile\(/);
});
