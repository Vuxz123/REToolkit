# Local Unity library catalog and staging import

> **For agentic workers:** Use subagent-driven-development and TDD, spec review
> then quality review. User approved design with "triển khai". Preserve pending
> tranches; no commits/global installations/user game modifications.

**Goal:** Agent scans configured ZIP folders, identifies project requirements,
resolves exact candidates, imports a saved plan to staging and verifies the result.
**Architecture:** Read-only ZIP catalog + pure resolver + isolated staging importer;
shared strict CLI/MCP. Existing export, original ZIPs and native inputs remain
unchanged. Import never silently replaces a stub/DLL/type/GUID. Unsupported or
unproven metadata remains explicit; empty library roots are unconfigured.
**Tech stack:** Node24 ESM, existing checked ZIP extractor, yaml, exact-version
Unity Editor helper, workspace/toolchain leases, source-owned ZIP fixtures.

Implementation continues the approved2026-10-23 design despite session date
reverting to2026-10-20. Reuse `.worktrees/assetripper-ai`; main baseline/backup is
`.worktrees/libraries-main-baseline.json` / `libraries-main-backup` (221 files).

## Configuration and catalog (catalog agent)

Own src/libraries/catalog.js, descriptors.js, optional archive helpers;
test/library-catalog.test.js, fixture/helper files named library-catalog-*.
Root owns config read/write and service; no package.json edits by workers.

`scanLibraries({roots=[],cacheDir,descriptors=[]})` async -> catalog:
`{kind:'retoolkit-library-catalog',schemaVersion:1,state:'unconfigured'|'indexed',
revision:sha256,roots:[absolute],archives:[{path,sha256,size}],packages:[package],
limitations:[]}`. Library roots selected readonly, no links. Cache only toolkit
controlled .cache/libraries; private checked snapshot/extraction per archive hash.
Hash exact source bytes before/after extraction. Reuse extractChecked CRC/path/
collision/unpacked/count budgets; bound aggregate archives<=256,metadata128MiB,
individual ZIP8GiB, total extraction16GiB. No nested ZIP recursion by default.

Package contract:
`{id:content-derived-sha256,libraryId:string,version:string|null,format:'upm'|'assets'|
'unitypackage'|'unsupported',recognition:'confirmed'|'candidate'|'unknown'|'conflict',
archiveSha256,archivePath,root:relative-or-empty,payloadFiles:[{path,size,sha256}],
identity:{packageId:string|null,assemblies:[string],namespaces:[string],types:[string]},
dependencies:{id:version},compatibility:{unity:string|null,platforms:[string]},
evidence:[{kind,path,value}],limitations:[],guidInventory:[{path,guid}]}`.
payloadFiles paths relative extracted ZIP root, never arbitrary output paths.
UPM root detected via package.json metadata; Assets subtree recognized by actual
Assets segments + assembly/package/version metadata. Unknown version/loose namespace
alone cannot be confirmed. ZIP name never proof. Missing archive version can be
confirmed via exact descriptor content pin; descriptor records are data, not scripts.
Generic DLL-only unknown => unsupported/unknown unless static verified metadata
exists; explicitly report limitation instead of executing Assembly.Load.
Multiple independent roots -> packages, ambiguous overlapping roots -> conflict.
No extraction/metadata flags can escape source or cache controls.

## Resolver/plans (resolver agent)

Own src/libraries/resolver.js (+ pure helpers), test/library-resolver.test.js.
`identifyLibraries(graph,catalog,{requirements=[]}={})` ->
`{kind:'retoolkit-library-identification',schemaVersion:1,graphRevision,catalogRevision,
requirements:[{id,version,source,evidence}],installed:[...],candidates:[...],limitations}`.
Evidence from graph assets .asmdef/.dll/script metadata, namespace/type as hints;
explicit requirements from root bounded JSON or inline API request
`{kind:'retoolkit-library-requirements',schemaVersion:1,packages:[{id,version}]}`.
Exact versions and simple compatible ranges supported or report unsupported; never
latest. Initially requirements explicit; inferred hints cannot authorize auto-import.
Root may pass read package manifest requirements as verified selected projectfacts.

`createLibraryPlan({graph,catalog,requirements})` -> plan:
`{kind:'retoolkit-library-plan',schemaVersion:1,operationId:uuid,graphRevision,binding,
catalogRevision,state:'ready'|'satisfied'|'blocked',selected:[package],
requirements,issues:[{code,message,libraryId?}],compileReady:false,
bindingsVerified:false,uiVerified:false,payloadSha256}`.
Full transitive closure; exact candidate only on unique compatible metadata,
semver ranges handled conservatively, missing/ambiguous/cycle/conflicting version
blocked. root import uses validateLibraryPlan(plan,graph,catalog) which recomputes
semantic plan intent (operationId varies) so rehashing tampered payload can't bypass.
Check package/GUID/type/assembly target collisions against graph; imported source
may map .cs assembly default differently -> conservative risk blocking. Existing
package recognized exact contents only => satisfied, partial/stub => blocked.
No .meta regeneration or DLL/source duplicate implementation. Original files
unchanged import; no migrations/type replacement in this tranche.

## Importer + Unity helper (importer agent)

