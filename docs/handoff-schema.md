# Portable handoff schema 1

`node re.js handoff create Game` writes a new folder under
`exports/handoff-Game-<runId>`. `--out <path>` chooses a folder or, when its name
ends in `.zip`, a ZIP. The destination must be outside all toolkit workspaces, including
after resolving junctions. Existing destinations are refused. Export holds the
workspace lease, refuses active native sessions, copies into staging, rehashes
the selected inputs and sources, verifies staging, and publishes the result.
It does not start an engine, perform analysis, decompile functions, or send data.

The default payload is `dump/dump.cs`, `dump/script.json`, and `.md`/`.txt` files
under `notes/` from `04_Notes`. Missing dump files do not prevent a notes-only
export. Hidden directories, runtime/cache/log/backup/credential/token filenames,
raw project state, and APK/OBB archives are excluded. Review authored notes before
sharing them: their text is copied as supplied.

Optional payloads:

- `--include-dummy-dll`: `reconstructed/DummyDll/` from `dumperDummyDll`, falling
  back to `il2cppDumperOutput/DummyDll`; classification `reconstructed`.
- `--include-assets`: `assets/` from `reconstructedSourceDir`, including existing
  AssetRipper output; classification `assets`.
- `--include-binaries`: only the selected native binary and metadata, under
  `binaries/native/` and `binaries/metadata/`; classification `binary`.
- `--evidence <external-folder>`: previously captured evidence JSON under
  `evidence/`. Every accepted file must bind to the current native and metadata
  hashes/sizes and exact Ghidra program/project identity. No observations are
  generated during export.

Each bundle contains `manifest.json`, with these fields:

```json
{
  "kind": "retoolkit-handoff",
  "schemaVersion": 1,
  "name": "Game",
  "runId": "<export UUID>",
  "createdAt": "<ISO timestamp>",
  "build": {
    "native": {"sha256": "<64 lowercase hex digits>", "size": 123, "abi": "arm64-v8a"},
    "metadata": {"sha256": "<64 lowercase hex digits>", "size": 456}
  },
  "steps": {
    "dump": {"state": "succeeded", "fingerprint": "<SHA256>", "runId": "<step UUID>", "completedAt": "<ISO timestamp>"}
  },
  "tools": {"dumper": {"version": "unknown", "sha256": "<SHA256>"}},
  "files": [
    {"path": "dump/dump.cs", "size": 20, "sha256": "<SHA256>", "classification": "metadata"}
  ],
  "artifacts": [{"name": "dump", "state": "valid", "paths": ["dump/dump.cs", "dump/script.json"]}],
  "limitations": ["Analysis readiness is independently unverified."]
}
```

The example is schematic. Native/metadata identities are `null` when their
selected files are missing; fingerprints, step run IDs/completion times, and
tool hashes may be `null`. Build identity uses current bytes, with no host paths.
Step facts omit raw output manifests, errors, runtime configuration, and logs.
Saved successful steps with mismatching input/output/fingerprint evidence are
reported stale or unknown without changing `project.re.json`.

Artifact states are `valid`, `stale`, `missing`, `unknown`, and `excluded`.
`excluded` records an optional payload not requested. `missing` includes an
incomplete required dump pair. `valid` describes observed artifact evidence; it
does not prove Auto Analysis, original-source recovery, or input compatibility.
Classifications are `metadata`, `pseudocode`, `references`, `observations`,
`notes`, `reconstructed`, `assets`, and `binary`. Neither metadata skeletons nor
pseudocode nor reconstructed assets are labeled original source.

Evidence capture uses `kind: "retoolkit-evidence"`, `schemaVersion: 1`, `query`
with `method` and `params`, the same build identity shape, `programIdentity`,
`runId`, `revision`, `collectedAt`, `result`, `coverage`, `limitations`, and
`dataTrust`. Identity uses `program`, `sha256`, and `projectName` from the native
bridge; auxiliary bridge identity facts may remain present. Supported methods
and derived classifications are:

| Method | Classification |
| --- | --- |
| `functions.decompile` | `pseudocode` |
| `references.list` | `references` |
| `functions.list` | `observations` |

Evidence bytes retain their captured revision, timestamp, coverage, and
limitations, including historical revisions and partial observations. Export
does not relabel historical evidence as a new observation.

Capture and import share `src/evidence-schema.js`. Evidence envelopes use a
canonical UUID run ID, a nonnegative integer revision, an ISO UTC timestamp,
and exact `dataTrust: "untrusted-target-content"`. The schema rejects unknown
properties at every structured boundary, including query parameters, build
identities, program facts, coverage, result pages, and result rows. It does not
permit token/config/environment fields to be carried as extra metadata.

Query parameter allowlists are `selector`, `limit`, optional `cursor` and
`timeoutSeconds` for decompile; `address`, `direction`, `limit`, optional `cursor`
for references; and `limit`, optional `query` and `cursor` for functions. Limits
are 1–1000, decompile timeouts 1–300 seconds, and directions `to` or `from`.
Addresses remain strings. Identity requires `program`, `projectName`, `sha256`,
and `imageBase`; the optional native bridge fields are `programPath`, `language`,
`compiler`, `addressSpace`, `ghidraVersion`, and `analysisStatus` (currently
`unknown`). ABI values use the toolkit's recognized ABI names or `unknown`.

Results match the actual Java provider: `{items,nextCursor}` with an additional
`address` for decompile. Decompile rows contain `line` and `text`; reference rows
contain `from`, `to`, and `type`; function rows contain `address`, `name`,
`qualifiedName`, `signature`, `bodySize`, and the five known comment fields.
Paging cursors are validated against their recorded method, query binding, run,
and revision. Coverage uses exactly `state`, `source`, and `explanation`: state
is `partial` when a next cursor exists, otherwise `observed`, and source is
`loaded-program`. These query observations cannot claim complete analysis.
Target strings remain untrusted target content and are copied without rewriting.

`node re.js handoff verify <folder-or-zip>` validates schema 1, an exact inventory,
each size and SHA256, and ZIP CRC values. It rejects unknown/future schemas,
absolute/traversal/backslash paths, Windows alternate streams and device names,
case-colliding names, symbolic links/junctions, undeclared or missing entries,
and unsupported ZIP entry types. Inventory names use relative POSIX paths.
Paths are limited to 32,768 characters and 64 components to bound nested
directory-prefix processing.
Only directories needed by declared file paths are permitted. `manifest.json`
is limited to 32 MiB and the inventory to 100,000 files. ZIP verification streams
file bytes, stops at declared sizes, and never extracts a ZIP to disk.

The JavaScript interface exports `createHandoff(toolkit,name,options)` returning
`{path,manifest}`, `verifyHandoff(path)` returning `{ok,manifest,errors}`, and
`readHandoff(path)` returning a verified `{manifest,readFile(relative)}`.
`readFile` is asynchronous and returns a Buffer only for a declared inventory
path. It revalidates the original manifest hash and requested bytes on each
read, including when the ZIP is replaced after initial verification.

These checks detect byte corruption and unsafe package structure. Manifests are
not signed and do not establish the authenticity or truth of target content.
