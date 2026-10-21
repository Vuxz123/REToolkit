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

SQLite indexing writes a fresh generation beneath
`04_Notes/assets/indexes/<UUID>/graph.sqlite`. `graph.json` becomes a version2
manifest containing the complete source inventory, asset/script declarations,
coverage and the database's sealed SHA256/size/revision receipt. It has no
in-memory node/edge arrays. Publication follows complete source rechecks; a
failed index leaves the previous manifest in place. Successful older generations
remain available to saved reconstruction plans.

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
