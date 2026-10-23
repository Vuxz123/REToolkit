# Continue an agent after a background job

REToolkit workers persist their results without an agent polling continuously.
A finished worker does not by itself schedule another agent turn. A sentence
such as “Next: after review/apply finishes…” is only a handoff unless the agent
actually waits or registers a continuation.

## Wait in an active turn

Use the workspace-bound assets MCP:

```json
{"name":"jobs_wait","arguments":{"jobId":"<watched job UUID>","timeoutSeconds":25}}
```

It returns the usual job snapshot plus `wait.state` (`terminal` or `timed-out`).
Timeouts are 1..30 seconds and do not cancel the producer. Terminal states are
`succeeded`, `failed`, and `unknown`; inspect the domain result separately.
The read-only wait takes no workspace lease. Ping/status calls remain responsive
while up to four waits are pending. A wait cannot wake a closed agent turn.

CLI equivalent: `retk jobs wait Game --job-id <UUID> --timeout-seconds 25 --json`.

## Register a Codex CLI continuation

This adapter uses [Codex queue](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
to notify an existing exact thread UUID. It probes the installed trusted CLI's
`queue --help` before watching. Older CLIs without `--thread` and `--message`
fail preflight. Claude Code, Gemini CLI and OpenCode have no queue adapter here.

The agent obtains its own UUID from `CODEX_THREAD_ID` in its harness environment
when available, or from an explicit session identity. Do not guess, use `--last`,
or select another thread by display name. Never print the whole environment.

For result inspection only, start this typed job:

```json
{
  "name":"jobs_start",
  "arguments":{
    "operation":"agent.wake_after",
    "params":{
      "jobId":"<watched job UUID>",
      "threadId":"<this Codex thread UUID>",
      "task":"observe-job",
      "waitTimeoutSeconds":86400
    }
  }
}
```

Save the returned **watcher** job UUID separately from the watched job UUID.
Read the watcher with `jobs_get`/`jobs_wait` before ending the turn. Require
top-level watcher `state: "running"`, `wakeProgress.state: "waiting"` and
`wakeProgress.transportReady: true`, or a
final result with `state: "queued"`. A queued Node job alone is not an armed
notification. Missing thread identity, failed preflight or unknown state must
be reported as a continuation blocker; continue an active wait where practical.

CLI equivalent:

```cmd
retk agents wake-after Game --job-id <watched-UUID> --thread-id <thread-UUID> --task observe-job --json
```

For an already authorized source-integrity check followed by scoped Unity
validation, use the following `params` instead:

```json
{
  "jobId":"<reconstruct.apply job UUID>",
  "threadId":"<this Codex thread UUID>",
  "task":"verify-source-and-scoped-unity",
  "operationId":"<exact source operation UUID>",
  "assetIds":["<exact scene/prefab/.asset ID>"],
  "waitTimeoutSeconds":86400
}
```

The watched job must be `reconstruct.apply` for this exact operation/workspace.
Only verified job success permits the fixed notification to request
`reconstruct.verify`, then `reconstruct.validate` for the saved exact asset scope.
The agent still checks the apply receipt, source identity and scope first. Failed
or unknown upstream outcomes produce inspection-only notifications. The watcher
does not run Unity itself, apply source, approve review, or verify gameplay.

CLI uses `--operation <UUID>` and `--asset-ids <JSON-array>` for this task. See
[Unity validation](unity-validation.md) for shell-specific JSON quoting. For large
scopes prefer the typed MCP payload. Full scope stays in the immutable policy;
the queue message carries its relative reference, count and SHA-256 instead of
putting thousands of IDs in Windows command arguments.

## Read the outcome

Watch registrations live in `04_Notes/agent-wakes/<binding-hash>/`:

- `policy.json`: immutable workspace/job/thread/task/operation/sorted asset scope.
- `status.json`: current delivery observation and timestamps.
- The watcher job's `result` and `wakeProgress` expose the same bounded state.

`waiting` with `transportReady:true` means preflight passed and observation is
active. `queued` with `delivery:accepted` means the CLI accepted the notification;
it does not prove the agent resumed, read the receipt or completed validation.
The result deliberately keeps `agentResumed:false`.

`failed` or `timed-out` means no successful notification was established. `unknown`
can indicate interrupted ownership, uncertain dispatch or pending child cleanup.
Inspect saved status and the actual thread; never automatically replay a queue
request whose delivery is unknown. Duplicate registrations for the same exact
workspace/job/thread read the existing claim without dispatching again. A changed
policy conflicts. An orphaned waiting claim is unknown rather than re-armed.

A notification does not resume a canceled task or add authorization. An external
code review is not a REToolkit job event: await it through the harness's review
mechanism, then register the resulting apply job if needed. Do not promise that
prose will wait for review.

## Existing sessions

Reconnect the assets MCP to load the new tools/schema. Newly opened REToolkit
agent terminals receive the updated workflow snapshot. An older terminal has its
old snapshot; explicitly point it to this guide or reopen the agent session.
Old prose-only promises are not retroactively registered. Resume that exact
thread once, recover its saved job/operation/scope, then wait or register one
continuation. Preserve any already running verification controller instead of
starting a second validation sequence.

Acceptance uses owned fake CLI processes and temporary workspaces. It checks
detached worker completion, exact queue arguments, duplicate suppression,
failure/timeout/unknown handling and MCP responsiveness. It does not establish
authenticated Codex delivery, agent resumption or game readiness.
