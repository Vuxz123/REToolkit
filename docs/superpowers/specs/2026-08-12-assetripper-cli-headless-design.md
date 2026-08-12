# AssetRipper CLI (Headless) — Design

Date: 2026-08-12
Status: Approved, not yet implemented

## Problem

`re.ps1 assetripper` only opens AssetRipper's interactive web GUI — the user
has to click through a browser to load the extracted build and export it as a
Unity project. There is no scriptable/headless way to do this as part of a
workspace's pipeline.

## Goal

A new `re.ps1 assetripper-cli <GameName>` command that headlessly drives the
already-installed `AssetRipper.GUI.Free.exe` to load a workspace's extracted
build and export it as a Unity project into `05_ReconstructedSource\`, with
no browser interaction and no install-time build step.

## Non-goals

- **Building a native standalone CLI executable from AssetRipper source.**
  Investigated and rejected: the core export projects
  (`AssetRipper.Export.UnityProjects`, `ExportHandler`, ...) are not published
  on NuGet — only peripheral support libraries are. The one known community
  wrapper, `neoedmund/AssetRipperCLI`, ships a `.csproj` with a
  `ProjectReference` hardcoded to the author's personal machine layout
  (`../../github/AssetRipper/AssetRipper/Source/...`) and does not build from
  a plain `git clone`. Making it build would require cloning the entire
  `AssetRipper/AssetRipper` monorepo, installing a new .NET SDK 10 dependency
  (REToolkit currently only installs the .NET **Runtime**, for
  Il2CppDumper), and maintaining a vendored fork against upstream API
  changes. Headless HTTP automation of the officially shipped, version-pinned
  binary achieves the same practical outcome (scripted export, no browser)
  for a fraction of the install/maintenance cost.
- **Running automatically as part of `re.ps1 flow`.** Stays an opt-in command,
  like `assetripper`/`ghidra-gui`/`pyghidra-gui` — asset extraction is not
  needed by every workflow.
- **`ExportPrimaryContent` (raw asset export).** Only `ExportUnityProject` is
  in scope; REToolkit's use case is reconstructed source/assets, not a raw
  asset dump. Could be added later as an `-PrimaryContent` switch.
- **Keeping the headless server running after the command finishes.** It is a
  one-shot process: launched, driven, and stopped within a single command
  invocation.

## Decisions

- **Mechanism**: launch the existing `AssetRipper.GUI.Free.exe` (already
  installed by `-InstallAssetRipper`, aliased as `AssetRipper.exe`) with
  `--headless --port <N>`, then drive it via HTTP `POST` to its own internal
  command endpoints — the same ones its Vue frontend calls. No build step, no
  new install dependency.
- **Confirmed routes** (read directly from `AssetRipper.GUI.Web` source —
  `Pages/CommandsPage.cs` and `GameFileLoader.cs` — not guessed):
  - `POST /LoadFolder` — form field `Path` — synchronous; blocks until
    `GameFileLoader.LoadAndProcess` returns.
  - `POST /Export/UnityProject` — form fields `Path`, `CreateSubfolder` —
    synchronous (awaited); blocks until export finishes. `--headless` mode
    auto-consents to "delete existing non-empty output dir"
    (`GameFileLoader.Headless` short-circuits the confirmation dialog that
    would otherwise hang waiting for a UI click).
  - `POST /Reset` — clears loaded state. Not strictly required for a one-shot
    process, but cheap to call defensively before `LoadFolder`.
- **Input/output paths**: input = `project.re.json`'s `extractedPath` (the
  workspace's `01_Extracted`); output = the workspace's
  `05_ReconstructedSource` folder (already created by `New-Workspace`,
  currently unused by any command).
- **Port**: fixed toolkit-reserved default (`44399`), probed for availability
  first; tries up to 5 subsequent ports (`44399`–`44403`) before failing with
  a clear error.
- **Timeouts**: `Wait-AssetRipperHttpReady` polls for up to 30s before
  throwing. The `/Export/UnityProject` request itself must use an effectively
  unbounded HTTP client timeout (`Invoke-WebRequest`'s ~100s default is not
  enough) — export time scales with build size and must not be killed
  mid-export by an arbitrary client-side timeout.
- **Failure detection**: several `GameFileLoader` failure paths (empty export
  path, export path is a protected system folder, nothing loaded) just log an
  error and return — HTTP status stays 200. HTTP status alone is therefore
  not trustworthy. The command additionally verifies the postcondition:
  `05_ReconstructedSource` must exist and be non-empty after
  `/Export/UnityProject` returns, otherwise the run is treated as failed and
  the user is pointed at the AssetRipper log file.
- **Command name**: `assetripper-cli` (matches the user's original
  terminology), implemented as headless HTTP automation rather than a literal
  separate executable — called out in `re.ps1`'s usage text so it is not
  confused with a real bundled CLI binary.
- **Workspace integration**: unlike `il2cppdumper`/`assetripper` (raw
  passthrough), `assetripper-cli` follows the
  `Read-Project → mutate → Save-Project` pattern already used throughout
  `retk-pipeline.ps1`.

## Architecture

New functions added to `scripts/retk-pipeline.ps1` — no new module, since
this is a single cohesive feature and does not warrant growing
`$RetkScriptModules`. `re.ps1`'s `$ToolPaths.AssetRipper` (already defined)
is reused for the exe path.

### Functions

| Function | Responsibility |
|---|---|
| `Find-AvailablePort` | Probe a TCP port for availability (`System.Net.Sockets.TcpListener` try/bind), starting at `44399` and trying up to 5 consecutive ports before throwing. |
| `Wait-AssetRipperHttpReady` | Poll `GET http://127.0.0.1:<port>/` with retry/backoff for up to 30s; throws if the process exits early or the timeout is hit. |
| `Invoke-AssetRipperCommand` | POST helper: `Invoke-WebRequest -Method Post -Uri http://127.0.0.1:<port><path> -Body @{...}`, throws on non-2xx. |
| `Export-AssetRipperUnityProject` | Orchestrator: resolve port, launch via `Start-DetachedNativeProcess`, wait ready, `POST /Reset`, `POST /LoadFolder`, `POST /Export/UnityProject`, verify output non-empty, `Stop-Process` in `finally`. |
| `Invoke-AssetRipperCliPipeline` | Top-level: `Read-Project`, resolve `extractedPath`/output dir, call `Export-AssetRipperUnityProject`, update `project.re.json` (`reconstructedSourceDir`, `status.assetRipperExported`, timestamp), `Save-Project`. |

