# LDPlayer full package capture

**Goal:** Expose the existing Node APK/split/OBB capture in the desktop and agent
workflow, extending opt-in capture to external app data and private app data when
existing device permissions allow it. The user explicitly selected private data.

**Design:** Keep the install XAPK separate from an application-data ZIP so userdata
is not accidentally indexed/imported as Unity build input. Save a scope manifest
and exact hashes. Report external/private included, absent or denied separately;
denial never becomes a full-backup claim. Existing shell access, run-as and
already-available su may be used; never enable root, remount, chmod, install an
app or delete/write device files. Capture is not an atomic snapshot or a guaranteed
restorable Android backup. Do not launch a game for GUI/agent calls.

**Tasks:** Use subagent-driven-development for an isolated data transport module,
parent orchestration/CLI/GUI integration, then independent review.

- [x] TDD bounded read-only ADB data transport: validated selectors/paths,
  external/private discovery, existing access modes, regular files only, binary
  transfer, before/after checks and explicit permission/absence observations.
- [x] Extend capture with opt-in `--include-data`, separate ZIP + scope receipt,
  integrity checks and preserved failed staging; thread CLI/toolkit option.
- [x] Add desktop LDPlayer device discovery and full capture typed operations,
  using explicit serial/package and optional selected adb.exe. Explain coverage.
- [x] Update docs and reconstruction skill intake; refresh installed skills with
  existing backups/hash guards. No new game/workspace selection or MCP config.
- [x] Review contracts/security, run focused/full tests and actual Electron/ADB
  executable fixtures. No real device/game acceptance or commit/push.

## Verification, 2026-10-21

- Transport author ran 21/21 fake-runner tests: shell/run-as/bounded su fallback,
  denied vs absent vs unknown failures, canonical paths/link rejection, framed
  bounded metadata, binary chunks, stat/hash races and no private output logging.
- Parent capture and typed-surface regressions reproduced missing functionality
  red, then passed. The broker retains partial data coverage for large previews;
  failed command status still takes precedence. MCP capture retains schemaVersion
  and rejects executable/launch flag overrides before invoking the workspace tool.
- Full `npm test` snapshot: 696 tests, 695 passed, 1 skipped, 0 failed. The later
  added MCP wire regression passed within the 3/3 surface suite. Retained
  `npm run test:legacy` passed.
- `node test/real-adb.mjs` passed using a compiled source-owned fake ADB executable:
  APK/splits/OBB plus two binary userdata files; denied private scope reported
  partial; 60 calls held supervisor leases; no game launch/root enablement;
  prior project/bundle survived a partial pull; userdata was excluded from build
  extraction. This did not contact a device or establish LDPlayer compatibility.
- Actual sandboxed Electron `real-desktop-results.mjs` and `real-desktop.mjs`
  passed: 12 navigation panels, LDPlayer typed controls, partial warning and
  existing readable results/Jev settings regressions. Inspected screenshot:
  `.cache/desktop-results-acceptance/e82b25c1-c90b-48af-a2e2-329d7ad8c5ff/ldplayer.png`.
- Independent integration/transport review found no blocking path, permission,
  privacy, integrity or lease issues. Requested bounded-preview/MCP DTO fixes
  were implemented with regression coverage.
- Skill structure validation passed 31 actual MCP names, 36 parsed CLI recipes,
  metadata and local supporting links. Refreshed six installed skill files in
  Codex/Claude with backup:
  `.cache/agent-cleanup/98e624b9-01cb-4cc4-a200-be5fe0814b6b/`.
- No actual emulator/game queries, private-data reads, Unity/Ghidra execution,
  Jev network call, game selection, commit or push occurred in this task.

Remaining operational limits: conservative safe filenames/entry/byte budgets;
existing device command/access support; live multi-file data is not atomic;
the sidecar is not a guaranteed Android restore backup. Missing/denied scopes
remain visible and are not promoted to full coverage.
