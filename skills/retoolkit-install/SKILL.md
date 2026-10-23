---
name: retoolkit-install
description: Use when setting up REToolkit on Windows, configuring the JavaScript CLI or GhidraMCP client, or reviewing outdated installed REToolkit instructions.
---

# REToolkit Install

Resolve the checkout from the task context or the MCP registration's absolute
`re.js` path. Documentation paths below are relative to that checkout, not this
skill's personal installation directory.

For a new Windows x64 machine, prefer `install.cmd` from the extracted checkout.
It bootstraps verified toolkit-local Node when needed and runs the full locked
CLI/GUI/native/MCP/desktop installation. `--profile desktop` installs CLI+GUI;
`--profile cli` omits GUI/engines. `--plan` and `--help` are offline/write-free.
The installer appends its managed command directory to User PATH, never Machine
PATH; `--no-path` skips that change. Command shims pin Node and the checkout.
Close the toolkit GUI/jobs before installation. Do not automatically install
Unity, harnesses or credentials. See `docs/quick-install.md` in the checkout.
`npm run setup:quick` and `retk quickstart` use the same Node coordinator once
Node is available. Installation does not qualify a game or MCP connectivity.
This route is distinct from the manual npm-link registration described below.

The recommended CLI is `retk <command>` on Node.js 24+. From the checkout,
run `npm ci` then `npm run cli:install`; npm link creates the CMD command in
the npm global prefix and keeps this checkout as the toolkit root. Keep that
directory in place. `retk --version` checks the active command. If CMD cannot
find it, inspect `npm prefix -g` and the user PATH, then reopen CMD; do not
silently edit global PATH. Unregister with `npm unlink --global retoolkit
--ignore-scripts`. No public registry package is implied. Direct `node re.js`
and `re.cmd` remain supported. Native engine setup and core workspace/state/
archive/flow commands are JavaScript. The PS5.1 installer delegates to Node24.
The desktop is Electron: `npm run gui:install`, then `retk gui`. Use its typed
Node operations and readable evidence panel; the old WinForms UI is a retained
compatibility path. See `docs/desktop.md` in the toolkit checkout.
ADB discovery/capture also runs through JavaScript: `retk adb devices`
and `retk pull-ldplayer <Game> <package> --serial <id> --skip-launch`.
JSON/Agent calls must use `--skip-launch`; provide `--adb <adb.exe>` when needed.
Use `adb packages --serial <id>` for installed app IDs. `pull-ldplayer` with
`--include-data` also captures external/private app data where existing access
allows it, in a separate ZIP with explicit missing/denied scope coverage.
Do not select the first of multiple ready devices. Delegate ABI selection to
`retk inputs resolve <Game> --json`: Node preserves explicit/current selections
and otherwise applies its documented ARM64-first Android policy. Ask only for
ambiguity remaining in its bounded result, never select an arbitrary candidate.
See `docs/adb-capture.md` in the checkout for capture and recovery.

Read repo-local `retoolkit-install`, `retoolkit-flow` and
`retoolkit-mcp-analysis` instructions directly. Do not automatically install
personal skills to run the toolkit. Search older installed
`ghidra-reverse-engineering-cli` instructions using the checkout's
`README.md` section "Agent Skills And Older Installations". Updating global
folders requires an explicit request, complete backups outside active skill
roots, and review of local customizations. Follow the
manual procedure in `prompts/install-ghidra-skill.md`, "Installed Skill Updates".

```powershell
npm ci
npm run cli:install
retk --version
retk setup plan --lock config/native-windows-x64.lock.json --json
retk setup install --lock config/native-windows-x64.lock.json --json
retk setup status --json
retk doctor
```

Stage one installs four native ZIP packages: JDK21.0.11, Ghidra12.1.2,
Il2CppDumper6.7.48 net8.0 and AssetRipper1.3.14 by default. Selecting Ghidra
includes JDK. `setup resolve` emits an exact metadata-bound lock; `setup plan`
resolves metadata and returns a plan without writes. Both use the network unless
given `--lock`. `setup install` reuses the transactional toolchain installer.
`setup status` reads receipt state and version metadata; metadata alone does not
prove installed file integrity.

If the publisher does not provide an exact asset checksum, stop resolution and
use a reviewed lock. Do not guess URLs, checksums or latest versions:

```powershell
retk setup plan --lock config/my-toolchain.lock.json --json
retk setup install --lock config/my-toolchain.lock.json --cache D:\RetkPackages --json
```

Locked planning stays offline. Installation revalidates cached archives and only
downloads missing ones. Download retries and Range resumption apply within one
invocation, with no cross-run partial-download resume. See the
release and recovery guide in `docs/toolchain-and-release.md`.

The adapter equivalent is `.\install-re-toolkit.ps1 -All -NativeOnly`.
Never recommend `-All` alone: GUI Python, GhidraMCP GUI extensions and global
.NET require separate profiles, so it fails before networking or engine writes.
For native JDK/Ghidra, use `-InstallGhidra` (includes JDK) or
`--components jdk,ghidra`.
`-LockedManifest` and `-PythonManifest` retain their exact plan/install routes;
the Python manifest manages MCP CLI only. The separate Node desktop profile
installs PyGhidra, the GhidraMCP extension and toolkit-local .NET:

```cmd
retk desktop-runtime plan --lock config/desktop-windows-x64.lock.json
retk desktop-runtime install --lock config/desktop-windows-x64.lock.json
retk desktop-runtime verify
```

An installed matching Ghidra is required. Installation does not establish GUI
activation or analysis readiness. Runtime files belong under `runtime/` and
`tools/`; do not change global Python, Java or PATH.

Configure the AI client with `node <absolute-path-to-re.js> mcp`. Merge the
examples under `config/` into existing configuration without replacing unrelated
settings. This native JavaScript command starts the local Python stdio bridge;
the separate Ghidra extension serves the live GUI program. Enable GhidraMCP in
CodeBrowser and start its MCP server before connecting the client.

To clean obsolete personal integrations at the user's request, run
`node scripts/clean-agent-integrations.mjs` from the checkout to inspect its plan,
then `node scripts/clean-agent-integrations.mjs --apply`. It updates existing
Ghidra registrations in Codex/OpenCode and current installed REToolkit skills,
retiring the obsolete Codex CLI skill after complete backups under
`.cache/agent-cleanup/`. It does not select an assets workspace or configure Jev.

Use `retoolkit-flow` to prepare an authorized build. Preparation does not verify
analysis readiness. Use `retoolkit-mcp-analysis` after confirming the intended
GUI program, completed Auto Analysis and required symbols. Synthetic tests do
not verify live Ghidra, MCP or gameplay behavior.

For game reconstruction beyond preparation, use `retoolkit-game-reconstruction`.
It coordinates asset/script mapping, evidence, source changes, library/migration
branches, exact-artifact validation, gameplay/visual checks and resumable notes.
