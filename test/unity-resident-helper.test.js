import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('resident helper validates fresh per-run paths and editor state before attesting a final report', async t => {
  if (process.platform !== 'win32') return t.skip('owned C# fixture requires Windows Framework compiler');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'retk-resident-helper-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const fixture = (await fs.readFile('test/fixtures/unity-helper/Fixture.cs', 'utf8'))
    .replace('EditorValidation.Run();', `
        request.assets = new EditorValidation.Entry[0];
        request.runId = args[2];
        if (scenario == "mismatch") request.runId = Guid.NewGuid().ToString();
        if (scenario == "version") request.unityVersion = "other";
        UnityEditor.EditorApplication.isCompiling = scenario == "compiling";
        UnityEditor.EditorApplication.isPlayingOrWillChangePlaymode = scenario == "playing";
        UnityEditor.EditorUtility.scriptCompilationFailed = scenario == "compile-failed";
        UnityEngine.SceneManagement.SceneManager.dirty = scenario == "dirty";
        Console.WriteLine("inspection:" + EditorValidation.InspectLive());
        try {
            var receipt = EditorValidation.RunLive(args[3], args[4]);
            if (!File.ReadAllText(args[4]).Contains("\\\"complete\\\":true")) throw new Exception("final report missing");
            Console.WriteLine("receipt:" + receipt);
        } catch (Exception error) { Console.WriteLine("rejected:" + error.Message); return 3; }
        if (UnityEditor.SceneManagement.EditorSceneManager.resets != 2) throw new Exception("scene reset missing");`);
  const fixturePath = path.join(directory, 'Fixture.cs');
  await fs.writeFile(fixturePath, fixture);
  const executable = path.join(directory, 'fixture.exe');
  const compiled = spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe', ['/nologo', '/out:' + executable, path.resolve('templates/Unity/REToolkitValidation.cs'), fixturePath], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
  for (const scenario of ['valid', 'mismatch', 'version', 'compiling', 'compile-failed', 'playing', 'dirty', 'stale', 'outside', 'filename']) {
    const root = path.join(directory, scenario);
    const runId = '12345678-1234-4234-8234-123456789abc';
    const runDirectory = path.join(root, 'runs', runId);
    await fs.mkdir(path.join(root, 'project', 'Assets'), { recursive: true });
    await fs.mkdir(runDirectory, { recursive: true });
    const request = path.join(scenario === 'outside' ? root : runDirectory, 'request.json');
    const report = path.join(runDirectory, scenario === 'filename' ? 'other.json' : 'observation.json');
    await fs.writeFile(request, '{}');
    if (scenario === 'stale') await fs.writeFile(report, 'stale');
    const result = spawnSync(executable, [scenario, root, runId, request, report], { encoding: 'utf8' });
    assert.equal(result.status, scenario === 'valid' ? 0 : 3, scenario + ': ' + result.stdout + result.stderr);
    const inspection = JSON.parse(result.stdout.split(/\r?\n/).find(line => line.startsWith('inspection:')).slice(11));
    assert.equal(inspection.projectPath, path.join(root, 'project'));
    assert.equal(inspection.dirtyScenes, scenario === 'dirty' ? 1 : 0);
    assert.equal(inspection.isCompiling, scenario === 'compiling');
    assert.equal(inspection.isPlaying, scenario === 'playing');
    assert.equal(inspection.scriptCompilationFailed, scenario === 'compile-failed');
    if (scenario === 'valid') {
      assert.match(result.stdout, new RegExp('receipt:' + runId));
      assert.equal(JSON.parse(await fs.readFile(report, 'utf8')).runId, runId);
    } else {
      assert.doesNotMatch(result.stdout, /receipt:/);
      if (scenario === 'stale') assert.equal(await fs.readFile(report, 'utf8'), 'stale');
      else await assert.rejects(fs.access(report));
    }
  }
});
