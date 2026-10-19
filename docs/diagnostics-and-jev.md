# Diagnostics, evidence and TypeSafe Jev

Use Node.js 24+ and the JavaScript `re.js` entry point. GUI integration is deferred.
The modules use the existing schema2 state and persistent Ghidra bridge.

## Diagnose the intended task

```powershell
node re.js doctor Game --task prepare --json
node re.js doctor Game --task headless --json
node re.js doctor Game --task mcp --probe --timeout 15 --json
node re.js doctor Game --task assetripper --json
node re.js status Game --json
```

`doctor` returns schemaVersion 1, the existing `checks`, task states, diagnostic
IDs/codes, actions, observed facts, and limitations. `status` keeps project fields
and adds `diagnosticsSchemaVersion: 1`, readiness, tasks, diagnostics, limitations.
Doctor exits 1 for `blocked`; `unknown` or `available` never means verified ready.
Status keeps its existing refresh/save semantics when no native session is active.
The `diagnose()` module itself is read-only.

| Task | Evidence required |
| --- | --- |
| prepare | Current input hashes/sizes, matching dump fingerprint/output manifest, exact imported Program receipt, available runtimes, no conflicting workspace/project lease |
| headless | A ready native session with exact build, Program/project, run and healthy endpoint; installed executables alone are insufficient |
| mcp | Python/bridge, compatible extension, discovered exact instance and sufficient identity/capability facts; absence of hash attestation remains unknown |
| assetripper | Its configured executable; availability does not prove reconstruction output |

Analysis and symbol evidence remain separate tasks. A loaded Program does not
prove Auto Analysis or complete symbols. Missing optional Python/AssetRipper
does not block unrelated preparation. MCP probing is opt-in, limited to
initialize, advertised tools/list, and advertised list_instances. It never
uses substring connect_instance fallback. Probe timeout is 1–30 seconds.

## Capture observations and create a bundle

```powershell
node re.js session start Game
node re.js evidence capture Game --kind functions --selector Board --limit 20
node re.js evidence capture Game --kind decompile --selector Board_Update --limit 100
node re.js evidence capture Game --kind xrefs --selector ram:0x123456 --direction to --limit 50
node re.js session stop Game
node re.js handoff create Game --evidence exports/evidence/Game --out exports/Game.zip
node re.js handoff verify exports/Game.zip
```

Evidence collection requires an existing native session. It writes outside all
workspaces, binds native and metadata hashes/sizes, and records run, revision,
exact query, result, timestamp, coverage and limitations. `partial` means more
rows exist; `observed` covers only the query. Neither claims analysis completeness.
Capture publishes at most 4 MiB per JSON file; narrow the query when necessary.
Use separate external evidence folders for different builds. Handoff rejects
mixed or stale build identities and malformed evidence, instead of silently
dropping files. Historical same-build observations keep their original revision.

Handoff holds the workspace lease and refuses active native sessions. It defaults
to `dump.cs`, `script.json`, and authored notes. Evidence is included only with
`--evidence`; `--include-dummy-dll`, `--include-assets`, and `--include-binaries`
are separate payload opt-ins. No APK, project database, token or raw project
configuration is selected by default. Authored note contents are copied unchanged.
Outputs must be outside every toolkit workspace and use a new destination.

Folder and ZIP bundles retain relative inventory paths and can be moved.
Verification checks schema, exact inventory, byte sizes, SHA256, ZIP CRC, paths
and links. It detects corruption; it does not authenticate unsigned observations.
See [schema 1](handoff-schema.md).

## Build a request offline, then submit explicitly

```powershell
node re.js jev request exports/Game.zip --questions config/jev-questions.example.json --out exports/request.json
node re.js jev request exports/Game.zip --against exports/OtherBuild.zip --questions config/jev-questions.example.json --out exports/comparison.json
node re.js jev request exports/Game.zip --questions config/jev-questions.example.json --file notes/review.md --max-state-bytes 65536 --out exports/narrow.json
# Set TYPESAFE_API_KEY in your environment before this explicit network action:
node re.js jev run exports/request.json --out exports/result.json --timeout 60
```

Requests use the official [TypeSafe API](https://docs.typesafe.ai/api):
`POST https://api.typesafe.ai/v1/systemone`, Bearer authorization, and
`{model,state,questions}`. Supported question types are `choice`, `score`, `noul`.
Questions come from your JSON file; REToolkit supplies evidence and does not
implement comparison scores. Default model is `jev-latest`; use `--model` to pin
a model ID. Model aliases and context limits follow
[TypeSafe's model documentation](https://docs.typesafe.ai/models). The returned
model and token usage are retained with validated typed answers.

Default selection includes notes and captured pseudocode/references/observations.
Repeat `--file <relative-inventory-path>` to explicitly select text, including
metadata when needed. With `--against`, the same selected paths must exist in
both bundles. Binary/assets/reconstructed payloads cannot enter this adapter.
State is structured with `primary` and optional `against` labels, build/tool/step
facts, manifest fingerprints, selected text and limitations. No absolute host
paths are added to that state; user-authored text may already contain them.

The default state budget is 65,536 UTF-8 bytes, including JSON escaping and
metadata. Aggregate declared sizes are checked before content reads; encoded
size is checked incrementally. Oversize selection fails with `jev_state_too_large`;
content is never silently truncated. The HTTP request limit is 32 MiB and depth
is at most 64; exact large numbers such as addresses must remain strings.
A byte budget does not guarantee the model's token context limit.

Only `jev run` reads `TYPESAFE_API_KEY`. There is no key CLI flag, alternate
endpoint, redirect, or automatic retry. It validates the request, uses a 1–300
second deadline across response transfer, bounds responses to 4 MiB, and publishes
to a new file only after validating the typed answer. HTTP/transport errors are
sanitized. Missing credentials cause failure before network activity. No real
service call was made during implementation; HTTP behavior was tested locally.
