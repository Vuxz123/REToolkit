# Native setup, locked toolchains and release checks

The JavaScript CLI provides a checksummed, staged installation path for four
relocatable Windows x64 ZIP packages. `setup` resolves exact releases and reuses
that transaction; the PowerShell installer is a thin PS5.1 Node24 adapter.
Python/MCP CLI has a separate [generation and wheel lock](python-runtime.md).
GUI Python, user extensions and global .NET require separate reviewed profiles;
their installation has not been ported.

## Resolve and install native engines

```powershell
node re.js setup resolve --components jdk,ghidra,dumper,assetripper --json
node re.js setup resolve --components jdk,ghidra --out config/reviewed-native.lock.json --json
node re.js setup plan --components jdk,ghidra,dumper,assetripper --json
node re.js setup install --components jdk,ghidra,dumper,assetripper --json
node re.js setup status --json
```

The exact defaults are JDK21.0.11, Ghidra12.1.2, Il2CppDumper6.7.48 net8.0 and
AssetRipper1.3.14. Exact overrides use `--jdk-version`, `--ghidra-version`,
`--dumper-version` and `--assetripper-version`; a version must belong to a selected
component. Ghidra selection includes JDK unless an explicit lock defines its own
package coverage. Without `--components`, native selection defaults to JDK/Ghidra.

The shipped `config/native-windows-x64.lock.json` records all four exact releases
from official publisher metadata. Use it for repeatable installation without
resolving metadata again:

```powershell
node re.js setup plan --lock config/native-windows-x64.lock.json --json
node re.js setup install --lock config/native-windows-x64.lock.json --json
```

`resolve` returns a regular toolchain lock; optional `--out` exclusively publishes
a fresh UTF8 JSON file and refuses an existing file or managed engine/runtime/
workspace/cache destination. It does not install archives. `plan` returns the
resolved lock and offline package plan without writing. Both operations access
publisher metadata unless supplied `--lock`. No latest release selection, guessed
dated filenames or invented hashes are permitted. Missing published checksum,
missing exact version or ambiguous assets fail resolution; supply a reviewed
existing `--lock` rather than weakening identity checks.

`install` resolves every selected source before downloading or staging engines.
It uses the existing all-selected-package transaction below. `status` reads the
committed receipt and local version metadata without writes. Existing files or
matching version text do not establish installation success; absent or changed
receipts remain unknown or unverified.

```powershell
node re.js setup plan --lock config/my-toolchain.lock.json --json
node re.js setup install --lock config/my-toolchain.lock.json --cache D:\RetkPackages --json
# Equivalent explicit native PowerShell selection:
.\install-re-toolkit.ps1 -All -NativeOnly -Plan
.\install-re-toolkit.ps1 -All -NativeOnly
```

`--lock` avoids metadata networking and defines the entire package selection, so
it cannot be mixed with selection/version flags. Planning stays offline. A full
verified cache makes installation download-free; missing entries download only
the exact locked sources. All commands accept `--root <toolkit>`.

The adapter with no flags delegates read-only `setup status`. `-All` alone, or
Node `--all` without `--native-only`, rejects GUI Python, GhidraMCP GUI extension
and global .NET requirements before metadata downloads or engine writes. Those
components are never silently skipped or reported complete. `-InstallRuntime`
also requests GUI Python and is blocked; use `-InstallGhidra` (includes JDK) or
`setup install --components jdk,ghidra` for native Java/Ghidra. Dedicated
`-InstallGhidraMcp` and `-InstallDotNetRuntime` likewise require separate profiles.
Custom legacy endpoints and irrelevant explicit versions are rejected.

Exact `-LockedManifest` and `-PythonManifest` routes remain available; the latter
supports the MCP CLI Python generation only. Neither implies GUI Python,
extension or global .NET setup. The adapter has no raw PowerShell download,
installer fallback, broad Temp cleanup or global environment changes.

## Plan, install and verify

```powershell
node re.js toolchain plan config/my-toolchain.lock.json --json
node re.js toolchain install config/my-toolchain.lock.json --cache D:\RetkPackages --json
node re.js toolchain verify --json
# Equivalent retained installer entry points:
.\install-re-toolkit.ps1 -LockedManifest config/my-toolchain.lock.json -Plan
.\install-re-toolkit.ps1 -LockedManifest config/my-toolchain.lock.json -PackageCache D:\RetkPackages
```

