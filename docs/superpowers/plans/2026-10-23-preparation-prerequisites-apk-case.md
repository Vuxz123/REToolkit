# Fix preparation prerequisites and APK resource casing

The user approved correcting two blockers diagnosed on SwarmSort. Use owned
fixtures first; do not replay preparation, launch engines, pull a device, change
project policy or close applications. RAM/resource limits stay unchanged.

- [x] Reproduce case-distinct APK resource rejection and the native prerequisite
  cycle using real ZIPs and the default preparation prerequisite handler.
- [x] Treat APK member identity as case-sensitive during read-only inspection;
  retain exact-duplicate, manifest-alias, path, link, size and CRC guards.
- [x] Separate pending dump/import output evidence from actual pipeline
  prerequisites; preserve tool/input/ownership blockers and unknown-state gates.
- [x] Retain detailed APK-set failure reasons in the Android receipt without
  changing the invalid-state or device recovery rules.
- [x] Verify negative cases, regression and read-only SwarmSort APK inspection.
  Document the resume requirement and remaining RAM blocker. No commit/push
  unless the user requests delivery separately.

## Verification

- New tests failed before implementation for case-distinct resources, default
  prerequisite output cycle, invalid-set diagnostics, incomplete readiness scope
  and misleading RAM error codes.
- Focused and related regression: 88 passed, 0 failed/skipped, exit 0. Command:
  `node --test test/preparation.test.js test/apk-inspection.test.js test/android-preparation.test.js test/diagnostics.test.js test/preparation-surfaces.test.js test/desktop-preparation.test.js test/desktop-preparation-view.test.js test/automatic-input-surfaces.test.js test/input-selection.test.js`.
  Evidence: `.cache/swarm-fixes-final-regression.log`.
- Real doctor integration uses source-owned dummy tool files, verifies that
  unprepared output readiness remains blocked, then proves setup proceeds and
  removing Java still blocks it. No fixture executable is run.
- Read-only inspection of the original SwarmSort APK in Downloads now reads its
  manifest and exact intake hash without invalid/case-duplicate failure. Signing
  verification was explicitly disabled for this check, so signing stays unverified;
  it does not certify full package/game readiness. Evidence:
  `.cache/swarm-apk-fix-verified.json`.
- User confirmed deleting old workspaces to recreate the project. No workspace
  was restored, pipeline resumed, application closed or device accessed.
- Independent review found no concrete P1/P2 issue; the incomplete-scope hardening
  it suggested was applied and covered by the rerun.
