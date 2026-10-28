# Component implementation resolver

Approved by the user after the proposed engine/package/vendor inventory,
type/assembly/GUID/fileID matching, available-release trials and controlled
staging migration with independent data/binding/behavior checks.

Add a streamed component inventory for current JSON/SQLite graphs. Count and hash
all selected component identities; group by native ClassID/type or script
GUID/fileID and retain bounded samples. ScriptableObject data rows are not
GameObject components. Unknown/opaque/static coverage remains explicit.

Build candidate identities from current Assets sources and inventoried embedded
Packages sources/metadata. Packages/manifest and lock versions are metadata, not
proof of installed implementation. Catalog matches are hints only, using actual
available versions and the existing library planner for install decisions. DLL
local IDs and unknown sources require Editor observation; names never prove a
stub. Native mappings never replace engine DLLs/ClassIDs or change Editor.

Use the existing staged migration observer, opt-in componentMode, to observe
exact selected native/script component IDs and compiled candidate source/DLL
identities. Include inventoried Packages targets. Native instances record
actual type/assembly separately from script identities. No Save/Play Mode.
Registry-cache-only targets absent from project inventory need a managed package
snapshot/import before writable migration; do not invent GUIDs or copy caches.

components.scan/observe/plan/apply/verify/report expose bounded DTOs through
CLI/MCP/jobs/desktop and shared artifacts. Plan may retain same-identity bindings
or create explicit migration rebindings. Different full types require explicit
mapping selection. The existing migrator rederives plans, checks complete field
coverage/identity and stages changes. Duplicate full types, assembly removal,
complex fields, missing observations and ambiguous candidates remain blockers.
Native observed mappings are read-only; no serialized ClassID rewrites.

Every observation/plan binds the current build, source inventory, graph, helper,
candidate project and library-catalog revision. Apply rechecks all dependencies
and original domain plans; unknown writes are never replayed. Report paginates
components/types/candidates/decisions with exact counts and scope. Staged changes
are verified by the existing observe/verify route and require fresh scoped Unity
validation; compilation is not gameplay success. Recovery adopts only canonical
migration receipts, retaining original export and previous generations.

Use source-owned fixtures and optional helper compilation only. Do not launch a
real Editor/game or import user libraries during implementation. DLL replacement
and arbitrary serialized migration stay outside existing supported gates.
