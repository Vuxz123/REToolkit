# ADB capture through Node.js

The JavaScript CLI discovers ready Android devices and captures an installed
authorized Unity package. It invokes ADB directly with argument arrays, then uses
the existing Node extraction/input pipeline. It does not invoke `re.ps1`, install
packages, request root, remove device files or open Ghidra.

## Discover and capture

```powershell
node re.js adb devices --adb C:\LDPlayer\LDPlayer9\adb.exe --json
node re.js pull-ldplayer FoodHunt com.example.game --serial emulator-5554 --skip-launch --json
node re.js pull-ldplayer FoodHunt com.example.game --adb C:\LDPlayer\LDPlayer9\adb.exe --serial 127.0.0.1:5555 --skip-launch --json
```

`--adb` accepts an existing regular executable ending in `.exe`. Without it,
resolution checks PATH and known LDPlayer9/4 folders. Device discovery reports
ready/offline/unauthorized states. Capture requires exactly one ready device or
an explicitly selected ready serial; it never picks the first of several.

Standard options are `--root <toolkit>`, `--json`, `--help`. Retained aliases
`-DeviceSerial`, `-AdbPath`, `-SkipLaunch` map to the corresponding Node flags.
Legacy `re.ps1` and the WinForms GUI retain their old implementation separately.

Without `--skip-launch`, capture requires an interactive terminal. It launches
the exact installed package, waits for Enter after its downloads finish, and
queries its current APK paths again. For JSON, AI/Agent, CI or piped commands,
use `--skip-launch` after ensuring downloads have already finished. ADB may start
its own normal server; this command does not configure LDPlayer or install ADB.

## Integrity and preservation

All base/split APK paths and OBB basenames are validated before pulls. Exact
installed package identity is required. Duplicate/case-colliding filenames are
rejected. Missing OBB directories are optional only when ADB explicitly reports
that directory as absent; unexpected stderr, access-denied, disconnect and
cancellation errors fail.

Each nonempty regular file must match remote size observations before and after
the pull. The capture checks SHA256 before and after ZIP creation, rejects links
and unexpected files, and saves a manifest as `retk-capture.json` inside the
XAPK. Limits are 1,024 files, 8 GiB per file, 32 GiB combined and bounded metadata.
These checks establish captured bytes and size observations, not an atomic
device snapshot or compatibility of binary/metadata, OBB or game behavior.

The bundle is exclusively published as
`workspaces/<Game>/00_OriginalBuild/<package>-<UUID>.xapk`; older bundles remain.
The capture receipt is `.adb-capture-<UUID>/capture.json` in that workspace.
Successful capture removes only its verified payload staging; failed capture
retains staging and reports its exact path. Never delete retained staging while
an uncertain child/owner may still write to it. Workspace/toolchain leases and
the existing engine supervisor cover device operations and import; gate failures
require owner inspection rather than forced cleanup.

## Choose inputs and recover

After capture, `add` extracts the XAPK, split APKs and ZIP OBBs. A successful
result means inputs are selected; it does not run dumping or Ghidra analysis.
For multiple native/metadata candidates, supply explicit paths. Split contents
retain a directory named after the APK basename:

```powershell
node re.js pull-ldplayer FoodHunt com.example.game --skip-launch --binary split_config.arm64/lib/arm64-v8a/libil2cpp.so --json
node re.js add FoodHunt "<saved-capture.xapk>" --binary split_config.arm64/lib/arm64-v8a/libil2cpp.so --metadata base/assets/bin/Data/Managed/Metadata/global-metadata.dat --json
```

Failed pulls leave prior project/extracted bytes intact. If capture succeeded but
extraction/selection fails, the error points to the saved XAPK and diagnostic
staging. The existing `add` pipeline retains the earlier published extraction;
its extraction step records failure. Reuse the saved XAPK to retry selection
without accessing the device again. Non-ZIP OBBs are retained with a warning.

## Test scope

`npm test` covers parsing, process observations and source-owned capture ZIPs.
`npm run test:adb` compiles a source-owned fake ADB `.exe` with Windows
PowerShell/.NET Framework, then exercises the actual CLI and engine supervisor
against base/split/OBB fixtures, including a zero-exit partial pull. It does not
access a real emulator/device, run vendor engines or establish game compatibility.
