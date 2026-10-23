# Workspace preview regression

The reported GoodSort3D workspace.add job succeeded, but its 431377-byte result
was compacted to a notice because the broker only preserved semantic previews
for project.create and adb.capture. The complete result was safely stored.

Implemented a bounded workspace summary for workspace preparation/status/engine
operations and input select/recover. It preserves step states, selected paths,
input revision, bounded ABI/metadata candidate lists, omission counts and next
actions. It omits large file/hash inventories while retaining the full artifact.
Workspace previews render direct step and candidate tables rather than nested
JSON inspectors. No archive re-import or target mutation is needed for this fix.

Verification:

- Regression was red for the reported notice-only workspace.add behavior, then
  green for add/status/select/recover; long Unicode candidate lists remain bounded.
- 36 focused desktop/model/input tests passed.
- Actual Electron workspace.add with 403 fixture files produced a saved full
  result and visible pending-selection warning, step/ABI tables, paths and next
  action. Raw JSON stayed collapsed; both ABI rows were visible without expansion.
  `.cache/desktop-results-acceptance/63efd56e-e134-41df-a082-634df0f09df1/workspace-preview.png`.
- Read-only replay of the reported saved GoodSort job passed. It kept both ABI
  choices and awaiting-user scan state. Observations are in
  `.cache/workspace-preview-regression.json`; the source result was not changed.
- No game/device/harness/engine execution, no re-import of GoodSort, no commit.
