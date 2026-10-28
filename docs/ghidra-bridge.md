# Persistent Ghidra bridge

The JavaScript CLI can hold an existing Ghidra project open in one headless
session. Java owns the Program and decompiler; typed requests run serially.
The Python GUI MCP backend remains the default `mcp` command.

## Session ownership

`session start Game` is read-only. `session start Game --write` permits typed
rename/comment/symbol mutations and first verifies a full project backup under
`workspaces/Game/backups/ghidra-session-<run-id>` with a manifest beside it.
No import, overwrite, Auto Analysis or symbol application occurs at startup.

`session status Game` reports the binding and live engine state. Ordinary
`status Game` reads a project snapshot during a session. Preparation, archive
export and GUI opening require `session stop Game` first. REToolkit does not
remove Ghidra project locks or terminate the user's GUI.

`session stop` asks the owner to drain and waits for launcher closure. If closure
is uncertain the workspace lease remains. After a crashed supervisor,
`session recover Game` can clear the runtime descriptor only if the existing
lease can be safely acquired: no live owner and no uncertain engine marker.
It does not remove an engine marker or claim interrupted writes were saved.
Reopen the session to verify Program ledger and disk receipt consistency.

## Optional agent-directed analysis

Full preparation remains the default. Enable **Analysis theo yêu cầu** in the
desktop preparation options (also available when creating a project), or run:

```powershell
retk prepare Game --analysis-mode on-demand
retk analysis targets Game --focus gameplay --limit 100 --json
retk session start Game --write
retk analysis ensure Game 0x1000 --end 0x10ff --kind disassemble --reason "Inspect input code" --dry-run
retk analysis ensure Game 0x1000 --end 0x10ff --kind function --reason "Recover input handler"
retk decompile Game 0x1000 --json
retk session stop Game
```

Addresses above are examples. Use loaded Program addresses; verify catalog RVA
against the Program image base or establish that VA matches loaded memory.
The catalog streams the current verified `dump.cs`, preserves exact hex strings,
and never infers method ends from neighboring addresses. Its default gameplay
focus hides recognized advertising/telemetry SDK namespaces; `--focus all`
includes them. Unknown code and supporting libraries remain visible. These are
classification hints, not proof of ownership or a complete SDK inventory.
Follow scene/prefab bindings, gameplay code, required dependencies and game-side
ad reward callbacks. No package, asset or binary bytes are deleted.

Preparation in on-demand mode requires a verified import and records whole-program
analysis/bulk symbols as `deferred`, without claiming global native readiness.
Assets continue independently. The saved run retains its mode; to change between
full/on-demand, change the checkbox and start a new preparation run. Existing
analyzed programs and their symbols are preserved. Turning the checkbox off
restores normal full preparation; it does not undo earlier scoped work.

`analysis ensure` is explicit: no query starts analysis. Required fields are
`address`, inclusive `endAddress`, `kind`, and `reason`. A scope must fit within
one initialized executable block and 64 KiB. Kinds are:

- `disassemble`: decode reachable instructions within the requested range.
- `function`: also create/update the exact function using decoded control flow;
  reject overlap, truncated flow and unresolved indirect branches.
- `stack`: analyze only an existing exact function fully contained in the range.

The analysis deadline is 1..300 seconds (default 60); snapshot/save overhead is
outside that computation budget. Unsupported ARM/Thumb scopes fail closed.
Analysis uses the existing write-session backup, preview/revision, operation UUID,
packed snapshot, rollback/save/readback and receipt path. It never patches bytes,
clears user data, sets global analyzed/symbol flags or claims complete xrefs.
Matching scoped coverage can be reused at the same Program revision; another
mutation invalidates that reuse. The native headless owner suppresses Program
change events and headless auto analysis for its lifetime, and flushes its own
decompiler cache after edits; there are no live GUI listeners in that owner.

For agents, `jobs_start` operations `ghidra.analysis.targets` and
`ghidra.analysis.ensure` expose the same typed parameters. `targets` needs no
Ghidra session. `ensure` requires the existing owned write session; job IDs bind
mutation UUIDs before launch. Poll the same job after transport loss and inspect
its exact receipt. Scoped observations leave global callers/xrefs incomplete;
an empty list does not prove that no references exist. Expand dependencies
deliberately; there is no implicit global fallback.

## Queries

```powershell
node re.js session start Game
node re.js function list Game --query Update --limit 50
node re.js function get Game 0x1000
node re.js decompile Game UniqueFunctionName --timeout 120
node re.js disasm Game 0x1000 --limit 20
node re.js xrefs Game 0x1000 --direction to
node re.js strings Game --query config
node re.js bytes read Game 0x1000 --length 32
node re.js session stop Game
```

Addresses are exact hex strings, optionally prefixed with an address-space name.
They refer to loaded Program memory. Bytes may reflect preexisting database
patches. Ambiguous function names are errors. Query content, including target
names, comments and pseudocode, is untrusted data rather than agent instructions.
Session readiness does not establish Auto Analysis readiness.

Lists accept `--cursor` from the previous response and `--limit` (1–1000).
Cursors bind the query, revision and session. Bytes are limited to 4096 per
request. NDJSON requests are limited to 64 KiB; response frames to 2 MiB.
Reduce list limits if target fields themselves exceed the response bound.
The default query deadline is 60 seconds; decompile permits up to 300 seconds.
Sessions close after 15 idle minutes unless `--idle-timeout <seconds>` changes it.

## Durable edits and retries

