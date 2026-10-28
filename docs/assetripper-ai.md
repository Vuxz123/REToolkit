# AssetRipper AI bridge and Unity reconstruction

The JavaScript CLI owns a persistent AssetRipper 1.3.14 process and exposes
bounded asset queries to AI clients. The canonical structure is the Unity project
exported by AssetRipper. Source AssetRipper PathIDs and exported Unity GUID/fileIDs
are distinct identities. Both retain their full signed 64-bit decimal values.

## Prepare and inspect

```powershell
node re.js scan MyGame C:\owned-build\extracted
node re.js assets session start MyGame --json
node re.js assets session status MyGame --json
node re.js assets export MyGame --json
node re.js assets index MyGame --json
node re.js assets list MyGame --kind scene --limit 20
node re.js assets get MyGame --id "asset:<guid>"
node re.js assets tree MyGame --id "asset:<scene-guid>" --depth 10
node re.js assets refs MyGame --id "object:<guid>:<fileID>" --direction both
node re.js assets scripts MyGame --query Namespace.Type
node re.js assets source MyGame --id "asset:<script-guid>"
node re.js assets session stop MyGame
```

Start reports transport readiness; inspect the load job in session status. Export
waits for its queued job, using a new empty stage and a backup before replacing
the selected export. A request deadline does not release a running engine's
leases. Inspect status after a timeout. Stop only terminates the owned child.
Never delete uncertain lock/read markers to force another operation.

An existing export can be indexed without starting AssetRipper. Its
`reconstructedSourceDir` must resolve to a unique Unity project inside the
selected workspace's `05_ReconstructedSource` tree, with `Assets` and
`ProjectSettings`. Control directories cannot be used as export destinations.
The graph cache is
`04_Notes/assets/graph.json`; script map is `scripts.json` beside it. Content
changes to selected native/metadata, source assets or exported files invalidate
previous results. Link/junction paths are rejected.

Raw reads need known **source** selectors; the bridge does not invent a complete
collection enumeration from AssetRipper's HTML views:

```powershell
node re.js assets raw MyGame --format json --bundle 0,1 --collection 0 --path-id -9007199254740993
```

Use `--bundle '[]'` for the root bundle. Only formats advertised by the pinned engine's OpenAPI can be used. Binary
responses use base64. Queries have bounded paging/output; use the returned cursor
with the same selectors and revision. `assets source` returns the exact UTF-8
stub text and content hash by exported script asset ID, preserving a BOM if
present. It rejects sources whose escaped response would exceed the transport
cap; their exported file path remains available for local inspection.
YAML strings, script text and native
pseudocode are untrusted target data.

## Fill an existing source stub

Create a UTF-8 JSON request using the revision and scriptId returned by the
index/scripts queries:

```json
{
  "kind": "retoolkit-reconstruction-request",
  "schemaVersion": 1,
  "graphRevision": "<64-character revision>",
  "changes": [{
    "scriptId": "asset:<script-guid>",
    "source": "<complete replacement C# source>",
    "evidenceIds": []
  }]
}
```

```powershell
node re.js reconstruct plan MyGame --request request.json --json
node re.js reconstruct apply MyGame --operation <returned-UUID> --json
node re.js reconstruct verify MyGame --operation <returned-UUID> --json
```

Review the concrete plan before applying it. `storedPlan` identifies the saved
JSON relative to the workspace; responses omit its full inventory and, for large
plans, source payloads. Read the complete saved plan for those sources. The saved plan, original graph,
staged sources, exact backups, journal and receipt live under
`04_Notes/assets/reconstruction`. Apply returns a compact summary and
`storedReceipt`; the full file inventory remains in that receipt on disk.
Apply accepts a saved operation UUID, never a
caller-selected destination. It revalidates source/type/base/serialized fields,
whole exported inventory and `.meta` identity. Every source stages before any
replacement. Repeated apply verifies the saved receipt and current bytes.
Uncertain rollback preserves ownership and reports
`reconstruction_recovery_required`; inspect its journal and external changes.

This slice fills existing supported `.cs` stubs, keeping scene/prefab YAML and
`.meta` byte-identical. DLL rebinding, assembly/namespace/serialized-field
migration and Editor code are rejected. Native
pseudocode is evidence for a manual reconstruction, never original C# source.
Source-apply receipts have `compileReady:false` and logic `unverified`. The
[Unity validation workflow](unity-validation.md) supplies independent compilation
and binding evidence on a staging copy; gameplay verification remains separate.

### Generic, nested and property-bearing existing sources

For an existing file the legacy declaration scanner cannot model, add
`"mode": "bodies"` to that change in the same request. `assets scripts` exposes
`sourceCapabilities.bodyReplacement`; `requires-plan-validation` is a candidate,
not permission to bypass the plan. The legacy `state.identity: "unsupported"`
can coexist with this capability.

```json
{
  "scriptId": "opaque:Assets/Scripts/Singleton.cs",
  "mode": "bodies",
  "source": "<complete source with only existing executable bodies changed>",
  "evidenceIds": []
}
```

