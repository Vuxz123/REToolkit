# Visual comparison API

`runVisualComparison(toolkit, name, {request})` or `{requestFile}` accepts exactly
one source. `requestFile` is an absolute path to bounded UTF-8 JSON.
`createVisualReport(toolkit, name, request, {runFrame})` is the lower-level API;
`runFrame` is an internal dependency for owned fixture acceptance, not a DTO field.
Both acquire workspace and toolchain leases. Output is exclusive to
`04_Notes/visual/<UUID>/report.json` plus PNG artifacts; no caller output path.

Example image DTO (all paths are selected read-only inputs; fixture provenance
cannot establish original-game fidelity):

```json
{
  "kind": "retoolkit-visual-request",
  "schemaVersion": 1,
  "mode": "image",
  "screen": "menu",
  "state": "idle",
  "profile": {"width": 1080, "height": 1920, "locale": "en", "platform": "Android"},
  "requiredRegions": [
    {"id": "play", "x": 300, "y": 1400, "width": 480, "height": 160,
     "pixelDelta": 2, "maxChangedRatio": 0.01, "maxMeanAbsoluteError": 0.5}
  ],
  "frames": [{
    "id": "idle",
    "baseline": {
      "path": "C:/captures/baseline.png",
      "profile": {"width": 1080, "height": 1920, "locale": "en", "platform": "Android"},
      "provenance": {"kind": "fixture", "build": "fixture-v1", "source": "controlled fixture", "approvedBy": "reviewer"}
    },
    "candidate": {
      "path": "C:/captures/candidate.png",
      "profile": {"width": 1080, "height": 1920, "locale": "en", "platform": "Android"}
    }
  }]
}
```

Each input optionally pins `sha256` (lowercase 64 hex). Baseline may be `null` or
its file may be absent: required coverage remains unknown. Provenance kind is
`original`, `fixture`, or `regression`; the caller supplies build/source/approver
attestation. All fields are strict. Profiles support optional orientation,
safeArea `{x,y,width,height}`, colorSpace, renderPipeline, unityVersion,
packageVersions (string map), inputBackend and gpu. Baseline and candidate
profiles must equal the requested profile exactly, including optional fields.
Decoded geometry must also match. No resize, registration, crop or masks.

For video, set `mode: "video"`, add absolute `ffmpegPath`, select source videos
in baseline/candidate `path`, and add integer `baselineTimeMs` and
`candidateTimeMs` on **every** frame (0..3,600,000). Extraction uses verified
private input copies, a direct owned executable, fixed arguments, file-only
protocols and mov/matroska/webm/avi/mpegts container whitelist. Each frame has a
30-second timeout; close is awaited after termination. No arbitrary filters,
arguments, shell, autorotation or inherited FFREPORT output paths. ffmpeg is not
installed, selected from PATH, or run implicitly for screenshots.

Summary shape:

```json
{
  "operationId": "<UUID>", "state": "pass|fail|unverified",
  "visualFidelity": "pass|fail|unverified", "regression": "pass|fail|unverified",
  "interaction": "unverified", "temporalBehavior": "unverified",
  "coverage": {"requested": 1, "observed": 1, "unknown": 0, "excluded": 0},
  "stale": false, "reportPath": "04_Notes/visual/<UUID>/report.json",
  "limitations": []
}
```

The full versioned `retoolkit-visual-report` binds request/profile/region
thresholds, exact input hashes, toolkit project/source snapshot, available asset
graph revision and verified graph files, ffmpeg hash, per-frame/per-region
outcomes, sampled timestamps, PNG frame/diff artifact hashes and provenance.
Every required frame times every required region contributes coverage. Failure
has precedence over unknown; empty scopes are rejected. Fixture/regression
baselines populate regression outcomes; only declared original baselines
populate visual fidelity. No original set means fidelity remains unverified.

Metric `absolute-rgba-v1` compares decoded 8-bit RGBA samples. A changed pixel
has any channel delta above the region's `pixelDelta`. Mean absolute error is
sum of all absolute RGBA differences divided by four times region pixel count.
Both ratio and MAE thresholds must pass; equality passes. Diff PNG is opaque,
with each RGB channel showing max(RGB channel delta, alpha delta), so alpha-only
mismatches remain visible. PNG output uses fixed compression settings.

`readVisualReport(toolkit,name,{operationId,section,limit,cursor})` supports
`summary` (default), `report` (up to 1 MiB), `frames` and `findings` pages (1..128).
Cursors bind the exact report payload and section. Input/source/artifact changes
mark saved outcomes stale and return current top-level outcomes as unverified.
Historical frame measurements remain available, with the stale flag. Reports
also check their payload fingerprint; this detects accidental edits, not a
cryptographic signature from a trusted issuer.

Bounds: 1 MiB request; 32 frames; 128 regions; 8192 max dimension; 16M pixels per
image; 128M combined diff/region pixel operations; 64 MiB per PNG; 512 MiB unique
screenshot sources; 2 GiB per video and 4 GiB unique video sources. Only 8-bit
noninterlaced nonanimated PNG is supported. Unsupported/corrupt image decoding,
missing frames and profile mismatches remain unverified. Video samples do not
prove continuous animation, timing correctness, state transitions, interaction,
text semantics, or asset identity. No source game files are written.

Acceptance: `node --test test/visual-*.test.js`. Tests use generated fixed tiny PNG
bytes, injected extraction with owned fixture files, and real direct Node child
processes for lifecycle/output checks. Real ffmpeg, original-game screenshots,
and original-game video have not been accepted in this workstream.

CLI adapter: `src/visual/cli.js` exports `isVisualCommand`, `parseVisualArgs`,
`runVisualCli` and `visualUsage` for the root dispatcher. Commands:

```text
visual compare <Game> --request <json> [--root <toolkit>] [--json]
visual report <Game> --operation <UUID> [--section summary|report|frames|findings]
              [--limit 1..128] [--cursor <cursor>] [--root <toolkit>] [--json]
visual --help
```

Options support `--key=value`; duplicates, unknown options, extra positional
arguments and operation-incompatible options are rejected. JSON output is capped
at 1 MiB and retains the service's independent/stale outcomes. The optional third
`runVisualCli` argument `{write}` is an internal output sink for acceptance tests.

`src/visual/definitions.js` exports `visualRequestSchema` and `visualDefinitions`
for `visual.compare` (typed request object) and `visual.report` (operation UUID and
paging). These definitions do not expose subprocess dependency injection. The
shared assets API/MCP integration is owned by the root dispatcher workstream;
service-side validation remains authoritative for nested and mode-specific
constraints even when a transport validates JSON schema.
