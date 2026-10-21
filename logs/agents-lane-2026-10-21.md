## 2026-10-21T12:20:54Z — LAI-833

On the owner's direct instruction (*"do it what is needs to do"*). A Claude
Code session dispatched by CHIEF built it, in the worktree `Laika-agents-lane`
on `LAI-833-agents-lane`, on top of LAI-834 (PR #8) and with LAI-822 (PR #5)
merged in for its migration.

**What changed**
- server/src/db/schema.ts, server/src/db/migrations/0046_agent_time_buckets.sql
  and meta/0046_snapshot.json, meta/_journal.json — the new table.
- server/src/services/agent-time.ts — `spreadActive`, `storeAgentBuckets`,
  buckets dropped with a left-out session, and `agentDay(…, tz)`'s `lane`.
- server/src/services/token-telemetry.ts — each `cli` point's seconds are
  spread over its interval.
- server/src/services/local-activity.ts — deleted with the history.
- server/src/jobs/jobs.ts — kept 40 days.
- server/src/services/my-day.ts — passes the zone.
- server/test/services/agent-time-lane.test.ts — new.
- server/test/services/my-day.test.ts — the agent section is three queries.
- server/test/tooling/schema-spec-drift.test.ts — the table has no `id`.
- server/test/db/schema.test.ts — the table is in `EXPECTED_TABLES`.
- server/web/src/api/time.ts — `MyDayAgent.lane`.
- server/web/src/routes/screens/my-day/timeline-derive.ts — `AgentRun` and
  `DayLine.agents`.
- server/web/src/routes/screens/my-day/Timeline.tsx — the AGENTS row, label
  and legend; lane labels as one flex column.
- server/web/src/routes/screens/my-day/my-day.css — label column and agent bars.
- server/web/test/routes/screens/my-day/agent-runs.test.ts,
  server/web/test/browser/my-day-agents.test.ts — new.
- docs/SPEC.md — §4.57 and §11.6.
- .tasks/review/LAI-833-agent-time-has-no-time-of-day.md, and this log.

**Decisions**
- Five-minute buckets, not the fifteen the task suggested: the same grain as
  the SIGNALS lane, and still nothing about content.
- Keyed by absolute bucket, not by day. A day's lane is one indexed range in
  any zone, the UTC day widened fourteen hours each side, with each bucket
  kept where its start falls. That avoids midnight arithmetic, and is right on
  a clock-change day.
- Seconds are spread over a point's interval in proportion. Seconds past the
  interval are put in the stretch before its end, and the upsert stops at 300.
  So a bad point or a restarted process can never trip the CHECK and refuse a
  telemetry upload.
- Only `type=cli`, the agent working. The keyboard stays minutes in the
  right column.
- On a card = the session's own split (§4.51), the same rule as the agent
  minutes per card. No new attribution was invented.
- Kept 40 days, by the existing `SESSION_DAYS_KEPT`. The totals keep their
  400.
- LAI-822 merged in, so this migration is `0046` and chains after its
  `0045`, as `server/src/db/migrations/README.md` says two branches must.
- The label column became one flex column, each label as tall as its row.
  That replaces LAI-834's padding sums, and holds for any mix of the three
  lanes.

**Discovered**
- `server/test/db/schema.test.ts` keeps a list of every table, separate from
  the SPEC drift check. A new table must be added to both. The first root gate
  found it.
- A slip: ESLint's result did not stop the commit after it (`efd6454e`).
  `86f2358b` fixed the lint error, and later commits are made only when
  ESLint exits 0.
- LAI-836's §4.55–§4.56 and this §4.57 all go at the end of SPEC §4. Whichever
  merges second resolves a small, mechanical conflict.

**State**
In review. The root gate was red once (`ca0a00de`, the schema test's list),
then green on `bfdb43f6` (0, 0, 0). The final-tree gate follows, then the
push and a PR based on LAI-834's branch.
