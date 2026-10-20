# Milestone 5: release hardening

The accepted roadmap and user's instruction to continue authorize this tranche.
Keep Node24 JavaScript CLI first, Windows PowerShell5.1 installer/GUI retained.
Implement a locked archive installation path, CI and GUI provenance. Do not run
the legacy online installer or replace this machine's installed engines during
implementation. Real IL2CPP/GUI/live Jev acceptance remains separately reported.

## Choices and boundaries

Use an explicit archive lock alongside the legacy installer: this avoids silently
turning existing latest-based flags into a new update policy. Replacing the whole
installer would also require migrating registry/.NET and Python virtualenv setup;
wrapping it in a directory rename would break absolute virtualenv launchers.
Therefore locked installation supports relocatable JDK21/Ghidra/Il2CppDumper/
AssetRipper ZIP packages only. Python, MCP wheel+venv, global .NET and user Ghidra
extensions remain explicit legacy setup; their reproducibility is not claimed.
The release tranche is complete only for these stated capabilities; remaining
qualification/installer coverage stays visible in the roadmap.

## Locked archives and receipts

`toolchain plan <lock.json>` validates offline and reports fixed destinations.
`toolchain install <lock.json> [--cache <folder>]` explicitly downloads/installs.
`toolchain verify` checks the last committed local installation receipt. Missing
receipts report unknown, never a verified toolchain. The retained installer gets
`-LockedManifest <path> [-PackageCache <folder>]` delegating to these JS commands
before any legacy temp sweep, environment edit, download or install flag runs.
Mixed locked/legacy operation flags are refused. Existing installer modes remain
available and are clearly distinguished from the new locked path.

Lock shape:
`{kind:'retoolkit-toolchain-lock',schemaVersion:1,platform:'win32-x64',packages:[
 {id:'jdk'|'ghidra'|'dumper'|'assetripper',version:<exact string>,
  source:{url:<HTTPS immutable release asset>,sha256:<lower hex>,size:<integer>,
          verification:'publisher-checksum'|'recorded-download'},
  archiveRoot:<safe relative archive prefix or ''>} ]}`.
Unique packages, no latest/version ranges, no unknown fields, credentials/query/
fragment in URLs, path traversal or absolute prefixes. Limits: lock1MiB, package
8GiB compressed/uncompressed,100k entries, path32768 characters/64 components.
No invented hashes or sample runnable lock with placeholder digest. Docs provide
schema and a fixture-derived example recipe; real vendor archives require their
actual SHA256 and exact size. A recorded hash does not authenticate a publisher.

Destinations are code-owned: jdk→runtime/java/jdk-21, ghidra→tools/ghidra,
dumper→tools/Il2CppDumper, assetripper→tools/AssetRipper. Never accept a manifest
target or arbitrary probe command. Stage all packages, validate hash/size, ZIP
CRC/types/path/case collisions/declared sizes, required nonempty layout files and
Ghidra/JDK version metadata. Apply repo-owned dumper script templates only after
source verification, recording template hashes. Do not execute downloaded code
as an automatic install probe: report layout verification separately from engine
acceptance. No claim that these four tools have been qualified together from a
mock install.

Atomic publication under an exclusive toolchain gate: persist a journal before
moving any old directory, rename old trees into a unique backup, publish staged
trees, snapshot installed file SHA/size inventory, then publish the receipt last.
Roll back all moved tools and the old receipt on failure. Preserve journal and
backups on uncertain rollback; refuse further installs until inspected. Retain
successful backups. Do not delete user directories, follow junctions, invoke
shell-built deletion/moving commands, or touch global PATH/registry. Cache files
are content-addressed by SHA256, revalidated before reuse, never trusted by name.

Receipt shape: `{kind:'retoolkit-toolchain-receipt',schemaVersion:1,runId,
 createdAt,platform,lockFingerprint,packages:[{id,version,source,target,
 files:[{path,size,sha256}],templates:[{path,sha256}]}],limitations:[]}`.
Only relative paths; before/after tool version/source facts retained in journal.
`verifyToolchain` reports matching/tampered/missing/extra files without mutation.

## Engine/update exclusion

Shared read leases guard CLI child processes that use toolkit engines; an
exclusive install gate refuses readers and new readers refuse an active writer.
Readers survive abrupt worker death conservatively: uncertain leases block
updates until explicitly inspected. No PID-only reclamation. Engine workers hold
the read lease until actual child close, including after an outer CLI dies.
Native session, MCP and retained CLI adapter launches pass the owning toolkit root.
Existing workspace/engine/project locks also block updates. On Windows, process
inspection checks executable/command paths under tools/runtime; unavailable
inspection fails closed. Never kill an owning GUI or remove its project locks.
Legacy `install-re-toolkit.ps1` latest modes remain outside this new guarantee.

## CI and GUI build provenance

Windows workflow on push/pull_request/manual dispatch runs pinned Node24 setup,
`npm ci`, JS and Windows PowerShell5.1 suites, without downloading engines or
using Jev credentials. Optional installed-engine acceptance stays separate from
unit CI. Workflow uses read-only permissions and immutable action commit pins.

`scripts/build-gui.ps1` records source Git revision/dirty state, explicit source
hashes (GUI+loaded helper scripts), ps2exe module version, and output EXE SHA/size
in a versioned JSON sidecar. Stage compilation and publish executable+receipt
with rollback; refuse an existing untracked output without explicit overwrite.
Preserve existing build convenience, but avoid silently installing a module during
tests. Injectable compile fixture proves provenance/staging/rollback under PS5.1.
No real GUI compiler/module download or GUI interaction is implied by a fake build.

## Verification

TDD: lock rejection, offline plans, download/cache corruption, safe extraction,
all-package rollback, uncertain recovery, exact receipts, links/paths/case,
busy engine/project/process, concurrent reader/writer and outer CLI death.
GUI helper tests inspect real fixture bytes and failure recovery, not just source
strings. Run all JS and legacy suites plus locked installer CLI fixture roundtrip.
Independent spec review then quality review; integrate only reviewed files after
root hashes match, preserving unrelated `.claude/` and July documents. No automatic
remote publication or production tool update.
