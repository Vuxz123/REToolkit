# Install the ghidra-reverse-engineering-cli skill

This prompt is for an AI agent (or human) tasked with installing the
"Ghidra Reverse Engineering CLI" skill into the user's local agent runtime.

## Goal

Make the agent aware of the `ghidra-cli` Rust tool (akiselev/ghidra-cli) and
its available subcommands so the agent can drive RE tasks (function listing,
decompilation, x-refs, type edits, patching) through the
`re.ps1 ghidra-cli ...` wrapper, and chain it with `re.ps1 import` / `analyze`
for full pipeline runs.

## Source

- Skill page: https://mcpmarket.com/tools/skills/ghidra-reverse-engineering-cli
- Upstream repo: https://github.com/akiselev/ghidra-cli
- License: GPL-3.0 (per upstream README)

## Pre-flight

Verify the toolkit is healthy before installing the skill:

```powershell
.\re.ps1 doctor
.\re.ps1 ghidra-cli doctor
```

If `.\re.ps1 doctor` reports `MISS` for any tool, run the matching install:

```
.\install-re-toolkit.ps1 -InstallRuntime        # portable JDK 21 + Python + Rust
.\install-re-toolkit.ps1 -InstallGhidra         # Ghidra 11.x
.\install-re-toolkit.ps1 -InstallGhidraCli      # ghidra-cli (needs cargo; lands at tools\ghidra-cli\ghidra.exe)
```

`.\re.ps1 ghidra-cli doctor` will print something like:

```
Checking Java (full JDK 21+)... OK
  JDK 21 at C:\...\REToolkit\runtime\java\jdk-21 (selected via JAVA_HOME)
```

## Install steps

### Path A — Claude Code / Claude Cowork / Codex

The MCP Market "Download skill" button distributes a `.skill` package. Have
the agent navigate to the URL above, click the download, and follow the
platform-specific installer prompt. Keep this in mind:

1. The download targets the agent's home directory (e.g.
   `~/.claude/skills/ghidra-reverse-engineering-cli/SKILL.md` for Claude
   Code, or analogous path for Codex).
2. After install, restart the agent session so it re-indexes skills.
3. Confirm the agent now responds to prompts like "decompile main in the
   ScrewDom project" without needing extra context.

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
`prompts/agent-ghidra-cli.md` of this toolkit and reference them from the
agent's system prompt or `AGENTS.md` of the project workspace.

## Sanity test

After installation, run from any agent-capable shell:

```powershell
.\re.ps1 ghidra-cli doctor
.\re.ps1 ghidra-cli function list --projects-dir <dir> --project ScrewDom
.\re.ps1 ghidra-cli decompile main --projects-dir <dir> --project ScrewDom
```

If a flag clashes with PowerShell parsing, fall back to `--%`:

```powershell
.\re.ps1 ghidra-cli --% function list --project ScrewDom --program libil2cpp.so
```

Note: the toolkit's `--projects-dir` / `--project` / `--program` flags are
injected automatically when you use the tier-1 wrappers (`re.ps1 import`,
`re.ps1 analyze`, `re.ps1 summary`), so raw `re.ps1 ghidra-cli` is mainly
for ad-hoc queries on an existing project.

Expected output:

- `doctor` -> JSON or human summary confirming Ghidra + JDK paths.
- `function list` -> function table (or empty if no program imported yet).
- `decompile main` -> C pseudo-code or "function not found" if ScrewDom
  hasn't been imported yet.

If `decompile main` returns "function not found", the agent should first
run the full pipeline:

```powershell
.\re.ps1 flow ScrewDom "D:\RE_Workspace\ScrewDom\01_Extracted"
```

This runs `init` -> `scan` -> `dump` -> `import` -> `analyze` -> `symbols`
automatically, with state persisted in `workspaces/ScrewDom/project.re.json`.

## Reminder for the agent

- The toolkit has two tiers; use the right one:
  - Tier 1 (state-machine pipeline): `re.ps1 init|scan|dump|import|analyze|symbols|flow|summary|status`
  - Tier 2 (raw tool passthrough): `re.ps1 ghidra-cli <args...>`,
    `re.ps1 il2cppdumper <args...>`, `re.ps1 ghidra-gui`, `re.ps1 pyghidra-gui`
- Prefer tier 1 commands when working on a project; they auto-inject
  `--java-home`, `--projects-dir`, `--project`, `--program`.
- Always call `re.ps1 ghidra-cli <args...>` instead of the bare `ghidra`
  binary. The wrapper guarantees the portable JDK is on PATH for the
  child process and routes through the toolkit's normalized paths.
- Use `--json` or `--pretty` when piping output so the agent can parse
  results deterministically.
- Never run `ghidra import` against a binary outside
  `workspaces/<name>/00_OriginalBuild/` without confirmation; binaries
  there are immutable by convention.

## Cheat sheet

| Want | Command |
|---|---|
| Run full pipeline | `.\re.ps1 flow <Game> <ExtractedPath>` |
| Step-by-step | `.\re.ps1 init/scan/dump/import/analyze/symbols <Game> [ExtractedPath]` |
| Show project state | `.\re.ps1 status <Game>` |
| Re-run one step | `.\re.ps1 dump <Game>` (updates `project.re.json` state) |
| Quick stats | `.\re.ps1 summary <Game>` |
| Raw CLI access | `.\re.ps1 ghidra-cli --% <subcmd> <args>` |
| Open GUI | `.\re.ps1 ghidra-gui` (or `pyghidra-gui`) |
| Run raw dumper | `.\re.ps1 il2cppdumper <native> <metadata>` |
