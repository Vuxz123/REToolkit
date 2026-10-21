# Node setup consolidation

The user approved implementation of the installer-first migration proposed in
the audit. This tranche completes the native engine setup path; launcher/GUI/ADB
migration is separate. Do not replace any existing real engine during development.
No commits or global environment modifications are authorized by this tranche.

Use existing transactional `installToolchain`, never a second engine installer.
Add a Node setup CLI resolving exact, publisher-metadata-bound ZIP identities for
JDK21, Ghidra, Dumper and AssetRipper. Resolution is explicit metadata networking;
existing `toolchain plan` stays offline. Defaults reflect already used versions:
JDK21.0.11, Ghidra12.1.2, Dumper6.7.48 net8.0, AssetRipper1.3.14. No automatic
latest selection, guessed dated filenames, or invented checksums. Missing digest
or ambiguous asset => fail with instructions to provide a reviewed existing lock.

`setup resolve` returns a regular toolchain lock to stdout, optional --out writes
a fresh UTF8 JSON file. `setup plan` resolves metadata then returns lock + offline
plan, no disk writes. `setup install` resolves all requested sources first, then
uses the existing staged all-selected-package transaction. `setup status` is
read-only, gives existing toolchain receipt state and current version metadata.
`--lock` accepts an existing lock for offline planning/cached installation.
Ghidra selection includes JDK unless an explicit lock defines its own coverage.

PowerShell installer becomes a small Node adapter. Preserve existing exact
LockedManifest/PythonManifest routes. Native flags delegate setup. Unsupported
legacy GUI Python, GhidraMCP extension and global .NET installation must be
reported BEFORE metadata download or engine mutation; never silently skipped or
reported complete. `-All` explicitly reports those missing profiles; new
`-NativeOnly` with `-All` selects just four native ZIP engines. README recommends
the unambiguous native Node command. Python/MCP CLI still has its existing Node
python-runtime manifest path; GUI extension/global .NET are not claimed ported.
No broad Temp cleanup, global GHIDRA_INSTALL_DIR, folder-existence success or
legacy fallback remains in the installer entrypoint.

Downloader keeps bounded HTTPS redirects, SHA256/size, no-link/private snapshot
checks. Add bounded transient retries and Range resumption within one invocation
using unique owned temporary files; validate status/Content-Range and final full
identity before publication. No persistent cross-process partial state or force
recovery is introduced. Network progress goes only to an explicit callback and
CLI stderr, keeping JSON stdout clean. Integrity and unsafe response failures are
terminal. Preserve uncertain ownership gates and previous good engine trees.

Verification: TDD for release selection, exact metadata checks, offline behavior,
wrapper forwarding/exit codes, no unsafe cleanup, interrupted download resumption,
failure rollback and live source metadata. Optional official archive acceptance
uses a newly created isolated cache toolkit and never executes vendor binaries.
Fixture installation must use a
private toolkit root; full JS/legacy suites, independent spec/quality reviews and
explicit baseline-hash delivery. No vendor engine replacement is acceptance.
