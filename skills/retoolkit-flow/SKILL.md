---
name: retoolkit-flow
description: Use when preparing Unity IL2CPP archives or extracted builds with REToolkit, inspecting resume plans, choosing binary/metadata inputs, or transferring .re workspaces.
---

# REToolkit Flow

Use `node re.js <command>` (Node.js >=24), or `re.cmd` on Windows, from the
repository root. Core workspace, state, scanning, archive and flow operations
are native JavaScript. Do not substitute the older PowerShell pipeline. The
existing PowerShell GUI remains a legacy path for a later migration.

```powershell
node .\re.js flow <GameName> "<archive-or-directory>" --dry-run
node .\re.js flow <GameName> "<archive-or-directory>" --no-open
node .\re.js status <GameName>
node .\re.js open <GameName>
```

Safe resume is the default; `--resume` makes the intent explicit. Reuse work
only when content identity and output evidence are valid. If discovery is
ambiguous, show candidates and require `--binary <path>` / `--metadata <path>`.
Matching metadata filenames do not prove compatibility. Changed content makes
dependent outputs stale, even when paths are unchanged. Legacy progress flags
alone cannot establish readiness.

Never silently replace a Ghidra program. Prefer a new workspace for changed
inputs, or deliberately request `--reimport` with a backup before replacement.
Save and close that project in Ghidra before headless work. Do not delete locks
or kill the user's Ghidra process. Keep valid earlier outputs if a later stage
fails; use the resume plan to decide what must run again.

Successful flow means **prepared**, not **analysis-ready**. Detached launch is
a handoff, not verification. In the GUI, confirm the program, finish Auto
Analysis, run `ghidra.py`/`ghidra_with_struct.py` with this workspace's
`02_Il2CppDumperOutput/script.json`, then start the GhidraMCP server. Use
`retoolkit-mcp-analysis` to connect and verify the live program.

```powershell
node .\re.js export <GameName>
node .\re.js import .\exports\<GameName>.re <NewName>
```

`import <GameName>` means Ghidra import; `import <file.re>` restores an archive.
Archive replacement needs explicit `--force` and a backup; never imply that a
normal archive import can overwrite an occupied workspace.

If an installed `ghidra-reverse-engineering-cli` skill contradicts this flow,
use current repo instructions and the [search/backup procedure](../../README.md#agent-skills-and-older-installations).
Personal installed skill updates are separate work; do not rewrite them
silently. Record synthetic test results separately from real engine checks.
