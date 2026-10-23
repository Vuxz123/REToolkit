# REToolkit desktop: project workflow redesign

Date: 2026-10-23. Status: approved and implemented in the production desktop;
fixture acceptance is recorded in the implementation plan.
Companion: [interactive mockup](../../ui/retk-flow-v1.html).

## Outcome

Make the selected project, its current blocker and its next useful action visible
without requiring knowledge of CLI commands, operation UUIDs or engine ownership.
Keep manual tools reachable. Preserve separate evidence for source integrity,
compilation, binding coverage, gameplay and original visual fidelity.

The first release reorganizes the desktop and its observation model. It does not
add automatic game reconstruction, arbitrary package installation, stage promotion,
universal cancellation, agent chat integration or a Claude wake adapter.

## Audit evidence

Reviewed the running Electron desktop at approximately 1386 x 914, with GoodSort3D
selected. Inspected Overview and Script / Unity through read-only navigation;
the shared input and Agent cards remain at the top of both pages. No project
mutation, game, engine or Agent was started. Findings below combine that visual
inspection with source review, not user research or measured task completion times.

| Priority | Current behavior / evidence | Effect | Proposed change |
| --- | --- | --- | --- |
| P1 | `renderer.js` keeps project, input, preparation and Ghidra panels visible on every non-settings page | Switching to Script / Unity changes the heading, but its tools remain below the same long stack | Persistent compact project header; route-specific main content |
| P1 | `operations.js` exposes 59 operations through generic dropdown/forms | Users must understand tool order, JSON request paths and UUIDs | Task cards and contextual actions; operation picker in Advanced |
| P1 | `jobs.js` desktop queue lives in memory; durable jobs and Ghidra/preparation observations have separate readers | A count of zero desktop commands is not proof no worker is active | Reconciled activity view with source, parent IDs, persisted history and coverage gaps |
| P1 | Overview displays lock availability as `available` / `busy` | Lock state can be mistaken for readiness or lack of a running job | Separate ownership, running activity and verified readiness |
| P1 | `project-view.js` launches a terminal but does not monitor session completion/readiness | User cannot tell whether MCP connected, startup failed or continuation was armed | Explicit launch/session observations and honest unknown states |
| P1 | `renderFields()` creates text inputs for almost all fields, including scoped JSON, enum and UUID values | Errors are discovered after submission; users copy IDs manually | Typed inputs, scope pickers, saved-plan/report selectors |
| P1 | Workspace selector changes input fields/overview but does not reset `selectedJob`; form workspace name is editable | A prior project's result can remain beside another selected project | Bind route, activity, form and result to project identity; global activity explicitly labelled |
| P2 | Input selectors stay expanded after selection succeeds; many refresh controls compete | Completed setup distracts from current work | Collapsed input summary; expand only for a blocker or explicit edit |
| P2 | Settings only covers Jev while runtime, libraries and harnesses live in separate tool groups | Setup is fragmented | Global Settings with Tools, Agents/MCP, Libraries and Jev sections |
| P2 | Status text, IDs, paths and English terms are prominent; many labels are 10–12 px | Slow scanning and unclear action hierarchy | Plain Vietnamese task labels, 14 px body, 12 px metadata, technical details on demand |

Strengths to preserve: sandboxed renderer and typed IPC, durable preparation,
ABI preference, original-build retention, guarded device/build matching, bounded
readable evidence previews, separate compilation/binding/gameplay claims and
original receipts. Existing read-only inspection remains available while an
engine owns a workspace. Do not derive approval from a UI recommendation.

## Alternatives considered

1. **Project dashboard plus contextual workflow (recommended).** Handles repeated
   repair/verify cycles and Agent use; requires a coherent observation model.
2. **Improve existing tool pages.** Smallest UI change, but command ordering and
   cross-tool state interpretation remain the user's responsibility.
3. **Strict linear wizard.** Useful for first intake; poor fit once reconstruction
   branches or a partial validation must resume. Use a short intake wizard only.

## Information architecture

Global home: project list, new-project action, recent activity, and setup blockers
that affect the chosen task. Do not rerun setup on every visit.

Inside a project:

