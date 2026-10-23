# Large Unity exports

Small projects retain the JSON graph. Large exports can select SQLite explicitly:

```cmd
retk assets index Screwdom3D --storage sqlite
retk assets list Screwdom3D --kind scene --limit 10
retk assets tree Screwdom3D --id asset:<guid> --limit 100
retk assets refs Screwdom3D --id object:<guid>:<fileID> --limit 100
retk assets scripts Screwdom3D --query Player --limit 10
```

The desktop's graph operation exposes `storage` (`json` or `sqlite`). The JSON
memory option `--max-graph-mib 128|256|512` applies only to JSON storage; combining
it with SQLite is rejected. SQLite requires Node24.15 or newer.

Serialized Unity YAML is read as a stream of documents in both stores. A scene or
prefab above 16 MiB can be indexed without loading all its text at once, retaining
references through its last document. Each document remains bounded to 16 MiB;
an oversized document reports `unity_document_byte_limit` explicitly. Strict YAML,
64-bit fileIDs, source hashes and file identity checks still apply. Unknown binary
serialized files remain opaque rather than being interpreted as reference-free.

`retk reconstruct validate Game --json` does not require an asset graph. It uses a
complete source inventory, copies all source bytes to staging and obtains actual
compile/binding observations from Unity Editor. Use this route while an individual
document blocks static indexing. Its inventory leaves serialized-reference
coverage unverified, and neither indexing nor successful staging proves gameplay.

Unity traversal now records per-asset checkpoints and independent compiler
status. See [Unity validation and resume](unity-validation.md) for partial
coverage, explicit resume, exact asset scope and progress fields.

SQLite indexing writes a fresh generation beneath
`04_Notes/assets/indexes/<UUID>/graph.sqlite`. `graph.json` becomes a version2
manifest containing the complete source inventory, asset/script declarations,
coverage and the database's sealed SHA256/size/revision receipt. It has no
in-memory node/edge arrays. Publication follows complete source rechecks; a
failed index leaves the previous manifest in place. Successful older generations
remain available to saved reconstruction plans.

## Source-only apply refresh

After an authorized source plan applies, the receipt's complete file inventory
must differ from the baseline only at its exact changed C# paths. GUID/meta,
assembly, source declarations and script bindings retain the existing plan gates.
Only those script metadata rows are reparsed. Scenes/prefabs/data tables,
serialized nodes/edges and hierarchy are reused; compile/binding/gameplay
readiness is still invalidated until independently checked.

SQLite refresh copies a verified sealed database to a fresh exclusive generation,
updates selected script JSON and metadata in a transaction, and hashes/seals it.
The original database remains byte-identical for old plans and receipts. This
avoids parsing/reinserting millions of unchanged records. It still copies/hashes
the database and verifies the complete source inventory; it is not zero-copy or
a guarantee of instant completion. Allow space for another database generation
and its bounded SQLite journal. File-based copy-on-write is requested where the
filesystem supports it, with ordinary copy behavior otherwise.

The manifest publishes only after final source and database identity checks.
Failed refresh/publication removes its owned unchanged unpublished copy. Changed
or uncertain files and already referenced generations are preserved for review.
The source receipt survives a graph refresh failure: inspect that exact operation
before an explicit retry, which verifies the already applied source and reuses
an exact published graph when available. Do not replay a running/unknown job.

`graphRefresh` in the apply result reports `source-refresh`, `reuse` or `full-index`,
storage, changed script count and elapsed milliseconds. This describes the
current invocation and can differ on retry; the source
receipt payload/hash and its saved artifact remain identical.
The full-index fallback
applies when a complete JSON baseline matching the saved plan is unavailable;
the reduced script graph saved with the plan is never published as complete.
Non-source inventory changes are rejected rather than folded into a refresh.

Durable MCP jobs expose `assetProgress` and controlled stages such as
`assets.source.receipt`, `assets.refresh.copying`, `assets.refresh.updating`,
`assets.refresh.sealing` and `assets.refresh.published`. Source receipt completion
is separate from overall job completion. The desktop activity detail shows the
same observations, counts, byte sizes and elapsed time. No ETA/percent is inferred.
Existing workers keep their already loaded code; this does not upgrade an active
apply in place. Reopen MCP/GUI for later work and retain the original job ID.

The same Unity parser preserves string fileIDs, GUIDs, null/builtin/missing
reference statuses, component fields and source-bound bulk payload summaries.
Readers verify the sealed bytes and metadata before fixed readonly SQL queries.
There is no user SQL or extension loading. Defaults cap250000 assets,8million
nodes,32million references,20MiB per stored row and128MiB manifest metadata.
The32GiB disk budget includes rollback journals, so usable primary database
capacity is lower. Source inventory caps remain250000 files and64GiB.
SQLite temporary sort files are outside that database/journal budget; it is not
a total peak-disk guarantee.

Query pages have at most1000 rows and1MiB. Cursors bind the selected graph and
database hash. Tree traversal has a50000-visited-ID ceiling and reports
`traversalTruncated` explicitly; use node selectors and paged references to
inspect additional branches. An individual row above the response budget fails
explicitly. The original exported file remains available by its inventoried path.

Script mapping pages and reconstruction materialize only the selected scripts'
bindings from the sealed database. Existing source identity, declaration,
GUID/meta, serialized-field and inventory checks still apply. The focused scope
is capped20000 nodes/64MiB. A saved plan retains its original sealed manifest;
apply rederives bindings before source mutation. It does not trust saved partial
arrays as a complete graph.
After selecting SQLite, create a new plan for older JSON-only saved plans.
Storage downgrades are rejected against workspace state before reading bindings
or applying a plan.

Migration observation can restrict components with a JSON array of1..1000 exact
object IDs:

```cmd
retk migration observe Screwdom3D --components components.json
```

Observation copies the complete project and inspects the selected components
and their containing assets. Migration plan/apply derive the scope from explicit
request component IDs. DLL conversion/removal and complex serialized migrations
retain their existing unsupported status. Library staging uses a separately
named source-facts snapshot where only file/declaration facts are needed; it
does not imply serialized-reference or gameplay verification.
