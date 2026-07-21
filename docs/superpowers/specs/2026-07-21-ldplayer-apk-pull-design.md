# LDPlayer APK Pull — Design

Date: 2026-07-21
Status: Approved, not yet implemented

## Problem

Getting a Unity IL2CPP game's full build into REToolkit today means the user
already has an `.apk`/`.xapk`/`.aab`/`.zip` file in hand. For games that are
only installed through the Play Store inside an emulator (LDPlayer), there is
no toolkit-native way to pull the installed build back out — the user has to
run `adb`/`pm path`/`pm pull` manually, and remember to also grab OBB or
dynamic-feature split APKs that only download after the game's first launch.

## Goal

A new `re.ps1 pull-ldplayer <GameName> <PackageName>` command that pulls a
game already installed in a running LDPlayer instance — base APK, any split
APKs (including Play Feature Delivery modules downloaded after first launch),
and OBB expansion files — into a workspace, ready for `dump`.

## Non-goals

- Pulling app-private data under `/data/data/<package>/` (requires root, not
  IL2CPP-relevant).
- Any automated/headless mode. This command assumes an interactive terminal
  and a human actively driving the emulator (opening the app, playing enough
  to trigger downloads) — the same assumption the toolkit already makes for
  `ghidra-gui`/`pyghidra-gui`.
- Installing/detecting LDPlayer itself, or managing emulator instances
  (start/stop). The user is expected to already have LDPlayer running with
  the target game installed.
- Any Android emulator other than LDPlayer (no generic AVD/Genymotion
  support). Could be revisited later since the underlying mechanism is plain
  `adb`, but out of scope for this pass.

## Decisions

Resolved during brainstorming (see conversation for full reasoning):

- **Data scope**: base + split APKs (including dynamic feature modules
  discovered after first launch) and OBB expansion files. No root-only data.
- **Integration point**: a new `re.ps1` command, not a standalone script and
  not a flag bolted onto `add`.
- **adb/device discovery**: auto-detect `adb.exe` (PATH, then common LDPlayer
  install paths) and the running device (`adb devices`; auto-select if
  exactly one). `-AdbPath`/`-DeviceSerial` are available as manual overrides
  for non-standard installs or multiple running instances.
- **Package selection**: exact package name required. On a miss, list
  similar-named installed packages as a hint rather than throwing a bare
  "not found".
- **Output shape**: a single `.xapk`-shaped zip (`base.apk`, `split_*.apk`,
  `Android/obb/<package>/*.obb`), not a pre-extracted folder — this reuses
  `Add-BuildToProject`'s existing recursive `*.apk`/`*.obb` flatten-and-scan
  logic unchanged.
- **First-launch trigger**: the command opens the app via
  `adb shell monkey -p <package> ...`, then pauses on `Read-Host` for the
  user to confirm they've let it load/play long enough for OBB/split modules
  to download. `-SkipLaunch` bypasses this when re-running against a game
  that's already fully downloaded.
- **End-to-end by default**: after pulling, the command copies the bundle
  into the workspace's `00_OriginalBuild\` (an existing template folder that
  today nothing writes into) and calls `Add-BuildToProject` automatically —
  the workspace is scan-complete and ready for `dump` when the command
  returns, matching how `add`/`scan` already auto-init a missing workspace.

## Architecture

New module `scripts/retk-ldplayer.ps1`, added to `$RetkScriptModules` in
`re.ps1` alongside the existing modules. Uses the shared `$Root`/`$ToolPaths`
already set up by `re.ps1`, and reuses `Invoke-NativeProcess`
(`scripts/retk-process.ps1`) to run `adb.exe` and capture output instead of
scattering raw `&` calls.

### Functions

| Function | Responsibility |
|---|---|
| `Resolve-LdPlayerAdb` | Find `adb.exe`: PATH first, then these candidate roots in order: `C:\LDPlayer\LDPlayer9\adb.exe`, `C:\LDPlayer\LDPlayer4\adb.exe`, `C:\Program Files\LDPlayer\LDPlayer9\adb.exe`, `C:\Program Files\LDPlayer\LDPlayer4\adb.exe`. `-AdbPath` overrides and skips all detection. |
| `Resolve-LdPlayerDevice` | `adb devices`, filtered to lines whose state is `device` (excludes `offline`/`unauthorized`/`no permissions`); auto-select if exactly one remains, otherwise list them and prompt via `Read-Host`. `-DeviceSerial` overrides and skips detection. |
| `Assert-LdPlayerPackageInstalled` | `adb shell pm list packages <pkg>`; on miss, re-list all packages and suggest ones containing the requested name as a case-insensitive substring, then throw. |
| `ConvertFrom-PmPathOutput` | Pure parser: raw `pm path` stdout → array of remote APK paths. No adb call — unit-testable. |
| `ConvertFrom-PmListPackagesOutput` | Pure parser: raw `pm list packages` stdout → array of package names. No adb call — unit-testable. |
| `Get-LdPlayerApkPaths` | Runs `adb shell pm path <pkg>`, parses via `ConvertFrom-PmPathOutput`. |
| `Invoke-LdPlayerAppLaunch` | `adb shell monkey -p <pkg> -c android.intent.category.LAUNCHER 1`, then `Read-Host` pause. Skipped when `-SkipLaunch`. |
| `Get-LdPlayerObbPaths` | `adb shell ls /sdcard/Android/obb/<pkg>`; best-effort, missing path is not an error. |
| `Save-LdPlayerBundle` | Pulls every APK (before-launch ∪ after-launch, deduped) and OBB file into a temp staging dir, zips into the `.xapk`-shaped bundle, returns its path. Temp names include a GUID (matching the collision fix already applied elsewhere in the installer). |
| `Invoke-LdPlayerPull` | Orchestrator: ensures the workspace exists (`New-Workspace` if `project.re.json` is missing), calls the above in order, copies the bundle into `00_OriginalBuild\<package>-<timestamp>.xapk` (timestamp as `yyyyMMdd-HHmmss`, matching the format already used for `logs\pyghidra-gui-*` files), prints a summary, then calls `Add-BuildToProject`. |

