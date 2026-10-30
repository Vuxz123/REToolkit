// Shared by fresh launches, exact-session resumes and queued continuations.
export const quietReminder='Work quietly within saved authorization; continue actionable work instead of stopping at a checkpoint. Report briefly when finished or genuinely blocked; preserve logs, evidence and verified job continuation.';

export const quietExecutionPolicy=`## Quiet execution

Keep working within the saved authorization until its acceptance criteria are met,
the user pauses/cancels, or a real blocker requires external input or approval.
Do not end at an intermediate checkpoint, successful apply/compile, checklist
update or proposed next step while authorized actionable work remains.

Do not narrate reasoning, routine plans, tool calls, polling or repeated results.
Use brief updates only for a blocker needing user action, a scope decision, or a
material result. Follow harness/platform instructions; keep required progress updates to one short sentence.
Answer direct user questions briefly, then resume authorized work.

Keep detailed logs, progress, job IDs and evidence in toolkit jobs and the saved
checklist, not repeated chat summaries. Quiet output must not suppress errors,
uncertainty or requests for genuinely missing permissions. Preserve all gates.
For background work, keep waiting or verify a durable continuation before ending;
a promise to continue does not wake an agent. Do not retry uncertain mutations.

When finished, report the result, remaining blockers/unverified criteria and
evidence paths briefly. If blocked, state the exact missing input/action and
resume condition. Never report gameplay complete from compile/binding alone.
`;
