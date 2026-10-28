# Recovery artifacts implementation plan

> Execute inline using the approved milestones; preserve unrelated checkout work.

**Goal:** Diagnose reconstruction gaps and compose existing operations on one
workspace-owned versioned Unity artifact.

**Architecture:** A private toolkit context redirects asset paths and exported
project resolution without repointing project.re.json. The recovery service owns
immutable generation inventories, intents and revision publication; existing
domain services keep their checks. Diagnosis queries verified artifact graphs.

**Tech stack:** Node 24, node:test, existing JSON/SQLite graph and Unity helpers.

- [x] Write failing tests in `test/recovery-artifacts.test.js` for create,
  isolation, stale revision and source/operation composition. Run
  `node --test test/recovery-artifacts.test.js` and observe missing capabilities.
- [x] Add private context in `src/assets/context.js`, use its root resolver in
  `src/assets/service.js`, `src/libraries/service.js` and
  `src/reconstruction/migration-cli.js`; default paths stay unchanged.
- [x] Implement snapshot/publish and strict receipts in
  `src/recovery/artifacts.js`, scope and operation dispatch in
  `src/recovery/service.js`. Save intent before mutation and never silently
  clear failure intent. Use complete inventory verification before publication.
- [x] Write diagnosis tests for unresolved references, runtime uncertainty,
  bounded pages and stale cursors; implement `src/recovery/diagnosis.js`.
- [x] Add strict `src/recovery/definitions.js` and `src/recovery/cli.js`, register
  in `src/assets/api.js` and `re.js`, wire desktop typed operations. Test CLI,
  MCP schemas and durable jobs through `test/recovery-surfaces.test.js`.
- [x] Document exact workflows/limitations in `docs/recovery-artifacts.md` and
  bundled agent tool contracts. Run focused and related regression tests, diff
  checks and review changes before integration into the main checkout.

No existing workspaces or engines are executed; use disposable fixtures. Verify
root file hashes still match the captured baseline before applying owned edits.

Verification: main-checkout related regression: 484 tests, 483 passed, 0 failed, 1 skipped. Final CLI/recovery/desktop acceptance: 28 passed, 0 failed. Read-only review found two P2 issues (historical migration evidence and unknown child outcomes); both reproduced with fixtures and fixed, with no remaining P1/P2 on re-review. Syntax checks and diff whitespace checks passed. No user game or Unity Editor gameplay was run. Changes are integrated into the main checkout without committing or pushing unrelated work.
