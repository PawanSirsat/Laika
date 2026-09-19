---
id: LAI-292
title: 'The space chrome is 191px of stacked rows — compact it and give the board toolbar a slot'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-290
started: 2026-09-19T19:14:30+05:30
status: in-progress
---

## Goal

**Asked for by the owner, with a reference screenshot**, and split with the other
SHELL session: they own what goes *in* the board's toolbar row (LAI-293), this
owns the vertical space above it.

> *"on top we have too much space, decrease it; that project name also moves on
> top so we can occupy that space with other things"*

**Measured on 3381, 1600px, before any change** — everything above the first lane:

| | height | |
| --- | --- | --- |
| `.space-bar` | **91px** | identity row 32px at y13, view tabs 34px at y56 |
| `#space-band-slot` | **57px** | the sprint strip |
| `.presence` | **29px** | WORKING NOW |
| | **first lane at y=191** | |

The reference puts one compact row directly on the columns. Ours carries a sprint
strip and a presence strip that the reference has no equivalent for — **those are
real data and are compacted, never dropped.**

## Acceptance criteria

- [ ] **The identity row and the view tabs share one line.** The project name,
      its live pill and `+ Create` sit beside the tabs rather than above them —
      this is the owner's *"project name moves on top"* and it is where the
      space comes from.
- [ ] **Measured, not asserted**: first lane's `top` is reported before and
      after at 1600 / 1280 / 900, both themes.
- [ ] **A slot below WORKING NOW**, full width, **no margin of its own**, for
      the board's toolbar row. Its exported constant is named in this file and
      messaged to the other session, who renders into it (LAI-293).
- [ ] **The slot collapses to nothing when no view fills it.** Timeline and
      Calendar must not gain an empty band.
- [ ] **Search and the member avatars leave the bar when a view claims them**,
      via `useClaimSpaceFilters` — *not* a `path === '/board'` check. The claim
      says *a view supplied its own*; the path check says *because it is the
      board*, which is true today and contingent tomorrow.
- [ ] **Every other view still filters.** `SpaceLayout` draws the bar for
      Timeline, Calendar and Capacity too, and the bar is the only place they
      have. Assert one of them still has its controls.
- [ ] Both themes, widths 1600 / 1280 / 900 / 420, page overflow `0` at each.
- [ ] Full gate — all three `EXIT 0`, repo root, **under the gate lock**.

## Notes / context

**The fold is already delivered.** Priority / tag / assignee / ready-only are
behind `Filter` as of LAI-290, verified by that session across five widths and
both themes. What remains of the owner's request is the *move* and this
compaction.

**Seam, agreed in writing with the other session:** this task owns the vertical
space and exposes a full-width slot with no margin; LAI-293 owns the slot's
contents and internal padding; this task matches `BoardToolbar`'s current height
rather than choosing a number, and they announce before changing it.