Own src/libraries/importer.js, templates/Unity/REToolkitLibraryImport.cs,
test/library-importer.test.js, helper fixtures named library-import-*.
`importLibraryPlan({toolkit,name,projectDir,graph,catalog,plan},dependencies={})`
under workspace lock -> compact receipt with operationId,state,stagingProject,
imported:[ids],compileReady:false,bindingsVerified:false,uiVerified:false,limits.
`verifyLibraryImport({toolkit,name,projectDir,graph,catalog,plan},dependencies={})`
-> receipt/report with fresh run evidence; root exposes these calls. Never modify
original export; stage under notes assets/library-imports/<operationId>/project.
All original inventory files copied exact and post-run source/ZIP hashes verified.
Revalidate plan using resolver before doing writes; verify catalog/extracted file
paths/hashes, never trust caller-provided destination/source. Stage ALL payloads
before publication, compare case-insensitive path/GUID/type collisions.

UPM packages materialize portable Packages/<packageId> with original package.json
metadata; use PackageManager.Client.Resolve to validate embedded package graph,
do not hand-edit root manifest. Assets payload publishes under Assets preserving
meta. ZIP containing unitypackage initially inspect+classify, import blocked unless
bounded inner tar/GUID/path analysis implemented (must state unsupported honestly).
Managed DLLs within recognized assets payload retain metadata, still compileverify.

Use dedicated fixed helper and async Unity loop: no premature -quit for package
resolution. Extend existing Unity runner PROGRAMMATIC purpose enum? Root owns
runner modifications; request root API `runUnityEditor({...options,purpose:'library-import'})`
will select fixed template entry/no-quit only for purpose, no arbitrary methods.
Helper watches UPM completion on update, writes strict bound report then Exit;
deadline ownership stays existing supervisor. Root adds purpose enum to runner/
worker with regression, no new arbitrary executable/flags CLI. Report:
`{kind:'retoolkit-library-import-observation',schemaVersion:1,operationId,
complete:boolean,success:boolean,packages:[{id,version}],diagnostics:[{severity,message}]}`.
Helper source in fresh Editor-only reserved directory no library assembly refs.
Actual verification after import can call existing validateUnityProject on staging
graph but package guard must allow recognized embedded packages only after lock
verification; root updates packageGuard/stage to carry libraries.lock.json under
Packages and verify managed entries. Don't weaken all local/Git guards.
Store `Packages/retk-libraries.lock.json` containing exact package payload manifests,
source catalog/archive IDs; later stage verifies contents+hashes. Must not be a UPM
package root itself. Helpers removed before indexing if their reserved path would
collide with normal Unity validation. Import receipts never claim UI pass.
Repeat import checks saved receipt/stage bytes; changed source/catalog/ZIP/payload
or stage => stale. Unknown child close -> unity_recovery_required with ownership
gates preserved. No automatic promotion to original export.

## Root service/CLI/MCP/integration

Root owns src/libraries/service.js,cli.js; src/assets/api.js/mcp integration,
re.js/help/readiness/docs; existing Unity purpose/managed package guard changes.
Config `.retk-libraries.json` at toolkit root
`{schemaVersion:1,libraryRoots:[],libraryImportPolicy:'auto-staging-on-unique-match'}`.
CLI `libraries roots add <folder>` modifies only local config after no-link checks;
`libraries scan|list` no Game, `identify|plan|import|verify <Game>`, `--requirements`
readonly JSON CLI input; import/verify --operation UUID only. Fixed operations
catalog scan/list/identify/plan/import/verify share MCP library_* typed APIs,
root-path registration CLI only (MCP can't introduce arbitrary filesystem roots).
No arbitrary output paths, URLs, shell commands, auto downloads or Editor eval.
Catalog output paged+bytebounded, clean stdio. Saved full artifacts and compact
responses, revision-bound cursors. Empty roots state unconfigured.
Run import under workspace+toolchain lease, active AssetRipper/Ghidra rejects;
UI/dependency report exposes missing/candidate/integrated separately, uiVerified false.
Auto policy permits Agent call plan/import without extra confirmation; no magical
compile-error auto-install or automatic original export mutation.

## Checklist

- [x] Backup main221 files, reuse isolated worktree, baseline333JS+7PS.
- [x] Catalog/descriptors TDD, adversarial archive/path/metadata/identity tests.
- [x] Resolver TDD exact/version/dependency closure/missing/ambiguity/collision.
- [x] Importer+helper TDD staging only, idempotency, receipt/hash/stale/close failures.
- [x] Root config/service CLI/MCP TDD, managed package/purpose integration.
- [x] Real Unity source-owned ZIP package->import->compile/binding validation,
  source ZIP/export unchanged, missing/ambiguous sources block; vendor untested.
- [x] Independent spec then quality reviews, regression fixes.
- [x] Full JS+7PS, explicit hashguard integration to main+repeat checks; no commit.

Final verification: 426 JS tests + seven PS suites passed in both worktree and
main; real Unity 2022.3.62f2 UPM import/compile/binding acceptance also repeated in
main with unchanged original ZIP/export. See
`../specs/2026-10-20-library-catalog-verification.md` for scope and local receipts.
