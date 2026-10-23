# Job completion wakes the selected Codex CLI thread

> Worker tasks may run in parallel on disjoint files; use fail-first tests and
> independent review. Preserve the dirty checkout. No live Codex message, game
> operation, review approval, commit or push in acceptance tests.

**Goal:** Replace prose-only promises to continue after a background job with
an explicit durable watch registration and one Codex queue notification.

**Architecture:** `jobs.wait` offers bounded event-driven observation while an
agent turn is active. A typed `agent.wake_after` background job watches an exact
workspace job and explicit Codex thread UUID; it records a deduplicated dispatch
claim before queueing a fixed, bounded completion message using the installed
trusted Codex executable. No --last/session-name guessing, synthesized keystrokes,
parallel exec-resume writer, arbitrary prompt/command or approval bypass. Unknown
dispatch never auto-retries. Notification acceptance is separate from agent work.

**Tech stack:** Node24 fs.watch + bounded reconciliation; existing durable jobs,
typed MCP/CLI, installed `codex queue --thread UUID --message TEXT`.

- [x] Reproduce missing wait/wake registration with owned process fixtures.
- [x] Implement read-only jobs.wait with timeout <=30 seconds, terminal predicate,
  cleanup and responsive MCP; no workspace lease or job mutation.
- [x] Implement exact-job/thread wake worker, atomic duplicate suppression,
  deadline and unknown dispatch recovery; fixed source-verify/scoped-validation
  continuation prompt retains gameplay unverified and never auto-replays apply.
- [x] Expose typed MCP/jobs/CLI operations and per-stage wake status; launcher and
  skills require explicit wait or registered watcher before claiming auto-resume.
- [x] Test actual source-owned fake Codex child argv/events/late close/errors,
  reconnect/duplicate/failed or unknown upstream jobs and full regression.

The observed GoodSort apply and custom PowerShell continuation are untouched;
registration for a real session requires its exact thread UUID and job identity.
Reviews/approvals outside toolkit jobs must use their harness wait/Goal mechanism;
prose saying "after review" is not an event subscription. Wake dispatch does not
grant scope, approve review, apply a plan, or establish gameplay readiness.

## Verification and review

- New owned detached-worker acceptance follows a synthetic apply to terminal,
  observes transport-ready progress, invokes only a fake npm Codex CLI and proves
  exact thread/receipt references and one dispatch across duplicate registration.
- Fail-first regression covers stale arming progress after an owned child exits.
  A dead worker now reports unknown and clears public transport-ready evidence.
  Arming requires top-level running plus waiting/transportReady, or final queued.
- Independent review reproduced and closed interrupted observer ownership,
  ambiguous probe cleanup and stale ready progress. Windows scope arguments use
  a policy reference/hash/count; full scope remains in the bounded saved policy.
- Full regression log: `.cache/agent-wake-final-tests.log`. Focused wait, worker,
  surfaces and MCP regression after the final fix: 37/37 passed. Whitespace check
  passed. Installed Codex/Claude skills synchronized with hash-verified backups.
- An initial full run passed 974/975 with one existing skip. The final broad run
  covered 976 tests: 974 passed, one skipped, one old AssetRipper concurrent-read
  fixture expected a guaranteed queue admission that it had not established.
  Binding verification can delay its connection until after shutdown, correctly
  producing connection_lost instead of session_stopping. Only that fixture now
  accepts these exact two refusal outcomes; reads=0, recovery error, engine close,
  retained leases and busy-lock assertions remain strict. Its corrected file
  passed 15/15 (`.cache/agent-wake-provider-regression.log`). No runtime provider
  behavior changed. Wake fixture teardown also awaits actual child close rather
  than a 300ms sleep; wake/worker/surface tests passed 22/22 after that correction.
  The entire broad suite was not rerun after this fixture-only adjustment.
- No authenticated queue delivery or agent resumption is claimed. Existing
  terminals require MCP reconnect/new workflow context; old prose-only handoffs
  have no registration. Guide: `docs/agent-continuations.md`.
