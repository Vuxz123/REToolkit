# Component resolver implementation plan

> Execute inline with superpowers:executing-plans and TDD. Preserve preexisting dirty work and game workspaces.

**Goal:** Give agents current component/library mappings and controlled migration plans with explicit blockers.

**Architecture:** Stream graph inventory, enrich only a private graph with package targets, observe through the existing staged migration helper, and compose existing plan/apply/verify operations. Exact binding, source/helper/catalog freshness and existing field/duplicate/DLL gates remain authoritative.

**Stack:** Node.js, node:test, current JSON/SQLite graphs, existing Unity observer and migration journal.

- [x] Add src/components/{inventory,registry,resolver}.js and fail-first fixtures for native/script grouping, full counts/bounded samples, Packages identities, missing/duplicate/unknown types and real available catalog hints.
- [x] Extend the private migration target graph with inventoried package source records; use it consistently at observe/plan/apply. Keep original public graph revision and source replacement rules. Add componentMode to the staged observer for native identities and compiled component-only registry. Test ordinary migration unchanged and package rebind staging.
- [x] Add src/components/{definitions,service,cli}.js with canonical sealed scan/observation/plan records and schema validation. Implement scan, observe, plan, apply, verify and bounded report. Recheck saved provenance and delegate writable work to existing migration services.
- [x] Wire API/MCP/jobs/recovery/desktop and workflow allowed operations. Editor operations fork; canonical migration stages are adopted without losing prior artifact edits. Add real CLI/fake-Editor, stale/cross-artifact/duplicate/conflict tests and readable GUI statuses.
- [x] Update README, component guide and bundled reconstruction skill; emphasize available-version trials, package-cache limitations, no blind GUID replacement and separate gameplay evidence. Run relevant regressions, compiler/syntax/whitespace checks, independent review and integrate only owned files after hash checks. No commit/push or real game/Editor execution.

Validation: 284 passed, 2 environment-gated skips, 0 failures across 33 related test files (component-final-tests.log). Owned JavaScript syntax checks passed. Migration observer compiled against installed Unity 6000.0.66f2 reference assemblies without launching Editor. Independent read-only review closed with no outstanding P1/P2 findings. Real Editor import/gameplay remains unverified.
