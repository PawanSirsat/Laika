---
id: LAI-217
title: The calendar screen
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-216]
discovered-from: LAI-070
status: backlog
started:
finished:
---

## Goal

The prototype has a calendar and the app has no route for it. The owner asked
for it explicitly, reversing its earlier exclusion (SPEC §14 q10 was unanswered
and it was dropped from the route table).

A month grid, the active sprint's days tinted, and tasks placed on days.

## Blocked on a decision, not a dependency — builder-b, 2026-08-25

`depends-on` is satisfied (LAI-216 is done), so this reads as claimable. **It is
not buildable yet**, and the blocker is not in the frontmatter where a claim
check would look:

- **`docs/DECISIONS.md` records no Calendar decision.**
- **SPEC §14 q10 is still unanswered** — §11.4.2's table reads
  `| Calendar | ? | none defined | — | ⛔ no decision — §14, q10 |`, and the
  prose says the screen "is blocked until §14 q10 is answered".
- **Three places deliberately record its absence**, and building it means
  deleting them: the doc comments in `routes/route-table.ts` and
  `components/Sidebar.tsx`, and the test `no Calendar anywhere (AC3)` in
  `test/routes.test.ts`.

I filed this task from the owner's direct answer, and PM has said they want that
confirmed by the owner rather than acted on from a relayed message. **That is the
right call and I am not going around it.** D-031's own text is the precedent:
*"the next session reads the decision log, not a conversation it never saw."*

**To unblock:** answer §14 q10 and record the decision. `docs/` is PM's area, so
that is theirs to write; the moment it exists this is straightforwardly
buildable, and the three absence-guards should be removed by *this* task rather
than left to rot as the fourth "justification that expired".

## What is real and what is not

**Real** — sprint dates. `sprints.starts_on` / `ends_on` are served, so the
tinted band, the month span and "which sprint is active" all come from the API.

**Not real** — **there is no `due_date` column on `tasks`.** Task placement is
therefore demo data under D-032: `demo/due-dates.ts`, guarded by `DEMO_ENABLED`,
naming the endpoint that retires it, and the screen carries a `DemoNotice`.

Do not add a `due_date` from this task — that is a schema change in CORE's
area and needs its own task (§1). If CHIEF would rather wait for a real column than
ship a demo grid, this task should be rejected rather than half-built.

## Acceptance criteria

- [ ] A `/calendar` route exists, is in the route table with the right `status`,
      and appears in the sidebar under `WORK`.
- [ ] A month grid: correct day-of-week alignment, correct length for the month,
      leading and trailing days from adjacent months distinguishable from the
      current one.
- [ ] The active sprint's days are tinted, from **real** `starts_on`/`ends_on`.
- [ ] Month navigation, with today reachable in one action.
- [ ] Task placement comes from `src/demo/due-dates.ts`, guarded by
      `DEMO_ENABLED`, and the screen shows a `DemoNotice` naming what is missing.
- [ ] The default `pnpm build` contains none of the demo strings — the existing
      `test/demo/not-in-bundle.test.ts` covers this and must still pass.
- [ ] Date arithmetic is tested directly, not through the component: month
      length, leap years, week alignment, and a sprint that spans a month
      boundary. `sprint-derive.ts` is the local precedent — its `daysLeft` was
      off by one on a sprint's last day and only a direct test found it.
- [ ] Both themes.

## Notes

- No date library. The SPA has React and Vite and nothing else, and CLAUDE.md
  forbids adding one without a task that names it. `Date.UTC` arithmetic, as in
  `sprints/sprint-derive.ts`.
- Do the arithmetic in **UTC**. `sprints.starts_on` / `ends_on` are date
  boundaries; using local-time `Date` constructors puts a sprint on the wrong day
  for anyone east or west of the server, and it is invisible in one timezone.