### `re.ps1` dispatcher

```text
"pull-ldplayer" {
    if ($Rest.Count -lt 2) { throw "Usage: .\re.ps1 pull-ldplayer <GameName> <PackageName> [-DeviceSerial <serial>] [-AdbPath <path>] [-SkipLaunch]" }
    # manually parse GameName, PackageName, then walk remaining $Rest for
    # -DeviceSerial/-AdbPath/-SkipLaunch, same style the "import" case already
    # uses for --force.
    Invoke-LdPlayerPull -GameName ... -PackageName ... -DeviceSerial ... -AdbPath ... -SkipLaunch:...
}
```

`GameName` validation is not duplicated here — it flows through
`Assert-WorkspaceName` automatically the moment any function touches
`Get-WorkspacePath`.

## Data flow

1. `re.ps1 pull-ldplayer FoodHunt com.example.foodhunt` → dispatcher parses
   args, calls `Invoke-LdPlayerPull`.
2. Ensure workspace exists (`New-Workspace` if missing) so
   `00_OriginalBuild\` is present.
3. `Resolve-LdPlayerAdb` → `Resolve-LdPlayerDevice` →
   `Assert-LdPlayerPackageInstalled`.
4. `Get-LdPlayerApkPaths` (pass 1 — catches APKs already present, relevant
   when `-SkipLaunch` is used).
5. Unless `-SkipLaunch`: `Invoke-LdPlayerAppLaunch` (open app, pause for
   confirmation).
6. `Get-LdPlayerApkPaths` (pass 2) → union with pass 1, deduped by remote
   path — catches dynamic-feature split APKs that only appeared after launch.
7. `Get-LdPlayerObbPaths` (best-effort).
8. `Save-LdPlayerBundle` pulls everything, zips it.
9. Copy the zip into `00_OriginalBuild\`, print a summary (APK/OBB counts,
   bundle path).
10. `Add-BuildToProject $GameName $bundlePath` — existing extract/flatten/scan
    logic, unchanged.

## Error handling

| Situation | Behavior |
|---|---|
| `adb.exe` not found | Throw with guidance to pass `-AdbPath`. |
| No device connected | Throw, tell the user to start/boot LDPlayer first. |
| Package not installed | Throw with a list of similarly-named installed packages. |
| `pm path` returns nothing for an installed package | Throw immediately — do not let this surface later as a confusing "native binary not found" from `Scan-UnityIl2Cpp`. |
| An individual `adb pull` fails mid-transfer | Throw immediately (fail-fast) — a missing split APK produces a broken bundle, better to fail at the pull step than downstream. |
| No OBB directory for the package | Not an error — log and continue (OBB is optional, per the scope decision). |
| `Add-BuildToProject` fails after a successful pull (e.g. non-IL2CPP game) | No special handling needed — the bundle is already saved under `00_OriginalBuild\`, so nothing pulled is lost; the existing `Scan-UnityIl2Cpp` error surfaces as-is. |

This command is interactive-only by design (it needs a human to actually play
the game for downloads to trigger); it is not meant to be scriptable/headless.

## Testing

Mirrors the project's existing convention (see `CLAUDE.md`): most
`*.Tests.ps1` files are source-text regression guards
(`Assert-Contains`/`Assert-NotContains`), not execution tests, because
`adb`/a real emulator can't be exercised in CI.

- New `tests/retk-ldplayer.Tests.ps1` (one file per module, matching
  `ghidra-script-bundle.Tests.ps1`/`ghidra-preferences.Tests.ps1`): asserts
  the module's functions and the `re.ps1` dispatcher case exist.
- `ConvertFrom-PmPathOutput` and `ConvertFrom-PmListPackagesOutput` are pure
  text parsers with no `adb` call — these get real executed tests (feed
  sample `pm path`/`pm list packages` output, assert the parsed array),
  following the `workspace-archive.Tests.ps1` pattern of dot-sourcing and
  actually calling functions.
- Everything that shells out to `adb` (device detection, launching the app,
  the actual pull) has no automated test — same limitation the toolkit
  already has for `ghidra-gui`/`pyghidra-gui`. A manual verification
  checklist to run once against a real LDPlayer instance before calling this
  done:
  - Game with a single APK (no split APKs), no OBB.
  - Game installed from an AAB (multiple `split_config.*.apk`).
  - Game with an OBB expansion file.
  - Game with a Play Feature Delivery module that only appears after first
    launch (verify pass-2 `Get-LdPlayerApkPaths` picks it up).
  - Typo'd package name (verify the suggestion list is useful).
  - `adb.exe` not on PATH and not in a default LDPlayer location (verify the
    error message and `-AdbPath` override both work).
  - Re-run with `-SkipLaunch` against an already-fully-downloaded game.
