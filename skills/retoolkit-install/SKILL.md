---
name: retoolkit-install
description: Use when setting up REToolkit on Windows, configuring the JavaScript CLI or GhidraMCP client, or reviewing outdated installed REToolkit instructions.
---

# REToolkit Install

The recommended CLI is `retk <command>` on Node.js 24+. From the checkout,
run `npm ci` then `npm run cli:install`; npm link creates the CMD command in
the npm global prefix and keeps this checkout as the toolkit root. Keep that
directory in place. `retk --version` checks the active command. If CMD cannot
find it, inspect `npm prefix -g` and the user PATH, then reopen CMD; do not
silently edit global PATH. Unregister with `npm unlink --global retoolkit
--ignore-scripts`. No public registry package is implied. Direct `node re.js`
and `re.cmd` remain supported. Native engine setup and core workspace/state/
archive/flow commands are JavaScript. The PS5.1 installer delegates to Node24.
The PowerShell GUI stays legacy until a separate GUI migration.
ADB discovery/capture also runs through JavaScript: `retk adb devices`
and `retk pull-ldplayer <Game> <package> --serial <id> --skip-launch`.
JSON/Agent calls must use `--skip-launch`; provide `--adb <adb.exe>` when needed.
Do not select the first of multiple ready devices or silently choose an ABI.
See [capture and recovery](../../docs/adb-capture.md).

Read repo-local `retoolkit-install`, `retoolkit-flow` and
`retoolkit-mcp-analysis` instructions directly. Do not automatically install
personal skills to run the toolkit. Search older installed
`ghidra-reverse-engineering-cli` instructions using
[README](../../README.md#agent-skills-and-older-installations). Updating global
folders requires an explicit request, complete backups outside active skill
roots, and review of local customizations. Follow the
[manual procedure](../../prompts/install-ghidra-skill.md#installed-skill-updates).

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
[release and recovery guide](../../docs/toolchain-and-release.md).

The adapter equivalent is `.\install-re-toolkit.ps1 -All -NativeOnly`.
Never recommend `-All` alone: GUI Python, GhidraMCP GUI extensions and global
.NET require separate profiles, so it fails before networking or engine writes.
`-InstallRuntime` also requests GUI Python and is blocked. For native JDK/Ghidra,
use `-InstallGhidra` (includes JDK) or `--components jdk,ghidra`.
`-LockedManifest` and `-PythonManifest` retain their exact plan/install routes;
the Python manifest manages MCP CLI only. GUI Python, extensions and global
.NET setup have not been ported. Runtime files belong under `runtime/` and
`tools/`; do not change global Python, Java or PATH.

Configure the AI client with `node <absolute-path-to-re.js> mcp`. Merge the
examples under `config/` into existing configuration without replacing unrelated
settings. This native JavaScript command starts the local Python stdio bridge;
the separate Ghidra extension serves the live GUI program. Enable GhidraMCP in
CodeBrowser and start its MCP server before connecting the client.

Use `retoolkit-flow` to prepare an authorized build. Preparation does not verify
analysis readiness. Use `retoolkit-mcp-analysis` after confirming the intended
GUI program, completed Auto Analysis and required symbols. Synthetic tests do
not verify live Ghidra, MCP or WinForms behavior.
