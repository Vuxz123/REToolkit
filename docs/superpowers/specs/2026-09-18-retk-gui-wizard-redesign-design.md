# REToolkit GUI: Step-Wizard Redesign

## Problem

`scripts\retk-gui.ps1` currently presents every command as a flat stack of
GroupBoxes (Setup, Skills, Pipeline, Ghidra, Workspace, Extras) with ~20
buttons visible at once, all enabled/disabled only by whether a workspace is
selected. A first-time user opening the GUI sees the entire command surface
at once with no indication of what to do first, what order things go in, or
what each button is for. There is no guided path through the actual pipeline
(Setup → create/select workspace → prepare a build → open Ghidra → inspect
results).

## Goal

Restructure the GUI into a 5-step wizard (a step rail + a single-step content
panel) that guides a user through the pipeline in order, while keeping every
existing command reachable and keeping the log/status bar/raw-command bar
always visible regardless of which step is active. No `re.ps1` command
behavior changes — this is presentation-only.

## Non-goals

- No changes to `re.ps1`, any `scripts\retk-*.ps1` pipeline module, or command
  semantics.
- No new commands. Every button maps to the same `re.ps1 <verb>` invocation
  it does today.
- No enforcement beyond soft step-gating (see below) — the raw command bar
  at the bottom remains available at all times as an escape hatch for any
  command regardless of step state, unchanged from today.

## Step definitions

Steps are shown in a narrow step-rail on the left; only one step's content
panel is visible at a time in the main content area to its right.

1. **Setup** — `Doctor` button (existing `doctor` verb) plus the existing
   Skills section verbatim (3 install buttons for Claude Code/Codex/OpenCode
   + status label), unchanged from the current implementation.
   - *Complete when:* the background health check
     (`Start-RetkGuiHealthCheck`, already implemented) has finished at least
     once (label text is no longer "Checking tools..."), regardless of
     whether it found issues. A missing optional tool must not block
     progress, since not every workflow needs every tool.
2. **New workspace** — the workspace selector combo (moved here from the top
   bar) + `Refresh` + `New workspace` button, unchanged verbs
   (`init`)/behavior.
   - *Complete when:* a workspace is selected in the combo
     (`Get-SelectedGameName` returns non-null). Picking an existing workspace
     satisfies this the same as creating a new one.
3. **Prepare Build** — two visually distinct groups in one panel:
   - "Automatic" (prominent, top): the `Flow` button (`flow` verb).
   - "Manual" (smaller, below): `Add build` / `Scan` / `Dump` buttons
     (`add`/`scan`/`dump` verbs), unchanged.
   - *Complete when:* the selected workspace's `project.re.json` has
     `status.dumped -eq $true`. This is set by both `Run-Il2CppDumper`
     (manual `dump`) and `Run-FullFlow` (`flow`, which calls the same
     function internally) — confirmed by reading
     `scripts\retk-pipeline.ps1`. Do NOT gate on `status.imported`: that flag
     is only ever set by `Run-FullFlow`, so gating on it would permanently
     lock out anyone using the manual Add/Scan→Dump path, since the GUI has
     no standalone "import into Ghidra" button today.
4. **Ghidra** — `Open (PyGhidra)` / `Ghidra GUI` / `Analyze` / `Symbols`
   buttons, unchanged verbs (`open`/`ghidra-gui`/`analyze`/`symbols`).
   - *Complete when:* `status.imported -or status.analyzed -or
     status.symbolsApplied` is true. Nothing is gated behind this step today,
     so the exact criterion is informational only (drives the step rail's
     checkmark, not a lock).
5. **More** — everything else, unchanged verbs, grouped under two inline
   sub-headings inside the single step panel (not separate steps/tabs):
   - "Workspace": `Status` / `Notes` / `Candidates` / `Context` / `Summary` /
     `Export` / `Import`.
   - "Extras": `AssetRipper CLI` / `Pull LDPlayer`.
   - No completion criterion (terminal step, nothing gates behind it).

## Gating rules

- Steps are locked in order: step N+1 is only clickable in the step rail once
  step N's completion criterion (above) is true for the *currently selected
  workspace*. A locked step's rail entry is disabled (grayed, non-clickable)
  and shows a lock indicator.
- Re-evaluate every step's completion state (and therefore the rail's
  locked/unlocked/checked rendering):
  - once, right after `Start-RetkGuiHealthCheck` finishes (step 1),
  - whenever the workspace combo's selection changes (steps 2-5, since they
    all read the newly-selected workspace's `project.re.json`),
  - whenever `Set-RunningState` toggles back to not-running (i.e. after any
    command finishes), mirroring how `Update-WorkspaceButtonsEnabled` and
    `Update-RetkGuiSkillsStatus` are already invoked from there today.
- Switching workspaces does not reset which step panel is currently visible;
  it only recomputes lock/check state against the newly-selected workspace.
  If the currently-visible step becomes locked as a result (rare: only
  possible by switching to a less-progressed workspace), the view does not
  auto-jump — the user can still see that panel's buttons, they are simply
  disabled the same way `RequiresWorkspace` buttons already are when no
  workspace is selected. Only the step *rail* enforces the lock (you cannot
  click into a locked step); it does not retroactively hide a panel already
  in view.
- The raw-command bar at the bottom (`rawCommandBox`/`runRawButton`) is
  unaffected by step gating — unchanged from today.

## Layout / technical approach

