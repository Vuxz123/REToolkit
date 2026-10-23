# Unity validation and resume

Validation stages the complete selected export and runs the exact matching Unity
Editor. Compilation, binding coverage and gameplay are separate observations.
The source export, older requests and receipts remain unchanged.

Validation accepts scenes (`.unity`), prefabs (`.prefab`) and serialized data
assets (`.asset`), including ScriptableObject tables. Exact scoped IDs may mix
these types. A saved policy containing table assets does not need its scope
reduced to scenes/prefabs. Source-only snapshots retain `.asset` selectors even
when static YAML indexing cannot parse their contents; `coverage.dataAssets`
counts those selectors, without claiming serialized-reference verification.

For a `.asset` file the helper uses Unity's
[LoadAllAssetsAtPath](https://docs.unity3d.com/2022.3/Documentation/ScriptReference/AssetDatabase.LoadAllAssetsAtPath.html)
to include the main object and hidden subassets, then reads their serialized
properties. Their budgets are shared per file. Empty/null/error loads remain
incomplete. Missing script pointers and unresolved object references block
binding success; ordinary optional null references remain allowed. The helper
does not follow references into other asset files, save assets or enter Play mode.
Data assets require explicit `reference-scan-v2` traversal observations; a legacy
loaded-only report cannot certify their coverage.

```cmd
retk reconstruct validate Game --json
retk reconstruct validation Game --operation <UUID> --section assets --limit 20 --json
retk reconstruct validate Game --resume-operation <UUID> --json
```

`compilation.state` reports verified compiler success/failure independently of
serialized traversal. `compileReady` follows verified compilation. A successful
compile may accompany `state: partial` and `bindingsVerified: false`.
`coverage.requestedAssets`, `completedAssets`, and `pendingAssets` describe the
requested asset coverage; an asset loaded but interrupted is still pending.
Zero missing-reference counters on an incomplete row do not establish success.

The helper visits reference-bearing fields, keeps arrays/structs that may contain
references, skips proven reference-free payload children, and guards managed
reference cycles within each serialized object. Budgets reset for each asset.
The current caps are 200000 objects and 2000000 visited properties per asset,
with a 240-second helper observation budget per invocation. The Editor process
also has its separate caller timeout. Hitting a cap leaves explicit pending work.
Limit/load failures record per-asset completion, counters and the last object,
component and property path, then allow subsequent assets to be checked. Partial
reports are checkpointed during work. `jobs_get.validationProgress` and desktop
results show observed asset progress; no guessed percentage is used.

Resume creates a fresh operation. It reuses only completed extended-helper rows
whose source/build, Editor, helper and scope still match. Previous artifacts and
their hashes are verified before reuse; legacy incomplete reports cannot supply
completed checkpoints. Source/helper/Editor changes require a fresh validation.
After this helper update, start a fresh validation rather than resuming a receipt
created by the earlier helper. New partial operations can then be resumed.
Keep the same authorized asset IDs, including table IDs. Older project-wide
receipts that omitted `.asset` files cannot certify the expanded project scope
even when their inventory revision still matches; reading those as current
validation returns `unity_validation_scope_changed`. Their files stay intact.
Interrupted or uncertain engine ownership must be inspected before any retry.
A repeated unchanged resource limit needs investigation, not an automatic loop.

For a feature such as item-slot, use exact IDs returned by the current asset index:

```cmd
retk reconstruct validate Game --asset-ids "[\"asset:<guid>\"]" --json
```

MCP `reconstruct_validate` or `jobs_start` with operation `reconstruct.validate`
accepts optional `assetIds` (a unique array of 1..1000 IDs), `resumeOperationId`
and `timeoutSeconds`. The desktop operation has the same optional scope and
resume fields. Omit scope when resuming to retain the prior scope; conflicting
explicit scope is rejected.

Scoped success is exposed as `scopeBindingsVerified`; it does not set the
project-wide `bindingsVerified` flag. All source files still participate in the
staged project and compilation. Script observations distinguish attachable types,
reflection-confirmed non-attachable types, compiler-confirmed source membership
and unresolved identities. Compiler membership alone does not establish a
component's binding identity. Gameplay and visual fidelity remain unverified.
