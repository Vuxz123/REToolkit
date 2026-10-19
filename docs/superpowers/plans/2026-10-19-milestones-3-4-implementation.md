# Milestones 3–4 implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development and test-driven-development. Independent diagnostic and portable-package modules have separate owners; integration and reviews are sequential.

**Goal:** Deliver task-scoped diagnostics/readiness and verified evidence handoff with an explicit TypeSafe Jev adapter.

**Architecture:** Keep the existing schema2 pipeline/Java bridge. Read-only diagnostics observe local state and optional bounded MCP probes. Handoff snapshots under lease into versioned folder/ZIP bundles, while evidence collection writes outside the active workspace. Offline Jev requests consume verified bundles; a separate explicit HTTP action submits them.

**Tech Stack:** Node24 ESM, node:test, existing yauzl/yazl, built-in fetch/crypto/fs/net/child_process. No new runtime dependency or GUI migration.

## Shared module contracts

- `src/diagnostics.js`: `diagnose(toolkit,{name,task='prepare',probe=false,...dependencies})` => report preserving old `checks`, adding schemaVersion/tasks/diagnostics/limitations. `formatDiagnostics(report)` => human text. `src/mcp-probe.js` handles bounded advertised read-only MCP protocol.
- `src/handoff.js`: `createHandoff(toolkit,name,{out,includeDummyDll=false,includeAssets=false,includeBinaries=false,evidence})`; `verifyHandoff(path)` => `{ok,manifest,errors}`. `readHandoff(path)` => verified `{manifest,readFile(relative)}` for the Jev adapter (readFile yields Buffer; ZIP streams are bounded). Use kind/schemaVersion defined in spec.
- `src/evidence.js`: `captureEvidence(toolkit,name,{kind,selector,direction='to',limit=100,out},dependencies={query:querySession})` => `{path,evidence}`. File schema `{kind:'retoolkit-evidence',schemaVersion:1,query:{method,params},build:{native:{sha256,size,abi},metadata:{sha256,size}},programIdentity,runId,revision,collectedAt,result,coverage,limitations,dataTrust}`.
- `src/jev.js`: `buildJevRequest(bundle,{against,questions,files=[],model='jev-latest',maxStateBytes=65536})`; `runJevRequest(request,{apiKey,timeoutMs=60000,fetchImpl=fetch})`. Offline serialization/artifact publication remains explicit at CLI boundary.
- Root owns `src/milestones-cli.js`, `re.js`, `src/toolkit.js` integration, docs/roadmap/package.

## Tasks

- [x] Isolate in `.worktrees/milestones-3-4` and preserve uncommitted JS/bridge baseline; record root hashes.
- [x] Baseline `npm test`: 83 pass before implementation.
- [x] Diagnostic owner: add failing tests for optional tasks, missing runtimes/extension, stale inputs, locks, readonly inspection, exact session/program and unknown capabilities; implement model + MCP framing/deadlines/cleanup; run own tests and installed-tool probe.
- [x] Handoff owner: add failing tests for portable manifest, lightweight defaults, opt-in payloads, missing/stale outputs, session/lock exclusion, source mutation, move/tamper, path/link/duplicate/CRC/oversize/schema validation; implement transactional folder/ZIP create + verify + bounded readFile; run own tests.
- [x] Root: add evidence capture failing tests including no-auto-start, native/meta/program binding, paged coverage, output outside workspace and atomic no-clobber publication; implement only needed code and rerun.
- [x] Root: add Jev request/HTTP contract failing tests for chosen-file inclusion, exact payload, 32MiB/depth/type/size limits, no truncation, no implicit network, key redaction, redirects, deadline, malformed answers and non-2xx; implement and rerun.
- [x] Integrate strict new CLI commands, backward-compatible doctor/status JSON, human diagnostics and exit codes; CLI behavioral tests before edits.
- [x] Spec compliance review and fixes; independent quality review and fixes.
- [x] Run full JS/legacy suites, actual MCP discovery probe and real synthetic Ghidra evidence/package acceptance. Keep live Jev untested unless user explicitly provides service credentials and authorizes submitted content.
- [x] Document portable manifest/CLI/Jev examples; update roadmap to JS/CLI-first current status, keeping m5 and outstanding engine qualification separate.
- [x] Copy reviewed changed files to root only if baseline hashes still match; rerun root tests and artifact roundtrip smoke. Keep uncommitted changes/worktree; no remote publication or unrelated commits.

No comparison/scoring engine is added. A request with two bundle states still delegates all judgments to Jev under user-supplied typed questions.
