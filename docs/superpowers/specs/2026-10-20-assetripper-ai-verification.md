# AssetRipper AI slices 1–2 qualification

Date: 2026-10-20. Target: user-approved AssetRipper-exported Unity project.
Base commit: `0ce7313`; implementation branch: `feature/assetripper-ai-bridge`.
No new commit/push and no production game data changes are part of this run.

## Delivered behavior

- Node persistent provider, verified private engine copy/default settings,
  OpenAPI capability gate, exact PathIDs, authenticated bounded local RPC and
  serialized jobs. Engine/workspace/toolchain ownership survives uncertain death
  or rollback; already queued work stops before executing after recovery failure.
- Fresh export stages with prior-export backup and exact project JSON rollback.
  Transport readiness does not imply a successful load; failed load blocks export
  and raw reads.
- Exported Unity graph with GUID/local fileID identity, scene hierarchy,
  components, references, prefab information, conservative source declarations,
  assembly constraints, bounded paging and stale snapshot guards.
- Full type/assembly script mapping, verified Dumper declarations and strictly
  build/Program-bound native evidence. Invalid local script IDs and ambiguous or
  constrained declarations cannot authorize source replacement.
- Saved plan/apply/verify workflow for existing supported `.cs` stubs. Exact
  YAML/meta retention, full inventory/type/field guards, synced staging/backups/
  journal, rollback and verified retries. Plan/receipt responses keep operation
  identity and a saved artifact reference without returning huge inventories.
- Shared strict CLI/MCP, clean bounded stdio, typed tool inventory and independent
  exported-project status in doctor/status diagnostics.

## Verification evidence

The worktree baseline before this tranche passed 244 JavaScript tests. The
integrated suite passed 300 tests after implementation and review fixes.
The same commands were rerun from the main workspace after delivery:

| Command | Result |
| --- | --- |
| `npm ci --ignore-scripts --offline` | Passed, five packages installed |
| `npm test` | 300 passed, 0 failed, 0 skipped |
| `npm run test:legacy` | All seven suites passed |
| `npm run test:assets -- C:/Users/DPC00176/REToolkit` | Real engine smoke passed |
| `git diff --check` | Passed |
| `node re.js doctor --task assetripper --json` | Available, without claiming ready |

`npm run test:legacy` passed all seven Windows PowerShell suites. Those suites
qualify legacy helpers/fixtures rather than real GUI execution.

`test/assets-acceptance.test.js` runs a source-owned persistent HTTP engine through
stage/export, MCP index/script queries, saved plan/application, receipt verification
and exact component YAML/meta preservation. Targeted mapping tests separately
verify exact metadata+native evidence joins and reject mismatched build/Program.

Actual installed AssetRipper1.3.14 smoke:

```text
npm run test:assets -- C:/Users/DPC00176/REToolkit
runId: 3b05de6a-9fa4-4bba-b2e7-e6aaba3c35d4
result: passed; private verified copy, real startup/OpenAPI, owned close, zero readers
loadedUserData: false
```

See the [provider qualification](2026-10-20-assetripper-provider-verification.md)
for its 15 process/HTTP/rollback/recovery cases and additional actual engine runs.

## Independent review

Spec review passed after fixing failed-load export, missing child GameObjects,
GUID-only component joins, Editor-constrained assemblies, recovery lease retention,
already queued work after recovery and large private operation payloads. Independent
review reran 38 nonprovider cases, 14 provider cases and the final recovery regression.

Independent code quality review approved the final implementation. Its receipt
output, predefined assembly fallback and control-directory export findings were
reproduced and fixed. Review reran 34 graph/reconstruction/API cases and 20
provider/context/service/acceptance cases. Source text reads use fixed asset IDs,
preserve UTF-8 BOM/content hashes and bound escaped transport output.

## Limits

No actual game has been loaded/exported by this tranche. Real-engine acceptance
qualifies startup/OpenAPI/stop only; fixture exports do not establish AssetRipper
export fidelity. Unity Editor compilation, missing-reference validation and gameplay
were not run. Every receipt retains `compileReady:false` and unverified logic.
DLL conversion, script rebinding/field migrations and Editor validation are slice3.
Binary/custom formats and uncertain C# declarations stay opaque/unsupported.
Input content hashing is synchronous in this version; status/stop latency on
large real builds has not been qualified.

Forty explicit AssetRipper delivery files were copied to main after checking its
170-file byte-hash baseline and exact backup. All 164 baseline files outside the
delivery set retained their original hashes. Pending vendor-MCP changes and
unrelated files remain intact. The worktree is retained for inspection.
