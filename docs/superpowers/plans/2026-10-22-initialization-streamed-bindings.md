# Missing initialization and streamed script bindings

> Agent workers: use fail-first behavioral tests and independent review. Two
> disjoint fixes may run in parallel. Preserve the existing dirty checkout.
> No live game/source apply, device activity, library replacement or commit.

**Goal:** Unblock evidenced missing constructors and complete Slot/Layer binding
checks through typed reconstruction routes without raising graph materialization
limits, changing serialized contracts or pretending stub DLLs are implemented.

**Architecture:** Add a separate explicit initialization mode preserving existing
body-mode. Exact bundled Roslyn verifies only declared missing constructors were
added; existing fields, initializers, attributes and all other declarations remain
identical. Each addition must match same-build verified dump constructor metadata
and exact native evidence; save/revalidate proof at apply. Stream full SQLite
script bindings into bounded counts/digests and preview samples from the sealed
database, re-derived at plan/apply. Keep complete source inventory, GUID/fileID,
freshness, transactional journal, rollback and receipt protections.

**Tech stack:** Node24, node:sqlite, exact Unity bundled Roslyn, existing typed MCP.

- [x] Reproduce initializer and >20k script binding failures using owned fixtures.
- [x] Implement full streamed binding attestation with bounded response previews;
  reject unresolved/ambiguous/incorrect GUID or local fileID anywhere in the scan.
- [x] Add explicit evidenced initialization capability for missing static or
  parameterless instance constructors of existing classes; no arbitrary member,
  field initializer, backing-field or serialization changes.
- [x] Revalidate evidence, constructor declarations, compiler/source inventory,
  graph/database identity, and repeated receipts at apply; test tampering/races.
- [x] Connect CLI/MCP schemas and document requests and remaining DLL requirements.
- [x] Run focused/full regression and read-only checks on exact reported sources
  and saved SQLite database. Never mutate GoodSort source, graph, notes or jobs.

Runtime library source identity remains a separate gap. DOTween available from
YarnFever is 1.2.335 while this game's native evidence says 1.2.765; do not silently
substitute it. ZeroX Rx/save require matching implementations/native recovery;
uGUI/TMP package availability alone does not verify DLL/GUID/fileID migration.
Report compile, binding coverage and playable gameplay independently.

## Verification

- Full regression: 939 tests, 938 passed, 1 existing skip, zero failures;
  `.cache/source-barriers-all-tests.log`. Follow-up generic-name proof guard
  has a fail-first regression; final focused suite passed 21/21, zero skips,
  stored at `.cache/source-barriers-final-focused.log`.
- Read-only GoodSort acceptance:
  `.cache/source-barriers-acceptance/3c594cea-96c7-4cef-b478-03933d9c3467/observation.json`.
  Sealed 9.26 GB database traversed all 87,586 Slot and 31,396 Layer bindings,
  zero unresolved. Actual GlobalStream nested constructor syntax/native proofs
  accepted with verified metadata v31 image ranges and original captures.
- Actual dump headers exposed an additional Dumper formatting gap. Implemented
  bounded v29/v31 raw-metadata image reader, exact hash/size + private attestation,
  strict contiguous type ranges and `__Generated` support. Both numeric and
  symbolic dump header fixtures covered; unsupported generic native constructor
  names cannot masquerade as nongeneric names.
- Independent review fixes: preserve malformed m_Script edges in JSON snapshots,
  reject forged/stale streamed summaries, bound proof previews, refresh native
  dump/build across async parsing/transaction/retries, retain GUID-less claims.
- Installed workflow sync uses backup
  `.cache/agent-cleanup/080f5c0f-f79d-4612-8fac-59a98f3af7de/`.
  No GoodSort source/graph/notes/job writes, no DLL replacement or game execution,
  no commit/push. Native existence/provenance does not prove behavior equivalence.
