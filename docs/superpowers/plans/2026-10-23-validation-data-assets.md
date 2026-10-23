# Validate scoped Unity data assets

- [x] Reproduce a scope containing two `.asset` tables in snapshot, staging,
  report contract and service validation tests without changing the policy.
- [x] Include `.asset` selectors alongside scenes/prefabs, retaining exact IDs,
  source inventory, scope coverage and resume/receipt binding.
- [x] Extend the Editor helper to inspect every loaded main/subasset with the
  existing per-asset property/object/time budgets; empty/null/error loads remain
  incomplete, and missing script references cannot pass.
- [x] Compile/run the actual helper against owned C# fixtures for subasset
  references, missing scripts, empty/null loads and budget exhaustion.
- [x] Reject older project-wide evidence that omitted newly supported assets;
  keep partial/scoped success distinct from whole-project readiness.
- [x] Run focused and full regression, update docs and record evidence. Do not
  run/retry the user's game validation, alter policies or commit/push.

## Verification — 2026-10-23

- `npm test`: 1064 tests, 1063 passed, 0 failed, 1 skipped (existing gated
  real Unity migration acceptance); log: `.cache/validation-assets-all-tests.log`.
- Focused validation regression: 45/45 passed; additional service/surface/helper
  regression: 27/27 passed; final helper/surface/snapshot check: 11/11 passed.
- Production JavaScript syntax checks and whitespace diff check passed.
- Independent read-only review found no confirmed P1/P2 issue.
- C# helper behavior was compiled and exercised against owned Unity API fixtures;
  real Unity Editor behavior and the user's game remain unverified.
- Existing policies and user validation artifacts were retained. No user-game
  validation, installation, commit or push was performed for this fix.
