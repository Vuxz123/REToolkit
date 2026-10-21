# Desktop, GUI runtime, visual assurance and reconstruction continuation

The user explicitly authorized the five remaining workstreams and chose Electron
desktop over a local web GUI. Real-game target supplied: Screwdom 3D 13.6.4 XAPK
at `C:/Users/DPC00176/Downloads/Screwdom+3D_13.6.4_APKPure.xapk`.
Keep that source immutable and work in a new staging/workspace. Original-game
visual baselines and Jev credentials have not yet been supplied. Never turn those
missing observations into passes. No commit or public npm publication requested.

## Electron desktop and launchers

Prefer Electron over a custom WinForms JS bridge; use a thin trusted renderer,
not duplicated pipeline code. `retk gui` starts a pinned Electron44.9.1 desktop.
Main process brokers typed job requests to the same Node24 CLI. Preserve the Node
executable from the launcher: spawning Electron's executable as a Node worker
would accidentally open another GUI. Window close cannot abandon active jobs.
Renderer has context isolation, sandboxing and no Node integration. A narrow
preload exposes snapshot/run/file-picker/update only; validate sender/main frame,
operation, keys, types and byte limits. Local app resources only, strict CSP,
no remote navigation, popup creation, arbitrary shell or eval exposed to IPC.

UI groups: workspace overview, prepare/dump/import/open, AssetRipper and graph,
reconstruction/validation, libraries, setup/runtime, visual evidence and Jev.
Show actual result/readiness/job state and errors. Unsupported or missing evidence
stays explicit. Inputs selected through native pickers or validated forms; no
invented game data, successful reconstruction or comparison scores.

Ghidra/PyGhidra launcher orchestration moves to new Node modules. Preserve toolkit
JDK and isolated Python/environment; no pip/venv repair on GUI launch. Start an
owned worker and retain workspace/toolchain ownership through actual child close.
Use foreground Ghidra launch semantics to avoid releasing the lease while a
detached JVM still runs. Project preferences/configuration are private to the
launcher profile; never overwrite global user preferences. No blind PID attach,
project-lock removal or killing user Ghidra instances. A launch receipt means
spawn/start observation, not verified analysis or live MCP Program readiness.

## GUI runtime, extension and .NET

Use exact reviewed artifacts/metadata and existing archive/Python installer
building blocks. GUI Python must contain CPython312, PyGhidra3.1.0, JPype1.5.2
and complete locked dependencies, with native import checks. Reuse the existing
locked Python generation format where possible rather than a permissive pip
installer. Install extensions into toolkit-private Ghidra settings/profile,
validate bridge/extension/Ghidra metadata, and keep GUI activation unverified until
observed. .NET is toolkit-local and selected with DOTNET_ROOT(_X64), not a global
machine installer. Keep prior profiles, journals, hashes and writer/read leases;
never replace installed main engines during fixture acceptance.

## Visual assurance

Implement the existing UI contract design as deterministic evidence comparison.
PNG screenshot comparison records exact input hashes, profile, ROI/mask policy,
pixel differences and a diff artifact. Never silently resize mismatched profiles.
Video comparison uses explicit frame times and an explicitly selected ffmpeg
executable; no arbitrary filters or shell, bounded extraction and owned staging.
Compare all required regions/frames. Missing baselines, unsupported capture,
profile mismatch or temporal observations remain unverified, separate from
compilation, bindings and interaction behavior. Use fixed source-owned image/video
fixtures to establish mechanics before claiming original-game fidelity.

## DLL conversion, rebinding and fields

DLL-to-C# conversion requires exact assembly/full type and observed MonoScript
GUID/local fileID, not a guessed11500000 or regex name match. Add explicit saved
plan/apply/verify for supported serialized-reference/field changes. Tie plans to
graph revision, source files and supplied Editor observations; preserve all
unlisted YAML/meta/fields and object references. Apply only in fresh staging with
exact backup and journaled rollback. Unsupported binary/managed-reference/type
conversions fail explicitly. Compilation, actual bindings, migrated values and
runtime behavior remain independent evidence.

## Real-game acceptance

Inventory/hash the supplied XAPK, enumerate inputs and select ABI explicitly.
Run dump/import/export in a new workspace and preserve source identities.
Editor validation and runtime/UI scenarios operate on copies. Never claim
full game reconstruction from decompiler pseudocode or stubs. Collect actual
failures and coverage; original screenshots/video and a configured Jev endpoint
are required for those final checks. Hosted external calls send only explicitly
selected request data. Missing authentication is a concrete external dependency,
not permission to log secrets or fabricate a live run.

## Delivery

### User-requested Jev settings

Create fixed local `config/jev.json` (Git-ignored) and a checked example.
Only endpoint/model/apiKeyEnv references enter this DTO; the endpoint remains
the supported official URL. Namespace variables under TYPESAFE_/JEV_ to prevent
executable-environment overrides. GUI Settings saves references and accepts an
optional password into main-process memory for the session. It never enters
job payloads/history or disk. Broker forwards those credential variables only
to explicit Jev send jobs. Saving/testing and queued jobs exclude each other.
The connection test sends one synthetic typed question, no game data or retry.
Missing auth remains blocked; saved requests are never rewritten on model changes.

### Real-game graph scale

Screwdom exports184599files/2.51GB. Keep a complete250000-file inventory,
100000directory/search ceiling and eight hash workers. Check handles, paths,
directories, absent roots and final per-file identities. Default graph metadata
budget remains128MiB; an explicit large-project selection may use256 or512MiB.
The stored graph and workspace record carry the selected budget; IPC page/query
budgets do not increase. Compact local graph storage has a hard512MiB ceiling.
Reconstruction snapshots retain the full file inventory, all source declarations
and all script bindings, omitting unrelated payload fields from their saved plan.
Allowlisted exact Unity class/type/bulk-field paths may become read-only
descriptors with exact source/token hashes, lengths and explicit coverage.
Reference-bearing arrays and all MonoBehaviour fields remain intact. Original
YAML is never changed. A cap failure is never published as a complete graph.

Use the ignored existing worktree, exact main byte backups and scoped hash guards.
TDD for behavior changes; independent spec/quality reviews; full JS and seven PS
suites plus separate real Electron/Unity/vendor/game evidence. Preserve unrelated
pending work and the existing registered `retk` source link.
