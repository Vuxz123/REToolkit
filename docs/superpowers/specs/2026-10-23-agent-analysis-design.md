# Agent-directed Ghidra analysis

Approved scope: the user approved implementation after reviewing selective gameplay analysis and requested an on/off control. Full analysis remains the default. No SDK/package/source deletion is involved.

## Behavior

Preparation accepts `analysisMode: full|on-demand` (CLI `--analysis-mode`). The desktop exposes an on/off checkbox. Full retains the existing pipeline. On-demand defers whole-program analysis and bulk symbol application after a verified import; asset work continues. Reports distinguish deferred native analysis from complete readiness. Resume cannot change the saved mode.

Agents inspect a paged IL2CPP method catalog, classified conservatively as excluded SDK (ads/tracking), gameplay candidate, supporting library, or unknown. Classification is a navigation hint, never proof of ownership. Unknown entries stay visible. Gameplay focus hides recognized ad/telemetry SDK implementations by default; explicit inspection remains possible. Catalog addresses retain exact integer precision and an explicit RVA/VA convention.

The agent explicitly requests bounded `ghidra.analysis.ensure` through jobs or `analysis ensure` CLI. Required fields are an exact executable start, inclusive end, a reason, and an allowlisted analysis kind (`disassemble`, `function`, `stack`). Each range is at most 64 KiB. Function creation follows decoded control flow and refuses bodies outside the requested range or overlaps. Stack analysis applies only to the exact function. No arbitrary analyzer/script or implicit whole-program fallback is allowed.

Analysis is a durable write using the existing session backup, transaction, preview/revision, operation UUID, snapshot, save and receipt machinery. Read sessions cannot analyze. Deadlines cancel bounded work, failures roll back, and uncertain save outcomes retain recovery gates. The owned session suppresses automatic analysis so scoped edits cannot trigger background global analysis. Repeated requests can reuse matching revision-bound coverage; receipts never promote global `analyzed` or complete xrefs.

## Validation

Unit tests cover default/full and on-demand preparation, resume, GUI toggle round trips, catalog SDK boundaries and exact addresses, CLI/job schemas and mutation binding. A source-owned real Ghidra fixture starts without instructions/functions, analyzes one range, decompiles it, checks neighboring SDK bytes stay undefined, rejects invalid ranges, and verifies save/reopen, repeat reuse and read-only rejection. No real game compatibility or measured speedup is inferred from fixtures.

## Observed verification, 2026-10-23

- Active-checkout `npm test`: 1104 passed, 0 failed, 1 skipped (opt-in real Unity migration).
- Ghidra 12.1.2 source-owned x86 and ARM64 scoped fixtures: passed function creation/decompile, neighboring-code isolation, repeat/retry, rollback, deadline expiration, stack, read-only rejection and saved reopen.
- Authenticated live Java bridge + Node analysis mutation/decompile: passed on the x86 fixture.
- Existing real Ghidra session acceptance: passed durable rename/comment/symbol writes, Unicode/overlay handling, snapshot/relocation, cancellation and uncertain receipt/save recovery.
- Installed-JDK mutation digest fixture: passed; retained PowerShell script-bundle/preferences checks: passed.
- Independent spec and quality reviews completed; deadline observation and catalog bounds/assembly propagation findings corrected and rechecked.

The game workspaces were empty. This verifies toolkit behavior on source-owned fixtures, not compatibility or speedup for a particular game. Personal installed skills were not changed; bundled repository skills and future agent context were updated.
