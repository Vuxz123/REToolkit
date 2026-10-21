# Native Node ADB capture

Continuation of the approved CLI-first JavaScript migration. The native engine
installer is complete; this tranche removes the `pull-ldplayer` CLI dependency on
the PowerShell pipeline. Keep GUI launchers and the legacy GUI path for later.
No commit, engine replacement, actual device access or global setup is required.

Three possible next tranches are GUI launchers, GUI runtime installation, and ADB
capture. Choose ADB capture: it can reuse the Node import pipeline and has no GUI
runtime dependency. Merely wrapping the old PS command would retain two state
writers. Replacing every launcher at once would couple unrelated lifecycle work.

## CLI and device contract

`pull-ldplayer <Game> <package> --serial <id> --adb <adb.exe> --skip-launch`
accepts optional `--binary`/`--metadata` for ambiguous extracted pairs and standard
`--root`/`--json`. Retain `-DeviceSerial`, `-AdbPath`, `-SkipLaunch` aliases. Add
`adb devices [--adb <path>]` for discovery. Duplicate/unknown flags and invalid
package, serial or workspace identifiers fail before process launch or writes.

Without `--skip-launch`, require interactive stdin/stdout before any operation;
launch only the exact package and wait for Enter. JSON/noninteractive callers
must explicitly skip launch. Require one ready device or an explicitly selected
ready serial; never choose the first of several or silently use an offline one.
Use only argument arrays, executable ADB paths, fixed shell subcommands and strict
remote paths. Do not install, modify, root or delete anything on the device.

## Capture and integration

The new `src/adb/client.js` resolves ADB from an explicit executable, PATH or known
LDPlayer locations. It lists devices, confirms exact installed package identity,
reads APK paths and safe OBB basenames, launches the package when requested and
pulls individual files and reads remote sizes with fixed `stat -c %s`. Compare
remote sizes before/after each pull and local file size. Denied access fails; only an explicit missing OBB
directory is optional. Metadata responses are bounded; duplicate/case-colliding
local names and unsafe remote paths are rejected before any pull.

`src/adb/capture.js` captures all APKs (base and splits) and OBBs into a new private
staging folder inside the locked workspace. Inventory every nonempty regular
file, reject links and unexpected files, then create a streaming XAPK using the
existing yazl dependency. Record remote path, local archive entry, SHA256 and size
in a capture manifest. Atomic exclusive publication into `00_OriginalBuild`
never replaces an earlier capture. Retain failed staging for diagnosis, and never
recursively delete a directory that an uncertain ADB child may still write to.

Toolkit `pullLdPlayer` holds the existing workspace/toolchain leases over all
device operations, publication and `add`. Existing `runProcess` supervises ADB
children with the workspace engine marker. After all verified files are saved,
reuse `add` with explicit input selection. This produces prepared inputs, not
verified binary/metadata compatibility. Ambiguous or failed import preserves the
saved bundle and old published extraction, with a clear diagnostic path. Capture
does not dump, analyze or open Ghidra. Legacy `re.ps1`/GUI code stays unchanged.

## Verification

RED/GREEN tests cover device selection, exact packages, unsafe paths, collisions,
missing/denied OBB, incomplete pull, no-launch mode, staging preservation, ABI
selection, old extraction preservation and leases. Source-owned fake ADB ZIP
fixtures exercise actual CLI, capture, extraction and JSON without a real device.
Run all JS and seven PS suites, separate spec/quality reviews, then hash-guarded
owned-file delivery. Existing unowned pending files retain exact bytes.
