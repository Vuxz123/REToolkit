# Readable Evidence Implementation Plan

> Use subagent-driven-development for the independent pure model, parent DOM
> integration, then independent spec and quality review. No commit/push unless
> requested for this new change.

**Goal:** Present GUI results as readable summaries, tables and evidence details.
**Architecture:** Pure bounded view model plus text-only DOM presenter; current
typed broker/IPC and output receipts stay authoritative.
**Tech stack:** Existing Electron, native HTML/CSS/JavaScript, node:test.

- [x] Add failing tests and implement `src/desktop/result-model.js` with
  `test/desktop-result-model.test.js`: status distinctions, metrics, generic
  nested facts/tables, source text, unknown fields, preview bounds and raw JSON.
- [x] Implement `src/desktop/result-view.js`, integrate `renderer.js` and
  `index.html`; allowlist only the new local scripts in `main.cjs`. Reuse the
  presenter for Jev settings checks. Add matching CSS with responsive tables,
  status hierarchy, warnings, logs, collapsed technical JSON and copy feedback.
- [x] Extend the actual Electron fixture to validate normal/blocked/error/table
  states, hostile text and collapse behavior. Keep user clipboard untouched.
  Capture screenshots on fixtures only and inspect the result layout.
- [x] Review spec compliance, review code quality, run relevant/full checks,
  deliver only reviewed changed files with existing main hash guards. Preserve
  unrelated local files and game cancellation. Update user-facing documentation.

## Verification, 2026-10-21

- Independent spec and quality reviews passed. The nested-bookkeeping budget
  regression was reproduced red, fixed, and independently rechecked.
- Main checkout: `npm test` reported 658 tests, 657 passed, 1 skipped, 0 failed.
  Focused model/desktop tests passed 26/26.
- Main checkout: `node test/real-desktop-results.mjs` passed actual job rendering,
  tables, statuses, hostile text preservation, collapsed JSON, copy callback,
  invalid native-copy input and actual missing-auth Jev settings UI.
- Main checkout: `node test/real-desktop-visible.mjs` passed native window
  visibility through the actual CLI, with Node integration disabled.
- Inspected graph and error screenshots. Main artifacts:
  `.cache/desktop-results-acceptance/ce77f4be-ae1b-419c-8b34-8c5d03d3a4d5/`.
- Native clipboard success uses an injected callback in tests; no user clipboard
  was overwritten. No game testing or network Jev request was performed.
- Explicit file delivery used main hash guards and preserved 246 other baseline
  paths. This feature is not committed or pushed.
