---
name: retoolkit-install
description: Use when setting up REToolkit on Windows, configuring the JavaScript CLI or GhidraMCP client, or reviewing outdated installed REToolkit instructions.
---

# REToolkit Install

The recommended CLI is `node re.js <command>` on Node.js 24+. `re.cmd` is a
Windows convenience wrapper. Install the engines with the retained PowerShell
installer; core workspace/state/archive/flow commands are native JavaScript.
The PowerShell GUI stays legacy until a separate GUI migration.

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
.\install-re-toolkit.ps1 -All
node .\re.js doctor
```

The installer retains its targeted runtime/Ghidra/Il2CppDumper/GhidraMCP/
AssetRipper flags. Runtime files belong under `runtime/` and `tools/`; do not
change global Python, Java or PATH. Retained PowerShell adapters require Windows
PowerShell 5.1; Node does not replace JDK, Python, .NET or the engines.

Configure the AI client with `node <absolute-path-to-re.js> mcp`. Merge the
examples under `config/` into existing configuration without replacing unrelated
settings. This native JavaScript command starts the local Python stdio bridge;
the separate Ghidra extension serves the live GUI program. Enable GhidraMCP in
CodeBrowser and start its MCP server before connecting the client.

Use `retoolkit-flow` to prepare an authorized build. Preparation does not verify
analysis readiness. Use `retoolkit-mcp-analysis` after confirming the intended
GUI program, completed Auto Analysis and required symbols. Synthetic tests do
not verify live Ghidra, MCP or WinForms behavior.
