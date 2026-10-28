# Reconstruction throughput and continuity

Status: approved by the user's implementation request on 2026-10-26.

## Observed problem

The requested outcome is gameplay reconstruction, but the current durable unit
is one operation. The Markdown reconstruction ledger records the larger goal;
the toolkit does not enforce that goal's lifecycle. A successful apply or Unity
check therefore cannot establish that the requested task is complete.

Read-only inspection of saved SS jobs on 2026-10-26 found two source applies
taking 11 and 22 seconds. Their SQLite source-refresh phases took 2665 and
5606 ms. Saved Unity validations took 47, 88 and 91 seconds; index jobs took
26–32 seconds. These are historical observations, not a fresh benchmark.
No saved agent.wake_after job was found. This does not rule out active waits.
The saved ledger retains the full gameplay goal and unfinished dependencies.

Code inspection also found repeated complete content inventories in input
selection and source publication, including before each file in a multi-file
apply. Shared recovery artifacts copy/hash a new project generation for source
apply and Editor operations. Snapshots omit Library, so a fresh generation
cannot reuse a previous generation's Unity import cache automatically.
The current wake contract supports observation or verify-and-scoped-Unity;
it does not drive the full feature checklist or acknowledge actual agent progress.

## Alternatives

1. Prompt-only workflow tightening: small change, but cannot detect an ended
   harness turn or durably own continuation. Useful as supporting guidance.
2. Durable reconstruction run plus measured operation optimization: recommended.
   Preserve existing jobs, receipts and operation gates; add a finite authorized
   task state and explicit continuation lifecycle around them.
3. Automatically relaunch arbitrary agents until gameplay works: rejected.
   Unknown dispatch, canceled goals and repeated failures would cause duplicate
   work without reliable completion evidence.

## Task lifecycle

Introduce typed reconstruction-run operations for create/status/checkpoint/next,
claim/heartbeat/release and explicit pause/cancel. Persist under the selected
workspace with one active run per candidate/task. Initial creation records the
user-authorized goal, candidate identity, finite feature/scenario checklist,
permitted operations and required acceptance dimensions. It adds no permissions.

Run states: active, waiting-job, waiting-agent, needs-inspection, blocked,
paused, canceled, completed. A successful job only updates the matching step.
Completion requires current evidence for every required acceptance criterion,
including gameplay scenarios when gameplay is the authorized goal. Missing
execution capability produces blocked/unverified gameplay, never completed.
Reports distinguish partial progress from task completion. Agent-authored notes
or evidence pointers alone cannot authenticate engine results.

Record exact artifact/revision, job and operation IDs, next dependency, last
progress and blocking reason. Reconcile saved state after restart against real
jobs, receipts, candidate inventories and cancellation before continuing.
Use atomic writes and the existing workspace/engine ownership rules.

## Continuation

Keep existing durable job workers. Bind a continuation to the exact run,
generation, job, harness session and authorized next step. For Codex, reuse the
existing transport preflight and at-most-once queue claim. A queued message is
delivery acceptance only. A resumed agent must explicitly claim/checkpoint the
run; report waiting-agent until that acknowledgment exists. An expired heartbeat
indicates missing liveness, not permission to replay a mutation or seize locks.

Do not assume other harnesses can be resumed: expose a capability result and
require an active wait or explicit resume when their adapter is unavailable.
Do not claim a filesystem watcher can wake an unsupported harness.
Unknown transport or child outcomes require inspection; never automatically
redispatch an unknown claim. Pause/cancel prevents new dispatch. Known terminal
job results can produce the next authorized task; review closure still needs an
actual harness review event.

## Throughput

Instrument phase timings and work counters first: input hashing, inventory,
snapshot bytes, source parser, publication, graph refresh, Unity import/compile,
binding traversal and engine transitions. Expose bounded summaries to CLI/MCP
and the current GUI job details. Avoid promising a speedup before measurement.

Plan source in dependency slices within existing limits (currently at most 16
changed scripts), with native evidence per change. Verify each applied batch.
Run scoped Unity validation at a compile-coherent feature boundary; if it fails,
repair that boundary before depending on it. Required gates remain enforced.
Switch between Ghidra and Unity at these boundaries where feasible, while
respecting their serialized workspace ownership.

Optimize repeated hashing only with explicit lifetime/invalidation semantics.
Never replace content identity with size/mtime-only persistent trust. Cache
reuse must be scoped to a verified owned operation and detect external changes;
otherwise retain the full verification path. Measure hash calls and byte counts
with fixture acceptance before claiming an improvement.

A separate later optimization may use a stable disposable Unity validation
runner/cache, synchronized from a fully verified revision. Library and generated
Editor files remain outside immutable source evidence; changes made by import
hooks must be observed and reconciled. Do not share writable Library via links,
reuse validation across changed source, or weaken snapshot isolation.

## Initial delivery and verification

First delivery: durable task state, next-step/completion decision, exact-session
continuation acknowledgment, launcher/workflow integration, phase metrics and
dependency-batch guidance. Reuse existing GUI activity/status components; avoid
an unrelated GUI redesign. Hash/cache changes and stable Unity runner follow
only after measurements isolate their contribution.

Use source-owned fixtures to verify restart during a job, successful apply with
unfinished gameplay, queued-but-unclaimed notification, paused/canceled run,
failed transport, unknown write, stale candidate, duplicate controller and
blocked dependency with independent work remaining. Assert that completed
cannot be set while any required scenario lacks current verification.
Performance fixtures check phase counters and reuse/invalidation behavior,
not unstable wall-clock thresholds. Real harness resumption and game gameplay
remain separate acceptance checks requiring actual observed runs.
