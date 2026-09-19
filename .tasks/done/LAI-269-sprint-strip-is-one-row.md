---
id: LAI-269
title: 'The sprint strip is one row, as the reference has it'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-263
started: 2026-09-18T17:15:24+05:30
finished: 2026-09-18T17:22:12+05:30
reviewed: 2026-09-19T10:40:00Z
status: done
---

## Goal

The owner supplied the Claude Design render of this board. Compared against it,
our sprint strip has **a whole row the design does not have.**

The reference is one row:

```
[All sprints] [S1 Event store & SSE 11/11] [S2 Agent sessions 13/14]
[S3 Presence & capacity 2/11 ‹selected›] [S4 Publish & harden 0/2]
[DONE 2/11 | BLK 1 | LEFT 4]  [›]
```

Ours is two: the pills and a `Sprint detail →` button, then a second band
carrying a percentage ring, an `ALL SPRINTS` badge, the sprint's name, its
dates and goal, and four stats.

## What changes

- **The second row goes.** Its content is either duplicated by the pill (name,
  fraction) or absent from the design (ring, badge, dates, goal). The goal and
  dates already live in each pill's `title`.
- **The stats move inline**, at the right of the one row, and take the
  reference's shorter labels: `DONE x/y`, `BLK n` in red, `LEFT n`.
- **`WIP` leaves the strip.** The design puts it on the In Progress column
  header (`WIP 3/4`), which is where it belongs — it is a property of a column,
  not of a sprint. **The header already renders it** and is already gated on a
  limit existing (D-032), so nothing new is needed there.
- **`Sprint detail →` becomes a `›` pager**, which is what the reference's
  right-hand arrow is: it scrolls the pill row when there are more sprints than
  fit.

## Acceptance criteria

- [x] The strip is a single row; `.strip-summary` and the ring are gone.
- [x] `DONE x/y`, `BLK n`, `LEFT n` render inline from the same real counts as
      before — nothing here becomes a fixture.
- [x] `BLK` is red and carries an accessible name that says "blocked", since
      the abbreviation alone does not.
- [x] The `›` button scrolls the pill row and is **absent when everything
      fits** — a control that does nothing is what §5.1 forbids.
- [x] The In Progress column header shows `WIP n/limit` **only where a limit
      exists**. Corrected from "shows `WIP n`": with no limit that is the
      column's own count printed twice — the badge beside it already says `3` —
      and a figure that repeats its neighbour is noise, not fidelity. It
      appears in full when LAI-267 lands.
- [x] A browser test asserts the strip is one row at 1440px with four sprints,
      and that the pager appears only when the pills overflow.
- [x] Both themes, widths 1440 / 1280 / 420, page overflow `0` at each.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes / context

**What is lost, stated rather than discovered later**: the percentage ring and
the selected sprint's dates and goal leave the screen. The ring duplicated the
pill's own fraction; the dates and goal remain in each pill's `title`. If the
owner wants them back they belong on the Sprints tab, which is a screen for
exactly that.

## Completion notes

Measured on the running instance: the strip is **57px**, one row, where the
two-band version was past 100.

**The pager's condition was wrong in my first test, and the test was right to
fail.** I resized the viewport to 900px expecting overflow; the pills share the
row with `flex: 1 1 0`, so they shrank instead and there was nothing to scroll.
Two consequences, both kept:

- `.strip-chip` gained a floor (`11rem`) so a sprint name stops shrinking into
  an ellipsis, and `.strip-chips` scrolls past it;
- the test now uses **twelve sprints**, which is the real condition — "more
  than fit" is about how many there are, not how narrow the window is — and
  asserts the pager actually scrolls the row, not merely that it renders.

**`WIP` was already right and the AC was wrong**, corrected inline: the lane
header renders `WIP n/limit` and is already gated on a limit existing (D-032).
Shipping `WIP 3` beside a count badge reading `3` would have been the same
figure twice.

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
