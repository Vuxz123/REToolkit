# Node setup consolidation implementation plan

> Use superpowers:subagent-driven-development; independent implementers have
> disjoint files, then spec and quality reviewers inspect the combined result.

**Goal:** Native engine installation uses one Node transaction, including legacy
entrypoints, exact release resolution and resilient bounded downloads.

**Architecture:** Existing src/toolchain owns engine publication/rollback. New
src/setup modules only resolve metadata and orchestrate. Unsupported legacy
components fail preflight rather than launching old setup. Node24, built-in fetch,
existing ZIP libraries and PS5.1 entry adapter; no dependencies added.

- [x] Back up current main241 files, reuse ignored existing worktree; baseline426.
- [x] Release resolver TDD: src/setup/releases.js and optional metadata.js;
  test/setup-releases.test.js. Export async resolveNativeLock({components,
  versions={}}, {fetchImpl=fetch}={}) => standard toolchain lock. components is
  unique subset jdk/ghidra/dumper/assetripper; missing/invalid digest/size/version,
  arbitrary hosts/duplicate assets/prereleases reject. Defaults exact in design.
  Provider endpoints are fixed official GitHub release tags and Adoptium JSON.
  Metadata <=2MiB/response, bounded totals/time/redirects, no binary downloads.
  Ghidra root ghidra_<version>_PUBLIC from actual matching dated asset; JDK root
  from exact upstream release_name; Dumper/AssetRipper archives flat by adapter.
- [x] Downloader TDD: src/toolchain/archive-io.js fetch/cachedArchive delegation
  + src/toolchain/download.js helper; test/toolchain-download.test.js.
  Preserve cachedArchive(source,cache,fetchImpl,options={}) compatibility. Options
  bounded maxAttempts<=3, attemptTimeoutMs default600000, bounded backoff, optional
  onProgress. Retry transient network/408/429/5xx only; same-call Range resume
  checks exact Content-Range total/offset; 200 restarts private file. Full hash
  rechecked before return. All streams close before next attempt/cleanup.
- [x] PowerShell adapter TDD: install-re-toolkit.ps1 and test/setup-wrapper.test.js.
  Preserve current manifest validation/delegation; Node setup plan/install/status,
  --components CSV and exact version options. All => --all, NativeOnly =>
  --native-only; InstallRuntime also --require-component python-gui;
  InstallGhidraMcp => ghidra-mcp-gui; InstallDotNetRuntime => dotnet. Root service
  rejects these requirements before networking/mutation. No raw PS networking,
  deletes or global environment mutation. Node exit forwarded; missing Node24
  fails clearly. Existing command flags validated, no silent ignored options.
- [x] Root CLI/service TDD: src/setup/cli.js,service.js; test/setup-cli.test.js,
  setup-service.test.js. Fixed setup resolve/plan/install/status, --lock,
  --out(resolve only), --components, --ghidra-version, --jdk-version,
  --dumper-version, --assetripper-version, --all/--native-only,
  --require-component repeatable only adapter, --root/--cache/--json/--help.
  Service exports runSetup(root,action,options,dependencies={}); dependencies test
  seams resolve,install,verify only, never accepted as CLI inputs. Native-only
  selection first then metadata; locked route stays offline. --all without
  --native-only gives explicit profile-required error before writes/network.
  Fresh --out atomic exclusive publication, no overwrite or engine subtree paths.
- [x] Root installer integration: forward downloadPolicy/onProgress to
  cachedArchive without weakening leases; emit safe compact progress stderr.
  AssetRipper pinned .retk-version marker included in installed inventory so
  existing runtime recognizes it; tests and recorded patch provenance.
- [x] Docs: README, CLAUDE, skills/retoolkit-install/SKILL.md and
  docs/toolchain-and-release.md updated exact native commands/limits, no -All
  recommendation, no promise GUI/.NET completed or vendor runtime qualified.
- [x] Independent spec review then quality review, regressions corrected.
- [x] All JS+7PS and actual CLI+PS fixture smoke; readonly official release
  resolution may run, no real engine replacement. Explicit owned-file hash
  delivery to main, preserve other pending files, repeat checks. No commit.
