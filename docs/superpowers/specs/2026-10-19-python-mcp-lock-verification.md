# Python/MCP lock verification

Local qualification on Windows, 2026-10-19. This continues the pending M5 archive
installer work from cb20cd6; it does not commit or replace production runtimes.

## Evidence

- Baseline:175/175 JavaScript tests before this change.
- Current full `npm test`:215/215 passed, zero failed/cancelled/skipped. This
  includes all26 existing archive installer regressions,14 runner tests,14 Python
  installer cases, strict schema/receipt tests, current managed/legacy transitions,
  actual CLI and PowerShell delegation, and managed probe reader lifetime.
- `npm run test:legacy`:7/7 Windows PowerShell5.1 suites passed, including GUI
  build provenance with a fixture compiler. No actual GUI EXE was compiled.
- `npm run test:python-runtime`: real copied CPython3.12.10 x64, pinned bundled
  pip25.0.1 and two source-owned wheels installed offline. Receipt verified;
  fixed bridge entry launched with stdio arguments; launch left sealed inventory
  unchanged; changed file was detected. Fetch is refused and downloads=0.
- `npm run test:toolchain`: actual CLI/PowerShell checked cache/ZIP installation,
  tamper detection and replacement backup succeeded, downloads=0 and no vendor
  executable run. An earlier concurrent run safely refused with TOOLCHAIN_BUSY
  because process identity was temporarily unknown. After child processes closed,
  readonly inspection returned idle and the sequential smoke passed.
- `git diff --check`: clean. Generated runtime files and dependencies remain ignored.
- After integration, the main checkout repeated215/215 JavaScript tests, all7
  PowerShell suites and the real offline Python/pip smoke successfully. Hash
  checks protect the previous pending M5 files and unrelated content; checkout
  CRLF/LF differences were reconciled during integration.

The real Python smoke copies an existing interpreter and its bundled pip wheel
into a temporary ZIP/cache. The MCP wheel is a tiny source-owned marker package,
not the actual vendor bridge. The process observation seam reports idle for this
temporary fixture only. The separate archive smoke exercises actual Windows CIM
inspection. Neither substitutes for qualifying vendor code or a production lock.

## Review and recovery boundaries

Independent spec review covered the runtime modules and CLI/PowerShell integration.
It found a cached bridge path when a toolkit was reused across selection changes;
a regression first failed, then passed with current selection lookup and a stable
legacy fallback. A separate quality review checked execution, metadata, rollback
and lease ownership and found no actionable issues (66/66 focused tests passed).

Pointer rollback is byte-exact; uncertain ownership retains its writer gate and
journal. Tests cover source/interpreter mutation, CRC/path/startup hooks, junctions,
old selection, metadata tamper, incompatible actual Python facts, missing/extra
distributions, invalid callable entry, deadlines/cancellation and unconfirmed close.
No automatic PID-only gate reclamation or generation cleanup was added.

## Remaining qualification

No production `active.json`, installed interpreter, existing virtualenv, Ghidra
plugin, workspace, registry, global PATH or .NET was changed. No real vendor
wheel was downloaded/executed, and no target/game program was queried. A reviewed
publisher checksum lock, actual bridge/plugin compatibility, PyGhidra GUI and .NET
installation reproducibility, hosted CI and live Jev remain separate work.
