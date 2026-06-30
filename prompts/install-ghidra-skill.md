# Install the ghidra-reverse-engineering-cli skill

This prompt is for an AI agent (or human) tasked with installing the
"Ghidra Reverse Engineering CLI" skill into the user's local agent runtime.

## Goal

Make the agent aware of the `ghidra-cli` Rust tool (akiselev/ghidra-cli) and
its available subcommands so the agent can assist with reverse-engineering tasks
such as function listing, decompilation, x-refs, symbols, strings, type edits,
and patching.

Inside REToolkit, the agent should call Ghidra CLI through the wrapper:

```powershell
.\re.ps1 ghidra-cli <args...>
```

Do not call the bare `ghidra.exe` directly unless the user explicitly asks.
The wrapper keeps the toolkit's portable JDK, paths, and workspace conventions
consistent.

Important current REToolkit flow:

```text
init/add/scan -> dump -> import -noanalysis -> notes -> open PyGhidra GUI
```

Auto Analysis and `ghidra.py` symbol application are intentionally left to the
user inside Ghidra/PyGhidra GUI. This avoids long-running headless analysis,
bridge issues, and Ghidra project lock conflicts.

## Source

- Skill page: https://mcpmarket.com/tools/skills/ghidra-reverse-engineering-cli
- Upstream repo: https://github.com/akiselev/ghidra-cli
- License: GPL-3.0 (per upstream README)

## Pre-flight

Verify the toolkit is healthy before installing or using the skill:

```powershell
.\re.ps1 doctor
.\re.ps1 ghidra-cli doctor
```

If `.\re.ps1 doctor` reports `MISS` for any tool, run the matching install:

```powershell
.\install-re-toolkit.ps1 -InstallRuntime        # portable JDK 21 + Python + Rust
.\install-re-toolkit.ps1 -InstallGhidra         # Ghidra
.\install-re-toolkit.ps1 -InstallIl2CppDumper   # Il2CppDumper
.\install-re-toolkit.ps1 -InstallGhidraCli      # ghidra-cli; lands at tools\ghidra-cli\ghidra.exe
```

`.\re.ps1 ghidra-cli doctor` should confirm that Ghidra and JDK are usable.

## Install steps

### Path A — Claude Code / Claude Cowork / Codex

The MCP Market "Download skill" button distributes a `.skill` package. Have
the agent navigate to the URL above, click the download, and follow the
platform-specific installer prompt.

Keep this in mind:

1. The download targets the agent's skill directory, for example:
   - `~/.claude/skills/ghidra-reverse-engineering-cli/SKILL.md`
   - or an analogous Codex skill directory.
2. After install, restart the agent session so it re-indexes skills.
3. Confirm the agent understands prompts such as:
   - "Use REToolkit to inspect the FoodHunt project."
   - "List candidate functions in the imported libil2cpp.so."
   - "Decompile this function through ghidra-cli."

### Path B — Manual install (Codex, custom clients)

If the user's client does not have a one-click installer:

1. Fetch the upstream agent docs, for example:
   - `https://raw.githubusercontent.com/akiselev/ghidra-cli/master/AGENTS.md`
   - optionally `CLAUDE.md` if available.
2. Place the chosen file under the user's skill directory, for example:
   - `%USERPROFILE%\.codex\skills\ghidra-reverse-engineering-cli\SKILL.md`
   - `%USERPROFILE%\.claude\skills\ghidra-reverse-engineering-cli\SKILL.md`
3. Restart the agent.

### Path C — No skill manager

If neither manager is available, copy the upstream agent docs into this toolkit,
for example:

```text
prompts/agent-ghidra-cli.md
```

Then reference it from the agent's system prompt, local project prompt, or
workspace-level `AGENTS.md`.

## Sanity test

After installation, run from an agent-capable shell:

```powershell
.\re.ps1 ghidra-cli doctor
```

For project-specific Ghidra CLI queries, make sure the project has already been
imported and analyzed in Ghidra GUI. A safe preparation flow is:

```powershell
.\re.ps1 flow ScrewDom "D:\RE_Workspace\ScrewDom\01_Extracted"
```

