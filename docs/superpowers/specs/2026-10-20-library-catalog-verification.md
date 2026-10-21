# Local Unity library catalog/import verification

Date: 2026-10-20. Implementation follows the previously approved design named
`2026-10-23-library-catalog-import-design.md`; its historical filename is retained.

Implemented scope: configured local ZIP roots; bounded static catalog and common
library hints; project-manifest or explicit versioned requirements; conservative
dependency closure and collision checks; saved plans; exact payload extraction;
fresh staging import with a fixed asynchronous Unity helper; repeat-operation
inventory checks; separate compile/binding verification; CLI and typed MCP tools.

The default is `libraryRoots: []`, reported as unconfigured. The user has not
supplied vendor library archives. No vendor package or reconstructed game has
been qualified by these fixtures.

## Real Editor acceptance

`node test/real-library-import.mjs` was run with installed Unity **2022.3.62f2**.
The source-owned UPM ZIP provides `OwnedLibrary.Token`; the generated exported
project contains one MonoBehaviour script referring to that type. There are no
scene/prefab assets in this acceptance case.

- Saved plan selected the unique `com.retk.ownedfixture@1.2.3` payload.
- The import helper observed the exact package ID/version, embedded source and
  resolved path using Package Manager; Editor close was observed with exit 0.
- Fresh verification returned `compileReady: true`, `bindingsVerified: true`
  for the one source script, and `uiVerified: false`.
- Source ZIP and exported project inventory remained unchanged after import and
  verification. Repeating import reused the bound receipt without launching Unity.
- Workspace lock and toolchain reader directories were released after child close.

Local acceptance artifacts remain under
`.worktrees/assetripper-ai/.cache/library-acceptance/f0a78f05-ee48-4e82-9279-9c941943b685`.
Import operation `f3464af9-e4bc-4a85-9542-9d060e687c48`; verification
`0339d9ca-8d60-4690-be48-cebe79ce6fb5`; compile observation
`b6f96984-2077-4d5e-ac9f-2a94989ec486`. These ignored local artifacts are evidence,
not distributable game assets.

The first real run exposed Unity adding `m_EditorVersionWithRevision` to staging.
A regression now allows only that narrow same-version normalization and records
its before/after hashes. It does not allow arbitrary source/settings rewrites.
Unity's headless graphics warning does not establish rendering correctness.

## Checks and review

Baseline: 333 JavaScript tests. Final worktree verification: **426/426 JavaScript
tests passed**, plus all **seven legacy PowerShell suites**. This includes 92
library tests and the new fixed asynchronous Unity runner regression.

Independent spec and quality reviews found and prompted regressions for root
ordering, deferred transitive constraints, opaque DLL/source/native identity,
Runtime/Editor assembly filters, bounded identification output and bounded hint
amplification. Existing embedded-package declarations are considered separately
from installation proof.
The final narrow independent review also passed the source-catalog re-derivation
guard and existing Package GUID collision facts (42 focused tests). Import and
verify re-derive catalog metadata from current ZIPs before Editor execution;
rewriting a cached JSON hash cannot invent source identities.

## Main workspace delivery

Delivered **31 explicitly owned files** with a baseline-hash guard and exact
backups. All **210 baseline files outside this delivery** remained byte-identical;
unrelated pending work was preserved. The local delivery manifest is
`.worktrees/libraries-delivery.json`. No commit or push was performed.

After delivery, the main workspace independently passed **426/426 JavaScript
tests**, **all seven legacy PowerShell suites**, and a fresh real Unity fixture
import/verify run. `git diff --check` passed. The live default library roots
remained empty and the policy remained `auto-staging-on-unique-match`.

Main acceptance artifacts:
`.cache/library-acceptance/aaa6b8da-49ef-4aca-b8c6-1e1e6b1856da`;
import `03f04841-4eac-45cd-ba0a-65d25a0f695c`;
verification `4fe7eb3b-82ba-46e8-9101-bd6c2eacf18f`;
compile observation `2e4ab04d-e128-4ab2-accc-eface43e9f69`.
Both observed Editor processes exited 0, fresh compile/binding flags were true,
UI remained unverified, original inventory/ZIP checks passed and ownership gates
were released.

## Limits

Supported import adapters are inspected UPM and Assets payloads. Nested
`.unitypackage`, loose or embedded uninspected DLL/native plugins, unsupported
C# declarations and unresolved collision facts block automatic selection. Static
namespace/assembly hints never authorize an import. Hashes bind local content;
they do not authenticate its publisher. Unsupported version constraints remain
blocked rather than selecting a latest release.

Existing metadata/GUIDs are preserved exactly. Unity may create missing metadata
for newly added files; these bytes are recorded in the final staging inventory.
No script-stub replacement or promotion back into the original export occurs.
Compile/binding checks do not prove runtime behavior, visual accuracy or UI
correctness. The original-game image/video comparison checker remains a separate
planned feature.