- The existing `leftPanel` (currently a single `FlowLayoutPanel` holding all
  6 GroupBoxes stacked, itself inside `SplitContainer.Panel1`) is replaced by
  a new `TableLayoutPanel` with 2 columns inside `SplitContainer.Panel1`:
  - Column 1 (fixed ~150px): the step rail — 5 buttons stacked
    top-to-bottom, one per step, each `Text` set to `"<n>. <Title>"` plus a
    suffix indicating state (`" ✓"` complete, `" \U0001F512"` locked, or
    plain for the current/available-but-incomplete step). The current step's
    button gets a distinct visual (e.g. bold font or a different
    `BackColor`) so the user can see where they are.
  - Column 2 (fill): a container `Panel` holding all 5 step-content panels
    stacked on top of each other (`Dock = "Fill"` on each, added in the same
    Z-order every time), with exactly one `.Visible = $true` at a time.
    Toggling `.Visible` (never destroying/recreating controls) keeps this
    change low-risk against the existing, carefully-debugged event-wiring
    (button click closures, `$global:AllActionButtons` membership, etc.).
- Existing groups (`Setup`/`Skills`/`Pipeline`/`Ghidra`/`Workspace`/`Extras`)
  keep their current internal construction
  (`New-RetkGuiGroup`/`Add-RetkGuiButtonToGroup`) — they are only
  *re-parented* into the appropriate step panel and, for step 3, visually
  split into "Automatic" vs "Manual" sub-areas within the Prepare Build
  panel. `Add-RetkGuiButtonToGroup`, `$global:AllActionButtons`,
  `$global:WorkspaceButtons`, `Set-RunningState`, and every button's
  `-OnClick` scriptblock are unchanged.
- New function `script:Update-RetkGuiWizardState` (mirrors the existing
  `Update-WorkspaceButtonsEnabled`/`Update-RetkGuiSkillsStatus` pattern):
  recomputes each step's complete/locked state from
  `Read-Project`/`project.re.json` (guarded by `try/catch` — a workspace
  mid-creation or with a malformed/missing `project.re.json` must not crash
  the GUI, just render that step as not-complete) and updates the 5 rail
  buttons' text/enabled/style accordingly. Called from the same 3 triggers
  listed under Gating rules.
- New pure/testable helper `Get-RetkGuiWizardStepStatus` (top-level function,
  alongside `Format-RetkGuiElapsed`/`Test-RetkGuiDoctorHasIssues`/etc.): given
  a `$project` object (or `$null` when no workspace is selected) plus the
  step-1 health-check-done flag, returns an array of 5
  `[pscustomobject]@{ Index; Title; Complete; Unlocked }` records. Keeping
  the pure status computation separate from the WinForms rendering code
  makes it unit-testable the same way `Test-RetkGuiDoctorHasIssues` is today.
- The top bar (`$topPanel`) keeps `Refresh` and `Open folder`; the workspace
  combo (`$workspaceCombo`) moves into the step 2 panel. `$topPanel` itself
  can stay `Dock = "Top"` and simply lose the combo control — `Refresh`/`Open
  folder` still act on whatever workspace is currently selected via
  `Get-SelectedGameName`, unchanged.

## Current-step tracking and initial state

- A single `script:` variable (e.g. `$script:CurrentWizardStep`, an int 1-5)
  tracks which step panel is visible. The step-rail buttons' `-OnClick`
  handlers set this variable, toggle `.Visible` on the 5 content panels
  accordingly, and re-render the rail (for the bold/highlighted "current
  step" treatment) — they do not call `Update-RetkGuiWizardState`, which
  only recomputes complete/locked state, not which panel is showing.
- The GUI always opens on step 1 (Setup) regardless of whether a workspace
  with further progress already exists. This keeps the startup path simple
  (no "resume where you left off" heuristic to get wrong) — a returning user
  with an already-far-along workspace just clicks through the already-
  unlocked/checked steps, which is fast since nothing blocks them.

## Testing

- Unit-test `Get-RetkGuiWizardStepStatus` with real-execution assertions
  (per this repo's TDD convention for pure helpers): no project (step 2
  incomplete/steps 3-5 locked), a project with `status.dumped = $false`
  (step 3 incomplete, step 4 locked), a project with `status.dumped = $true`
  (step 3 complete, step 4 unlocked), and a project with
  `status.imported = $true` (step 4 shows complete).
- Extend the existing static-assertion block in `tests\retk-gui.Tests.ps1`
  (matching its documented mixed style) to confirm the step-rail buttons,
  `Update-RetkGuiWizardState`, and the re-parented groups still wire every
  verb string the current assertions already check for (`'add'`, `'scan'`,
  `'dump'`, `'flow'`, etc.) — the existing per-verb `Assert-Contains` loop
  keeps working unmodified since the button `-OnClick` scriptblocks are
  unchanged text.
- Manual verification (as done earlier this session): launch
  `scripts\retk-gui.ps1` directly, screenshot via `PrintWindow` (not
  full-screen capture, to avoid ever recapturing an unrelated window on this
  multi-monitor machine), and click through all 5 steps with a real
  workspace to confirm gating/checkmarks track actual `project.re.json`
  state.

## Risk / rollback

This only touches `scripts\retk-gui.ps1` (plus its test file). Every existing
button's verb, click handler, and the single-command-at-a-time
`Invoke-GuiCommand`/`Invoke-RetkGuiCommand` machinery are untouched — the
change is purely how those same buttons are grouped and shown/hidden. If the
wizard framing turns out to be wrong, the previous flat-GroupBox layout can
be restored by re-parenting the same groups back into one `FlowLayoutPanel`
without touching any command logic.
