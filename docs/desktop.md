# Node desktop and reconstruction tools

[Project preparation](project-preparation.md) adds create-and-prepare plus
start/resume and per-stage progress. Its durable Node worker continues after the
short enqueue command and GUI close; runtime installation remains a prerequisite.

Large exports can use `retk assets index Game --max-graph-mib 256` or `512`.
Default128MiB and250000-file/200000-node/1000000-edge caps remain bounded.
This selects local graph storage/memory budget; AI/desktop responses remain
paged and bounded. Known bulk payloads are explicit read-only hash descriptors;
object references and MonoBehaviour fields remain represented. Indexing success
does not establish successful Unity compilation or gameplay.

On a new Windows x64 machine, [run `install.cmd`](quick-install.md) for Node,
CLI/GUI and the locked engine/runtime profiles together. Choose `--profile desktop`
for CLI+GUI only. The manual steps below remain supported.

For manual installation, install Node.js24+, then from this checkout:

```cmd
npm ci
npm run cli:install
npm run gui:install
retk gui
```

Electron44.9.1 is pinned. `gui:install` installs that vendor runtime and gives
Windows AppContainer read/execute access only to its binary directory. The
renderer retains sandbox/context isolation and no Node access. Typed operations
run the same Node CLI; closing the window waits for active commands. Job previews
are bounded; large results are saved under `.cache/desktop-jobs/<UUID>/result.json`.
Use operation receipts for durable evidence. This is a source checkout desktop,
not an installed standalone Windows exe.

## Project workflow

The desktop opens with a project list. The selected project's header keeps its
ABI, configured export/candidate path, harness selector and **Mở AI Agent** action
visible. A configured path does not establish that an export exists or is valid.

- **Tổng quan** shows one next action, recorded pipeline steps, observed jobs and
  independent native/source/compile/binding/gameplay/visual evidence.
- **Tái dựng** groups source planning, apply, binding observation and the Agent
  workflow. Plans and receipts still refer to exact operations and outputs.
- **Tài nguyên** contains input selection, preparation, Ghidra monitoring,
  LDPlayer discovery and asset/index tools. Input and runtime details expand here
  instead of repeating above every page.
- **Kiểm chứng** separates source, Unity, staging/migration and image/video
  checks. Scope, coverage and the last explicit freshness-check time remain visible.
- **Tác vụ & bằng chứng** combines bounded GUI, worker/MCP and Ghidra observations.
  Open a job for progress, results and logs in a drawer; uncertain results require
  inspection, with no automatic retry or invented completion percentage.
- **Kho thư viện**, **Cài đặt** and **Công cụ nâng cao** retain library workflows,
  runtime/Agent/Jev setup and every existing typed CLI operation.

Create-project intake has three steps: archive/name, preparation policy, then
review. It scans the real archive only after submission; unresolved inputs remain
an inspectable project. Preparation is enabled by default and can be disabled on
the policy step. Project-bound operation forms keep the project name read-only,
provide enum/UUID/scope controls and disable conflicting writes when ownership is
observed. CLI/engine checks remain authoritative if ownership changes later.

Project and route preferences restore presentation only. Opening the desktop does
not replay saved commands. Compact GUI history retains at most 30 jobs in
`.cache/desktop-jobs/history.json`; interrupted queued/running commands restore as
unknown, not as new work. Corrupt or oversized history is reported and preserved.

The combined monitor scans at most 128 durable job directories (30 displayed),
64 session directories (20 displayed), plus eight Ghidra observations. It reports
truncation and unreadable records. A result larger than the bounded detail budget
remains an exact saved-file reference. Process state, terminal opening, queued
wake notifications, MCP connection and Agent resumption are separate facts.

Background observation uses cheap reports. **Làm mới** or **Kiểm tra bằng chứng**
explicitly rechecks freshness; the overview holds that point-in-time observation
for at most 60 seconds and invalidates it on observed job changes. It is not a
continuous attestation of files edited outside the toolkit. Gameplay and visual
fidelity remain unverified without their own evidence.

Library identify/plan forms accept an optional requirements JSON file, including
explicit trial requirements using a version available in the catalog. Import
still requires the resulting operation ID; it does not accept new requirements.

## Reading results and evidence

Use **Tạo project từ APK** to create and select a new workspace. Each selected
project has a harness dropdown and **Mở AI Agent** button. See
[APK projects and agent sessions](project-agent.md) for context, MCP jobs,
authentication and incomplete-split recovery.

The project **Binary / ABI và metadata** panel handles APKs containing several
`libil2cpp.so` files. Complete first extractions stay in `01_Extracted`. Node
prefers ARM64, ARMv7, x86_64, x86 when the preferred binary and metadata are unique;
existing/manual selections win. **Tự chọn ABI ưu tiên** resolves older pending
projects in one action. Exact manual selectors remain available, and duplicate
preferred binaries or multiple metadata still require a choice. No engine starts
when inputs are selected.

The **Tài nguyên → Dữ liệu LDPlayer / ADB** action discovers devices and installed third-party package
IDs and pulls APK/splits/OBB plus external/private app data using existing access.
Select an exact serial/package; the GUI never launches the game. Install payload
and userdata ZIP are separate, and denied data appears as partial coverage.
See [capture coverage and limits](adb-capture.md).

