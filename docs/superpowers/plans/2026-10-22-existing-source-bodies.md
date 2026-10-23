# Existing source body replacement and shared DOTween

> Agent execution: use focused implementers and independent review; retain all current uncommitted work. No commit or game mutation is requested.

**Goal:** Let agents plan/apply implementations in existing generic, nested and property-bearing sources while preserving every declaration and serialized identity; snapshot the user's YarnFever DOTween into the shared catalog.

**Design:** Keep the legacy source contract unchanged. Add explicit per-change `mode: "bodies"` using the exact installed Unity Editor's bundled Roslyn syntax parser. Compare token skeletons with only executable bodies omitted; literals and initializer tokens outside those bodies remain exact. Bind parser/helper identity, source inventory, path, assembly, declared generic/nested identities and optional existing meta to the saved plan. Recompute the contract from current bytes during apply rather than trusting a rehashed plan. Files without meta qualify only as existing generic compiler sources; no GUID is invented. Reuse durable journal/rollback and inventory guards, then require independent Unity compilation/binding checks before readiness claims.

**Library scope:** Copy DOTween core, modules, Editor support and original notices from the explicitly selected threadscrew/YarnFever project into a hashed local ZIP with provenance. Register and scan the shared root. A catalog snapshot does not authorize replacing an existing stub DLL or prove import into a game; library collision/composition remains explicit unless separately implemented and verified.

- [x] Reproduce scanner/GUID rejections using owned sources modeled on the audited declarations.
- [x] Add compiler-backed syntax contracts, exact type arity/nesting, bounded helper execution and parser identity; test body edits versus declaration/initializer/attribute/lexical changes.
- [x] Extend typed request schema and source plan/apply route with explicit body mode; handle meta-free generic sources without relaxing legacy identities or component fileID guards.
- [x] Preserve complete-inventory/assembly ambiguity and rederive contracts at apply, including forged plans, parser changes, races, rollback and repeated receipts.
- [x] Snapshot DOTween from threadscrew into shared catalog with exact version/payload hashes and provenance; do not execute or alter the source project.
- [x] Update agent tool contracts/capability guidance, run focused/full regression and actual compiler fixtures, obtain independent review.

**Acceptance boundaries:** Toolkit/fixture work only. Existing GoodSort sources are read-only examples; no automatic gameplay reconstruction, DLL deletion, workspace source apply, Unity launch or fabricated evidence. Syntax equivalence and source receipt integrity do not establish compilation, bindings or gameplay.

## Verification

- Full final suite: 843 tests, 842 passed, one existing skip, no failures
  (`.cache/source-bodies-all-tests.log`).
- Actual installed Unity 2022.3.62f2 Roslyn fixtures verify all executable member
  forms, fields/auto-property/initializer/attribute tokens, generic/nested names,
  ambiguous inventories, parser configuration/runtime changes and cancellation.
- Source plan fixtures cover saved replay, forged plan/hash/parser identity,
  metadata absence, GUID/local-fileID rejection, omitted graph scripts, distinct
  assembly identities and rollback. Legacy reconstruction checks remain green.
- Read-only audit with fresh source facts on Unity 6000.0.66f2 accepted all eight
  reported source declaration contracts. Serialized bindings were not examined,
  no source was applied and no Unity process ran. The prior saved graph is stale
  and must be indexed again before creating an actual source plan
  (`.cache/source-bodies-readonly-result.json`).
- Shared DOTween 1.2.335 archive: 37 vendor files, 164694 bytes,
  SHA-256 `e50be4124b46cfcbceb300c8cc6b6cdaad8ca7f7a9365179979190cd4d2f26e0`.
  Exact archive/root pin recognizes the release; source inventory and archive
  reproduction matched. Managed DLL/importer/conditional module compatibility
  and existing DLL collisions still block automatic integration into a game.
- Independent review has no remaining findings after cross-assembly ambiguity,
  all-hostfxr inventory and compiler config identity corrections. The updated
  skill routes unsupported legacy sources to explicit body plan validation and
  does not grant automatic DLL replacement.
- Four installed Codex/Claude skill/reference files updated through guarded
  synchronization; backup `.cache/agent-cleanup/dc05546a-fe7b-4409-bf41-fe626ae712e4`.

No commit, game source change, DLL replacement or gameplay readiness claim made.
