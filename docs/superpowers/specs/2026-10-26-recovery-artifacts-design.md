# Reconstruction diagnosis and shared artifacts

Approved scope: milestones 1–2 from the conversation. Node orchestrates existing
source recovery, local library import, migration and Unity validation on an
explicit artifact; no automatic stub replacement or complex migration is added.

## Artifact lifecycle

`recovery create Game` snapshots the selected verified export into a workspace-owned
artifact. It records input binding, full source inventory, generation UUID and
unverified compile/binding/gameplay status. Original export and project settings
are never repointed. `recovery status/history` return bounded current identity
and history. Every mutating `recovery run` requires artifactId + expected revision.
It checks current input/inventory, saves an intent, then copies source mutations
into a fresh generation. Successful library imports/migrations are adopted only
from their canonical receipts and verified stage inventories inside the artifact.
Old generations remain unchanged. Failed/interrupted writes retain intent and
block further operations until explicitly inspected; status stays readable.

Existing domain services are reused with a privately registered toolkit scope:
artifact-local graph/plans/receipts and project state, real workspace locks and
toolchain leases, original native/dump identity. No arbitrary output project,
generic executable, shell or unrestricted method is exposed. Domain validation
and collision gates remain authoritative. Validation cannot establish gameplay.

## Diagnosis

`recovery diagnose` produces a bounded, paged issue list for the exact artifact
snapshot: source recovery capabilities and missing implementation evidence,
uninspected managed runtime DLLs, unresolved component script references and graph
coverage limitations. Empty bodies are hints, never proof of a runtime stub.
Library candidates are inventory/catalog hints, not a compatibility assertion.
Feature scope can be selected by exact script IDs; serialized reference coverage
is explicitly separate from behavioral dependency completeness. Unsupported or
unobserved behavior stays unknown, including constructor completeness without
verified metadata/native proof. Each issue includes an actionable next operation.

## Surfaces and acceptance

Typed CLI/MCP and durable jobs share strict DTOs; GUI can invoke the registered
operations. Existing direct commands retain their original-export semantics.
Fixture tests prove source isolation, two-operation composition, independent
artifact plans, stale inputs/revisions, unknown writes, blocked library adoption,
full stage receipt inventories, paging and no false readiness claims. Related
source/library/migration/validation suites must pass. Real game acceptance and
runtime replacement belong to later milestones.
