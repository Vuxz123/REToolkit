# CLAUDE.md

REToolkit prepares authorized Unity IL2CPP builds for Ghidra, with a persistent
Java headless bridge for CLI queries/typed edits and a retained GUI GhidraMCP path.
The recommended CLI is `node re.js <command>`
(Node.js >=24), with `re.cmd` as a Windows convenience wrapper. CLI migration
comes first; the PowerShell GUI remains legacy for a later migration.

## Development Commands

```powershell
npm ci
npm test
npm run test:legacy
node .\re.js help
node .\re.js doctor
node .\re.js flow <GameName> "<source>" --dry-run
```

The main suite uses built-in `node:test` and `test/*.test.js`; use behavioral
fixtures and disposable temporary directories. Optional `test:legacy` runs the
original hand-rolled `tests/*.Tests.ps1` scripts under Windows PowerShell 5.1.
Those include static source checks and helper execution; they are not live GUI
or real-engine acceptance tests. Do not claim engine success from fake tools.
The retained GUI helper suite is `tests/retk-gui.Tests.ps1`.

## Boundaries And Invariants

- JavaScript owns workspace creation, extraction/scanning, schema/state,
  fingerprints, archive transfer, dump/import orchestration and resume planning.
  Do not implement those commands as a PowerShell fallback.
- `re.js` is the entry point; JavaScript implementation lives under `src/`.
  Tests live under `test/`; `package.json` owns test commands.
- Retain the PowerShell installer and selected compatibility adapters for
  Ghidra/PyGhidra launchers, raw tool wrappers, LDPlayer and AssetRipper. Keep
  those PS5.1-compatible and preserve toolkit-local runtime isolation.
- `mcp` launches the local Python bridge directly from JavaScript, preserving
  stdio and child exit/signal behavior. Protocol stdout must contain no banners.
- Existing `re.ps1`, `scripts/retk-*.ps1` and WinForms GUI are legacy paths.
  The GUI still invokes PowerShell and does not imply JS feature parity.
- `templates/Il2CppDumper` and `templates/Ghidra` remain template sources.
  Change templates rather than embedding replacement copies in orchestration.

Each workspace uses `workspaces/<GameName>/project.re.json` and the existing
numbered directories. Validate names and paths at a shared boundary. Schema 2
must read legacy projects, preserve unknown fields, back up before migration,
and treat unverifiable legacy progress as unknown rather than successful.
Native binary/metadata identity uses content hashes and sizes; changed content
invalidates dependent outputs. Ambiguous candidates need explicit selection.
A matching metadata filename does not establish compatibility.

Safe resume is the default. Skip only work with valid identity and output
evidence. Stage extraction/dump artifacts and publish after validation. Keep
prior good artifacts when a later stage fails. Serialize workspace mutation
and atomic read-modify-write updates; do not rely only on a final file-write
mutex or PID identity.

Never silently overwrite Ghidra programs. Require explicit reimport, with a
verified backup before replacement. Archive `--force` is explicit too and must
back up an occupied destination before replacement. Do not kill the user's
Ghidra process or delete project locks. For headless work, save and close the
owning GUI project; for interactive work, use its existing MCP server.

`flow` success means prepared, not analysis-ready. Imported state does not prove
Auto Analysis, symbols, correct program selection or MCP readiness. Manual GUI
steps stay awaiting user action/unknown until separately verified.

## Skills And Documentation

Use the current repo-local `skills/retoolkit-*` instructions. Search installed
skill roots for stale `ghidra-reverse-engineering-cli` guidance before following
it. README and `prompts/install-ghidra-skill.md` document detection and manual
backup/update. Global installed skills are outside this migration: do not change
them automatically or overwrite local customizations.

README is the current JavaScript CLI guide; Tutorial.md is the older PowerShell
workflow. Keep `config/` MCP examples on `node <absolute-re.js> mcp`. Retired
`ghidra` / `ghidra-cli` aliases remain disabled. Native bridge commands are
`session`, `function`, `decompile`, `disasm`, `xrefs`, `strings`, `bytes`,
`comment`, and `symbols plan/apply`. See `docs/ghidra-bridge.md`.

Locked installation uses `toolchain plan|install|verify`, shared engine read/write
leases, fixed archive destinations, checksum/size/layout checks and journaled
rollback. Do not bypass uncertain gates or replace active tools. Keep plan/verify
read-only. `python-runtime plan|install|verify` manages CPython 3.12 x64 and MCP
CLI wheels in final-path generations with a receipt-hashed active pointer. Hold
a reader from managed verification through child close; invalid selection must
block MCP, without affecting native preparation. Never silently fall back from
a corrupt managed profile. PyGhidra GUI, extensions and global .NET remain separate.
See `docs/python-runtime.md` for schema, offline pip flags and recovery boundaries.
See `docs/toolchain-and-release.md`; vendor execution/hosted CI/real GUI acceptance
must not be claimed from fixture suites. GUI build replacement/module install now
requires explicit `-Force`/`-InstallPs2Exe`; preserve provenance sidecars.

Use only authorized builds; do not bypass DRM, anti-cheat or payment/licensing,
or redistribute source/assets the user does not own.
