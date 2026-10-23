# Automatic project preparation with Android delivery inspection

> Agent workers: implement bounded independent units, use fail-first tests and independent review. Preserve all existing uncommitted work. No live game/device execution or commit is requested.

**Goal:** Run deterministic project setup in a detached Node pipeline before the AI agent begins, including detection and guarded recovery of missing installed Android splits and downloaded data.

**Architecture:** Reuse typed operations, existing engine ownership and durable jobs. A preparation coordinator persists stages, observes real outputs, reuses only content-current artifacts, serializes workspace engine stages and publishes one compact handoff. CLI/MCP/GUI start or resume a preparation job; the user need not keep an agent alive to poll steps. Installation and prerequisite checks remain separate from readiness claims; missing exact runtimes produce actionable blockers.

**Android contract:** Inspect bounded APK manifests, dependency split declarations, package/version and verified signing identity. Compare only an explicitly selected device/package with matching original base identity. Capture all installed APKs/OBB and requested app data to a new artifact, validate the captured APK set again before replacing selected inputs, and preserve original archives/receipts. Never guess a device/package, mix app versions/signers, install/launch a game, enable root, claim undeclared PAD/CDN data is complete, or treat a denied private scope as absent. Missing remote/on-demand data remains unverified. A missing IL2CPP binary alone does not prove split delivery.

- [x] Add APK/APK-set identity and dependency inspection, verified signing checks and bounded installed package discovery; cover malformed inputs, split/version/signer mismatch, required split types and universal APKs with fixtures.
- [x] Add Android preparation inspection/capture service using the existing read-only ADB transport; bind serial/package and identity before pull, revalidate after capture, preserve old inputs and explicit coverage.
- [x] Add durable Node preparation coordinator using existing dump/import/analysis/symbol/AssetRipper/index operations. Reconnect/resume without duplicate writes; uncertain outcomes stop for receipt recovery. Resource/ownership blockers remain visible and bounded, not silent waits.
- [x] Expose typed job/MCP and CLI routes, observable per-stage status and compact handoff; symbols require explicit saved/current address-mode policy and existing backup/receipt checks.
- [x] Add GUI create-and-prepare/start/resume and progress/handoff display, saved LDPlayer target selectors and explicit symbol policy. Agent launch consumes preparation results rather than orchestrating setup again.
- [x] Update documentation/skills and run focused/full regression plus owned process/UI fixtures. Report actual engine/device acceptance separately; no real target run in this task.

**Readiness:** Native analysis, symbol coverage, assets/index, Unity compile/binding, downloaded asset coverage and gameplay remain separate dimensions. A completed preparation pipeline does not establish a reconstructed/playable game. The pipeline may finish partial with a complete handoff and explicit decision blockers while independent stages succeed.

## Verification and limits

- Full `node --test test/*.test.js`: 903 tests, 902 passed, 1 existing skip,
  zero failures; `.cache/preparation-all-tests.log`.
- Actual sandboxed Electron fixture (no live game/device/agent engines):
  `.cache/desktop-preparation-acceptance/214e4655-3cfd-46aa-ac84-c3dc51b00993/`.
  Running/partial/stale screenshots visually checked; 56 desktop tests passed.
- Owned detached Node preparation worker and actual binary AXML/signed APK
  fixtures verify transport, selection, identity and durable results. Independent
  review findings fixed: stale status/validation readiness, uncertain ADB cleanup,
  historical readiness on refused resumes, and atomic heartbeat read races.
- Installed Codex/Claude workflow updated with hash-guarded backup at
  `.cache/agent-cleanup/efe44033-29c6-4ba3-8f01-ecdef62f8346/`; dry-run now clean.
- Missing SDK/runtime installation remains separate. Initial script mapping is
  bounded, Unity baseline optional, remote/on-demand data and gameplay unverified.
  No real target capture, full vendor-engine pipeline, game launch, commit or push.
