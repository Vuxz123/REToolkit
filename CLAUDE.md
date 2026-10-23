# CLAUDE.md

REToolkit prepares authorized Unity IL2CPP builds for Ghidra, with a persistent
Java headless bridge for CLI queries/typed edits and a retained GUI GhidraMCP path.
The recommended CLI is `retk <command>` after `npm ci` and `npm run cli:install`
(Node.js >=24). npm link registers the command in the existing npm global prefix;
the source checkout remains the toolkit root from any cwd. Do not move engines
or workspace data into another installation. `node re.js` and `re.cmd` remain
valid source entrypoints. Do not advertise a public registry package that has not
been published. Registration does not edit PATH or download engines. `retk gui`
starts the Electron desktop after `npm run gui:install`; it brokers the same Node
CLI through sandboxed typed IPC. PowerShell GUI remains legacy. Ghidra/PyGhidra
launch, desktop runtime installation, visual comparisons and migration commands
are Node modules. See docs/desktop.md and docs/jev-settings.md. Never record API
keys in job payloads, configuration JSON, logs or reports. GUI keys are session
only; file settings reference a TYPESAFE_*/JEV_* environment variable.

## Development Commands

```powershell
npm ci
npm run cli:install
retk --version
npm test
npm run test:legacy
node .\re.js help
node .\re.js doctor
node .\re.js flow <GameName> "<source>" --dry-run
```

`npm run test:cli-install` uses an isolated npm prefix and caller directory to
verify real CMD shims, linked-root identity, JSON/exit behavior and unlinking.
It never registers the test checkout in the user's real global prefix.

The main suite uses built-in `node:test` and `test/*.test.js`; use behavioral
fixtures and disposable temporary directories. Optional `test:legacy` runs the
original hand-rolled `tests/*.Tests.ps1` scripts under Windows PowerShell 5.1.
Those include static source checks and helper execution; they are not live GUI
or real-engine acceptance tests. Do not claim engine success from fake tools.
The retained GUI helper suite is `tests/retk-gui.Tests.ps1`.

## Boundaries And Invariants

- JavaScript owns workspace creation, extraction/scanning, schema/state,
  fingerprints, archive transfer, ADB capture, dump/import orchestration and resume planning.
  Do not implement those commands as a PowerShell fallback.
- `re.js` is the entry point; JavaScript implementation lives under `src/`.
  Tests live under `test/`; `package.json` owns test commands.
- Retain the thin PowerShell-to-Node installer entrypoint and compatibility adapters for
  Ghidra/PyGhidra launchers, raw tool wrappers and AssetRipper. Keep
  those PS5.1-compatible and preserve toolkit-local runtime isolation.
- `mcp` launches the local Python bridge directly from JavaScript, preserving
  stdio and child exit/signal behavior. Protocol stdout must contain no banners.
- Existing `re.ps1`, `scripts/retk-*.ps1` and WinForms GUI are legacy paths.
  The GUI still invokes PowerShell and does not imply JS feature parity.
- `adb devices` and `pull-ldplayer` use `src/adb` and the Node import pipeline.
  Never fall back to the legacy PS pull from the JS CLI. JSON/non-TTY capture
  requires `--skip-launch`; interactive launch waits for confirmation. Require an
  explicit serial for multiple ready devices. Validate package/remote paths,
  remote/local sizes and SHA256 inventories; preserve failed staging and old
  published inputs. Do not choose an arbitrary ABI. The optional `test:adb`
  compiles a source-owned fake executable and does not establish real-device
  compatibility. See `docs/adb-capture.md`.
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

For full reconstruction tasks use `skills/retoolkit-game-reconstruction/SKILL.md`
and its conditional references. It defines the feature/evidence ledger and resume
rules. Library/migration stages require their own verifiers; do not attribute an
export's validation to a different output or assume stage promotion is supported.

Use the current repo-local `skills/retoolkit-*` instructions. Search installed
skill roots for stale `ghidra-reverse-engineering-cli` guidance before following
it. README and `prompts/install-ghidra-skill.md` document detection and manual
backup/update. Global installed skills are outside this migration: do not change
them automatically or overwrite local customizations. For an explicit user
cleanup request, `scripts/clean-agent-integrations.mjs` plans or applies the
known launcher/skill migration with full backups and hash guards.