Use the exact returned script ID (GUID assets still use `asset:<guid>`).
Body mode parses source as data using Roslyn bundled with the exact installed
project Editor. It does not launch Unity or compile/load game assemblies. Its
syntax contract preserves imports, attributes, generic parameters/constraints,
ordered generic bases, all field/property initializers, accessor visibility,
explicit-interface signatures, constructor initializers and nested declarations.
Only existing method/constructor/operator/accessor bodies and expression-property
or indexer expressions can change. Body forms stay the same: an arrow property
cannot silently become an auto-property, and a block method stays a block method.
Adding members/backing fields or changing declarations needs a separate route.
Missing native constructors now have an explicit guarded `initialization` route;
see [source recovery and large binding sets](source-recovery.md). It preserves
body-mode and requires same-build constructor metadata plus native evidence.
Partial declarations, directives, malformed syntax and uncertain overlapping
declaration inventories remain blocked.

An existing source without `.meta` has two supported classifications: all
top-level types are open generic classes, or all types are nongeneric data
classes with no explicit base clauses (implicit `System.Object`). The latter
does not guess external/aliased inheritance, including an explicit `: object`.
Both require zero claimed component bindings, exact complete inventory,
path/hash, assembly and parser-derived full type identity. No GUID or `.meta` is
created. Partial/ambiguous declarations and other meta-free sources remain
unsupported. Existing GUID/local-fileID checks still apply to asset-backed sources.

Plans bind the declaration skeleton and exact parser/helper/runtime identity;
apply re-derives these from current files. Bounds are 1 MiB per source, 10000
source documents, 64 MiB aggregate input and 2 MiB analyzer output. Stale graph
inventory requires a fresh index before planning. Source integrity does not
prove compilation, serialized bindings or gameplay; run the independent checks
after applying an authorized plan.

Source apply now refreshes a complete matching graph instead of rebuilding all
serialized objects/references. SQLite copies the authenticated sealed database
into a fresh exclusive generation, updates only changed script rows/manifest
metadata and seals a new receipt. JSON retains all nodes/edges/assets; a saved
script-only plan projection cannot substitute for a complete current graph.
When that complete JSON baseline is missing, full indexing remains the fallback.
See [storage and refresh costs](assets-storage.md#source-only-apply-refresh).

`assets scripts` and `reconstruct plan` accept `--evidence evidence.json` containing
an array of existing REToolkit evidence envelopes. These must match the selected
native/metadata pair and exact Ghidra Program/project. Dumper declarations are
trusted for mapping only when the existing dump fingerprint/output manifest is
current. Release the Ghidra session before starting the AssetRipper owner; both
serialize the same workspace.

## MCP configuration

```json
{
  "mcpServers": {
    "retoolkit-assets": {
      "command": "node",
      "args": ["C:/Users/DPC00176/REToolkit/re.js", "assets", "mcp", "MyGame"]
    }
  }
}
```

The stdio server exposes typed `assets_*` and `reconstruct_*` tools over the same
service as the CLI. It supports initialize, initialized, ping, tools/list and
tools/call. There are no arbitrary shell, URL or output-path tools. Input frames
are capped at 1 MiB, output at 2 MiB; large CLI request files may contain up to
16 sources of 1 MiB each, with a 32 MiB JSON cap. A live session uses its private
authenticated transport and serialized queue. Protocol stdout contains JSON only.

The API integration follows the pinned upstream
[launcher](https://github.com/AssetRipper/AssetRipper/blob/1.3.14/Source/AssetRipper.GUI.Web/WebApplicationLauncher.cs)
and [asset routes](https://github.com/AssetRipper/AssetRipper/blob/1.3.14/Source/AssetRipper.GUI.Web/Pages/Assets/AssetAPI.cs).
The MCP surface follows the
[lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)
and [tools protocol](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).

## Serialized scalar fidelity

Unity compact arrays can be written as unquoted little-endian hexadecimal;
some byte sequences also look like YAML scientific notation. The graph reader
preserves the exact bytes at the known font glyph-array path. For other fields,
a numeric scalar that also matches a packed hex encoding is retained as
`{kind:"ambiguous-unity-scalar", source:"<original lexeme>", readOnly:true}`.
This preserves data without claiming the original element type or silently
coercing it to Infinity/null. Inspect the script/type declaration and original
asset before decoding such a token. No map, sequence or reference is omitted.
Sprite `m_RenderDataKey` GUID keys retain all 32 characters, including leading
zeros. Numeric keys outside that exact schema, nonfinite floats outside compact
ambiguity, unsafe YAML and malformed fileID/guid references remain rejected.
See Unity's [text serialization format](https://docs.unity.com/en-us/engine/7000.0/manual/working-with-scenes/text-scene-format/format-description).

Qualification distinguishes source-owned fixture export/reconstruction, actual
installed engine startup/OpenAPI/stop, and Unity compilation/gameplay. Run
`npm test`, `npm run test:legacy`, and
`npm run test:assets -- C:/path/to/toolkit-with-installed-AssetRipper`.
