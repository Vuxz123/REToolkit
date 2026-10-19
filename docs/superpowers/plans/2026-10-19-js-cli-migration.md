# JavaScript CLI Migration Implementation Plan

> **For agentic workers:** The user authorized CLI migration first; GUI work is a separate later task. Changes remain uncommitted for review. Behavioral changes have regression tests; real-engine checks are reported separately below.

**Goal:** Implement milestones 0–2 in the JavaScript CLI while preserving authorized existing workspaces and Ghidra results.

**Architecture:** `re.js` dispatches native JavaScript workspace, input, archive, state and pipeline modules. External engines run as child processes with toolkit-local environments. Selected legacy PowerShell tool adapters remain explicit; core commands never fall back to the old pipeline. The existing PowerShell GUI remains unchanged for later migration.

**Tech stack:** Node.js >=24, built-in `node:test`, Windows, retained PowerShell 5.1 installer/adapters, JDK/Python/.NET/Ghidra/Il2CppDumper engines.

## Scope And File Boundaries

| Files | Responsibility |
|---|---|
| `re.js`, `re.cmd`, `package.json` | Entry points, CLI dispatch, test commands. |
| `src/state.js` | Schema 2 migration, identity, step transitions, persistence. |
| `src/inputs.js`, `src/archive.js` | Input discovery/selection, extraction and portable `.re` transfer. |
| `src/process.js` | Safe engine process execution and isolated runtime environment. |
| `src/toolkit.js` | Resume planning, staged dump/import, project preservation and locking. |
| `test/*.test.js` | Behavioral fixtures and CLI subprocess checks. |
| README, CLAUDE, repo skills, prompt, MCP examples | Current JavaScript CLI contract and migration boundaries. |
| Existing `re.ps1`, `scripts/`, WinForms GUI | Retained legacy surface; do not imply new CLI feature parity. |

## Milestone 0 — Current Behavior And CLI Surface

- [x] Document native JavaScript core, retained installer/adapters, and legacy GUI boundary.
- [x] Point Codex/OpenCode MCP examples at `node <absolute-re.js> mcp`.
- [x] Document stale installed `ghidra-reverse-engineering-cli` detection and explicit backup/update outside active skill roots; make no global skill changes.
- [x] Define prepared versus analysis-ready and usable project-lock guidance.
- [x] Implement `node re.js help` and `re.cmd` with nonzero exit on invalid usage/failure.
- [x] Configure `npm test` for `node --test test/*.test.js`; keep optional original PS suites under `npm run test:legacy`.
- [x] Verify MCP directly spawns the Python stdio bridge and keeps protocol stdout clean.

## Milestone 1 — Input Identity And State

- [x] Write legacy project migration tests; verify they fail before schema implementation.
- [x] Read legacy JSON, preserve unknown fields, back up before schema 2 writes, and avoid upgrading legacy booleans to verified readiness.
- [x] Record native/metadata SHA-256 and size, observed ABI, source/tool identity and step input/output evidence.
- [x] Test multiple candidates; require explicit `--binary`/`--metadata` selection when ambiguous.
- [x] Test identical paths with changed content; invalidate the correct dependent output states.
- [x] Implement pending/running/succeeded/failed/awaiting-user/stale/unknown transitions with run/time/error evidence.
- [x] Keep manual GUI analysis and symbols awaiting user action/unknown until separately confirmed.

## Milestone 2 — Resume And Preservation

- [x] Write subprocess tests showing the second unchanged flow skips valid dump/import work.
- [x] Build an inspectable plan for `--dry-run`; default to safe resume (`--resume` is explicit equivalent intent).
- [x] Validate output evidence rather than file existence alone; missing/corrupt output reruns only the necessary work.
- [x] Stage extraction/dump output, validate before publication, and retain earlier valid artifacts after a later failure.
- [x] Refuse silent Ghidra overwrite; require explicit `--reimport` and a completed backup before replacement.
- [x] Test existing archive destination refusal; explicit `--force` must back up before archive replacement.
- [x] Lock the whole workspace mutation/read-modify-write sequence; concurrent commands must not race. Do not kill user Ghidra processes or rely on PID alone for recovery.
- [x] Cover interrupted runs, Unicode/space paths, output corruption and input changes with disposable fixtures.

## Commands To Verify

Native commands: `init`, `scan`/`add` (`--binary`, `--metadata`), `dump`, Ghidra
`import`, `.re` `export`/`import`, `flow` (`--resume`, `--dry-run`, `--no-open`,
`--reimport`), `analyze`, manual `symbols`, `open`, `path`, `status`, `notes`,
`context`, `candidates`, `doctor`, and direct stdio `mcp`.

Explicit compatibility adapters: `ghidra-gui`, `pyghidra-gui`, `il2cppdumper`,
`assetripper`/`asset-ripper`, `assetripper-cli`, `pull-ldplayer`.

## Acceptance Evidence

- [x] Run `npm test`, review every result and fix failures before claiming completion.
- [x] Run `npm run test:legacy` where PS5.1 is available; distinguish legacy source checks from current CLI behavior.
- [x] Check documented commands and JSON/TOML MCP configuration against the implemented CLI.
- [ ] Full Unity acceptance: actual APK/dumper, existing analyzed game workspace, GUI archive reopen and target-specific MCP query remain unrun.

Verified locally: Ghidra 12.1.2/JDK21 imported a self-generated PE fixture and re-opened it read-only with matching hash/program attestation. Installed Python MCP bridge completed initialize and tools/list with 30 advertised tools; no game target was queried.

Synthetic tests separately cover archive transfer/rollback, preserved annotation payloads, schema migration, staged failures, concurrency, actual child-process cancellation/parent death and output validation. They do not establish real IL2CPP reconstruction or live GUI behavior.
