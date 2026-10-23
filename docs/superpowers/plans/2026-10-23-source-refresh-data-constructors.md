# Source refresh and data constructors

The user approved fixing whole-project rebuilds after source apply and the
meta-free nongeneric data-class constructor gate. Work stays in toolkit fixtures;
do not mutate, restart or validate the running GoodSort operation.

- [x] Reproduce the nongeneric/no-meta constructor failure with a source-owned
  class, same-build constructor metadata and native evidence. Add negative cases
  for inheritance, ambiguous identity, component claims and meta changes.
- [x] Permit bounded compiler-only data classes without a base clause, retaining
  exact source/assembly/type identity, inventory, syntax and initialization proof.
  Preserve the old generic route and all existing binding gates.
- [x] Reproduce full index rebuild after apply through the service. Introduce a
  source refresh module that checks receipt inventory deltas and reparses only
  changed script assets; unchanged asset/reference structure stays intact.
- [x] Clone a verified sealed SQLite generation to a fresh exclusive file, update
  only changed asset rows and metadata, seal a fresh receipt, and preserve the old
  database. This trades bounded database copy/hash I/O for avoiding all YAML and
  node/edge rebuilds; it is not zero-copy or a skip of inventory verification.
- [x] Keep JSON refresh complete: load a verified full current graph, never publish
  the script-only saved plan graph as a complete graph. Fall back to full indexing
  when no complete graph matching the plan baseline is available.
- [x] Connect source/apply/refresh progress into durable jobs. Verify retry reuses
  the published matching graph and that errors retain source receipts and older
  valid graphs. Reject unsupported receipt changes, tampering and source drift.
- [x] Run focused and complete regression; document the copy/hash costs, new gate,
  progress and requirement for a fresh plan/session. Git delivery was subsequently
  requested by the user and is tracked in commit/push history.

## Verification notes

- Fail-first tests reproduced the original missing-meta data-class rejection and
  absent source-refresh reporting. Constructor/init/body retry fixture cases passed.
- Independent review identified post-seal cleanup, output identity across progress
  callbacks, and uncertain manifest-publication handling. Deterministic regression
  tests failed before fixes, then passed for all cases.
- Focused source-refresh/desktop safety suite: 47 passed, zero failed/skipped
  (`.cache/source-refresh-final-focused.log`). Earlier focused reconstruction,
  streaming, validation-progress and desktop suite: 64 passed.
- Initial unconstrained full run: 1081 tests, 1075 passed, 5 failed, 1 skipped.
  Three assertions needed to compare immutable receipt fields separately from
  per-invocation refresh observations. Two tests could not verify the local
  Editor version during concurrent version probes; the production gate was kept.
  Production Editor verification was not relaxed.
- Final full run: `node --test --test-concurrency=2 test/*.test.js` — 1081 tests,
  1080 passed, 0 failed, 1 skipped (gated real Unity acceptance), exit 0.
  Evidence: `.cache/source-fixes-all-tests-final.log`.
- JavaScript syntax and whitespace diff checks passed. Final independent review
  found no remaining concrete P1/P2 issue.
- No live game/Unity validation or running job mutation, commit or push.
