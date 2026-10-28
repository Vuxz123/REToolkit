# Agent-directed analysis implementation plan

> Use superpowers:subagent-driven-development for isolated tasks and reviews. User approved the design and requested a toggle. Preserve pre-existing workspace changes; deliver changes back to the active checkout after hash checks.

**Goal:** Allow agents to inspect gameplay-oriented native targets and request bounded persistent analysis, optionally deferring global preparation.

**Architecture:** Existing Node CLI, typed jobs and Java persistent bridge. Reuse durable mutations and add a conservative method catalog. Preparation mode is optional, full by default.

**Tech Stack:** Node built-in tests, Java Ghidra 12.1 APIs, desktop DOM tests, source-owned headless fixtures.

- [x] Preparation task: add failing behavior tests in `test/preparation.test.js` and desktop tests; introduce `analysisMode` in `src/preparation/{service,cli}.js`, preparation DTO in `src/jobs/definitions.js`, desktop options and builders. On-demand records deferred analysis/symbol stages and proceeds with assets without changing global readiness. Preserve existing prerequisite/APK work.
- [x] Catalog task: add failing tests for SDK namespace boundaries, unknown visibility, exact large addresses and paging. Implement `src/ghidra/analysis-catalog.js` using current verified dumper/profile evidence and bounded file processing. Expose via CLI and typed jobs.
- [x] Engine task: add real-engine fixture before implementation. Implement `scripts/ghidra/RetkAnalysis.java`, wire `RetkMutations.java` and `RetkSessionBridge.java`; disable automatic analyzer scheduling in the owner. Use existing durable transaction/receipt semantics; bound executable ranges, profile and timeout. Test rollback, neighboring code isolation, repeated coverage and reopen.
- [x] Integration task: add CLI parsing tests, protocol/job schemas and dispatch; bind operation IDs before jobs launch. Update agent context, local skills and bridge/preparation docs to explain toggles, partial xrefs, library boundaries and workflow.
- [x] Verification task: run focused tests then complete `npm test`, real Ghidra acceptance and relevant legacy checks. Have a separate agent review spec compliance and quality, fix findings and recheck. Copy only feature changes to the active checkout when its original file hashes still match. Record actual results and remaining qualification limits.
