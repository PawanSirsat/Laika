## 2026-10-21T07:20:00Z — ops (board and task-file bookkeeping)

Approved by the owner for today. Worktree `Laika-bookkeeping`, branch
`chief-ops-board-bookkeeping`, cut from master `d36d2ee5`. No application code
was touched.

**What changed**
- `.tasks/done/LAI-740-connect-wizard.md`,
  `.tasks/done/LAI-741-connect-wizard-fixed-rail-and-optional-entries.md`,
  `.tasks/done/LAI-742-connect-wizard-review-follow-ups.md`: moved from
  `review/` (move first, then edit), `status: done`, and an accept note each.
  `finished:` was already set on all three. Commit `7ee9a9a7`. Evidence: the
  build commits `88b1ecf7`, `1f7f1ec4` and `e1de1a0c` are on master's
  first-parent line (2026-10-12), and all 13 files LAI-740 names exist at
  `d36d2ee5`.
- `.tasks/backlog/LAI-852-start-working-not-found-on-an-outside-id.md`: new
  task, area server, p2, discovered-from LAI-818. Commit `5e6fde42`.
- Board (project `laika`), with no card set to Done:
  - LAIKA-622 (LAI-822) and LAIKA-632 (LAI-841): Backlog to In progress, with
    a comment naming the branch. `start_working` was not called.
  - LAIKA-351, 352, 353 and 354 (LAI-264, 289, 613, 618): comment only.
    Status stays Cancelled; see Decisions.
  - 14 cards created for task files that had none: LAIKA-641 to 654. 641, 642
    and 643 (LAI-758, 766, 775, all in `done/`) are in Review. The other 11
    are in Backlog.
  - LAIKA-655 created for LAI-852.

**Decisions**
- **LAI-264/289/613/618 stay Cancelled.** The brief said to move them to
  Review because Cancelled "looks wrong". It is right. `92673b6e` closed all
  four unbuilt, superseded by D-077. Each file carries `closed:` and not
  `finished:`, and its closing section says "Closed, not done. Nothing was
  built from this file." Review would put work in front of Pawan that was
  never built. I commented and did not move them.
- **Nothing was created for LAI-046 or LAI-100.** Each id has two files, and
  each file already has a card: LAIKA-88 and LAIKA-382 for LAI-046, LAIKA-70
  and LAIKA-71 for LAI-100. Those cards carry no `external_ref`, because the
  LAI-780 backfill skips a title two cards share by design. That is why
  `get_task_context LAI-046` says not found. Creating cards would have made
  duplicates.
- **Duplicate check beyond `external_ref`.** I read the 104 board keys that no
  `LAI-NNN` maps to (LAIKA-454 to 556, and 564). None has a `LAI-NNN` title
  and none has an `external_ref`, so none of the 14 new cards duplicates an
  unlabelled one.
- **Review cards go through In progress.** The board refuses Backlog to Review
  (allowed from Backlog: todo, in_progress, cancelled). The three Review cards
  therefore carry `started_at` from today. That timestamp is bookkeeping, not
  work.
- **LAI-852, not LAI-850.** The first §3 sweep gave LAI-850. The re-run just
  before the commit found LAI-850 and LAI-851 filed on
  `LAI-832-contributors-capacity-follow-ups` in between. The file was still
  untracked, so it was renamed before any commit carried the wrong id.

**Discovered**
- `start_working LAI-818` answering not found cannot come from the MCP path on
  master for one token. Both tools call `resolveTaskRef(db, task, actor)`
  (`server/src/mcp/write-tools.ts:311`, `server/src/mcp/read-tools.ts:257`,
  same commit `7ab1ca44`) and then the same `requireTask`
  (`server/src/services/tasks.ts:465`). REST `POST /tasks/:id/claim` passes
  the segment unresolved (`server/src/http/routes/tasks.ts:292`). LAI-800
  covers REST GET only (`LAI-800-rest-task-by-key.md:20`). Filed as LAI-852
  (discovered-from: LAI-818).
- The branch `LAI-848-editor-round-trip-guard` holds task **LAI-849** in
  progress, while LAI-848 is a different file on `LAI-841-sprint-stats-flake`.
  The branch name ties that session's tokens to the wrong card (D-084). Not
  filed: it is the builder's to rename or explain. Neither id had a card
  checked here, because both are outside the LAI-843 to 847 scope.
- Every SHELL review task (LAI-266 to 609) is on master, but several were
  superseded afterwards. LAI-739 replaced the columns UI, LAI-727 removed the
  sprint strip and the WORKING NOW row, LAI-481 reversed LAI-293's rail
  naming, and LAI-606 reversed LAI-603's one-colour count. Recommendations
  are in the PR description. Nothing was moved.
- LAI-807 names `day-timeline.ts`, which LAI-831 deleted (`4992bda0`). Its
  successor, `timeline-derive.ts`, already places blocks by instant in the
  day's zone and has a fall-back day test. What is left of LAI-807 is a
  spring-forward test and a block crossing midnight.
- The board rate-limits a token at about two calls a second. The census of
  547 ids needed retries throughout, and none was recorded as a result.

**State**
PR open against master, not merged. Checks: `task-file-state`,
`estimate-backtest` and `schema-spec-drift` each exit 0 after the last edit.
CI runs the full gate on the PR.
