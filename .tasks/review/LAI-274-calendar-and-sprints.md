---
id: LAI-274
title: The Calendar and the Sprints list to the design
area: web
assignee: shell
status: review
priority: p1
depends-on: []
discovered-from: LAI-273
started: 2026-09-18T19:35:00Z
finished: 2026-09-18T19:48:00Z
---

## Why

Screens 4 and 5 of the owner's page-by-page pass. Prototype lines 581–624
(Calendar) and 625–646 (Sprints).

**Calendar** was missing the design's whole frame: no week-number gutter, no
card, no legend, no sprint marking, and — on the served build — **no tasks at
all**, because demo data is opt-in at build time and the instance was serving a
plain production bundle. Correct by D-032, and indistinguishable from broken.

**Sprints** was a stacked card per sprint running some 180px tall; the design's
row is 65px. Four sprints filled a window the design fits in a third of one.

## What

Calendar:

- `monthWeeks()` and `isoWeek()` in the derive module — the grid is rows, each
  owning its own `W38` gutter cell, so a row cannot drift out of step with its
  label the way two parallel lists eventually would. ISO weeks, because "week 1
  contains the first Thursday" is the rule every calendar a reader has used
  follows and getting it wrong is invisible for eleven months of the year.
- The design's card, 104px cells, day-number badge, month name on the 1st.
- **The sprint bands are real.** Sprints have dates, so days inside the running
  sprint are marked from `GET /projects/:slug/sprints`. The demo module still
  covers exactly one field — `tasks.due_date` — and nothing else.
- The legend: today, active sprint days, weekend, agent-owned.

Sprints:

- The design's row: `S1` · status pill · name + dates + goal · a 150px block of
  figures with the 5px bar and `N in flight · M unassigned` · the chevron.
- `blocked`, `wip` and `unassigned` are counted in the screen and passed in, so
  the card places numbers and decides none — and `blockedState`'s rule is used
  once rather than reimplemented here (LAI-215).
- The chevron scopes the board and timeline to that sprint, which is what the
  design's footnote says the row does. The footnote is there too.

## Acceptance criteria

- [x] The calendar renders a week-number gutter, and the numbers are ISO.
- [x] Days inside the running sprint are marked from the **API**, not the demo
      module.
- [x] Both legends render every item the design lists.
- [x] A sprint row is one line; its figures come from the project's real tasks.
- [x] The chevron sets `?sprint=` and lands on the board.
- [x] Page overflow `0`; full gate — all three `EXIT 0`, repo root.

## Notes

**The demo bundle is a build flag, not a code change.** `DEMO_ENABLED` is
`import.meta.env.DEV || VITE_LAIKA_DEMO === '1'`, so the owner's instance is now
served from a `VITE_LAIKA_DEMO=1` build. A plain `pnpm build` still contains no
demo data and `not-in-bundle.test.ts` still proves it.

**The sprint management actions were kept.** The design draws a chevron and
nothing else because a mockup has nothing to manage; deleting Activate, Edit and
Delete to match it would remove working features the API supports. They sit in
the row as a compact cluster rather than the button bar that made the card three
lines taller than the design's.
