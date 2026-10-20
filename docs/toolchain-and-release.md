# Locked toolchain installation and release checks

The JavaScript CLI provides a checksummed, staged installation path for four
relocatable Windows x64 ZIP packages. This supplements the retained PowerShell
setup. Python/MCP CLI has a separate [generation and wheel lock](python-runtime.md).
GUI Python, user extensions and global .NET still need separate setup; they are
not reproduced by this archive lock.

## Plan, install and verify

```powershell
node re.js toolchain plan config/my-toolchain.lock.json --json
node re.js toolchain install config/my-toolchain.lock.json --cache D:\RetkPackages --json
node re.js toolchain verify --json
# Equivalent retained installer entry points:
.\install-re-toolkit.ps1 -LockedManifest config/my-toolchain.lock.json -Plan
.\install-re-toolkit.ps1 -LockedManifest config/my-toolchain.lock.json -PackageCache D:\RetkPackages
```

`plan` validates without network or writes. `install` explicitly downloads missing
archives; the cache uses `<sha256>.zip` and is revalidated. A valid prepopulated
cache enables installation without downloads. `verify` reads the last committed
receipt and compares every recorded file's SHA256/size with the exact inventory.
No receipt means `unknown`, with exit1; it does not infer that existing tools were
installed through this path. Changed/missing/extra files also cause exit1.
Each receipt covers only the packages selected in its lock, leaving other tools
untouched and unclaimed. These commands accept `--root <toolkit>`.

Locked and legacy operation/version flags cannot be combined. The locked branch
delegates before any legacy temp sweep or setup action. Existing `-All` and other
legacy latest-based modes retain their behavior and do not gain this transaction
guarantee. No system PATH, registry or .NET installation is changed by locked mode.

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
inventory includes all these derived bytes; the journal records their patches.
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

No existing installed engine was replaced during implementation. Real vendor-set
compatibility, a real vendor Python/MCP lock qualification, a real ps2exe/GUI build, hosted CI,
authorized IL2CPP builds and live Jev remain separate qualification work.
