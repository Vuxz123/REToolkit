# Unity reconstruction verification implementation

> **For agentic workers:** Use superpowers:subagent-driven-development with TDD;
> spec review then quality review. Continue the approved reconstruction design
> following the user's "triển tiếp". No automatic commits or global updates.

**Goal:** Validate an exported project in an isolated exact-version Unity staging
copy, report actual MonoScript identities and missing bindings, and expose bounded
results through existing CLI/MCP. This is the Editor verification part of slice3;
DLL removal/type conversion and field migration remain explicitly unsupported.

**Architecture:** The existing service owns workspace/toolchain leases. A fresh
source-only project copy receives a fixed C# Editor helper and a bound request.
A Node supervisor owns the exact Editor child and a persistent second lock marker.
Results bind source graph/build/editor/helper/run hashes; only observed complete
reports with a closed successful process may establish compile/binding readiness.
Original exports, scenes, stubs and package files are never updated by validation.

**Tech Stack:** Node24 ESM, Unity2022.3+/6000 batchmode and fixed Editor C# APIs.

## Shared contracts

Task helper owns `templates/Unity/REToolkitValidation.cs` and helper source tests.
Task runner owns `src/unity/runner.js`, `worker.js`, `report.js`, its fixture/tests.
Root owns `src/unity/validation.js`, staging/schema tests, assets service/API/CLI,
readiness/docs, acceptance and delivery. Use existing worktree
`C:/Users/DPC00176/REToolkit/.worktrees/assetripper-ai`; preserve pending changes.

Helper entry is `REToolkit.EditorValidation.Run`. Inputs are fixed command args
`-retkRequest <request.json>` and `-retkReport <report.json>`; no eval/method input.
Request:
`{kind:'retoolkit-unity-validation-request',schemaVersion:1,runId,graphRevision,
binding,unityVersion,scripts:[{assetId,path}],assets:[{assetId,path,kind}]}`.
Paths are source-relative Assets paths only, scripts <=10000, assets scenes/prefabs
<=10000. Report <=16MiB, total objects <=200000; truncate sets complete:false.

Helper report:
`{kind:'retoolkit-unity-observation',schemaVersion:1,runId,graphRevision,
unityVersion,complete,compilation:{state:'succeeded'|'failed'},
scripts:[{assetId,path,guid,fileID:string,fullName,assembly,resolved:boolean}],
assets:[{assetId,path,kind,loaded:boolean,missingScripts:int,missingReferences:int}],
diagnostics:[{severity:'error'|'warning'|'info',message:string,path:string}]}`.
Use TryGetGUIDAndLocalFileIdentifier(long). Only .cs MonoScripts from request,
GetClass actual assembly/fullName. Open requested scenes/prefabs in staging,
count missing components and object references via SerializedObject. Never save,
never enter Play Mode. Error/limit always report complete:false where unobserved.
All output paths must resolve outside Assets inside the staging run control dir.

Runner:
`runUnityEditor({editor,projectDir,requestFile,reportFile,lockDirectory,
toolkitRoot,timeoutSeconds=600},dependencies={})` ->
`{exitCode,closed:true,timedOut:boolean,logTail:string}`.
editor is exact executable, no shell; fixed batchmode/nographics/projectPath/
executeMethod/logFile- args. Test dependency `engine` allowed programmatic only.
Supervisor holds toolchain reader+second workspace lock marker before spawn;
parent exit/worker death never permits PID-only reclamation. Bounded captured
output/logTail, timeout kills owned child and waits for actual close. If close
unconfirmed preserve gates and throw `unity_recovery_required`. No arbitrary
flags or output paths from CLI/MCP. Exported helper report is untrusted target
content; strict validator rejects unknown structure, unsafe IDs/counts/paths,
duplicates, wrong expected run/revision/version or unrequested assets/scripts.
`validateUnityObservation(report,request)` returns validated report.

Root:
`validateUnityProject({toolkit,name,projectDir,graph,timeoutSeconds},deps={})`
called under workspace lease. Select exact installed Editor using project configured
`unityEditorPath` or `<ProgramFiles>/Unity/Hub/Editor/<version>/Editor/Unity.exe`;
missing exact editor returns blocked, never install or upgrade a project. Validate
file version via adjacent Data/Resources/PackageManager/Editor manifest or a trusted
exact folder and CLI inventory; mismatched version cannot establish readiness.
Use graph inventory Assets/Packages/ProjectSettings, no links/generated caches,
hash copied bytes and recheck original graph before/after. Local file:/git packages
are rejected for staging v1, no uncontrolled outside-project dependencies.
Inject helper into new reserved `Assets/REToolkitValidation/Editor` folder with
Editor-only asmdef, reject source collision. Run artifacts under controlled notes
`assets/unity-validation/<UUID>/project`, request/report/receipt alongside it.
Persist independent state with compileReady/bindingsVerified only for current build
graph+source hash guard and exact complete successful report. Behavior remains
unverified. Nonzero Editor exit/missing report never becomes success; extract bounded
compiler diagnostics from logTail. Store full report, return <=2MiB summary by UUID.
CLI `reconstruct validate <Game> [--timeout-seconds N]`; cached bounded status/report
query `reconstruct validation <Game> --operation <UUID>`; no arbitrary helper/editor
shell flags or output paths. Require AssetRipper session stopped before Editor launch.

## Tasks and verification

- [x] Baseline300 JS,7PS; reuse isolated worktree, byte-backup main before editing.
- [x] Helper: source-owned contract tests red, implement actual MonoScript identity,
  staged scene/prefab traversal, missing script/reference counts and bounded report.
- [x] Runner: fixtures red for process exit/timeout/parent death/worker death and
  malformed/mismatched report; implement owned supervisor and strict validator.
- [x] Root staging: red snapshot mismatch/links/generated paths/duplicate helper/
  package escape tests; stage/copy exact assets and invoke runner; no original writes.
- [x] Root CLI/MCP/readiness red tests and integration, report commands, bounded
  summaries, blocked editor/mismatch, compile success/failure independently.
- [x] Real installed Editor source-owned project compile+missing-script fixture,
  original bytes unchanged; distinguish this from actual game acceptance.
- [x] Independent spec review then code quality; fix important findings with tests.
- [x] Full JS+7PS, explicit hashguard files to main, repeat checks. No commit/push.

## References verified

Unity docs: AssetDatabase.TryGetGUIDAndLocalFileIdentifier (long), MonoScript.GetClass,
GameObjectUtility.GetMonoBehavioursWithMissingScriptCount and batch executeMethod.
Installed CLI1.0.0-beta.3 exposes `unity run` but lacks documented self-update;
readonly CLI inventory found exact2022.3.62f2/6000.0.66f2 installed. Two other Editors
are already open on unrelated projects; this implementation only launches its own
staging project and never targets those sessions. No automatic CLI/Editor update.
