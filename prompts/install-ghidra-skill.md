# Install the ghidra-reverse-engineering-cli skill

This prompt is for an AI agent (or human) tasked with installing the
"Ghidra Reverse Engineering CLI" skill into the user's local agent runtime.

## Goal

Make the agent aware of the `ghidra` CLI tool (akiselev/ghidra-cli) and its
available subcommands so that the agent can drive reverse-engineering tasks
(function listing, decompilation, x-refs, type edits, patching) through the
`re.ps1 ghidra ...` wrapper in this toolkit.

## Source

- Skill page: https://mcpmarket.com/tools/skills/ghidra-reverse-engineering-cli
- Upstream repo: https://github.com/akiselev/ghidra-cli
- License: GPL-3.0 (per upstream README)

## Pre-flight

Verify the wrapper is on PATH and the tool is installed:

```powershell
.\re.ps1 check
.\re.ps1 where ghidra-cli
.\re.ps1 ghidra doctor
```

If `.\re.ps1 ghidra doctor` fails:

1. Run `.\install-re-toolkit.ps1 -InstallGhidraCli`. This will need:
   - Rust toolchain (`cargo`). Install from https://rustup.rs/ if missing.
   - Ghidra installed (run `.\install-re-toolkit.ps1 -InstallGhidra` first).
2. Restart the shell so PATH changes take effect.

## Install steps

### Path A — Claude Code / Claude Cowork / Codex

The MCP Market "Download skill" button distributes a `.skill` package.
Have the agent navigate to the URL above, click the download, and follow
the platform-specific installer prompt. Keep this in mind:

1. The download targets the agent's home directory (e.g.
   `~/.claude/skills/ghidra-reverse-engineering-cli/SKILL.md` for Claude
   Code, or analogous path for Codex).
2. After install, restart the agent session so it re-indexes skills.
3. Confirm the agent now responds to prompts like "decompile main in
   the ScrewDom project" without needing extra context.

### Path B — Manual install (Codex, custom clients)

If the user's client does not have a one-click installer:

1. Fetch `SKILL.md` from the upstream repo:
   `curl https://raw.githubusercontent.com/akiselev/ghidra-cli/master/AGENTS.md`
   (and `CLAUDE.md` for additional agent guidance).
2. Place the file under the user's skill directory, e.g.:
   - `%USERPROFILE%\.codex\skills\ghidra-reverse-engineering-cli\SKILL.md`
   - `%USERPROFILE%\.claude\skills\ghidra-reverse-engineering-cli\SKILL.md`
3. Restart the agent.

### Path C — No skill manager (drop into repo)

If neither manager is available, copy the upstream agent docs into
`prompts/agent-ghidra-cli.md` of this toolkit and reference them from
the agent's system prompt or `AGENTS.md` of the project workspace.

## Sanity test

After installation, run from any agent-capable shell:

```powershell
.\re.ps1 ghidra --% doctor
.\re.ps1 ghidra --% function list --project ScrewDom
.\re.ps1 ghidra --% decompile main --project ScrewDom
```

Note the `--%`: it tells PowerShell to stop parsing args, so flags like
`--project` are forwarded literally to ghidra-cli. Without it, PowerShell
tries to bind them to re.ps1's positional params and either fails or
splats incorrectly.

Expected output:

- `doctor` -> JSON or human summary confirming Ghidra + JDK paths.
- `function list` -> function table (or empty if no program imported yet).
- `decompile main` -> C pseudo-code or "function not found" if
  ScrewDom hasn't been imported yet.

If `decompile main` returns "function not found", the agent should
first run:

```powershell
.\re.ps1 ghidra --% import .\path\to\binary --project ScrewDom
.\re.ps1 ghidra --% analyze --project ScrewDom
```

## Reminder for the agent

- Always use `re.ps1 ghidra <subcommand>` instead of calling the
  `ghidra` binary directly. The wrapper guarantees `GHIDRA_INSTALL_DIR`
  is set and routes through the toolkit's normalized project paths.
- Prefer `--json` or `--pretty` when piping output so the agent can
  parse results deterministically.
- Never invoke `ghidra` against a binary outside of `workspaces/<name>/00_OriginalBuild/`
  without confirmation; binaries there are immutable by convention.