- **Overview:** next action, blocker, compact pipeline, current activity and
  evidence dimensions. Completed input details collapsed.
- **Reconstruction:** feature/checklist slices, proposed/applied changes and
  relevant plans; explicit selected export/library-stage/migration-stage identity.
- **Resources:** build/splits, asset/script inspection and dependency requirements.
  Local catalog links to global library management.
- **Verification:** source integrity, Unity compile, binding scope, gameplay and
  original-image comparison as independent results with freshness.
- **Activity & evidence:** filtered durable history and operation detail, including
  GUI/CLI/MCP provenance, logs and receipts. Raw JSON secondary.

Project header: project switcher/name, artifact branch, activity/ownership summary,
harness selector and Open Agent. Global library manager and Settings live below
project navigation. Advanced tools retains the current command surface without
becoming the default landing page. Engine names remain useful secondary labels.

## Primary flows

### New project

Home → choose APK/XAPK/APKS/AAB/ZIP → name and inspect input → review preparation
policy → create and prepare → project dashboard. The mockup uses example inputs;
production inspection must use the real intake result and does not invent a
pre-intake capability. If inspection requires extraction, represent it as a real
job after reserving the project, and retain that project on incomplete input.

Default ABI selection stays in Node. Advanced controls expose manual selection,
symbol plan/apply policy, explicit RVA/VA, storage and optional baseline validation.
Do not infer address mode. Surface only options relevant to the selected task.

Missing inputs → explain observed gap → discover LDPlayer devices → explicitly
select device/package → verify installed build identity → show capture scope →
pull through the supported route → re-inspect input. Never auto-select the first
device/package. Missing IL2CPP alone does not prove missing splits; distinguish
Mono/unsupported builds and uncertain remote/PAD content.

### Return to a project

Open → observe current state → show one primary next action. Active job: View
progress. Actionable blocker: Resolve blocker. Current prepared output: Open
Agent / continue saved task. Interrupted/uncertain write: Inspect operation first.
No saved task: request task through the harness; do not infer whole-game work.

Read-only navigation and evidence remain usable while a workspace is occupied.
Only conflicting mutations are blocked, with owner/job explanation. Readiness
recommendations must reflect evidence freshness; never infer success from a PID,
exit zero or absence of a lock. Revalidate state when submitting an action.

### Agent

Choose Codex, Claude, Gemini or OpenCode → inspect availability → launch with
project context/MCP → show observed launch state. Preserve existing login and
permission behavior. Link to session logs/context. A launch failure provides
cause and a new-launch action after correction, not a generic operation retry.

Keep these distinct: terminal requested, harness process started, exited/failed,
MCP connection unknown/observed, watcher waiting with transport ready, notification
queued, agent resumed unverified. Existing terminal-status files do not attest
MCP connectivity. Codex continuation must meet the real arming predicate; other
harnesses must not display automatic wake as supported. The UI is not embedded
Agent chat and cannot silently send a new task into another session.

### Long task / recovery

Show operation, stage, elapsed time, latest observation and actual coverage/counts.
If the workload is unknown, use indeterminate progress with named stage; no invented
percentage/ETA. Expand into a right-hand detail panel with timeline, diagnostics,
owned lock, artifact paths and full receipt reference. Do not equate quiet logs
with a hung job. Do not use a Cancel button until owned termination is supported.

For uncertain writes, Inspect outcome is primary; replay remains unavailable
until supported recovery establishes what happened. Resume only for operations
whose backend supports it, with original scope preserved. GUI reopen reconnects
to durable observations; in-memory command history that cannot be recovered is
explicitly incomplete, not displayed as no activity.

### Verification / handoff

Select candidate branch and scope → inspect or run supported checks → report
each dimension with source/build identity, scope, coverage and freshness. A
library-stage pass never marks the selected export verified. A partial binding
result links to completed/pending counts and supported resume. Original captures
are distinct from fixture baselines. Missing reference imagery leaves fidelity
unverified. Jev transmission remains a deliberate configured action.

## Observation and interaction contract

