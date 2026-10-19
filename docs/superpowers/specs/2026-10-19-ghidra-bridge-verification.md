# Bridge v1 verification

Scope: experimental CLI implementation of the approved persistent Ghidra bridge.
Windows, Node 24.15.0, installed Ghidra 12.1.2 and toolkit JDK 21. All engine
fixtures are source-owned synthetic inputs; no game target was modified.

Delivery result (2026-10-19): **83/83 Node tests**, **6/6 legacy suites**,
real MCP initialize/tools-list (**30 tools**, no target queried), and an actual
read-only Ghidra start/query/stop from the delivered root code all passed.
The full session and native symbol fixture commands passed before delivery;
copied source hashes were verified against the reviewed worktree.

## Automated coverage

- `npm test`: framing, UTF-8, allowlists, auth/binding, deadlines, private Windows
  runtime ACLs, detached lifecycle, concurrent start, lease contention, supervisor
  death/control loss, immutable request retry across reopened runs, stale input,
  imported-generation invalidation, complete/noop/old-profile receipt reconciliation,
  CLI plan/hash contract and original pipeline/archive regressions.
- `npm run test:legacy`: six original PowerShell helper suites.
- `npm run test:ghidra-symbols -- <engines-root>`: exact integer addresses above
  2^53, explicit RVA/VA, all five template groups, user label/comment protection,
  explicit replacements, collisions, verified instruction creation/no overlap,
  immutable plan tamper and stale revision/before/input rejection. Real loaders:
  raw x86, generated ELF64 AArch64 at 0x400000, generated PE64 AMD64 at 0x140000000.
- `npm run test:ghidra-session -- <engines-root>`: one persistent Program,
  query APIs, durable rename/comment and 1000-label transaction, reopened ledger
  replay, packed snapshot restoration to a separate project, relocated receipt
  lookup, dedicated control loss, actual detached Node supervisor and Unicode
  payload hashes, overlay address-space separation, cancellation rollback,
  postcommit save failure and post-save receipt-publication failure.

Important save semantics: headless ABORT alone still permits implicit final save
for existing Programs. `needs-recovery` shutdown first marks the Program temporary
and aborts, before any cleanup that may throw. The fixture verifies that an
injected failed Program.save does not silently become saved during shutdown.

## Remaining release qualification

- A real authorized IL2CPP build/dumper output pair.
- Opening the resulting project in the interactive GUI and reading annotations.
- ARMv7/Thumb address normalization; symbol import currently fails closed there.
- Full il2cpp.h/type/signature import and a Node MCP adapter are later features,
  rather than capabilities of the current plain-symbol CLI.

Synthetic native loader results do not establish compatibility with every build
or identify a particular installed dumper executable as a qualified RVA profile.
Explicit `--address-mode` remains required. Ready sessions do not imply completed
Auto Analysis, correct metadata pairing or original recovered source code.
