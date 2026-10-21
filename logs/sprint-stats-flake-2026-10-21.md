## 2026-10-21T07:28:16Z — LAI-841

Two builders worked this task in the worktree `Laika-sprint-stats-flake`, on
branch `LAI-841-sprint-stats-flake`, both dispatched by CHIEF on the owner's
instruction. A Codex builder claimed the task, investigated it, fixed it and
filed the follow-ups. It stopped at its usage limit while its fifth root gate
was running. A Claude Code session then took over to verify the fix, gate
it, move the task to review and open the PR. It changed no code.

**What changed**
- server/web/test/browser/board-sprint-stats.test.ts — `5114a6f7` (Codex).
  The crowded-row and pill cases now set their viewport in `open`'s `before`
  hook, before navigation, instead of resizing afterwards. `openSidebar`
  waits for the collapsed 60px rail, asserts that no sidebar preference is
  stored, clicks, then waits for `aria-expanded=true` and 212px. Before, it
  read the toggle once and accepted any 212px width.
- .tasks/review/LAI-841-board-sprint-stats-sidebar-flake.md — cause, the
  controlled reproduction, the 20-run and load proof, all five root gates,
  the handover verification and the result. All four criteria ticked.
- .tasks/backlog/LAI-846-my-day-browser-sidebar-state.md — filed, plus the
  wider-font failure seen in the third gate.
- .tasks/backlog/LAI-847-build-idempotence-test-time-bound.md — filed, plus
  the fourth gate's repeat, the second isolated rerun and the third gate's
  occurrence.
- .tasks/backlog/LAI-848-project-status-migration-tests-under-load.md — filed.
- logs/sprint-stats-flake-2026-10-21.md — this entry.

**Decisions**
- Fixed the test setup, not the app. The app collapsing a narrow window when
  the media query changes is correct behaviour (`sidebar-state.ts:51-52`).
  The test read the state before that change arrived.
- Set the viewport before navigation *and* made the helper wait for the
  collapsed rail before it clicks. The first removes the in-flight media
  change. The second means a resize-after-navigation caller would wait the
  change out instead of accepting the old layout. The alternative, keeping
  the resize and only adding the wait, leaves a setup that depends on
  ordering in a way the next reader cannot see.
- The handover left the fix as Codex wrote it. The diff, the controlled
  reproduction and 26 green full-file runs (20, plus 1 under load, plus 5)
  gave no reason to rewrite it.
- The handover did not run Codex's `/tmp/lai841-finalize.py`. Its only
  check is that `/tmp/lai841-gate-exits.txt` reads all zeros. It does not
  check which run or which tree wrote that file. If the check passes, it
  writes prose already composed for a green gate into the task file and
  the log. While the fifth gate ran, that file still held the fourth run's
  `TEST 1`.
- `VITEST_MAX_WORKERS=2` for the root gates after the fourth. Four runs with
  the default pool went red in files this change does not touch, under load
  of 20 to 97 with other builders gating. The bound changes no assertion,
  timeout or file set. It is recorded wherever a gate result is quoted.
- Ticked the gate criterion on the fifth run (`TEST 0`, `LINT 0`, `FMT 0`)
  and ran one more root gate on the final tree before pushing. That run's
  exit codes are on the PR and the card, not in the task file, because
  recording them there would be an edit after the gate.

**Discovered**
- The My day browser tests resize across the 1180px band and read the
  sidebar toggle once (`my-day-v2.test.ts:907`, `:955`, `:1025`) → LAI-846
  filed (discovered-from: LAI-841). The third gate also failed the
  wider-font case at 1440px. That is not proven to be this race.
- Build idempotence failed its 120000ms bound in the first, third and fourth
  root gates (130757ms, 194554ms and 138733ms) and passed alone each time →
  LAI-847 filed (discovered-from: LAI-841). **The third occurrence was not
  in Codex's record.** pnpm bailed on web before the server summary printed,
  so only the case's `×` line survives (`/tmp/lai841-third-gate.txt:18397`).
  A census of the log found it.
- Two project-status migration cases failed in the second gate, with no
  error text surviving pnpm's bail, and passed alone → LAI-848 filed
  (discovered-from: LAI-841).
- The CLI sync-abandonment failure in the second gate is the existing
  LAI-801. No duplicate filed.
- `Laika-editor-guard`'s branch is named `LAI-848-editor-round-trip-guard`,
  but its task file is LAI-849, filed four minutes after this branch's
  LAI-848. The ids do not collide. The branch name ties that session's
  tokens to the wrong card if the board reads the id from the branch
  (D-084). That is noted here, not filed: it belongs to that session.
- The gate's own grep matches the test name `completeSetup and fieldErrors`
  on `Errors`. It is a harmless false positive, but worth knowing before
  reading one as a failure.
- No fixed port and no manual instance. Browser fixtures own their loopback
  stub servers on OS-assigned ports. localhost:3000 and production were not
  touched.

**State**
In review: PR against master, card LAIKA-632 in Review. CHIEF owns the merge
and the follow-ups.

## 2026-10-21T07:28:16Z — session end

**What changed**
- Nothing beyond the LAI-841 entry above.

**Decisions**
- Stayed scoped to LAI-841. The follow-ups are filed, not fixed.

**Discovered**
- Nothing beyond the LAI-841 entry above.

**State**
Session ending clean once the final-tree gate is green and the branch is
pushed. Next for CHIEF: review LAI-841, then triage LAI-846, LAI-847 and
LAI-848. LAI-847 is the most likely to redden a busy gate.