Build a read-only project view model above existing services. Preserve raw source
records. Bind every row to project, run/operation ID and candidate branch; retain
observation time, origin, freshness, available action and limitation. Reconcile
desktop enqueue and durable worker using exact IDs; do not merge by label/time.
Missing linkage is shown separately. Global counts must name their scope.

Poll only visible/active observations; back off when hidden. Preserve expanded
details, keyboard focus, filters and scroll on updates. Switching project clears
unrelated selections or keeps them only in an explicitly global history route.
Restore last project and route; reopening must not start a mutation.

Status vocabulary: Not started, Running, Waiting for input, Needs inspection,
Verified for scope, Partial, Failed, Stale, Unverified. Each needs text/icon as
well as color. Failed and Unverified are different. Do not compress readiness
into a single green project badge or an overall game-completion percentage.

Typed actions inherit workspace identity. Saved plans, operations and assets use
selectors with readable names plus IDs in details. Validate locally for feedback
and revalidate through typed IPC/service guards. Display the affected candidate,
scope and concrete plan before any new approval actually required by task policy.
Keep existing authorization; do not add approval gates to routine authorized work.

## Layout and accessibility

Target 1366 x 768 first, also check 1280 x 720 and 1600 x 1000. Main heading,
next action and active status must fit above the fold at the primary size.
Use a 224 px sidebar, compact project header, main content and optional detail
drawer. Collapse secondary columns on smaller windows; keep a single main scroll
region rather than stacked nested scrollers. Do not hide information solely in
hover states. Menus/dialogs need keyboard access, Escape, focus restoration and
visible focus; disabled actions explain why. Announce state changes sparingly
without repeating every polling update. Respect reduced motion and text scaling.

## Rollout and acceptance

1. Project shell, contextual Overview, scoped state and Advanced escape hatch.
2. Unified observation/history, operation detail and honest Agent states.
3. Intake/recovery wizard and typed resource/verification forms.

Reuse backend capability boundaries. Persisted desktop history and additional
session observation require backend work; they are not solved by a visual redraw.
Deliver UI tests with fixtures: empty/new project, selected ABI, active worker,
missing split, uncertain source apply, partial scoped validation, stale receipt,
different candidate branch, failed harness launch and Codex notification queued.

Acceptance: users can find the current blocker and its action on Overview without
scrolling through completed setup; jump from any page to the relevant job detail;
never see a prior project's result labelled as the current one; reopen without
restarting completed work; distinguish package imported from integration verified
and notification queued from Agent resumed. Verify navigation, keyboard/focus,
1366 x 768 layout and source/branch-bound evidence. Test production adapters
separately from mockup interactions. No game-readiness claim follows from this UI.

## Mockup boundary

The companion uses illustrative project data and simulated interactions only.
It covers project navigation, intake, scenario switching, job detail, harness
selection, launch failure/notification states and validation dimensions. It has no
REToolkit IPC, filesystem/project mutation, engine launch or network AI request.
Counts, paths and timestamps shown there are not GoodSort3D observations.

## Prototype review performed

Browser checks on 2026-10-23: 1280 x 720, 1366 x 768 and 1600 x 1000 had no
horizontal overflow on Overview and kept the primary next action above the fold.
All eight project/system routes opened at 1366 x 768. The job drawer aligned to
the content's right edge; Escape closed it and restored focus to the opener.

Interaction review covered empty intake validation, the three intake steps,
explicit device/package selection, uncertain apply without a replay control,
Codex watcher ready versus queued, no Claude wake control, simulated launch
failure, activity filtering and Settings tabs. A stage-switching review found and
fixed inherited original-export counts; stage views now remain unverified.
Missing-input and uncertain-outcome scenarios also suppress current verified
readiness claims. A visual review found and corrected the drawer's initial left
alignment. A final JavaScript parse check passed. No production adapters were
exercised by these prototype checks.

Local review artifacts:
`.cache/gui-ux-review/a33667b6-7daa-474a-9d88-2f2eb7faa36b/review.json` and
`screenshots/overview-1366.png`, `screenshots/job-detail-1366.png` beneath the same
review directory. The HTML is standalone and remains viewable without the local
companion server. Broader accessibility and user-task testing remain acceptance
work for production implementation; this is not an exhaustive WCAG audit.
