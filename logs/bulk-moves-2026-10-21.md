## 2026-10-21T17:30:55Z — LAI-823

**What changed**
- server/src/services/bulk-moves.ts — new: the one rule (more than 10 distinct
  tasks by one actor within 60 s, moves and creations apart), read-time.
- server/src/services/metrics.ts — bulk completions out, `bulk_excluded`;
  cycle time split into `building` and `waiting_for_review`.
- server/src/services/sprint-forecast.ts — top-level only, bulk out of the
  history (`basis.bulk_excluded`), whole range → `reason: 'too_uncertain'`.
- server/src/services/people-activity.ts — bulk moves taken off board days,
  `bulk_excluded`.
- server/src/services/{events,activity}.ts, server/src/http/routes/events.ts —
  `bulk: boolean` on every feed row, REST and SSE.
- server/test/services/bulk-moves.test.ts — 18 tests, red first.
- server/test/services/people-activity.test.ts — "never the log" narrowed to
  one actor-indexed read; server/test/http/routes/people.test.ts — shape.
- .tasks/review/LAI-823-*; .tasks/backlog/LAI-309-*, LAI-310-* — filed.

**Decisions**
- Owner decided the rule and exclusion with a visible count (recorded in the
  task file and on LAIKA-623).
- Computed on read, not stored — `activity` is append-only and a sweep's
  first moves become bulk only once later ones exist; a stored flag would
  credit each sweep's first ten.
- Distinct tasks, not rows — a claim and finish of one task is one task.
- Narrowed the heatmap's "never reads activity" guard instead of deleting it,
  and handed the SPEC wording to LAI-309.

**Discovered**
- LAI-308 was taken by another Strelka session (LAI-854's branch) between my
  first id sweep and the filing; renumbered mine to LAI-309/310 before commit.
- `my-day-v2.test.ts` wide-font case failed once in the root gate at load
  ~25–34, passed 31/31 alone → existing LAI-715, not filed again.
- `eventView(row, bulk = false)` broke `.map(eventView)` (index passed as the
  flag) — caught by tsc; kept it one-argument.

**State**
In review; red only on view-type-drift, which LAI-310 (SHELL) turns green (§4.4).
