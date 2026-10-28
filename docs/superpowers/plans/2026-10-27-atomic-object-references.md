# Atomic ObjectReference data comparison

Fix SS2's eight false m_Script.m_FileID differences without changing raw game
data, baseline snapshots, historical receipts or accepted gameplay state.

- [x] Change fixed collector to scriptable-data-v2: capture persistent parent
  ObjectReference GUID/local fileID and skip its transport children. Preserve
  arrays, structs, managed references and ordinary fields named m_FileID.
- [x] Add explicit versioned atomic reference comparison. Legacy v1 remains
  exact by default for historical receipts. Atomic projection requires a real
  ObjectReference parent with persistent identity; real GUID/fileID changes,
  orphan children and user fields remain differences. Report excluded counts.
- [x] Permit data.verify with explicit reuseVerificationId for a canonical,
  complete, closed-Editor data packet on the exact unchanged candidate/build/
  asset scope. Recheck original qualification and helper versions, record new
  comparison policy and immutable receipt, keep old values/results unchanged.
  No Editor run, fresh baseline, scope reduction or mutation replay.
- [x] Cover legacy helper compatibility, stale/tampered observations, changed
  references, v1/v2 mixed comparison and actual C# helper iterator behavior.
  Run regressions/review, then re-evaluate the selected SS2 packet if eligible.
  Append ledger evidence without claiming workflow/gameplay completion.

Validation: 269 related tests passed with no skips/failures; independent review closed with no outstanding P1/P2. Actual SS2 durable reanalysis job 3777dcbd-9f01-48f7-91f2-9bd9ff67b507 verified 0 differences/dataPreserved:true. Workflow data acceptance rechecked true; 20 historical files and 16 current asset files unchanged; project revision unchanged; no Engine executed. New receipt 1706eaea-55c5-47a8-83d5-a90c0faae1d6; gameplay unverified.