The result panel shows a status summary, counts, labelled fields and tables.
The selected project's **Ghidra · Tác vụ và tiến độ** card also observes recorded
CLI/Agent work outside the desktop queue: import, Auto Analysis and saved MCP
symbol/session-start jobs. It refreshes every two seconds while visible, showing
the lock owner/worker PIDs, elapsed time, last log update, bounded log tail and
recorded final state. No lock acquisition, engine query or process termination is
performed. A live PID and a quiet log do not prove progress or a hang; the card
warns after five minutes without log output. It does not estimate percentages or
discover arbitrary separately opened Ghidra windows. Job discovery is bounded to
128 directory entries and eight displayed tasks; truncation is explicit.
Saved project JSON is bounded to 16 MiB, and the monitor caches only compact step
fields while its file identity/timestamps remain unchanged. Large inventories are
not copied to the renderer. A workspace step and MCP job sharing the exact log
are shown as one task.

Expand a row's details to inspect nested records. Execution logs are separate;
errors and missing Jev credentials appear as readable messages. Compilation,
bindings and gameplay remain separate verification states.

Technical metadata and raw JSON are collapsed by default. Expand them when
debugging or handing data to an agent. Copy buttons copy paths or JSON as text.
Large previews explicitly show omitted content and the saved-result path when
available. Close and reopen `retk gui` after updating desktop source files.

Large workspace results keep a semantic summary: extraction/scan/engine step
states, current paths, ABI/metadata candidates and the next action. File/hash
inventories stay in the full saved result. The result panel shows step and ABI
tables directly; it does not require opening raw JSON to resolve input selection.

`node test/real-desktop-results.mjs` checks the actual sandboxed renderer using
fixtures and produces screenshots under `.cache/desktop-results-acceptance/`.
Its copy-success test uses an injected callback to preserve the user clipboard;
the real IPC bridge is checked with invalid input rejected before clipboard access.

`node test/real-desktop-flow.mjs` checks the production shell in an isolated
fixture toolkit with Electron viewport emulation at 1280×720, 1366×768 and
1600×1000 (independent of the Windows display's resize limits). It covers project isolation,
durable validation progress, typed forms, unsaved Jev settings and real APK intake
with preparation disabled. Screenshots and the observation report are saved under
`.cache/desktop-flow-acceptance/`. These checks do not establish game fidelity.

## Private Ghidra GUI runtime

```cmd
retk desktop-runtime plan --lock config/desktop-windows-x64.lock.json
retk desktop-runtime install --lock config/desktop-windows-x64.lock.json
retk desktop-runtime verify
retk pyghidra-gui Game
retk ghidra-gui Game
retk desktop-launch status <run UUID>
```

The lock pins CPython3.12.10, PyGhidra3.1.0, JPype1.5.2 and all38 wheels,
GhidraMCP6.0.0 extension and local .NET8.0.22; installed Ghidra12.1.2 PUBLIC
is required. Python and settings remain separate from the main MCP profile.
Installer journals and immutable generations support owned-pointer rollback.
Use a reasonably short toolkit path: Windows native Python extensions have a
loader path limit. Invalid selected profiles block execution. Launch never
installs packages or silently repairs a venv.

Node owns a foreground JVM/GUI worker and workspace/toolchain leases through
observed close. `launched` means process spawn, not completed analysis, enabled
extension or connected MCP Program. No existing Ghidra window is killed or
unlocked. Native setup in the desktop requires an explicit reviewed native lock;
use `config/native-windows-x64.lock.json`.

## Image and video comparison

```cmd
retk visual compare Game --request visual-request.json
retk visual report Game --operation <UUID> --section summary
```

See [the request contract](../src/visual/README.md). Declare exact screen/state,
profile, required regions and explicit baseline provenance. The tool creates
hash-bound reports and diff PNGs, compares every required region and marks stale,
missing or mismatched evidence unverified. It never resizes captures implicitly.
Video requires an explicitly selected ffmpeg and aligned timestamps; unsupported
formats are not passes. Fixture comparisons prove mechanics, not game fidelity.
Typed `visual.compare`/`visual.report` tools are also available in assets MCP.

For large exports, select `sqlite` in the graph operation's storage field. See
[large-project storage and scoped migration](assets-storage.md) for CLI examples,
paging, storage limits and version2 manifest details.

## Script and field migration

```cmd
retk migration observe Game
retk migration plan Game --request migration.json --observations observations.json
retk migration apply Game --plan plan.json --observations observations.json
retk migration observe Game --receipt receipt.json
retk migration verify Game --receipt receipt.json --observations post-observations.json
```

Stop AssetRipper before migration. Observation uses the exact matching Unity
Editor and an isolated copy. Saved plan/output paths are under
`04_Notes/assets/migration/<UUID>`. Apply creates a fresh staged project and keeps
the original export unchanged. Use reported paths for subsequent commands.
The desktop and typed assets MCP expose these operations too.

Migration requires Editor-observed assembly/full type/GUID/local fileID and
serialized-value assertions. Supported scalar/object-reference field renames
preserve unlisted YAML/meta/large reference IDs. Compilation, bindings, values
and gameplay are separate results. DLLs remain retained; automatic DLL removal,
full DLL-to-C# conversion, arrays/nested/managed-reference fields and type
conversion remain unsupported and fail explicitly. IL2CPP dump stubs do not
recover the original method implementations.

## Visible-window regression

The desktop CLI explicitly launches Electron with `windowsHide:false`.
Background CLI jobs retain hidden-console startup. An offscreen image alone
does not prove that Windows displays the application window. Run
`node test/real-desktop-visible.mjs` for an isolated actual-CLI check that
asserts the native Electron window is visible and closes its own fixture.