`toolchain plan` validates without network or writes. `install` explicitly downloads missing
archives; the cache uses `<sha256>.zip` and is revalidated. A valid prepopulated
cache enables installation without downloads. `verify` reads the last committed
receipt and compares every recorded file's SHA256/size with the exact inventory.
No receipt means `unknown`, with exit1; it does not infer that existing tools were
installed through this path. Changed/missing/extra files also cause exit1.
Each receipt covers only the packages selected in its lock, leaving other tools
untouched and unclaimed. These commands accept `--root <toolkit>`.

Locked and other operation/version flags cannot be combined. Both manifest
branches delegate directly to Node after validation. No system PATH, registry or
.NET installation is changed by this setup path.

## Bounded downloads

Archive downloads use bounded HTTPS redirects and verify the complete SHA256 and
size before publication. Transient network failures, HTTP408/429 and server
errors have bounded retries. A transfer can resume with Range within its current
invocation using an exclusively owned temporary file; Content-Range must match
the exact offset and total. A server returning200 restarts the private transfer.
Unsafe responses and identity failures are terminal. There is no persistent
partial cache, cross-run download resume, or force recovery that bypasses gates.
Progress is sent to stderr so JSON stdout remains parseable.

AssetRipper installation records a `.retk-version` marker from the locked package
version and includes it in the inventory and patch journal. This supports the
existing runtime adapter; it is version provenance from the lock, not an
independent binary version or execution probe.

## Write a real archive lock

Schema1 has exactly these fields; the angle-bracket values below are explanatory
placeholders and are deliberately invalid until replaced with actual facts:

```json
{
  "kind": "retoolkit-toolchain-lock",
  "schemaVersion": 1,
  "platform": "win32-x64",
  "packages": [{
    "id": "ghidra",
    "version": "<exact release version>",
    "source": {
      "url": "https://<publisher>/<immutable-release-asset>.zip",
      "sha256": "<actual 64 lowercase hexadecimal digits>",
      "size": 123,
      "verification": "publisher-checksum"
    },
    "archiveRoot": "<top-level folder inside ZIP, or empty string>"
  }]
}
```

Use an exact release asset URL, never `latest`, a branch URL, credentials or query
parameters. Redirects are bounded and must remain HTTPS. Set `size` to the actual
compressed byte count. Determine the archive's layout without running its code;
`archiveRoot` selects its root directory, not the installation destination.

For a downloaded archive, `(Get-Item -LiteralPath <zip>).Length` supplies size and
`(Get-FileHash -LiteralPath <zip> -Algorithm SHA256).Hash.ToLowerInvariant()` supplies
the byte identity. Compare it with a publisher-provided checksum through a trusted
source before using `publisher-checksum`. Use `recorded-download` when you only
recorded the downloaded bytes; that label does not independently authenticate
their publisher. REToolkit checks the supplied digest, not that provenance claim.
No runnable vendor lock with invented hashes is shipped.

| Package ID | Fixed destination | Required layout checks |
| --- | --- | --- |
| jdk | runtime/java/jdk-21 | Nonempty bin/java.exe; release JAVA_VERSION equals the declared JDK21 version |
| ghidra | tools/ghidra | Launchers and application.properties; application.version equals declared version |
| dumper | tools/Il2CppDumper | Nonempty Il2CppDumper.exe and bounded valid config.json |
| assetripper | tools/AssetRipper | Nonempty AssetRipper.exe or AssetRipper.GUI.Free.exe |

Il2CppDumper receives the repo's `ghidra.py` and `ghidra_with_struct.py` templates,
with their hashes recorded. Its config is normalized to `RequireAnyKey=false` and
`GenerateScript=true`, preserving other keys. AssetRipper's GUI.Free executable
is copied to the expected `AssetRipper.exe` alias when needed. The installed file
inventory includes these derived bytes and the pinned `.retk-version` marker;
the journal records their patches.
Version strings for Dumper/AssetRipper are declared by the lock and bound to its
archive digest, not independently attested by executing the vendor program.

## Publication, exclusion and recovery

All packages stage before any old directory moves. Verification rejects unsafe
paths, links, case/file-directory collisions, CRC/size mismatches and excessive
entries. Locks are limited to1MiB, each package to8GiB compressed/uncompressed,
ZIPs to100,000 entries and paths to64 components/32,768 characters. Path bookkeeping
and inventory/journal/receipt metadata are bounded at128MiB. Dumper config is
limited to1MiB. Supported metadata must fit before publication begins.

