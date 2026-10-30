# Reuse a Unity Editor for reconstruction validation

Use `resident` for repeated compile/binding/data checks while recovering a batch
of related classes. Unity 6 and an installed Unity CLI are required. REToolkit
starts its own dedicated Editor with the exact project version; it does not take
over an arbitrary Editor containing unsaved work. The first run installs
`com.unity.pipeline` into the validation copy and imports the project.

```powershell
retk reconstruct validate MyGame --mode resident --json
retk reconstruct resident-status MyGame --json
retk data verify MyGame --baseline <baselineId> --mode resident --json
retk reconstruct resident-stop MyGame --json
```

The desktop validation form exposes `mode`: `clean` (default) or `resident`.
Session status and stop are separate desktop operations. Typed MCP validation
and data verification accept the same `mode` parameter. Discover exact tool
names through `tools/list`; use background jobs for long operations and read
their progress and final result.

For a recovery artifact, invoke these domain operations through `recovery.run`
on that artifact and revision. This keeps the session, graph and evidence on the
same branch. Resident validation and data verification do not fork a source
generation; applying source still does. Do not use a workspace-level stop to
stop an artifact-level session.

Recommended agent loop:

1. Recover a coherent batch of classes within existing plan limits, review and
   apply it once, then verify its integrity receipt.
2. Call `reconstruct.validate` with `mode: "resident"` and the exact asset scope.
   Only changed source files are synchronized; the Editor and Library cache stay.
3. Call `data.verify` with the existing baseline ID and `mode: "resident"` when
   required. Its receipt can also cover compile/binding for that asset scope;
   do not repeat identical checks or omit other affected scene/prefab scope.
4. Inspect errors, recover the next batch and repeat. Successful compile/binding
   or data preservation does not verify runtime behavior or gameplay.
5. Stop the resident session and run normal `--mode clean` validation before
   final acceptance. Original baseline capture remains a clean run.

Each invocation records its request, observation and sealed execution receipt.
`process.closed: false` is expected: `execution.completed: true` describes the
finished invocation, while Unity stays alive. Status reports the pending run and
project path. Resident observations provide the same asset progress checkpoints.

The helper resets scenes before/after inspection and rejects Play mode, dirty
scenes or incomplete compilation. Unexpected source/helper/package changes are
rejected. Package or Editor changes require stopping and starting a new session.
Keep external edits and interactive experiments out of this validation copy.
For unsupported Editor versions, explicitly use `clean`; there is no silent
fallback that hides a cold run.

On an interrupted or failed invocation, inspect its retained session, job and
Editor log before stopping/restarting. A persistent toolchain lease protects the
Editor until closure is verified; do not delete the lease to force an update.
Startup compile errors can prevent Pipeline from connecting and require diagnosis
from the retained Editor log. No validation result is fabricated in that case.

Measured on a small Unity 6000.0.66f2 fixture with Unity CLI beta.13: first
invocation 38.0 seconds, unchanged invocation 6.3 seconds, and a changed C# file
9.7 seconds. All three used one Editor; the second copied no source and the third
copied one file. The fixture Editor was then closed successfully. This is not a
game-scale benchmark or a gameplay test.
