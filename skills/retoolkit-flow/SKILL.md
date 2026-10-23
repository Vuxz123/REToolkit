---
name: retoolkit-flow
description: Use when preparing Unity IL2CPP archives or extracted builds with REToolkit, inspecting resume plans, choosing binary/metadata inputs, or transferring .re workspaces.
---

# REToolkit Flow

Resolve the checkout from the task context or the MCP registration's absolute
`re.js` path. Documentation paths below refer to that checkout, even when this
skill was copied into a personal skill directory.

Use `node re.js <command>` (Node.js >=24), or `re.cmd` on Windows, from the
repository root. Core workspace, state, scanning, archive and flow operations
are native JavaScript. Do not substitute the older PowerShell pipeline. The
Electron desktop is available with `retk gui` after `npm run gui:install`.
It runs the same Node CLI; the retained PowerShell UI is a compatibility path.

```powershell
node .\re.js flow <GameName> "<archive-or-directory>" --dry-run
node .\re.js flow <GameName> "<archive-or-directory>" --no-open
node .\re.js status <GameName>
node .\re.js open <GameName>
```

Safe resume is the default; `--resume` makes the intent explicit. Reuse work
only when content identity and output evidence are valid. Node preserves explicit
or current selections; otherwise its default policy prefers ARM64, ARMv7, x86_64,
then x86 among recognized Android binaries. One binary at the preferred ABI and
one metadata are required. For an existing unresolved extraction, call
`retk inputs resolve <GameName> --json` once and use its compact result. Do not
reread receipts or ask the user merely to choose ARM64. Duplicate preferred ABI,
unknown mixed binaries or multiple metadata remain unresolved; use exact
`--binary <path>` / `--metadata <path>` choices then. `inputs resolve` accepts
`--policy manual` to keep multiple candidates unresolved.
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
use current repo instructions and the checkout's `README.md` section
"Agent Skills And Older Installations" for the search/backup procedure.
Personal installed skill updates are separate work; do not rewrite them
silently. Record synthetic test results separately from real engine checks.

After preparation, use `retoolkit-game-reconstruction` for the complete
reconstruction/validation workflow; do not interpret flow completion as a
recovered or playable game.
