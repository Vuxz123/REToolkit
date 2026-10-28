# Meta-free source and retained data baseline blockers

Fix the SS2 validation gates without modifying game sources, original metadata,
historical receipts, raw baselines or workflow acceptance scope.

- [x] Add a compiler-backed route for source-only files without original metadata.
  Bind to exact path, assembly, source bytes and successful staged compilation;
  reject attachable concrete Unity classes and ambiguous/incomplete declarations.
  Keep real asset GUID/fileID requirements unchanged. Cover enum, assembly-info,
  generic Unity base classes and rejection cases with fail-first fixtures.
- [x] Add explicit `data.qualify` for an existing retained baseline. Revalidate
  raw bytes, original validation packets, complete typed/scoped object coverage
  and each ScriptableObject's observed script identity. Record an immutable
  qualification beside the original baseline; never substitute current values.
  Verification can use that qualification while historical partial receipts stay
  unchanged. True missing/unsupported observations stay blocked.
- [x] Expose qualification through CLI/MCP/jobs/recovery/GUI and document the
  route. Test cross-artifact/stale/tampered evidence and preservation of arrays,
  values/references. Reuse the original baseline ID in the existing workflow.
- [x] Run relevant regression suites and independent review; inspect the selected
  SS2 retained packets read-only, then qualify only if actual evidence passes.
  Do not run Editor/Ghidra/game, reset baseline or mark gameplay verified.

Verification: 259 related tests passed, no failures/skips (metafree-final-regressions.log). Independent review closed with no remaining P1/P2. New C# helper compiled against installed Unity API references; no Editor/game launched. SS2 baseline227ffafa-819a-4a0b-9a90-3cc2a2681cec qualified as67605a7d-527d-4b11-b492-243801b43a21:8SO/2637properties;18originalfiles unchanged;project revision unchanged. Historical source packet now conservatively verifies118/119 missing-meta files; DOTween nestedhelpers need fresh reflected-type observation from new helper. Saved current10asset job DTO and ledger handoff; workflow state not changed.
