# Game reconstruction workflow skill

The user requested a complete REToolkit reconstruction workflow informed by REA's
skill. Implement an agent instruction bundle, not an embedded agent or new
backend orchestration API. Keep current Node services authoritative.

The entrypoint is `retoolkit-game-reconstruction`; reuse the three existing
REToolkit skills for preparation/installation/live Ghidra. Add two conditional
references for exact tool/branch contracts and durable checkpoint/recovery.
Installed copies must keep these relative references self-contained. Root tool
documentation paths are explicitly checkout-relative.

The workflow routes supplied inputs, resolves the finite feature/acceptance scope,
reuses matching analysis state, maps assets/scripts, records hypotheses against
evidence, resolves local library requirements, applies supported source/migration
plans and verifies the exact output artifact. It retains explicit gaps for missing
inputs, unsupported conversion/composition, Editor, original baselines and Jev.
Separate compilation, binding, migrated values, gameplay and visual outcomes.
Use a manual authored ledger under `04_Notes`, never mutate receipt/backend state
to make it agree with agent conclusions. Two repeated same-error repairs without
new evidence stop that loop while independent useful work continues.

Library and migration stages are separate outputs. Their verifiers do not promote
them into the selected export or combine them. A full-game request that depends
on unsupported composition cannot be called complete from separate stage passes.

REFRESH: extend the existing guarded bundle update to four skills. Install the
new workflow into Codex and clients already using the REToolkit bundle (currently
Claude); do not register additional MCP clients or choose a game/workspace.
Snapshot/hash-check and back up affected current folders before updating.

Acceptance uses offline realistic skill scenarios, independent source-contract
review, metadata/link/CLI-parser validation, distribution fixtures and full Node
regression tests. No game or runtime execution acceptance is implied.

## REA sources and adaptation

Pinned upstream revision: `264862bf2e3612c9cb6fcfb861843cbba4e1893f` (read 2026-10-21).
The original files were read, not installed/executed. REToolkit prose is original.

| Source | Adapted idea | REToolkit implementation |
| --- | --- | --- |
| [REA skill](https://github.com/morluto/rea/blob/264862bf2e3612c9cb6fcfb861843cbba4e1893f/.agents/skills/reverse-engineer-anything/SKILL.md) | Route targets, start narrow, reuse matching state, checklist and finding ledger | Workspace-specific intake, bounded asset queries, feature/evidence ledger |
| [Evidence workflows](https://github.com/morluto/rea/blob/264862bf2e3612c9cb6fcfb861843cbba4e1893f/.agents/skills/reverse-engineer-anything/references/evidence-workflows.md) | Keep observations/inferences/unknowns and finite verification scope distinct | Current build/graph/receipt identity and independent acceptance dimensions |
| [Connection/recovery](https://github.com/morluto/rea/blob/264862bf2e3612c9cb6fcfb861843cbba4e1893f/.agents/skills/reverse-engineer-anything/references/connection-and-recovery.md) | Diagnose observed blockers, distinguish host timeout and continuing work | Preserve leases/markers, inspect current operation before retrying |
| [MCP prompts](https://github.com/morluto/rea/blob/264862bf2e3612c9cb6fcfb861843cbba4e1893f/docs/mcp-prompts.md) | Guided workflows are instructions and do not themselves invoke tools | Skill explicitly avoids inventing a workflow runner or REA-only tools |

REA `record_unknown`, `verify_reconstruction`, retained parent IDs and MCP prompts
are not REToolkit capabilities. Use its own existing receipts, files and CLI/MCP
contracts instead of copying those API names. No universal equivalence claim.