README is the current JavaScript CLI guide; Tutorial.md is the older PowerShell
workflow. Keep `config/` MCP examples on `node <absolute-re.js> mcp`. Retired
`ghidra` / `ghidra-cli` aliases remain disabled. Native bridge commands are
`session`, `function`, `decompile`, `disasm`, `xrefs`, `strings`, `bytes`,
`comment`, and `symbols plan/apply`. See `docs/ghidra-bridge.md`.

Local Unity library work follows [docs/libraries.md](docs/libraries.md). Register
ZIP roots through `libraries roots add`; `.retk-libraries.json` is local and ignored,
with no roots configured by default. Agent workflow: scan/list, identify the
current export, save a plan, import its operation UUID into staging, then run a
fresh verify. Requirements default to the exported package manifest; an explicit
strict requirements DTO overrides them. The existing `assets mcp <Game>` server
exposes typed `libraries_*` tools; root registration remains CLI-only.
The auto-staging policy allows a unique compatible plan to proceed without a
separate approval. Namespace/package-name hints never establish an exact release.
Do not select latest, replace stubs/DLLs/types/GUIDs, or promote staging over the
original export. Preserve ZIP and source bytes, exact supplied metadata, receipt
hashes, managed package locks and uncertain ownership gates. Import establishes
package resolution; only fresh verification supplies compilation/binding evidence.
UI and behavior remain unverified. Source-owned Unity fixture acceptance does not
establish compatibility with vendor libraries or a user game.

Native setup uses `setup resolve|plan|install|status` and the same existing
toolchain transaction; do not add a second installer. Recommend
`node re.js setup install --lock config/native-windows-x64.lock.json` for the four
native ZIP engines. Exact defaults are JDK21.0.11, Ghidra12.1.2,
Dumper6.7.48 net8.0 and AssetRipper1.3.14; Ghidra includes JDK. Resolution and
unlocked planning access publisher metadata, never select latest or invent a
missing digest. A release without a published checksum requires a reviewed
`--lock`. Locked plans are offline; a complete verified cache makes locked
installation download-free. `setup status` is read-only and metadata alone does
not establish a verified receipt. Downloads retry and resume Range transfers
only within one invocation; no cross-run partial state or force recovery exists.

`install-re-toolkit.ps1` is a PS5.1 Node24 adapter with no raw downloads, Temp
sweep, global environment mutation or installer fallback. No flags reads status.
`-All -NativeOnly` selects the four native engines. `-All` alone must reject GUI
Python, GhidraMCP GUI extensions and global .NET requirements before networking or
writes. `-InstallRuntime` also requires GUI Python; use `-InstallGhidra` or
`--components jdk,ghidra` for native JDK/Ghidra. Preserve exact `-LockedManifest`
and `-PythonManifest` delegation and reject mixed installation/version flags.
The PythonManifest route covers MCP CLI only. GUI Python, GhidraMCP extension
and toolkit-local .NET use the separate Node `desktop-runtime` profile.
Do not replace existing real engines for setup fixtures. The optional
`test:setup-download` downloads the four shipped locked archives into a new
`.cache/setup-vendor-acceptance/<id>` root, verifies inventories and checks
available reference-engine sentinel hashes; it never executes vendor binaries.
Source-owned ZIP/network fixtures alone do not qualify vendor downloads or execution.

Locked installation uses `toolchain plan|install|verify`, shared engine read/write
leases, fixed archive destinations, checksum/size/layout checks and journaled
rollback. Do not bypass uncertain gates or replace active tools. Keep plan/verify
read-only. `python-runtime plan|install|verify` manages CPython 3.12 x64 and MCP
CLI wheels in final-path generations with a receipt-hashed active pointer. Hold
a reader from managed verification through child close; invalid selection must
block MCP, without affecting native preparation. Never silently fall back from
a corrupt managed profile. PyGhidra GUI, extensions and global .NET remain separate.
See `docs/python-runtime.md` for schema, offline pip flags and recovery boundaries.
The Windows adapter permits only pywin32312/cp312-win_amd64's exact known root
hook as inert data. Keep -I -S; never evaluate .pth, call site.addsitedir, or run
pywin32 postinstall. Probe native imports before selection. Vendor qualification
uses a private Temp root and only initialize/tools-list requests; static extension
metadata matching does not establish GUI activation or Program identity.
See `docs/toolchain-and-release.md`; vendor execution/hosted CI/real GUI acceptance
must not be claimed from fixture suites. GUI build replacement/module install now
requires explicit `-Force`/`-InstallPs2Exe`; preserve provenance sidecars.

Use only authorized builds; do not bypass DRM, anti-cheat or payment/licensing,
or redistribute source/assets the user does not own.
