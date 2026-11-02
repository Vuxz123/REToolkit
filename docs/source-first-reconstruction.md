# Recover code before indexing all assets

Preparation now builds a source index for reconstruction instead of requiring a
full serialized asset graph. For an existing project, select **Lập chỉ mục code
(nhanh)** in the desktop operations or run:

```powershell
retk assets index Game --scope source --json
retk assets scripts Game --limit 100 --json
```

MCP uses `assets.index {scope:"source"}`. Do not pass `storage` or `graphMaxMiB`
for this scope. `assets.scripts`, `assets.source` and `reconstruct.plan` also
create a source index when neither a source index nor a full graph exists.
Existing full-graph plans remain supported. Do not restart an active index job.

The source index records the full candidate file hashes, C# declarations,
source GUID/meta identity and assembly boundaries. It does not parse scene,
prefab or data YAML or build a SQLite reference database. It is stored separately
as `04_Notes/assets/source-index.json` (under the artifact's assets directory
when invoked through `recovery.run`). Full inventory hashing remains necessary
for integrity and rollback; source indexing is not constant-time on large games.

Use batches of up to 16 related files, with explicit `bodies`, `initialization`
or `event-storage` mode. Existing exact-Editor compiler contracts, native proof
requirements, duplicate source identity checks, saved plans, backups and receipt
verification still apply. Legacy whole-source replacement requires the full
graph route. Source-only apply refreshes only the source index and never starts
a full graph build; repeated apply uses the existing receipt checks.

After each coherent batch, verify the apply receipt and run scoped Unity
validation, preferably `--mode resident` on Unity 6. Do not defer all compilation
until the entire game is reconstructed. Binding counts and coverage in a source
map are unverified, not proof that a script is unused or correctly attached.
Code recovery does not prove serialized data preservation or playable gameplay.

For graph-based asset queries, rebinding/migration work or final project
inspection, explicitly build the full graph:

```powershell
retk assets index Game --scope full --storage sqlite --json
```

A successful full index replaces the active source-index selection; failed full
indexing leaves the source index available. Full graph generation does not
replace Unity validation, data verification or gameplay acceptance. This change
does not itself add a partial asset-graph builder; use existing scoped Unity
validation while full static reference coverage is deferred.
