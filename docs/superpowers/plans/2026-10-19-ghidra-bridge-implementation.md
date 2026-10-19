# Persistent Ghidra bridge implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development and test-driven-development. Independent Java engine, symbol planning and Node lifecycle modules have separate owners; integration and review are sequential.

**Goal:** Implement the approved CLI session/query/rename/comment/IL2CPP symbol bridge against existing Ghidra projects.

**Architecture:** A detached Node supervisor owns the existing workspace lease and a supervised headless launcher. A Java HeadlessScript owns the Program and decompiler, accepts authenticated loopback NDJSON and serializes Program operations. Disk plans, snapshots, journals and saved receipts are written only by that owner.

**Tech Stack:** Node.js 24 ESM, built-in node:test, Ghidra 12.1 Java API, bundled Gson, PowerShell only for retained GUI adapters.

## Shared contract

Launch `RetkSessionBridge.java <private-config.json>`. Config: `version:1`, `runId`, `token`, `mode:read|write`, `workspace`, `projectDir`, `projectName`, `program`, `native:{path,sha256}`, `metadata:{path,sha256}`, `profile`, `endpointPath`, `idleMs`. Java atomically publishes endpoint `{version,runId,host:'127.0.0.1',port,programIdentity}`. Requests `{version:1,id,runId,token,method,params}`. Responses echo `{version:1,id,runId,ok,result|error,programIdentity,revision,coverage,limitations}`. Addresses are hex strings. Errors have a stable `code` and actionable `message`.

Methods: `session.status`, `control.attach`, `control.heartbeat`, `session.stop`, `functions.list/get/decompile`, `instructions.list`, `references.list`, `strings.search`, `memory.read`, `functions.rename`, `comments.set`, `symbols.plan/apply`. Mutation params include `operationId`, `payloadHash`, `expectedRevision`, `expectedOld`, `dryRun`; clients first preview then submit the observed old value/revision. Payload hash binds method+params excluding operationId/payloadHash. Same ID different hash rejects; no automatic mutation replay.

## Task 1 — Preserve baseline and isolate

- [x] Create ignored `.worktrees/ghidra-bridge`, copy current uncommitted JS source without changing root or committing unrelated work.
- [x] Run `npm test` at root: 66 baseline tests pass.

## Task 2 — Java engine and durable mutation executor

Files: `scripts/ghidra/RetkSessionBridge.java`, `RetkQueries.java`, `RetkMutations.java`, `RetkProgramIdentity.java`; real-engine fixtures in `test/real-ghidra-session.mjs`.

- [x] Start a real fixture test expecting endpoint, repeated status/read and readonly rejection; observe missing script failure.
- [x] Implement bounded authenticated framing, serial owner queue, separate control heartbeat, idle/stop/drain, identity validation and one decompiler.
- [x] Add query assertions for function selection, bytes, strings, xrefs, disassembly and paged decompile; compile/run against installed Ghidra.
- [x] Add write fixture assertions for preview, rename/comment, stale revision and retry; implement packed snapshots, intent journal, outer transaction, save, persisted operation ledger and saved receipts.
- [x] Verify reopened Program and separate `.gzf` restoration, preserving original project; fail closed on uncertain save/receipt.

## Task 3 — IL2CPP symbol plan/apply

Files: `scripts/ghidra/RetkSymbols.java`, symbol fixtures/tests. Own only these files; use shared Java executor for apply.

- [x] Write a real-engine fixture plan covering integer addresses, image-base mapping, user conflicts, noops, labels/comments and stale/tampered plan.
- [x] Implement streaming JSON address parsing with exact integers, explicit rva/va profile, mapped-address validation and conservative unsupported Thumb rejection.
- [x] Plan all five template groups to immutable files under `04_Notes/symbol-plans`; record before/after, conflicts/skips and coverage.
- [x] Apply exact plan bytes only after input/revision/policy/before-value validation, as a single outer transaction owned by Task 2; preserve USER_DEFINED by default.

## Task 4 — Node protocol/lifecycle/client

Files: `src/ghidra/{protocol,runtime,client,supervisor,provider,environment}.js`, `test/ghidra-*.test.js`.

- [x] Write tests for malformed/oversized/fragmented frames, response binding, TCP auth and missing sessions; run `node --test test/ghidra-protocol.test.js` before implementation.
- [x] Implement protocol limits and one-request client deadlines without mutation retry.
- [x] Test private runtime ACL, atomic descriptor, redaction and input revalidation; implement Windows SID+icacls verification before token publication.
- [x] Test detached start/stop with a source-owned fake protocol engine; implement supervisor lease, full verified pre-write backup, engine marker, heartbeat and conservative cleanup.
- [x] Reconcile only saved receipts into project state under supervisor lease; leave explicit pending state on failure.

## Task 5 — CLI and existing command integration

Files: `src/ghidra/cli.js`, `re.js`, `src/toolkit.js`, `README.md`, `CLAUDE.md`, `package.json`, CLI integration tests.

- [x] Add failing CLI behavior tests; implement strict argument parsing and approved commands/options including operation ID, dry run and comment file.
- [x] Block mutators/GUI during session; implement status via read-only snapshot/live ping without nested lease.
- [x] Document CLI examples, transport/trust boundary, stop-first GUI and actual qualified fixture scope.

## Task 6 — Review and delivery verification

- [x] Spec compliance review, fix findings, then independent quality review and fixes.
- [x] Run `npm test`, `npm run test:legacy`, real Ghidra session acceptance and existing import/MCP smoke checks where changed.
- [x] Preserve diagnostics on failures, report actual engine qualification and any unsupported fixture profiles honestly.
- [x] Copy reviewed bridge changes to root only after verifying baseline hashes, rerun root checks, retain worktree and uncommitted user changes.

Delivered experimental v1. Verification: `docs/superpowers/specs/2026-10-19-ghidra-bridge-verification.md`.
Full release qualification remains separate:

- [ ] Authorized real IL2CPP fixture/dumper pair.
- [ ] Interactive GUI reopen acceptance.
- [ ] ARMv7/Thumb mapping qualification.

No commits or remote publication are required for this task. Real game data is not used without authorization; source-owned fixtures do not establish support for every IL2CPP build.
