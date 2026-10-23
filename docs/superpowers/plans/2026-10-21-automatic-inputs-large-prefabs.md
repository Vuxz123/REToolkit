# Automatic input selection and large prefab support

**Goal:** Reduce agent intake turns and remove the whole-prefab 16 MiB blocker without losing reference or validation coverage.

**Architecture:** Node chooses a unique supported Android binary using a documented priority; explicit/current choices win. A compact resolver is shared by CLI, desktop and observable MCP jobs. Unity serialized sources stream by document with bounded memory and exact source verification. Unity compile/binding validation uses its own source inventory and Editor observations, independently of graph indexing.

**Scope:** Tooling and synthetic fixtures only. No game execution or reconstruction is requested by this change.

- [x] Add default ARM64, ARMv7, x86_64, x86 preference, manual override and persisted provenance; test ambiguity, stale selections and existing choices.
- [x] Add one-call `inputs resolve` and `workspace.inputs.resolve`; return bounded diagnostics rather than full project inventories.
- [x] Expose automatic resolution in desktop and explain the selected ABI; retain exact manual selectors.
- [x] Stream serialized Unity files for JSON and SQLite indexing; retain per-document limits, strict YAML and source identity verification.
- [x] Decouple compile/binding validation from graph availability using exact source snapshots; never infer reference coverage from inventory alone.
- [x] Update bundled agent workflow to use the resolver and independent validation; verify fixtures, regression suite and desktop acceptance.

Acceptance: multi-ABI APK selects ARM64 without an agent choosing it; a previous manual ARMv7 selection stays selected. Same-ABI duplicates and ambiguous metadata still require a choice. A valid prefab larger than 16 MiB retains references through the last document in both graph stores. An oversized individual document fails explicitly while Unity validation remains available against the full, unchanged source.

## Verification

- Fail-first surface tests reproduced the missing desktop/MCP resolver; independent validation tests reproduced the graph prerequisite; large serialized tests reproduced whole-file rejection.
- Final complete Node suite: 786 tests, 785 passed, 1 existing skip, 0 failures (`.cache/auto-abi-prefab-final.log`).
- Actual Electron fixture acceptance passed automatic ARM64, manual ARMv7 persistence, legacy recovery plus one-click resolution, and bounded pending-input preview (`.cache/desktop-results-acceptance/4f110e43-d053-451a-84b2-b9ae013d26ca/observation.json`). Screenshot inspected.
- Workflow metadata/links and 36 CLI recipes validated; guarded installed Codex/Claude skill refresh changed 8 files with backup `.cache/agent-cleanup/3b1be59b-5852-49ea-a375-5557b5899fb3`; subsequent plan reports no pending changes.
- Independent code review found no important defects. Whitespace check passed. No real Unity Editor/game execution or target-workspace mutation was performed; Unity observations in tests are synthetic.
- Changes remain uncommitted.