The installer copies verified cache bytes into a private transaction archive and
checks that copied stream's hash/size, extracts it, then rechecks the private archive
before publishing. Shared cache changes cannot substitute different executable
bytes into a receipt claiming the lock's digest.

The receipt lives at `.cache/toolchain/receipt.json`; journals, original receipts,
staging and backups live at `.cache/toolchain/transactions/<UUID>/`. Publication
records intent, backs up old directories and publishes the new receipt last.
Known failures restore all previous selected trees and receipt. Successful backups
remain available. A rollback that cannot be proved complete preserves its journal,
backups and exclusive gate. Future engine launches/updates refuse that gate.

Engine workers retain read leases until actual child close; killing an outer CLI
does not authorize updating its engine. Workspace mutations also hold a read lease,
including pre-launch config preparation. Active writer, reader, workspace/project
locks, or running engine processes prevent updating. Windows process inspection
returns only state/PID/name and never exposes raw command lines. Inaccessible
process identity is `unknown` and installation fails closed; the terminal must
have permission to inspect running processes. A plain readonly plan remains usable.

If `TOOLCHAIN_BUSY` or `TOOLCHAIN_RECOVERY_REQUIRED` appears, finish or close the
identified owning operation and inspect the retained evidence. Do not delete gate,
reader or project-lock files based only on an old PID. For uncertain transactions,
compare the recorded target/backup/stage inventories and previous receipt before
manual repair. There is deliberately no automatic PID-only recovery or force flag
that bypasses this check. Legacy standalone/manual launchers are not cooperative
read-lease owners; process/project-lock inspection remains necessary for them.

## CI and GUI artifacts

Native `session stop` also waits for workspace lease proof, its recorded
supervisor's exit and startup gate removal before returning terminal state.
Windows runtime JSON replacement tolerates sharing errors for at most1s while
preserving the existing target; persistent failure still reports an error.

`.github/workflows/windows.yml` runs Node24 `npm ci`, all JS fixtures, and Windows
PowerShell5.1 suites, with read-only permissions and action commit pins. Pins were
checked against the official [checkout7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)
and [setup-node7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0)
releases. CI has no engine download, GUI compile or Jev call. A source workflow is
not proof of a completed hosted run; push/remote execution is separate.

```powershell
.\scripts\build-gui.ps1                  # uses an already installed ps2exe
.\scripts\build-gui.ps1 -InstallPs2Exe   # explicitly allow module installation
.\scripts\build-gui.ps1 -Force           # explicitly replace existing artifacts
```

The build stages output, checks source drift, and publishes EXE plus
`REToolkit-GUI.exe.provenance.json` with rollback. Schema1 records Git revision
and dirty/unknown state, hashes/sizes of GUI/core/build/helper sources, compiler
module version, and EXE hash/size. The sidecar identifies bytes; it does not prove
live GUI correctness or replace a signed release. It also does not embed runtime
helpers in the EXE. Missing Git identity stays unknown.

## Verification commands and limits

```powershell
npm test
npm run test:legacy
npm run test:toolchain
```

The last command creates its own ZIP in Temp, uses the actual CLI and retained
installer delegation with a verified cache, checks tamper detection and retained
backup, then cleans up. It executes no vendor binary and downloads nothing;
Windows process inspection permissions are required. Unit tests substitute
external process/network observations while exercising real files and ZIPs.

The setup tests use bounded fake Node commands, source-owned ZIPs and simulated
metadata/network responses. They check delegation, exact release selection,
retry/Range behavior and rollback; they do not establish real vendor download or
runtime correctness. The separate opt-in `npm run test:setup-download` downloads
the shipped vendor lock into a new `.cache/setup-vendor-acceptance/<id>` toolkit,
uses a dedicated archive cache, verifies all installed inventories, and records
available reference-engine sentinel hashes before and after. It requires at least
5 GiB free and retains archives and installation evidence; no vendor binary runs.
The 2026-10-20 run passed for JDK21.0.11, Ghidra12.1.2, Dumper6.7.48 and
AssetRipper1.3.14. See [scope and results](superpowers/specs/2026-10-20-node-setup-verification.md).
No existing installed engine was replaced during implementation. Real vendor execution/set
compatibility, a real vendor Python/MCP lock qualification, a real ps2exe/GUI build, hosted CI,
authorized IL2CPP builds and live Jev remain separate qualification work.
