# ScriptableObject data contracts implementation plan

> Execute inline using superpowers:executing-plans and TDD; preserve existing dirty changes and workspaces.

**Goal:** Verify serialized ScriptableObject data across reconstruction without inferring gameplay readiness.

**Architecture:** Opt-in observations extend the existing staged Unity helper. A separate Node data-contract service seals baseline/current provenance and compares full canonical records. Recovery/workflow reuse existing candidate and job ownership.

**Stack:** Node.js node:test, existing JSON/schema validator, existing Unity C# helper.

- [x] Add bounded typed data-observation schema and comparison in src/data/contracts.js; fail-first tests in test/scriptable-data-contracts.test.js for missing/duplicate identity, primitive arrays, nested fields, schema changes, references, large IDs, unsupported coverage and exact diff counts/paging.
- [x] Extend src/unity/report.js and validation.js plus templates/Unity/REToolkitValidation.cs with opt-in dataCapture. Preserve ordinary validation behavior, reject capture resume, attest helper/request/observation and expose data rows through the existing assets report. Test request/report contracts and staging with fake Editor observations, never user code execution.
- [x] Add src/data/{definitions,service,cli}.js. Register data.capture/verify/report in assets API/MCP/jobs/re.js, recovery whitelist and Editor operation forking. Create sealed baseline/verification receipts, validate immutable provenance, run fresh scoped Unity validation and compare complete snapshots; retain partial failures. Test original-export isolation and distinct artifact scopes.
- [x] Add workflow data dimension with exact assetIds/baselineId, data.verify job acceptance and stale-evidence invalidation. Test source+data+binding separation and rejection of mismatched baseline/scope/candidate.
- [x] Expose desktop actions, bounded previews/readable summaries and update bundled reconstruction instructions/README/docs. Source recovery and complex field migration stay in the existing supported scope.
- [x] Run targeted and related Unity/recovery/workflow/desktop regressions, syntax/whitespace checks, independent code review; integrate only owned files after root baseline checks. Do not commit/push or run a real game/Editor.

## Verification

- Root related regression: 316 tests passed, zero failures/skips; .cache/scriptable-data-final-tests.log.
- Actual C# helper executed against the owned Unity API fixture, including primitive arrays, nested/hidden objects, limits/unsupported coverage, signed IEEE zero and large int vectors.
- Helper compiled successfully against installed Unity6000.0.66f2 reference assemblies with the bundled Roslyn compiler. No Unity Editor was launched. Compiler log in the isolated worktree .cache/scriptable-helper-compile/compiler.log.
- Real CLI report/invalid-scope subprocess tests, injected-Editor baseline/fresh verify and workflow receipt reuse pass. No user game executed; live Unity import/deserialization/gameplay remains unverified.
- Review findings reproduced and fixed: floating precision and mixed-case raw paths. Final reviewer reported no remaining concrete P1/P2.
- Latest data evidence is rechecked by workflow.next so changed helper/provenance cannot retain current data acceptance.
- All owned JavaScript syntax, CLI help and root whitespace checks passed; original project data and unrelated dirty changes retained. No commit/push.
