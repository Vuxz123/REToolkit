# Project creation, harness launch and observable MCP jobs

The desktop offers a prominent New project from APK button. A form accepts a new
workspace name and APK/XAPK/APKS/ZIP path, creates a workspace without overwriting
an existing project, and imports/scans the archive without starting native tools.
Failure preserves the workspace and diagnostics so incomplete split builds can
be repaired. Successful and incomplete newly created projects become selected.

Each selected project exposes a harness selector and Open AI Agent button.
Codex CLI, Claude Code, Gemini CLI and OpenCode run in a separate terminal with
the workspace as cwd. A generated project-local session directory contains the
task context, bundled workflow instructions and harness-specific MCP settings.
Do not overwrite user/global harness configuration or install harness packages.
Missing harness executables are reported clearly. No permissive approval flags.
The launch prompt binds the exact project and distinguishes reference/target data
from instructions. Never launch or inspect a canceled game as a development test.

The workspace-bound assets MCP additionally exposes jobs_start, jobs_get and
jobs_list. A start call accepts only registered typed operations, returns a job
ID immediately, and runs engines in supervised CLI children. Get returns state,
current stage, bounded diagnostic tail, timestamps, exit code and parsed final
result or a saved result reference. Jobs survive MCP client reconnects through
workspace-local records; interrupted jobs are uncertain, never successful by
inference. No generic shell/executable operation is exposed; existing typed engine
selection fields retain their normal validation. Existing
synchronous MCP tools remain compatible.

Registered pipeline operations include status, add/scan input selection, dump, import, analyze, owned
Ghidra session start/status/stop, symbols plan/apply, plus existing asset,
reconstruction, migration, library, visual and ADB operations. Live symbol writes
use the existing saved-plan/receipt/session ownership checks. Job completion and
domain readiness are separate facts. Keep partial capture/coverage explicit.

Agent context and reconstruction skill explain missing split indicators (missing
IL2CPP pair, Unity data/OBB or ABI split, installation source evidence), ask only
for unresolved device/package identity, and capture through the supported route.
They require inspecting symbols coverage and receipts, polling existing jobs
instead of retrying timed-out mutation, and recording failed/uncertain runs.

Verification uses synthetic archives, fake processes and Electron fixtures only.
No actual device/game, Ghidra mutation or authenticated harness session is run.
