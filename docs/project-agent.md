# APK projects and AI Agent sessions

The create-project dialog now defaults to preparing the imported project in a
detached Node worker. Set symbol/address policy and optional explicit Android
target before creation; existing projects have start/resume controls. See
[automatic preparation](project-preparation.md) for stages, freshness checks,
guarded split recovery and current limits. Missing SDKs/runtimes are reported,
not automatically installed. The short desktop enqueue command exiting does
not mean preparation has finished; use the durable preparation panel/job.

Open `retk gui`, click **Tạo project từ APK**, choose the archive and give the
project a new name. Continue through preparation policy and review, then submit.
REToolkit retains the original archive and imports/scans it.
It selects the created project without opening Ghidra, Unity or the game.
Existing project names are refused. CLI equivalent:

```cmd
retk create-project MyGame "D:/Builds/game.xapk" --json
```

Multi-ABI Android APKs prefer ARM64, then ARMv7, x86_64 and x86 when there is one
binary at the preferred ABI and one metadata. Explicit and existing selections
win. Unknown mixed binaries, duplicate preferred binaries and multiple metadata
still show **Cần bổ sung đầu vào**. A complete first extraction goes into
`01_Extracted`. The **Binary / ABI và metadata** panel explains automatic choices
and supports **Tự chọn ABI ưu tiên** for unresolved existing projects, or exact
manual choices with **Chọn và tiếp tục**, without extracting the archive again.
A failed archive remains inspectable; it is not an analysis-ready project.

Older failed first imports can expose **Đưa dữ liệu về 01_Extracted**. This recovers
only the recorded completed extraction into an empty canonical directory, with
a project backup and recovery receipt; it does not choose an ABI. Existing
selected projects and nonempty extractions remain protected. Ambiguous replacement
imports keep their staging until a candidate is explicitly selected. CLI routes:

```cmd
retk inputs MyGame --json
retk inputs resolve MyGame --json
retk inputs select MyGame --binary lib/arm64-v8a/libil2cpp.so --metadata assets/bin/Data/Managed/Metadata/global-metadata.dat --revision <returned-revision> --json
retk inputs recover MyGame --revision <returned-revision> --json
```

Use the actual paths and revision returned by inspection. Changed candidates
invalidate old selections. Recovery never publishes a stage left by corrupt or
incomplete archive extraction. Changing a selected ABI invalidates downstream
analysis for the former binary.

Agents use `workspace.inputs.resolve` through observable MCP jobs for one compact
result instead of rereading intake receipts and checklists solely to choose ABI.
`inputs resolve --policy manual` preserves ambiguity for manual selection.

In the persistent project header, select **Codex CLI**, **Claude Code**, **Gemini CLI** or
**OpenCode**, then **Mở AI Agent**. Install/login to the chosen CLI separately;
missing harnesses are disabled. Refresh the GUI after changing PATH/installations.
The launcher supports Windows and opens an interactive terminal at the selected
workspace. It passes the project context and two MCP registrations:

- `retoolkit_assets`: workspace-bound assets, reconstruction, ADB and job tools.
- `retoolkit_ghidra`: existing live Ghidra MCP bridge. Its runtime must be ready
  for live queries; opening an agent does not start or select a Ghidra Program.

Each launch writes `04_Notes/agent-sessions/<UUID>/` containing `context.md`,
bundled workflow snapshots, `mcp.json`, harness-specific settings and launch
status. Global configurations and unrelated project configuration are preserved.
Codex gets session `-c` MCP overrides; Claude gets `--mcp-config`; Gemini uses an
isolated `GEMINI_CLI_HOME`; OpenCode gets `OPENCODE_CONFIG_CONTENT`. Gemini may
require fresh authentication in this isolated home. Credentials are not copied.
If project or managed Gemini settings would replace or disable the reserved MCP
bindings, launch refuses with a configuration-conflict message; it preserves
those settings instead of connecting to another project or overriding policy.
The terminal bootstrap PID is not the harness PID. `terminal-status.json`
records actual harness startup/exit; a terminal opening does not verify that
authentication or MCP connection succeeded. No automatic approval bypass is set.