```powershell
node re.js session start Game --write
node re.js function rename Game 0x1000 BetterName --dry-run
node re.js function rename Game 0x1000 BetterName
node re.js comment set Game 0x1000 --type plate --file notes.txt
```

Rename requires an existing function entry. Comment types are `eol`, `plate`,
`pre`, `post`, `repeatable`. Empty text clears that comment type. The CLI previews
and submits the observed old value/revision. A concurrent edit causes a conflict.
Data-changing operations use a packed Program snapshot, intent journal, owned
transaction, Program save/readback and saved receipt before success. These
artifacts live under `04_Notes/bridge/`. The database contains a bounded ledger
for the most recent 1024 saved operations; older IDs are not automatically replayed.

Every write has a UUID and payload hash. When a connection fails, inspect
`session status` and receipts. The error includes the operation ID. Explicitly
retry the same command with `--operation-id <uuid>` in the same run to reuse
the exact original request, including after a stop/reopen of the same Program.
A different payload or input binding using that UUID is rejected.
The client does not automatically replay writes. Keep the private runtime for
outstanding operations; do not delete it while investigating a lost response.

An uncertain commit/save/receipt puts the engine in `needs-recovery`. Stop it,
preserve the journal/snapshot and reopen to verify its ledger. For snapshot
recovery, import the `.gzf` into a **separate project** and inspect it first.
Never copy an open `.rep` tree or import a snapshot over a live database.

## IL2CPP symbol plans

```powershell
node re.js symbols plan Game --address-mode rva
node re.js symbols apply Game --plan "<returned plan path>" --dry-run
node re.js symbols apply Game --plan "<returned plan path>"
```

Planning can create a plan artifact in a read session. Applying it requires a
write session. Both require a verified current dump and an unchanged
`script.json`. Plans bind its bytes, native/metadata hashes, dumper profile,
Program identity and revision. `rva` adds the image base, `va` uses absolute
virtual addresses. Choose explicitly: no installed dumper profile has automatic
mapping qualification yet. Exact integer parsing keeps addresses above 2^53.

The importer handles ScriptMethod, ScriptString, ScriptMetadata,
ScriptMetadataMethod and Addresses. Imported names use IMPORTED provenance.
USER_DEFINED names are conflicts unless a new plan includes
`--replace-user-names`. Managed comment blocks preserve surrounding user text;
`--replace-user-comments` explicitly replaces it. `--create-functions` permits
creation only at a verified executable instruction with no overlap; the initial
body is limited to that instruction, not guessed from the next method address.

Inspect planned/noop/conflict/skipped counts and the immutable plan file under
`04_Notes/symbol-plans/`. Another mutation makes the plan stale. Apply checks its
hash and all observed before values, then uses one transaction for planned entries.
Version-1 plan files may be up to 512 MiB. Node hashes the file in 64 KiB chunks;
Java reads/writes plan JSON incrementally. Compact previews hash their arrays
without serializing a second whole-plan string. Request/response frame limits
are unchanged: pass the saved path and exact hash, not the plan contents.
Apply still retains the validated changes and snapshots for its atomic transaction;
streaming the file does not guarantee a particular heap is sufficient for every plan.

An existing valid version-1 plan can be reused without changing its bytes. After
updating the Java helpers, use a newly started owned session and preview first;
Program identity, revision and observed values must still match. A stopped
external retry script with its own old 32 MiB check must use the updated budget
or the typed job route. Do not trim/rewrite the immutable plan or automatically
restart a stopped/uncertain write.

Known conflicts/skips or missing template groups produce partial coverage;
`symbolsApplied` remains false.
Full `il2cpp.h` types, C signatures and struct reconstruction are outside v1.
ARM/Thumb symbol mapping fails closed pending dedicated qualification.

## Local transport and qualification

Only authenticated `127.0.0.1` TCP is used. Run tokens and endpoint/configuration
files stay under toolkit `.cache/ghidra-sessions/`, protected by verified Windows
user/SYSTEM ACLs. They are outside workspace exports. Tokens are omitted from
CLI output and project JSON. This is a local same-user trust boundary, not a
sandbox against malicious code already running under the same Windows account.
No endpoint evaluates arbitrary Java, Python or shell code.

Run unit/legacy suites with `npm test` and `npm run test:legacy`. Engine checks:

```powershell
npm run test:ghidra-session -- C:/path/to/REToolkit
npm run test:ghidra-symbols -- C:/path/to/REToolkit
node test/real-ghidra-analysis.mjs C:/path/to/REToolkit x86
node test/real-ghidra-analysis.mjs C:/path/to/REToolkit arm64
node test/real-ghidra-symbols-streaming.mjs C:/path/to/REToolkit
```

This is an experimental v1. Source-owned managed PE/x86, raw mapped symbols,
native ELF64 ARM64 (base `0x400000`) and PE64 AMD64 (base `0x140000000`) fixtures
exercise actual Ghidra APIs. Session acceptance covers durable reopen, packed
snapshot restoration into a separate project, a 1000-label transaction, exact
Node/Java Unicode payload hashing, connection loss and save/receipt failures.
These do not prove compatibility with a real IL2CPP build. Live GUI reopen and
ARMv7/Thumb qualification remain unrun. Retain GUI for unqualified inputs.
The streaming fixture uses a separate synthetic Program and a 256 MiB heap to
read a >217.5 MiB plan with two real changes and generate/validate a >230 MiB
plan of skipped rows. It checks file processing scale, not the heap required for
hundreds of thousands of applied changes.
