---
id: LAI-1040
title: 'The board''s DONE total counts cancelled work the Sprints card leaves out, and the card''s unassigned counts finished work'
area: web
assignee: shell
priority: p3
depends-on: [LAI-882]
discovered-from: LAI-882
status: review
finished: 2026-11-02T00:45:00+02:00
started: 2026-11-02T00:10:00+02:00
---

## Goal

The board toolbar and a Sprints card give the same sprint the same figures.
Two of their figures are counted by different rules today.

## Found (PR #40 review, carried by LAI-882, 2026-11-01)

LAI-882 made "blocked" one rule everywhere (`holdsUp` in
`server/web/src/api/board-derive.ts`). The same review named two more
disagreements. They are not about "blocked", so they are not LAI-882's.

1. **DONE's total includes cancelled work.** `countStats`
   (`server/web/src/routes/screens/board/sprint-stats.ts`) returns
   `total: tasks.length`, cancelled included. The Sprints card's progress
   (`progressFor`, `routes/screens/sprints/sprint-derive.ts`) and the
   Timeline's `countsProgress` (`timeline-derive.ts`) take cancelled out of
   both done and total, *"because work that will not happen must not hold a
   finished sprint short of done"*. So a sprint with 8 done and 2 cancelled
   reads 8/10 in the board toolbar and 8/8 on its card.
2. **The Sprints card's unassigned count includes finished work.**
   `sprintFigures` (`sprint-derive.ts`) counts `assignee_id === null` over
   every task, done and cancelled included. A finished task nobody was
   assigned to is not work waiting for an owner.

## Started before its dependency is done

`depends-on: [LAI-882]`, and LAI-882 is in review (PR #193), not in
`.tasks/done/` on `master`. CHIEF directed this start while #193 is in
review. This file existed only on LAI-882's branch, so this branch
(`LAI-1040-sprint-counts-agree-on-cancelled`) was cut from
`LAI-882-card-blocked-rule-matches-server`. **#193 then merged** (review
PASS), and `origin/master` was merged in (not rebased: the claim was already
pushed), so the PR's diff against `master` is LAI-1040's alone.

## Acceptance criteria

- [x] One rule for a sprint's done/total, shared by `countStats`,
      `progressFor` and `countsProgress`, from one helper: cancelled is in
      neither done nor total.
- [x] `sprintFigures`' unassigned counts open work only (not `done`, not
      `cancelled`), and its comment says so.
- [x] Tests that fail on today's code: a sprint with a cancelled task reads the
      same total in the toolbar and on its card; a done, unassigned task is not
      counted unassigned.
- [x] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Added at CHIEF's direction (2026-11-01, batched into this PR)

Not one of the criteria above, which stay as filed. CHIEF asked for it in the
same PR under the batching rule (same area):

- `blockedState` and `blockers` (`server/web/src/api/board-derive.ts`) answer
  `false` and nothing for a task that is itself `done` or `cancelled`, so its
  card draws no lock and no "blocked by", and the Blocked-only filter drops
  it — as BLK, the sprint lock, the Timeline, the Dashboard and the server
  already did (`server/src/services/projects.ts:354`,
  `t.status NOT IN ('done', 'cancelled')`; the line 321 named in the request
  is the summary's empty value, not the rule).
- `server/web/test/api/blocked-rule.test.ts` gains a done and a cancelled
  waiting task against a dependency in every status.

## Done (SHELL, 2026-11-01)

- **Rule.** SPEC §11.4.3 is the only place that states it, for the Timeline's
  bars: *"`cancelled` counts in neither"*. Applied to every surface.
- `progressOf` (`routes/screens/sprints/sprint-derive.ts`) is the one
  done-over-total rule. `progressFor`, `countsProgress`
  (`routes/screens/timeline/timeline-derive.ts`) and `countStats`
  (`routes/screens/board/sprint-stats.ts`) call it. 8 done + 2 cancelled now
  reads 8/8 on all three.
- `sprintFigures`' unassigned counts tasks that are not `done` and not
  `cancelled`.
- Tests: new `test/routes/screens/sprints/sprint-counts.test.ts` checks every
  surface against figures written out by hand (red on the old code: 5 of 9).
  `sprint-stats.test.ts` keeps the strip's `countFor` verbatim as the record
  and states the one deliberate difference (total less cancelled);
  `sprint-derive.test.ts`'s unassigned is 3, not 5; the browser
  `board-sprint-stats.test.ts` expected-figure helper drops cancelled from the
  total (its fixture has no cancelled task, so its figures do not move).
- Mutations, each restored and compared byte for byte: `progressOf` keeping
  cancelled; the toolbar bypassing it; `progressFor` and `countsProgress` each
  passing `cancelled: 0`; unassigned counting finished work; `blockedState`
  locking finished work; `blockers` naming on finished work. All seven red.
