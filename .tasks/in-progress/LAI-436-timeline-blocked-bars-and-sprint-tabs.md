---
id: LAI-436
title: A blocked task's bar is not red, and there is no sprint tab row
area: web
assignee: shell
priority: p2
depends-on: [LAI-434]
discovered-from: LAI-434
started: 2026-09-01T16:55:00+05:30
status: in-progress
---

## Goal

Two gaps between the timeline and the design, found by **looking at the running
screen** after LAI-434 landed. **Both are CHIEF's fault, not the builder's** —
each was written as prose in LAI-434 and never turned into a numbered criterion,
so LAI-434's ticks are all honest.

### 1. A blocked task's bar has no colour

LAI-434's prose said *"the bar, coloured by status, **red with a blocked
marker** when `blocked_by` contains an unfinished blocker"*. Its numbered
criterion said only that the marker uses `board-derive.ts`'s computation — which
it does, **for the summary count**. So the strip reads `BLOCKED 1` and **no row
shows which one.**

The prototype colours the bar red and puts a lock on it. That is the point of
the row: a person scanning the timeline should see *which* work is stuck without
reading a number and then hunting.

### 2. No sprint tab row

The prototype has tabs across the top — `S1 … S4`, each with a progress bar and
`11/11`-style counts — and clicking one selects that sprint's summary strip.

**The counts are already in a better place** (`7/7`, `0/9`, `0/4` in the band
headers), so this is about **selection**, not information: today the strip always
shows the active sprint and there is no way to look at a finished or a future one.

## Acceptance criteria

- [ ] A task whose `blocked_by` contains an unfinished blocker renders **red**,
      **outlined or solid alike** — blocked is orthogonal to measured-versus-placed,
      and a blocked task that has started must not lose its solid fill to say so.
- [ ] The blocked treatment is **not colour alone** — same rule as
      solid-versus-outline (LAI-434), for the same reason. A marker, a pattern,
      or a glyph.
- [ ] `blockedState` from `board-derive.ts`, not a second computation.
- [ ] A tab row lists every sprint with its `done/total`, and **selecting one
      shows that sprint's summary strip** — `DONE / BLOCKED / WIP / DAYS LEFT`
      computed for the selected sprint, not only the active one.
- [ ] **`DAYS LEFT` for a completed sprint is not a negative number**, and for a
      planned one it is not "days left" at all. Decide what each says and test
      both — this is where the clamp from LAI-434 stops being sufficient.
- [ ] The active sprint is selected on load, and is visually distinguishable from
      a merely selected one.
- [ ] A browser test in both themes: a blocked row is identifiable without
      reading the strip, and selecting a completed sprint changes the strip.
- [ ] Full gate green — repo-root `pnpm test`.

## Notes / context

**No new endpoint.** Everything is already on the tasks and sprints responses.

**Do not add a fourth `initials()` or a second blocked rule** — LAI-215 and
LAI-434 both landed on reuse and this is the third chance to get it wrong.

**The lesson this task exists to record**, since it cost a round trip: *intent
written as prose in a task file reads as binding and measures nothing.* If a
sentence describes something the screen must do, it belongs under **Acceptance
criteria**, or it will be built to the criterion and not to the sentence — and
the builder will be right.
