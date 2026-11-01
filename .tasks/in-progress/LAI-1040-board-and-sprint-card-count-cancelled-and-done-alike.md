---
id: LAI-1040
title: 'The board''s DONE total counts cancelled work the Sprints card leaves out, and the card''s unassigned counts finished work'
area: web
assignee: shell
priority: p3
depends-on: [LAI-882]
discovered-from: LAI-882
status: in-progress
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
review. This file exists only on LAI-882's branch, so this branch
(`LAI-1040-sprint-counts-agree-on-cancelled`) is cut from
`LAI-882-card-blocked-rule-matches-server` with `origin/master` merged in, and
its PR carries LAI-882's commits until #193 merges.

## Acceptance criteria

- [ ] One rule for a sprint's done/total, shared by `countStats`,
      `progressFor` and `countsProgress`, from one helper: cancelled is in
      neither done nor total.
- [ ] `sprintFigures`' unassigned counts open work only (not `done`, not
      `cancelled`), and its comment says so.
- [ ] Tests that fail on today's code: a sprint with a cancelled task reads the
      same total in the toolbar and on its card; a done, unassigned task is not
      counted unassigned.
- [ ] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.