### `re.ps1` dispatcher

```text
{ $_ -eq "assetripper-cli" } {
    if ($Rest.Count -lt 1) { throw "Usage: .\re.ps1 assetripper-cli <GameName>" }
    Invoke-AssetRipperCliPipeline -GameName $Rest[0]
}
```

Added next to the existing `assetripper`/`asset-ripper` case (~`re.ps1:226`).

## Data flow

1. `re.ps1 assetripper-cli FoodHunt` → dispatcher → `Invoke-AssetRipperCliPipeline`.
2. `Read-Project FoodHunt` — must already be scanned (`extractedPath` set);
   throw with guidance (`Run: .\re.ps1 scan ...`) otherwise, matching the
   existing pattern at `retk-pipeline.ps1:10`/`:83`.
3. `Find-AvailablePort 44399` → port `N`.
4. `Start-DetachedNativeProcess` launches `AssetRipper.GUI.Free.exe --headless
   --port N`, hidden window, stdout/stderr to
   `logs\assetripper-cli-<timestamp>.log`.
5. `Wait-AssetRipperHttpReady` polls until the server responds.
6. `POST /Reset`, `POST /LoadFolder Path=<extractedPath>`,
   `POST /Export/UnityProject Path=<05_ReconstructedSource>
   CreateSubfolder=false`.
7. Verify `05_ReconstructedSource` is non-empty.
8. `Stop-Process` (in `finally`, always runs).
9. `Save-Project`: `reconstructedSourceDir` = path,
   `status.assetRipperExported = $true`,
   `status.assetRipperExportedAt` = timestamp.
10. Print summary (exported file/folder count, output path).

## Error handling

| Situation | Behavior |
|---|---|
| Workspace not scanned (`extractedPath` null) | Throw with guidance to run `scan` first. |
| Chosen port and next few candidates all busy | Throw with a clear "port range exhausted" message. |
| Process exits immediately after launch (crash) | Detected by `Start-DetachedNativeProcess`'s existing `HasExited` poll — surfaces as a failed launch, not a false "started". |
| HTTP server doesn't come up within timeout | Throw, point at the log file. |
| `/LoadFolder` or `/Export/UnityProject` returns non-2xx | Throw with response body. |
| Export "succeeds" (200 OK) but `05_ReconstructedSource` stays empty | Treated as failure (known `GameFileLoader` swallow-and-log paths) — throw, point at the log file for the real error. |
| Any failure after the process was launched | `finally` block still calls `Stop-Process` so no orphaned headless server is left running. |

## Testing

Mirrors the project's existing convention (per `CLAUDE.md`): most
`*.Tests.ps1` files are source-text regression guards, not execution tests,
since a real Unity build can't be exercised in CI.

- New `tests/retk-assetripper-cli.Tests.ps1`: asserts the new functions and
  the `re.ps1` dispatcher case exist, and that the route strings
  (`/LoadFolder`, `/Export/UnityProject`, `/Reset`) and the `--headless` flag
  appear in the source — a regression guard against the routes silently
  changing on an AssetRipper upgrade.
- `Find-AvailablePort` is a pure-enough helper (just TCP bind probing) and
  could get a real executed test similar to `workspace-archive.Tests.ps1`'s
  dot-source-and-call pattern, but network-port tests are flaky in CI
  sandboxes; left as a source-text assertion only, called out here so a
  future contributor doesn't assume it is covered.
- Everything that actually shells out to `AssetRipper.GUI.Free.exe` and calls
  its HTTP endpoints has no automated test (same limitation as
  `assetripper`/`ghidra-gui`). Manual verification checklist before calling
  this done:
  - A workspace with a small extracted build — verify
    `05_ReconstructedSource` gets populated and `project.re.json` is updated.
  - Re-run against a workspace that already has a non-empty
    `05_ReconstructedSource` — verify the "delete existing contents" headless
    auto-consent works and does not hang waiting for a dialog.
  - Occupy port 44399 with something else first — verify it falls through to
    the next candidate port.
  - Point at an empty/garbage extracted folder to simulate a silent export
    failure — verify the postcondition check catches it and the error
    message is useful.
  - Verify `Stop-Process` actually happens (no leftover
    `AssetRipper.GUI.Free.exe` process) after both a successful run and a
    forced failure.
