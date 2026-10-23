# Game reconstruction skill implementation plan

**Goal:** Give REToolkit agents a complete, resumable workflow from an authorized
Unity build/export to evidence-backed reconstruction and scoped acceptance.

**Design:** Add `skills/retoolkit-game-reconstruction` with a concise orchestrating
SKILL, conditional tool recipes and a durable Markdown checkpoint contract. Use
the current CLI/MCP implementations as authority. Reuse the existing install,
flow and analysis skills. This supplies agent instructions, not a GUI agent,
workflow engine, new MCP prompts or unsupported conversion capabilities.

**REA research:** Read the actual reverse-engineer-anything skill, evidence and
recovery references, and MCP prompt guide at revision
`264862bf2e3612c9cb6fcfb861843cbba4e1893f`. Adapt target routing, narrow queries,
question/claim/evidence ledgers, reusable state, unresolved findings and finite
verification. Write original REToolkit instructions; do not copy REA tools or
claim that REA capability names exist here. Source records live in the ignored
`.cache/rea-workflow-reference/` and are never executed.

- [x] Baseline pressure/gap review using the existing three skills and contracts.
- [x] Write the workflow, focused references and UI metadata.
- [x] Review realistic continuation/failure scenarios against exact tool schemas.
- [x] Extend the existing guarded skill refresh to install the fourth skill into
  Codex and clients already using this REToolkit bundle; preserve other config.
- [x] Validate structure, local links, source/installed equality and tests.

Acceptance includes: intake and feature checklist; input/graph/project identity;
asset topology and code hypotheses; local library recognition; supported C# stub
changes; explicit migration route; exact-artifact Unity verification; behavior
and visual baselines; optional authorized Jev; bounded repair loops; durable
resume and final partial/full status without claiming whole-game equivalence.

Do not execute any game or use a canceled target. No commit/push in this task.

## Verification, 2026-10-21

- Baseline identified missing orchestration in the three original skills; existing
  integrity rules were retained rather than treated as absent.
- An independent offline evaluator used the new skill on eight realistic cases:
  absent target/cancellation; apply without readiness; separate library/migration
  stages; changed build plus uncertain timeout; unsupported DLL/nested migration;
  target-text instructions; repeated compiler failure; and an authorized ready
  feature slice. Parent inspected the decisions. They preserved scope/freshness,
  routed correct verifiers, recorded missing evidence and continued authorized
  useful work without repeated approval. This is a decision simulation, not
  runtime/gameplay verification. Cases and decisions are in the ignored
  `.cache/game-workflow-evaluation/` directory.
- Independent contract review approved CLI/MCP semantics and bundle refresh.
  It found six old relative links in companion skills; these now explicitly
  reference checkout documentation and explain checkout resolution. Recheck passed.
- Structural validation using the existing Node `yaml` dependency passed metadata,
  UI fields/default prompt, three local references, 28 named MCP tools and 33 CLI
  recipes parsed with their actual parsers. Python's quick validator was attempted
  but PyYAML was unavailable; no package was installed for this task.
- New distribution regression failed before the 4-skill bundle change, then
  passed. Focused migration tests: 9/9. Full `npm test`: 667 tests, 666 passed,
  1 skipped, 0 failed.
- Applied 14 skill file changes to Codex/Claude. Backup:
  `.cache/agent-cleanup/0b56cbb1-5fc3-428b-94fd-461edb547a85/`.
  Verified backup hashes, 20 installed source-file matches, all six installed
  local supporting links, unchanged client configurations and an empty repeat plan.
- No game, original-game media, Unity, Ghidra, AssetRipper or Jev request was run
  as part of this skill implementation. No new workspace/MCP registration was
  selected. Existing unrelated changes were preserved; no commit/push.

Start a new agent session to load `$retoolkit-game-reconstruction`. The skill
retains unsupported DLL conversion/complex migration/stage composition as explicit
blockers instead of promising an automatically reconstructed equivalent game.
