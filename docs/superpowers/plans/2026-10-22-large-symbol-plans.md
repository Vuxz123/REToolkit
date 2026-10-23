# Large immutable Ghidra symbol plans

**Goal:** Support the retained 228064550-byte GoodSort plan through the normal typed apply path, preserving its exact bytes/hash and all existing transaction/backup/receipt checks.

**Design:** Keep version-1 plan compatibility. Replace Node's whole-file 32 MiB read with bounded streaming SHA-256 and source identity/link checks, capped at 512 MiB. Mirror the plan budget in Java; stream JSON file reads/writes and discard validated plan entries rather than retaining a second whole plan tree. Generate compact previews and canonical array digests without copying full change/before/after arrays. Keep one atomic Program transaction, snapshot, revision/old-value guards, idempotent operation IDs and uncertain-write recovery. MCP frame/result limits remain unchanged.

**Scope:** Toolkit implementation and owned fixtures. Read-only verification of the retained real plan is allowed; do not apply it, reopen game engines, alter prior plans/backups/receipts, or restart the agent's stopped retry automatically.

- [x] Reproduce the Node rejection with a large owned fixture; implement shared streamed plan verification and await both enqueue/worker rechecks.
- [x] Stream version-1 Java plan generation/validation with the same 512 MiB budget; retain exact hash, binding, revision, old-state and policy behavior.
- [x] Remove mutation-preview array copies and stream canonical digests while retaining compatible receipt/preview hashes.
- [x] Verify small and >217 MiB owned plans, changed/linked/oversized sources, malformed/stale plans, rollback/idempotency behavior and bounded RPC output.
- [x] Verify retained GoodSort plan read-only, update operational guidance, run appropriate regression and real Ghidra fixture acceptance where available, obtain independent review.

No symbol-application success may be claimed from plan verification alone.

## Verification

- Full Node suite: 821 tests, 820 passed, one existing skip, zero failures
  (`.cache/large-symbol-plans-final.log`). Final focused suite: 19/19 passed
  (`.cache/large-symbol-plans-focused-final.log`).
- Actual retained plan verified read-only: 228064550 bytes, exact SHA-256 matches
  its immutable filename. No game engine started and no symbols applied
  (`.cache/large-symbol-real-plan-check.json`).
- Owned real Ghidra streaming fixture with 256 MiB heap: read 228064551 bytes,
  generated/validated 241440021 bytes, with numeric spelling, malformed JSON,
  invalid UTF-8, hard-link, changing-file, size, revision and old-state guards.
- Independent review: no outstanding findings after correcting numeric token
  preservation through public Gson APIs. The actual Ghidra session fixture
  catches OSGi package exports that plain javac does not.
- Existing real Ghidra symbols fixture passed for raw x86, ARM64 ELF and AMD64
  PE. Existing persistent-session fixture passed with 1000 saved symbols,
  compact previews, reopen/readback, snapshot restoration, idempotency,
  cancellation rollback, save/receipt failure recovery and Node supervisor
  Unicode hashing. All engines used owned synthetic fixtures only.
- Installed Codex/Claude workflow references synchronized with backup under
  `.cache/agent-cleanup/ec380432-e370-4341-b6c4-93acb0db8d52`.
