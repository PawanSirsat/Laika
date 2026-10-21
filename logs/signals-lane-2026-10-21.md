## 2026-10-21T11:16:23Z — LAI-834

On the owner's direct instruction. A Claude Code session dispatched by CHIEF
built it, in the worktree `Laika-signals-lane` on `LAI-834-signals-lane`. Asked
*"OK to send prompt and commit timing as 5-minute counts (never text) so the
SIGNALS lane can be drawn?"*, the owner answered "yes do it". That is D-096.

**What changed**
- server/src/services/time-drafts.ts — `at` on a block: checked against the
  block (`assertBuckets`), kept beside the counts in `signals`, and the day's
  lane read back (`signalTimesOn`).
- server/src/services/my-day.ts — `signal_times` in `GET /me/time`.
- server/src/services/time-settings.ts — `signal_times: true` in the switches.
- server/src/http/routes/time.ts — the closed schema takes `at` as integer
  pairs only.
- server/test/services/time-signal-times.test.ts,
  server/test/http/routes/time-signal-times.test.ts — new.
- server/test/services/my-day.test.ts — the drafts section is now 4 queries,
  not 3. server/test/{services/time-settings,http/routes/time}.test.ts — the
  switches now carry `signal_times`.
- server/web/src/api/time.ts — `SignalTimes`, `MyDay.signal_times` and
  `TimeSettings.signal_times`.
- server/web/src/routes/screens/my-day/timeline-derive.ts — `DayLine.signals`
  and `SIGNAL_MINUTES`.
- server/web/src/routes/screens/my-day/Timeline.tsx — the SIGNALS row, its
  label, and two legend keys.
- server/web/src/routes/screens/my-day/my-day.css — the lane's rules, after
  the count badge's.
- server/web/src/routes/screens/my-day/my-day-derive.ts — `plural` exported.
- server/web/test/api/view-type-drift.test.ts — the `SignalTimes` pair.
- server/web/test/routes/screens/my-day/signal-marks.test.ts,
  server/web/test/browser/my-day-signals.test.ts — new.
- cli/src/activity-time.ts — buckets counted, merged and sent
  (`timeIn`, `mergeTimes`, `blocksToSend`).
- cli/src/activity-sync.ts — the switches' `signal_times`.
- cli/README.md — "What leaves". cli/test/activity-time-signals.test.ts — new.
- cli/test/activity-time.test.ts — two exact-shape assertions updated for `at`.
- docs/SPEC.md — §4.47, §6.4 (the switches, the upload) and §13.
- docs/DECISIONS.md — D-096.
- .tasks/review/LAI-834-signals-have-no-timestamps.md, and this log.

**Decisions**
- Kept the buckets inside `time_drafts.signals` rather than in a new column.
  No migration, so LAI-822's in-flight `0045` keeps its number. The same
  blanking and deletion that cover the counts cover the times.
- Absolute buckets (`floor(ms / 300000)`), not offsets from the block. They
  survive a block's edges being dragged or split, and the board can check
  them against the span as sent.
- The lane is the day's union over every block, whatever became of it,
  served at the day's level. Pending drafts alone would lose the time
  already confirmed. Within a bucket the largest count wins, because
  parallel tasks carry their stretch's prompts each.
- The board advertises `signal_times: true`, and the collector sends `at` only
  then. Otherwise a new collector against an older board would have every
  upload refused by the closed schema.
- A day whose report would pass 16 KB goes without times rather than being
  refused. Its blocks keep their count badge, which every block still has.
- Built on LAI-859 (merged in twice: its code, then its records). Both change
  the drafter's block building, and this extends the blocks that rule makes.
  LAI-859 merges first.
- The My day paragraph and the endpoint table in SPEC were left to LAI-836,
  which rewrites both. The lane's field is described in the upload paragraph
  instead, so the two merge cleanly (a trial merge said so).

**Discovered**
- In the first browser run, a lane label's bounding box included its padding
  (up to the grid's top), so "the label sits in its row" was testing nothing.
  The test now measures the label's text with a Range. Also, the timeline
  opens scrolled to the first block, so the lane's box starts off-screen and
  the scroller's edge is where it is seen to start. A probe printed both
  (`scrollLeft` 238, lane x 87, scroller x 325) before the assertion changed.
- LAI-858's builder is restyling My day in parallel. This change adds new
  rules (`.dayline-grid-lanes`, `.dayline-label-signals`, …) and edits none of
  the existing timeline rules, to stay clear of it.
- No collector reinstall is needed: `laika` runs from the checkout.

**State**
In review. The root gate on `4dff1a2e` exited 0, 0, 0. The final-tree gate
follows, then the push and a PR based on LAI-859's branch.
