# Node native setup verification — 2026-10-20

## Delivered behavior

The four native ZIP installers now use JavaScript and the existing toolchain
transaction. `setup resolve|plan|install|status` adds exact release metadata
resolution, a shipped Windows x64 lock, compact JSON results and stderr progress.
The PS5.1 installer is a 148-line Node24 adapter. Its exact native/Python manifest
routes are retained. Unsupported GUI Python, GUI extensions and global .NET
requests fail preflight; `-All` requires an explicit `-NativeOnly` selection.

Ghidra's dated asset is selected from its actual release tag, not a guessed URL.
Downloads retry transient errors at most three times, can resume within one call
with strict Range checks, and require the complete locked SHA256/size. Existing
leases, staged publication, rollback, inventory verification and retained backups
remain the installation authority. No dependencies were added.

## Evidence

- Main baseline: 426 JS tests passed before changes; 241 existing tracked or
  pending production paths were hashed and backed up before delivery.
- Worktree final `npm test`: **484 passed, 0 failed, 0 skipped**.
- Worktree `npm run test:legacy`: all **7 PowerShell suites passed**.
- `npm run test:toolchain`: actual setup/toolchain CLI and exact-manifest
  PowerShell delegation passed with a source-owned cached ZIP in Temp. Includes
  offline planning, setup replacement/status, tamper detection and retained backup.
  No download or vendor execution.
- Independent spec review found no important/critical issues; independent quality
  review found none and ran **84 focused tests, all passed**.
- RED/GREEN covered missing setup modules, release selection, interrupted
  transfers and the AssetRipper version marker. The first full suite also exposed
  an existing AssetRipper fixture race: transport readiness preceded completion
  of the asynchronous source-load job. That test now waits for the existing job
  completion before checking destination refusal. Production AssetRipper code
  was not changed for this synchronization fix; its 15-test suite then passed.

## Official archive acceptance

The opt-in `npm run test:setup-download -- <reference-toolkit>` ran successfully
against the shipped lock. It downloaded actual official ZIPs into a new isolated
toolkit, verified full archive identity and installed inventories, checked that
the writer gate was released, and retained its evidence. No vendor binary ran.

| Package | Exact version | Verified installed files |
| --- | --- | ---: |
| Temurin JDK | 21.0.11 | 490 |
| Ghidra | 12.1.2 | 5,225 |
| Il2CppDumper net8.0 | 6.7.48 | 17 |
| AssetRipper | 1.3.14 | 5 |

The inventory includes generated adapters and the locked AssetRipper version
marker. The marker records package provenance, not independent execution proof.

Local evidence root:
`.worktrees/assetripper-ai/.cache/setup-vendor-acceptance/dba826b5-34e9-478b-a8d7-7c3e3598ad3a/acceptance.json`.
All six available reference-engine sentinels retained their original SHA256;
this is a sentinel check, not a hash comparison of every old engine file.
No existing engine was replaced. The source lock SHA256 is
`31f832eb958c529ac8086d85dc996fcfe05ce45e129a668ccb292a258dc04df9`.

## Delivery verification

Delivered exactly **27 owned files** with baseline-hash guards. All **228 other
baseline paths** retained their original bytes, including the pending
`scripts/retk-core.ps1` changes. No blanket synchronization was used.

Repeated in the main workspace: **484/484 JS tests**, **7/7 PowerShell suites**
and the CLI/PowerShell fixture smoke passed. The first main smoke run, concurrent
with the process-heavy suites, was conservatively refused with `TOOLCHAIN_BUSY`
because process identity was unverified; a later read-only CIM check found no
missing identities and the isolated smoke passed. No process gate was weakened.
The main CLI also re-verified the retained official installation: all **5,737**
files matched, with no missing, tampered or extra files. `git diff --check`
reported no whitespace errors. Local delivery hashes are recorded in
`.worktrees/setup-delivery.json`; logs are `.worktrees/setup-main-*.log`.

## Scope limits

This completes the native installer tranche. GUI/launcher/ADB migration, GUI
Python/extensions/global .NET setup, vendor executable compatibility and game
acceptance remain separate work. Existing locked Python/MCP CLI installation
still has its own path. A verified archive installation does not establish that
Ghidra, Dumper, AssetRipper or a Unity game executes correctly.

No commit, push, global environment change or replacement of existing engines
was performed.
