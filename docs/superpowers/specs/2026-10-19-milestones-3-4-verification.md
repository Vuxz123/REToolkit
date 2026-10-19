# Milestones 3–4 verification

Date: 2026-10-19. Windows PowerShell 5.1, Node.js 24+, installed Ghidra 12.1.2
and portable JDK21. This record covers the JavaScript CLI; GUI remains legacy.

## Automated and integration evidence

- Before changes: `npm test` at the main workspace passed 83/83.
- Worktree full run: `npm test` passed 133/133 with zero skipped/failed tests.
  An additional path-depth regression was then added; its focused handoff suite
  passed after a confirmed failing run against the old validator.
- `npm run test:legacy`: all 6 retained PowerShell suites passed.
- Guarded integration copied 29 reviewed feature/documentation files to the main
  workspace after verifying its original hashes; unrelated pending changes were
  preserved. Main workspace `npm test` then passed **134/134**, zero failures or
  skips; `npm run test:legacy` passed all 6 suites again.
- Main CLI smoke passed init/scan/status, ZIP creation, moving and verifying the
  ZIP, and offline request generation with the documented question template.
  Project schema2 and diagnostics schema1 were both retained; no service call ran.
- Spec review: no outstanding Critical/Important findings after schema fixes;
  independent targeted run passed 50/50. Quality review: no P1/P2 findings
  remaining; independent focused run passed 30/30.
- Installed MCP probe: `node re.js doctor --task mcp --probe --json` (using the
  worktree entry with `--root` pointing to installed toolkit) initialized the
  real bridge and listed 30 tools. Bridge/extension release6.0.0 and extension
  compatibility12.1.2 were observed. ServerInfo1.28.1 is the MCP SDK version,
  not bridge release. No GUI instance was present: task correctly `blocked`,
  code `MCP_INSTANCE_NOT_RUNNING`. No connect_instance or target query ran.
- Real Ghidra acceptance: `node test/real-handoff.mjs <installed-toolkit>` passed
  twice, including once with the final strict evidence schema. It built its own
  managed PE, seeded an x86 function, imported into an isolated temporary
  project, and opened a native read session. Headless diagnostics were `ready`;
  preparation stayed blocked because dumping was intentionally absent.
- The same acceptance captured actual function listing and decompile rows,
  preserved exact input/Program/run/revision identity and `partial` coverage,
  stopped the session, exported three lightweight files to ZIP, moved/verified
  the ZIP, read its pseudocode evidence and built a Jev request offline. The
  manifest recorded missing dump. No binaries, raw project database or runtime
  configuration entered the inventory. Successful temporary fixtures cleaned up.

## Behavior covered by tests

Task-specific availability/readiness; missing optional runtimes; stale hash or
output evidence; readonly diagnostics; exact native/MCP Program matching;
bounded MCP protocol/deadline/child cleanup; no substring fallback; workspace
and engine leases; moved folder/ZIP verification; tamper/CRC/path/link/case/
inventory/schema/size errors; snapshots revalidated before publication; strict
provider query/result/cursor schemas; stale-build rejection; historical revision
and partial-coverage preservation; no automatic evidence session startup.

Jev tests use local fetch substitutes, not the service. They cover typed question
validation, offline selected text and two-build labels, exact large identifiers,
UTF8/depth/finite-number/request-size limits, aggregate preflight and encoded
state budgets, fixed HTTPS endpoint, Bearer auth, redirect rejection, single
attempt, deadline, missing key, HTTP error sanitization, response stream failure,
and typed noul/choice/score answer/legend/probability validation.

## Limits

No live Jev service call or API key was used. Documentation establishes the HTTP
contract; service acceptance and model/token-context fit need an explicit real
request. REToolkit does not claim a direct Jev ZIP-import interface or supply its
own comparison engine. Official sources:
[API](https://docs.typesafe.ai/api), [models](https://docs.typesafe.ai/models),
[state](https://docs.typesafe.ai/concepts/state).

Source-owned PE fixtures do not qualify real IL2CPP dumping, matching native/
metadata pairs, game Auto Analysis, GUI interactions, ARMv7/Thumb, or live MCP
target queries. Those remain separate engine acceptance work.

Bundles are unsigned observations. Their hashes detect corruption, not trust or
analysis completeness. `readFile` revalidates inventory on each selected read
and may be slow for large bundles. Folder publication was qualified on Windows;
POSIX rename may replace an empty directory created concurrently by another
writer. ZIP and JSON file publication use no-overwrite hard links.

M5 reproducible installation/CI and the GUI migration remain roadmap items.
