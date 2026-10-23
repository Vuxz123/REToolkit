# Resumable Unity validation

**Goal:** Fix GoodSort's property-budget partial result without hiding incomplete reference coverage or confusing it with compilation failure.

**Approved design:** Optimize reference traversal, checkpoint bounded per-asset work, expose separate compilation/binding/coverage, classify non-attachable source files, allow exact asset scope for item-slot acceptance. Existing reports stay immutable and readable. Tooling changes are verified with owned fixtures; do not disturb running game work, SQLite workers or native sessions.

**Architecture:** The Unity helper keeps schema 1 and adds a versioned `traversal` extension. Asset rows carry per-asset completion/counters/stop location, scripts carry compiler-backed classification. It writes partial checkpoints during observation. Node validates the extension strictly, separates compilation from binding coverage and creates immutable sealed summaries. An explicit resume creates a new operation and reuses only fully attested completed assets for identical source/build, Editor/helper and scope. CLI/MCP/desktop share typed `resumeOperationId` and `assetIds` options. Legacy incomplete rows never count as completed checkpoints.

- [x] Add failing owned helper regressions; implement selective traversal, managed-reference cycle guards, per-asset budgets and checkpoint reports.
- [x] Add strict extended request/report validation, independent compile result, non-attachable script classification and scoped coverage tests.
- [x] Implement source-bound immutable checkpoints, explicit resume, artifact freshness checks and owned session/lease preservation.
- [x] Add typed CLI/MCP/desktop scope/resume options and readable distinct compile/binding/coverage/next-step presentation.
- [x] Update workflow instructions and docs; validate fixtures, full regression, actual helper/desktop acceptance where available, and independent code review.

Acceptance: a property-limited asset remains incomplete while subsequent assets finish; strings and proven reference-free payloads do not consume element traversal, object-reference arrays remain checked, managed-reference cycles terminate; compile success survives partial coverage. Resume skips only verified completed assets and rejects changed source/helper/Editor/scope. Feature scope never grants project-wide binding success. Real Unity fixture acceptance must be recorded separately from mocked Editor output.

## Verification

- Fail-first tests reproduced missing scope/resume routes, false compile failure under partial coverage, inherited/conditional source identity gaps, absent active-asset checkpoints, and stale desktop progress after the 512 KiB diagnostic cap. Fixed cases are covered by behavioral fixtures.
- Final full suite: 818 tests, 817 passed, 1 existing skip, zero failures; `.cache/resumable-validation-complete.log` (fresh after final helper/backend/progress changes).
- Actual helper C# compiled with the Windows Framework compiler and executed against owned fake Unity APIs. Exercises safe primitive payload skips, reference arrays/structs, managed cycles, per-asset limits, continued assets, active pre-load checkpoints, classification and deadline. This is not an actual Unity Editor run.
- Actual Electron fixture acceptance passed form fields, independent compile/partial coverage, resume visibility, running counts, scope isolation and existing desktop regressions; `.cache/desktop-results-acceptance/f28c0504-819b-40c6-a544-860cc727ce97/observation.json`. Screenshot visually inspected.
- Independent review approved after fixing progress parsing beyond the stored-log budget. Final whitespace check passed. Bundled skill links/metadata/CLI recipes validated; guarded installed Codex/Claude workflow sync changed 4 files with backup `.cache/agent-cleanup/df634c2b-fe64-4522-b8d4-5ce7deaccd02`; subsequent dry-run has no changes.
- No real game/Unity Editor run or GoodSort workspace mutation. Existing receipts remain unchanged. Because the helper hash changed, first validation after updating must be fresh; new partial receipts support resume. No commit created.
