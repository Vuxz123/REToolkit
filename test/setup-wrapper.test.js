import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const installer = fileURLToPath(new URL('../install-re-toolkit.ps1', import.meta.url));
const source = fs.readFileSync(installer, 'utf8');
const windows = {skip: process.platform !== 'win32'};

// Do not execute the previous installer, even inside a fixture: it had global
// environment and user-profile effects. Only the bounded, read-only adapter is
// eligible for the fake-command harness below.
function assertAdapter() {
  assert.ok(source.length < 16000, 'installer must be a thin Node adapter');
  assert.doesNotMatch(source, /Invoke-WebRequest|Invoke-RestMethod|Remove-Item|SetEnvironmentVariable|Start-Process|Set-Location|\$env:\w+\s*=/i);
}

function fixture(t) {
  assertAdapter();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retk-setup-wrapper-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('retk-setup-wrapper-'));
    fs.rmSync(root, {recursive: true, force: true});
  });
  const script = path.join(root, 'install-re-toolkit.ps1');
  fs.copyFileSync(installer, script);
  fs.writeFileSync(path.join(root, 're.js'), '// inert fixture; never executed');
  const sentinel = path.join(root, 'retk-must-stay.tmp');
  fs.writeFileSync(sentinel, 'preserve');
  const runner = path.join(root, 'runner.ps1');
  fs.writeFileSync(runner, `param([string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$global:FixtureConfig = $config
function global:Invoke-FixtureNode {
    $arguments = @($args)
    ConvertTo-Json -InputObject $arguments -Compress | Add-Content -LiteralPath $global:FixtureConfig.log
    if ($arguments.Count -eq 1 -and $arguments[0] -eq '--version') {
        $global:LASTEXITCODE = 0
        Write-Output $global:FixtureConfig.version
        return
    }
    ConvertTo-Json -InputObject @{ argv = $arguments } -Compress
    $global:LASTEXITCODE = [int]$global:FixtureConfig.exitCode
}
function global:Get-Command {
    [CmdletBinding()]param([string]$Name)
    if ($Name -ne 'node') { throw "Unexpected command lookup: $Name" }
    if ($global:FixtureConfig.missingNode) { throw 'fixture node unavailable' }
    [pscustomobject]@{ Source = 'Invoke-FixtureNode' }
}
$parameters = @{}
foreach ($property in $config.parameters.PSObject.Properties) { $parameters[$property.Name] = $property.Value }
& $config.installer @parameters
exit $LASTEXITCODE
`);
  return {
    root,
    run(parameters = {}, options = {}) {
      const config = path.join(root, 'config.json'), log = path.join(root, 'node.jsonl');
      fs.writeFileSync(log, '');
      fs.writeFileSync(config, JSON.stringify({installer: script, parameters, log, version: 'v24.11.0', exitCode: 0, ...options}));
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', runner, config], {
        encoding: 'utf8', windowsHide: true, timeout: 15000,
        env: {...process.env, TEMP: root, TMP: root},
      });
      assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve');
      assert.ok(!fs.existsSync(path.join(root, 'runtime')));
      return {...result, calls: fs.readFileSync(log, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line.replace(/^\uFEFF/, '')))};
    },
  };
}

function argv(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.replace(/^\uFEFF/, '')).argv;
}

test('installer is a bounded adapter without legacy networking, cleanup or environment mutation', () => assertAdapter());

test('PowerShell default setup is read-only status with the script root', windows, t => {
  const f = fixture(t), result = f.run();
  assert.deepEqual(argv(result), [path.join(f.root, 're.js'), 'setup', 'status', '--root', f.root, '--json']);
  assert.deepEqual(result.calls[0], ['--version']);
});

test('PowerShell forwards native plan, exact pins, root and cache as separate arguments', windows, t => {
  const f = fixture(t), root = path.join(f.root, 'private root');
  const planned = argv(f.run({InstallDir: root, InstallGhidra: true, InstallIl2CppDumper: true, InstallAssetRipper: true, Plan: true,
    JdkReleaseVersion: '21.0.12', GhidraVersion: '12.1.3', Il2CppDumperVersion: '6.7.49', AssetRipperVersion: '1.3.15'}));
  assert.deepEqual(planned, [path.join(f.root, 're.js'), 'setup', 'plan', '--root', root, '--json', '--components', 'jdk,ghidra,dumper,assetripper',
    '--jdk-version', '21.0.12', '--ghidra-version', '12.1.3', '--dumper-version', '6.7.49', '--assetripper-version', '1.3.15']);
  const installed = argv(f.run({InstallIl2CppDumper: true, PackageCache: path.join(f.root, 'private cache')}));
  assert.deepEqual(installed, [path.join(f.root, 're.js'), 'setup', 'install', '--root', f.root, '--json', '--components', 'dumper', '--dumper-version', '6.7.48', '--cache', path.join(f.root, 'private cache')]);
});

