---
id: LAI-274
title: The Calendar and the Sprints list to the design
area: web
assignee: shell
status: done
priority: p1
depends-on: []
discovered-from: LAI-273
started: 2026-09-18T19:35:00Z
finished: 2026-09-18T19:48:00Z
reviewed: 2026-09-19T10:40:00Z
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

## Review — CHIEF, 2026-09-19

Accepted as part of the 27-task design pass (LAI-248…LAI-287), reviewed together
because they are one branch, one screen family, and 112 commits that only make
sense in sequence.

**Verified across the whole merge, not per task:**

- **Ownership held.** `git diff --name-only master...shell` touches `server/web/`,
  `.tasks/`, `logs/shell-*` and **one** file outside: `structure.test.ts`, whose
  single hunk is inside `WEB_NO_MIRROR_REQUIRED` — a `WEB_*` map, SHELL's by
  D-026. No crossing.
- **Gate green on the merged tree**, not on the branch: `TEST 0 / LINT 0 / FMT 0`
  at the repo root. Web tests **734 → 897**, `# skipped 0`, `# todo 0` — the
  growth is real and nothing was silently skipped.
- **Commit format and authorship**: all 112 match
  `<type>(<area>): <summary> [<task-id>]` bar three ordinary `Merge master`
  commits, all authored by the personal account.
- **Rendered, not read.** Built, served on port 3977 against a scratch database
  (`uptime_ms` checked against my own start time, §4.3), seeded three projects
  and eight tasks through the API, and drove it with a real browser at
  1680×1000.
- **Both themes through the real control** — clicked `Switch to dark theme`,
  never `classList.toggle`. `--card #fff → #1b1b20`, `--tx3 #606775 → #9a9aa4`,
  `--acc #2158e0 → #5b8cff`, and the JS-computed avatar chips re-render dark.
  That is the LAI-059 bug class and it is absent.
- **No fixture data.** Every `Mira`/`Kellner`/`kvelld.internal` hit in the diff is
  inside a comment explaining a formatting rule, or inside `src/demo/`. D-032's
  bundle guard was re-run **with `server/public/` actually built**, so the half
  that is conditional on a bundle genuinely executed rather than skipping.

**Verified specifically, and one thing is filed rather than held against it.**

AC1 says the week numbers are ISO. I did not take that on the tick: I extracted
`isoWeek()` and ran it against nine known ISO-8601 dates, chosen for the
year-boundary cases that break naive implementations — `2021-01-01 → W53`,
`2024-12-30 → W1`, `2016-01-03 → W53`, `2015-12-31 → W53`, `2019-12-30 → W1`.
**All nine correct.** The criterion is true.

**But nothing guards it.** `calendar-derive.test.ts` covers `monthGrid` and not
`isoWeek`, and this task's commits add no test file at all — the only one of the
27 that does not. The function's own comment says *"getting it wrong is invisible
for eleven months of the year"*, which is precisely the case for an assertion.

**Not a send-back.** No criterion here asked for that test, and §2 forbids adding
criteria to submitted work. Filed instead.
