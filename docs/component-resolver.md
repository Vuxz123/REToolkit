# Mapping Unity components to current libraries

`retk components` inventories serialized GameObject components and resolves their
bindings against actual compiled types. It distinguishes engine components,
project sources, inventoried package sources, DLL types and package-cache types.
ScriptableObject data is handled separately by [data contracts](scriptable-object-data.md).

## Read the inventory

```powershell
retk components scan MyGame --json
retk components report MyGame --operation <scanId> --section groups --limit 20 --json
retk components report MyGame --operation <scanId> --section targets --query TMPro --json
```

Run `assets.index` once on the selected branch first. SQLite scans stream all
serialized nodes; JSON scans use the existing graph. Counts cover the entire
inventory, with at most 20 sample instance IDs per group. Samples are not a full
scope: `samplesComplete: false` means discover the remaining exact object IDs
through existing asset/tree/reference queries. Opaque/stripped records without
`m_GameObject` are outside this component coverage. No global graph conversion is
needed for a SQLite scan.

Catalog matches are hints, not proof of installation or an implementation stub.
Use the available catalog release first; request the game's exact release only
when actual compile/schema/binding/runtime evidence shows incompatibility. A
unique available release gives a typed `libraries.plan` next action; multiple
releases remain explicit choices. The chosen Unity Editor must still match the
export's recorded version exactly. Configure library roots and run
`libraries.scan` to refresh available ZIP identities.

## Observe and plan

Write `observe.json`, containing actual object IDs from the graph:

```json
{"componentIds":["object:0123456789abcdef0123456789abcdef:123"]}
```

```powershell
retk components observe MyGame --params-file observe.json --json
retk components report MyGame --operation <observationId> --section targets --json
retk components report MyGame --operation <observationId> --section decisions --json
retk components plan MyGame --observation <observationId> --json
```

Observe selects 1–1000 exact components and runs the fixed read-only helper in a
disposable Unity staging project. Import callbacks can execute. It does not save
assets or enter Play Mode. Missing Editor/compile failures retain staging and
diagnostics; they do not become verified mappings. Closure uncertainty retains
ownership for inspection, rather than permitting a blind retry.

The helper observes assembly, full type, GUID and signed 64-bit fileID. It also
discovers runtime MonoScripts in resolved packages via Unity's
[MonoImporter API](https://docs.unity.com/en-us/engine/6000.7/script-reference/unityeditor/monoimporter/getallruntimemonoscripts).
Static source names alone never authorize a rebind. Native components use their
observed engine type/module and remain preserved; no engine DLL or ClassID is
rewritten.

Decisions are `preserve`, `rebind`, `unverified`, `missing`, `conflict` or `blocked`.
To choose a different implementation, use `targetId` from this observation's
targets page in `plan.json`:

```json
{
  "observationId":"<observation UUID>",
  "mappings":[{"componentId":"<exact object ID>","targetId":"<target SHA256>"}]
}
```

```powershell
retk components plan MyGame --params-file plan.json --json
retk components report MyGame --operation <componentPlanId> --section decisions --json
```

All selected components must be resolved. No mapping is guessed from a simple
class name. A duplicate full type remains a conflict even if the explicit pick
selects the existing binding. Unsupported schema changes are saved as blocked
plans with the existing migration reason.

Writable targets are supported source files with inventoried metadata, resolved
assembly and an exact observed type. Embedded managed `Packages/*.cs` can be
targets as well as `Assets/*.cs`. Registry-cache-only and DLL targets are readable
but cannot authorize a source rebind. Import/materialize a compatible library
through the existing library planner first, then index and observe again. Package
manifest names/versions do not prove compatible payloads. Duplicate GUIDs, DLL
removal, duplicate retained types, managed references and complex field
conversions keep their existing migration gates.

## Apply and verify

```powershell
retk components apply MyGame --operation <componentPlanId> --json
retk components verify MyGame --operation <componentPlanId> --json
```

Apply rederives the exact mapping and migration patches against the current
source, helper and catalog. It writes only a canonical staging project and returns
`operationId` for the **migration** plus `componentPlanId` for the component plan.
Keep these IDs distinct. Repeat apply uses the migration journal; interrupted
unknown writes require inspection. A `no-change` plan can verify the existing
observed identities and apply as a no-op, without inventing a migration.

Verification without a post-apply observation establishes staging inventory
integrity only. Observe the returned migration stage, then verify again:

Add `"stageOperationId":"<migration UUID>"` to a copy of `observe.json` named
`observe-stage.json`. A params file contains the complete operation DTO; do not
combine it with explicit operation options.

```powershell
retk components observe MyGame --params-file observe-stage.json --json
retk components verify MyGame --operation <componentPlanId> --observation <newObservationId> --json
```

Verification covers all selected preserved/native identities as well as rewritten
script identities. It does not claim full serialized-reference/property coverage,
runtime-library correctness or gameplay. Run scoped `reconstruct.validate` on
the actual candidate, and `data.verify` where a data baseline exists, then execute
the authorized gameplay scenarios separately.

## Agent, recovery and GUI

The same six operations are typed MCP tools (`components_scan`, etc.) and durable
job operations (`components.scan`, etc.). Use `jobs_start` for Editor work and
observe its existing job ID until completion; read the final domain state and
blockers, not just exit code zero. Reports are bounded and cursor-bound to the
saved record/query; historical reports do not recheck source freshness.

For an ongoing reconstruction, invoke these operations through `recovery.run`
with the current artifact ID/revision. Observe uses a disposable generation;
apply adopts its canonical migration stage after full inventory checks. Carry
the returned revision into the next operation. Observe the **current combined
artifact** after adoption. Recovery rejects historical stage observation or
verification once later source/library changes have changed the generation's
inventory. Rescan/reobserve the current generation rather than reusing that old
verification. Component verification does not automatically satisfy workflow
compile/binding acceptance; submit the existing scoped Unity validation evidence.

GUI → project → reconstruction operations provides scan, observe, plan, apply,
verify and paged report sections. Component scope accepts one exact object ID per
line; mappings accept an explicit JSON array. Results show mapping counts and
blockers separately from gameplay status. Canonical records live under
`04_Notes/assets/components/<UUID>` or the selected recovery artifact's `assets`
directory. They are integrity receipts, not publisher authenticity claims.