test('PowerShell All delegates profile preflight and NativeOnly delegates only native engines', windows, t => {
  const f = fixture(t);
  const all = argv(f.run({All: true}));
  assert.ok(all.includes('--all'));
  assert.ok(!all.includes('--native-only'));
  const native = argv(f.run({All: true, NativeOnly: true, Plan: true}));
  assert.ok(native.includes('--all'));
  assert.ok(native.includes('--native-only'));
  assert.ok(!native.includes('--require-component'));
});

test('PowerShell legacy runtime, GUI and dotnet flags become mandatory preflight requirements', windows, t => {
  const f = fixture(t);
  const args = argv(f.run({InstallRuntime: true, InstallGhidraMcp: true, InstallDotNetRuntime: true}));
  assert.equal(args[args.indexOf('--components') + 1], 'jdk');
  const requirements = args.flatMap((arg, index) => arg === '--require-component' ? [args[index + 1]] : []);
  assert.deepEqual(requirements, ['python-gui', 'ghidra-mcp-gui', 'dotnet']);
});

test('PowerShell preserves both exact manifest routes and rejects mixed flags', windows, t => {
  const f = fixture(t);
  for (const [parameter, command] of [['LockedManifest', 'toolchain'], ['PythonManifest', 'python-runtime']]) {
    const manifest = path.join(f.root, 'exact lock.json');
    assert.deepEqual(argv(f.run({[parameter]: manifest, Plan: true})), [path.join(f.root, 're.js'), command, 'plan', manifest, '--root', f.root, '--json']);
    assert.deepEqual(argv(f.run({[parameter]: manifest, PackageCache: 'cache'})), [path.join(f.root, 're.js'), command, 'install', manifest, '--root', f.root, '--json', '--cache', 'cache']);
    for (const extra of [{All: true}, {NativeOnly: true}, {InstallRuntime: true}, {JdkVersion: 21}, {Plan: true, PackageCache: 'cache'}, {[parameter === 'LockedManifest' ? 'PythonManifest' : 'LockedManifest']: manifest}]) {
      const result = f.run({[parameter]: manifest, ...extra});
      assert.notEqual(result.status, 0);
      assert.equal(result.calls.length, 0, 'invalid options must fail before invoking Node');
    }
  }
});

test('PowerShell rejects unsupported endpoints and explicit irrelevant versions before delegation', windows, t => {
  const f = fixture(t);
  for (const parameters of [
    {NativeOnly: true}, {JdkVersion: 17, InstallGhidra: true}, {JdkVersion: 21},
    {AssetRipperRepo: 'someone/else', InstallAssetRipper: true},
    {GhidraMcpReleaseApi: 'https://example.invalid', InstallGhidraMcp: true},
    {PythonVersion: '3.13.0', InstallRuntime: true}, {DotNetRuntimeMajor: 9, InstallDotNetRuntime: true},
    {GhidraVersion: '12.1.2'}, {Il2CppDumperVersion: '6.7.48'}, {JdkReleaseVersion: '21.0.11'}, {AssetRipperVersion: '1.3.14'},
    {PythonVersion: '3.12.10'}, {DotNetRuntimeMajor: 8}, {AssetRipperRepo: 'AssetRipper/AssetRipper'}, {PackageCache: 'cache'},
  ]) {
    const result = f.run(parameters);
    assert.notEqual(result.status, 0, JSON.stringify(parameters));
    assert.equal(result.calls.length, 0, 'invalid options must fail before invoking Node');
  }
});

test('PowerShell reports missing or old Node24 and propagates delegated exit codes', windows, t => {
  const f = fixture(t);
  for (const options of [{missingNode: true}, {version: 'v22.20.0'}, {version: 'not-a-version'}]) {
    const result = f.run({}, options);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Node\.js.*24/i);
    assert.ok(result.calls.length <= 1);
  }
  const result = f.run({InstallAssetRipper: true}, {exitCode: 37});
  assert.equal(result.status, 37, result.stderr);
});
