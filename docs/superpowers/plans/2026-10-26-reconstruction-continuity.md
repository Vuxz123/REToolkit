# Reconstruction continuity implementation plan

> Execute inline using superpowers:executing-plans; verify each fixture group before integration.

**Goal:** Persist the authorized reconstruction goal beyond a single job and expose real continuation liveness and phase costs.

**Architecture:** Workspace-owned workflow records reference existing jobs and candidate identities. A separate notes lock serializes controller state without blocking job observation. Existing mutation/engine gates remain authoritative. The wake adapter binds to an exact waiting run; explicit claims acknowledge agent resumption.

**Stack:** Node.js, node:test, existing typed CLI/MCP/desktop broker.

- [x] Add `src/workflow/definitions.js`, `store.js`, `candidate.js`, `service.js`: bounded schemas, sealed records, sequence CAS, single active candidate run, exact claims, heartbeat/release, dependencies, job reconciliation, cancellation and conservative completion. First run `node --test test/reconstruction-workflow.test.js` red, then green. Missing gameplay proof must never complete a goal.
- [x] Add `src/workflow/cli.js`; register API/MCP/jobs and desktop forms. Test real CLI roundtrip, malformed DTOs and bounded GUI results in `test/workflow-surfaces.test.js`.
- [x] Extend `src/agents/wake.js` and job schema with `continue-reconstruction`, exact run/job/thread binding and cancellation checks before dispatch. `workflow.wait` registers Codex watcher and retains dispatch intent before spawning. Add fail-first continuation fixtures, including accepted notification without acknowledgment and unsupported harness.
- [x] Add measured phase summaries in recovery and durable job results, preserving existing progress fields. Test counters/controlled labels, not wall-clock speed thresholds. Display them through existing desktop result sections.
- [x] Update bundled launcher, reconstruction skill, checkpoint reference, README and usage documentation: dependency batches up to existing 16-source limit, feature-boundary validation, source verification per apply, explicit lifecycle, no unsupported autonomous-resume claims.
- [x] Run related workflow/wake/recovery/jobs/desktop regression suites, syntax and whitespace checks. Review restart, stale evidence, pause/cancel and interrupted dispatch cases. Report real-harness/gameplay acceptance separately. No user game execution or commit/push is implied.

The stable Unity runner and persistent content-hash cache are separate follow-ups after phase measurements. This delivery must not claim those optimizations or a measured speedup.

## Verification

- Root related regression: 260 passed, zero failures/skips; .cache/continuity-final-tests.log.
- Domain regression in isolated worktree: 304 passed, three skipped, zero failures; .cache/continuity-domain-tests.log there.
- Focused fixture acceptance includes real CLI, artifact source application, source receipts, injected Unity observations, cancellation/dispatch locking, unknown inspection binding, stale historical completion and bounded public proofs. No user game or real Unity/Ghidra execution.
- Installed Codex queue help supports exact thread/message; actual live resumption was not exercised. GUI tests use fixtures, not live Electron acceptance.
- Independent review findings reproduced and corrected; no outstanding concrete P1/P2 in reviewed scope. Subsequent bounded-proof regression also passes.
- JavaScript syntax, CLI help and root whitespace checks pass. No commit/push performed.
