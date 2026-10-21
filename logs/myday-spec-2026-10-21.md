## 2026-10-21T06:26:58Z — LAI-836

A builder CHIEF dispatched, writing CHIEF's docs half on its behalf, in the
temporary worktree `Laika-myday-spec` on `LAI-836-my-day-v2-spec`. It started
no server and used no port.

**What changed**
- docs/SPEC.md — new §4.55 `time_breaks` and §4.56 `time_undo`. In §6.4's
  endpoint block: the draft `PATCH` gains `started_at?`/`ended_at?`,
  `GET /me/time` names breaks and drafts held, and `POST /me/time/undo` and
  `POST /me/time-breaks` are new lines. §6.4's Time prose: My day's `breaks`
  and `drafts_held`, edges on both `PATCH`es, one entry per block on
  re-confirm, and three new bullets (by the clock, Undo, Breaks). §11.6:
  both tables in time retention.
- server/test/tooling/schema-spec-drift.test.ts — the two
  `TABLES_NOT_IN_SPEC` entries for `time_breaks` and `time_undo` removed (the
  task's one named crossing).
- .tasks/backlog/LAI-844-spec-time-rows-outside-lai-836.md,
  .tasks/backlog/LAI-845-break-accepted-for-a-day-retention-deletes.md — filed.
- .tasks/review/LAI-836-spec-for-my-day-v2-server-additions.md — claimed,
  then finished with a Result section.

**Decisions**
- Wrote what the code does, not what LAI-831's *Server changes* says. Undo
  takes `{ id }` from `X-Undo-Id`, not `{ draft | entry | day }`, and it has
  `409 newer_change`. That list was written before review round 1 and never
  updated. The disagreements are listed in the task's Result.
- Described the by-the-clock rule (`409 overlaps_confirmed`) in §6.4 although
  LAI-836's list did not name it. It is LAI-831's addition, and it changes
  confirm, *Confirm day* and a timed entry's create, which §6.4 already
  describes. Leaving it out would have made those paragraphs wrong by
  omission.
- Did not touch §3.1, §3.4, §11.4.2 or the `POST /me/time-entries` body line,
  though each now says less than the code. They were outside the task's named
  sections, so I filed them as LAI-844 rather than widening a docs task by
  myself.
- §4.55/§4.56 never use the word `nullable`. `statedNullability` would read
  "not nullable" as *nullable* (`\bnot\s+null\b` does not match before "able"),
  and every column of both tables is NOT NULL.

**Discovered**
- `POST /me/time-breaks` accepts days back to today − 365, because it uses
  the entries' `assertEntryDay`, and `pruneTime` deletes breaks after 30
  days. A break on an older day is accepted with `201` and gone the next day.
  → LAI-845 filed (discovered-from: LAI-836).
- §3.1, §3.4 and §11.4.2 name the Time endpoints and the prune job without
  LAI-831's additions. §6.4 has never listed `POST /me/time-entries`'
  `started_at`/`ended_at` (there since LAI-787) or the entry `PATCH` body.
  → LAI-844 filed (discovered-from: LAI-836). LAI-793, still in backlog, asks
  for a My day §11.4.2 row that now exists on master. CHIEF may want to close
  it or fold it into LAI-844.
- No guard reads §6.4 or §11.6. Every SPEC reader was swept: schema-spec-drift
  (§4), parity and plugin-mcp (§7.1/§7.2), policy-spec-drift and
  policy-matrix (§3), errors (§6.3), env-contract (§11.7), context-copy
  (§7.3). The §6.4 and §11.6 text is checked by reading alone.
- `heldDrafts`' docblock says it counts what the switch deletes. The switch
  also deletes dismissed drafts, which it does not count. That comment is
  CORE's; I noted it in the Result and did not file it.

Gate on `9f88ce9d`. Run 1: `TEST 1`, `LINT 0`, `FMT 0`. It failed under
load average ~16–35 in `cli` `activity-lookback`, `server/web` `my-day-v2` and
`server` `response-type-coverage`, and `pnpm -r` bailed before `server` and
`server/web` summarised. Each file alone afterwards: green. Run 2: `TEST 0`,
`LINT 0`, `FMT 0`, with all three workspaces summarised (server 3375 passed,
web 2630, cli 533). CHIEF had to wake me: I ended a turn waiting on a
monitor while run 1 was still going. A subagent's turn is not resumed by a
background notification, so block on the gate instead of yielding.

**State**
In review (`.tasks/review/`). The branch push, the PR against master and the
card's `finish_task` come right after this commit. Nothing blocked. The two
`TABLES_NOT_IN_SPEC` removals land with the SPEC in this one branch.