This prepares the project by running:

```text
init/reuse workspace
-> scan/add
-> dump with Il2CppDumper
-> import into Ghidra with -noanalysis
-> generate notes
-> open PyGhidra GUI
```

Then the user should run Auto Analysis in PyGhidra GUI and apply `ghidra.py`
manually if needed.

After GUI analysis is done, raw CLI queries can be tested, for example:

```powershell
.\re.ps1 ghidra-cli --% function list --projects-dir <dir> --project ScrewDom --program libil2cpp.so
.\re.ps1 ghidra-cli --% decompile <function-name> --projects-dir <dir> --project ScrewDom --program libil2cpp.so
```

If PowerShell parses flags incorrectly, use `--%`:

```powershell
.\re.ps1 ghidra-cli --% function list --project ScrewDom --program libil2cpp.so
```

Expected output:

- `doctor` -> summary confirming Ghidra + JDK paths.
- `function list` -> function table if the program is imported/analyzed.
- `decompile <function>` -> C-like pseudo-code if the function exists.

If `function list` or `decompile` fails because the program is not imported,
use:

```powershell
.\re.ps1 flow <Game> <apk-or-ExtractedPath>
.\re.ps1 open <Game>
```

Then finish Auto Analysis in the GUI before retrying CLI queries.

## Reminder for the agent

- The toolkit has two tiers; use the right one:
  - Tier 1 (state-machine workflow):
    `re.ps1 init|add|scan|dump|import|flow|open|path|status|notes|candidates|context`
  - Optional/manual Tier 1 commands:
    `re.ps1 analyze|symbols|summary|strings|functions|stats`
  - Tier 2 (raw tool passthrough):
    `re.ps1 ghidra-cli <args...>`,
    `re.ps1 il2cppdumper <args...>`,
    `re.ps1 ghidra-gui`,
    `re.ps1 pyghidra-gui`
- Prefer Tier 1 commands when preparing a project.
- `flow` does not run headless analysis or auto-apply symbols.
- Use `open` or `path` to help the user open the imported Ghidra project.
- Always call `re.ps1 ghidra-cli <args...>` instead of the bare `ghidra` binary.
- Use `--json` or `--pretty` when piping output so the agent can parse results
  deterministically.
- Avoid running `ghidra-cli` query/analyze commands while the same Ghidra project
  is locked by another GUI/headless process.
- Do not run patching, binary modification, or potentially destructive commands
  unless the user explicitly asks and confirms the target file/project.

## Cheat sheet

| Want | Command |
|---|---|
| Prepare/import/open flow | `.\re.ps1 flow <Game> <apk-or-ExtractedPath>` |
| Step-by-step preparation | `.\re.ps1 init <Game>` → `scan/add` → `dump` → `import` → `open` |
| Show project state | `.\re.ps1 status <Game>` |
| Show project path/link | `.\re.ps1 path <Game>` |
| Open PyGhidra GUI | `.\re.ps1 open <Game>` or `.\re.ps1 pyghidra-gui` |
| Generate notes | `.\re.ps1 notes <Game>` |
| Candidate class list | `.\re.ps1 candidates <Game>` |
| Agent context file | `.\re.ps1 context <Game>` |
| Optional headless analyze | `.\re.ps1 analyze <Game>` |
| Optional symbol apply | `.\re.ps1 symbols <Game>` |
| Raw CLI access | `.\re.ps1 ghidra-cli --% <subcmd> <args>` |
| Run raw dumper | `.\re.ps1 il2cppdumper <native> <metadata> [output]` |

## Current safe default

For REToolkit's current workflow, the safest default is:

```powershell
.\re.ps1 flow <Game> <apk-or-ExtractedPath>
```

Then in PyGhidra GUI:

1. Open the imported program.
2. Run Auto Analysis.
3. Run `ghidra.py` manually from:

```text
workspaces\<Game>\02_Il2CppDumperOutput\ghidra.py
```

4. Use `dump.cs`, `DummyDll`, `candidates.md`, and `agent-context.md` for
   reconstructing readable C# reference logic.