GUI Jev session keys stay in private Settings memory and are not written into
the GUI's shared environment. Agent bootstraps/runners and Codex wake children
remove all `TYPESAFE_`/`JEV_` names case-insensitively, including inherited keys.
Harness authentication and MCP/session overrides remain intact. Use the explicit
GUI Jev workflow for its selected credential; do not copy keys into Agent context.
Existing terminals need reopening to use the new isolation boundary.

If Claude reports `MCP config file not found` followed by the initial
`Continue the REToolkit project ...` prompt, the session was generated by an older
launcher that passed the prompt into Claude's variadic `--mcp-config` option.
The launcher now uses `--mcp-config <mcp.json> -- <prompt>`. Close the failed
terminal, restart `retk gui`, and use **Open AI Agent** to create a fresh session;
the old saved launch manifest remains historical. This error does not call for
changing the project's MCP servers or authentication.

The agent first calls `preparation_status {}` and reads the saved task ledger.
Current preparation results avoid repeated dump/import/analysis/export/index.
Running workers continue without an agent polling loop; stale evidence and
unknown writes need review. Raw saved handoff files are historical until fresh
status verifies their content. Project/intake diagnostics are read only for a
reported blocker. With no recorded task it asks for the intended work. Missing IL2CPP or
Unity data, OBB, ABI splits or evidence of a split distribution prompt inspection
of the current input. If matching installed LDPlayer splits can close the gap,
the agent discovers devices/packages and binds the exact serial/package before
capture. It never chooses the first device/package or starts a canceled game.
Missing IL2CPP can also mean a Mono/unsupported build. Reuse complete captures.

## Long-running MCP operations

The workspace assets MCP exposes:

```json
{"name":"jobs_start","arguments":{"operation":"workspace.dump","params":{}}}
```

Save the returned `jobId`, then poll:

```json
{"name":"jobs_get","arguments":{"jobId":"<returned UUID>"}}
{"name":"jobs_list","arguments":{"limit":20}}
```

`jobs_start` returns without waiting for the engine. `jobs_get` returns observed
stage, timestamps/sequence, engine, saved workspace step states and a bounded
diagnostic event tail. Stages/steps are observations, not a calculated percentage.
Final output includes the actual result or a saved `resultReference`; large
results support `resultOffset` and `resultLimit` (up to 65536 bytes). Exact chunks
are also encoded as base64. Resolve artifact references against the workspace.
Engine logs and private failure diagnostics are referenced instead of forwarding
raw process output or private app-data chunks into MCP.

Jobs persist in `04_Notes/jobs/<UUID>/` and workers continue across MCP disconnects.
Their completion does not automatically start another agent turn. Use
`jobs_wait` for a bounded active wait, or register `agent.wake_after` for this
exact Codex CLI thread/job. Confirm watcher state `running` with
`wakeProgress.state:waiting` and `wakeProgress.transportReady:true` before
ending the turn. See [agent continuations](agent-continuations.md) for typed
source-verification/scoped-Unity tasks, durable status and unknown delivery.
`unknown` means the worker/transport could not establish the mutation outcome;
inspect the original operation ID, engine lease and receipt before recovery.
Never restart a write because polling or the client timed out. An exit-zero job
can still return partial capture coverage, blocked validation or an unready game.

The `jobs_start` schema lists typed operations and their parameters. It includes
existing asset/reconstruction/migration/library/visual/ADB operations plus:

- `workspace.status`, `workspace.add`, `workspace.scan`, `workspace.dump`,
  `workspace.import`, `workspace.analyze`. Add/scan accept `input` and optional
  `binary`/`metadata` selectors, allowing repair of incomplete or ambiguous intake.
- `ghidra.session.start`, `ghidra.session.status`, `ghidra.session.stop`.
- `ghidra.symbols.plan` and `ghidra.symbols.apply`.

Symbols require the owned write session, explicit address mode, a reviewed saved
plan and exact plan hash. Apply takes `plan`, `planHash`, optional `dryRun` and
`operationId`. A stable operation ID is recorded before launch; read the real
receipt and coverage afterwards. Existing ownership, input identity, revision,
conflict and partial-coverage checks remain enforced. GUI owners and headless
owners cannot compete for the same project. Existing synchronous MCP tools are
still available for short reads. There is no generic shell/executable job.

Verification uses synthetic archives/processes and actual Electron fixtures.
No authenticated harness, real LDPlayer game or live symbol mutation was used
to qualify this feature.
