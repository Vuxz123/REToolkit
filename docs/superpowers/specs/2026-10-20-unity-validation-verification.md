# Unity staging validation qualification

Date: 2026-10-20. Continuation of approved AssetRipper reconstruction design.
User requested fixture-first acceptance. No user game project was opened or modified.

## Delivered

JavaScript stages only source inventories, injects a fixed Editor-only C# helper,
selects the exact installed Editor by embedded ProductVersion, and supervises its
owned batch process through actual close. Reports bind the selected native/metadata,
asset inputs, graph revision, request, helper, Editor and observation bytes.

CLI/MCP expose validation and bounded section queries. Compilation, observed
bindings and behavior remain independent. Missing metadata, unknown class identity,
missing scripts/references and incomplete observations cannot claim verified bindings.
Binary and mixed-case scene/prefab paths are included in coverage.

## Evidence

- Before this tranche: 300 JavaScript tests passed in the isolated worktree.
- Final worktree and main workspace runs: 333 JavaScript tests passed; all seven
  legacy PowerShell suites passed. `git diff --check` and CLI help also passed.
- Helper compiled without diagnostics against installed Unity2022.3.62f2 and
  Unity6000.0.66f2 public DLLs. Static contract tests are separate from Editor runs.
- Actual source-owned acceptance used Unity2022.3.62f2 on three fresh staging copies:

| Case | compileReady | bindingsVerified |
| --- | --- | --- |
| Compiling source and correct prefab script | true | true |
| Prefab referencing a missing script GUID | true | false |
| Deliberate C# compiler error | false | false |

Run root:
`C:/Users/DPC00176/REToolkit/.worktrees/assetripper-ai/.cache/unity-acceptance/c698bc8f-4158-4043-9622-9c5fadeecf50`.
Operation IDs respectively: `d88f57e0-14e1-43d8-bb5f-c45dee875e94`,
`32fb1d68-a2eb-4e22-a046-5c0c40e32a67`, `af02bbf8-5b86-4872-aa38-c04dc05997bb`.
Each original inventory remained byte-identical after its validation. Process close
was observed, workspace lock removed, and zero toolchain readers remained afterward.

The three real Editor cases were repeated successfully from the main workspace
after delivery. Retained run root:
`C:/Users/DPC00176/REToolkit/.cache/unity-acceptance/fc519e62-9338-4a7e-9fc8-fca888aee65a`.
Operation IDs respectively: `82de969d-335c-4c8f-b8d8-0db23bcac256`,
`abe4deb4-1073-48dd-8306-90979fad138d`, `06cbd05d-59d8-4c07-a7e9-ae52451c326c`.
All expected readiness values in the table above matched; original inventories
and final ownership cleanup were verified again.

## Review fixes

Spec review approved after fixing omitted opaque/binary scene coverage, verifying
the executable's actual ProductVersion before launch, and guarding mixed-case and
embedded package manifests. Reviewer independently ran 36 relevant cases.

Quality review found mixed-case source extension mismatch and count-only output
paging. Both have regressions: uppercase source paths are covered consistently;
quote-heavy diagnostics paginate using nested JSON byte limits with correct cursors.
Final quality re-review approved the fixes and independently ran33 focused tests.
No material findings remained in the reviewed validation scope.

## Limits

This delivers the Editor verification portion of slice3. DLL conversion, explicit
script rebinding, serialized-field migration and gameplay equivalence are not
implemented by this tranche. Original source-apply receipts remain compile-unverified;
independent Editor receipts supply compilation evidence for their exact snapshot.

Only Windows `Unity.exe` discovery is implemented. Missing exact versions are
blocked; no editor/project upgrade or global CLI update occurs. Local/Git/external
package dependencies must be made portable first. Staging is not an OS security
sandbox: target import/Editor code may execute. No Play Mode is entered.

Real-game compatibility is untested. Unity6000 helper compilation was checked,
while actual three-case Editor acceptance was run on2022.3.62f2. Source hashes are
currently synchronous; large-project status latency is not qualified.

Delivery copied26 explicit files using the204-file byte backup/hash baseline.
All193 baseline files outside the delivery set retained their exact hashes;
pending prior tranches and unrelated changes are preserved. No commit/push.
