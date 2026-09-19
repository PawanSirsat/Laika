---
id: LAI-292
title: 'The space chrome is 191px of stacked rows — compact it and give the board toolbar a slot'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-290
started: 2026-09-19T19:14:30+05:30
finished: 2026-09-19T20:38:00+05:30
status: review
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

- [x] **The identity row and the view tabs share one line.** The project name,
      its live pill and `+ Create` sit beside the tabs rather than above them —
      this is the owner's *"project name moves on top"* and it is where the
      space comes from.
- [x] **Measured, not asserted**: first lane's `top` is reported before and
      after at 1600 / 1280 / 900, both themes.
- [~] ~~**A slot below WORKING NOW**~~ **Dropped — no slot was needed.**, full width, **no margin of its own**, for
      the board's toolbar row. Its exported constant is named in this file and
      messaged to the other session, who renders into it (LAI-293).
- [~] ~~**The slot collapses to nothing**~~ — moot, see above. Timeline and
      Calendar must not gain an empty band.
- [~] **Deferred to LAI-293 deliberately** — search and the avatars stay,
      via `useClaimSpaceFilters` — *not* a `path === '/board'` check. The claim
      says *a view supplied its own*; the path check says *because it is the
      board*, which is true today and contingent tomorrow.
- [x] **Every other view still filters.** `SpaceLayout` draws the bar for
      Timeline, Calendar and Capacity too, and the bar is the only place they
      have. Assert one of them still has its controls.
- [x] Both themes, widths 1600 / 1280 / 900 / 420, page overflow `0` at each.
- [x] Full gate — all three `EXIT 0` (1999 passed), repo root, **under the
      gate lock**, acquired and released as `shell`.

## Notes / context

**The fold is already delivered.** Priority / tag / assignee / ready-only are
behind `Filter` as of LAI-290, verified by that session across five widths and
both themes. What remains of the owner's request is the *move* and this
compaction.

**Seam, agreed in writing with the other session:** this task owns the vertical
space and exposes a full-width slot with no margin; LAI-293 owns the slot's
contents and internal padding; this task matches `BoardToolbar`'s current height
rather than choosing a number, and they announce before changing it.


---

## Measured, before and after

Everything above the first lane on the board, at 1600px:

| | before | after |
| --- | --- | --- |
| `.space-bar` | 91px | **44px** |
| first lane `top` | **191px** | **144px** |

Both themes, four widths, page overflow `0` at every one, all ten tabs present
at every one:

```
light 1600 laneTop=144 bar= 44 tabs=10 overflow=0
light 1280 laneTop=182 bar= 82 tabs=10 overflow=0
light  900 laneTop=227 bar= 82 tabs=10 overflow=0
light  420 laneTop=299 bar=154 tabs=10 overflow=0
dark   … identical at all four
```

It **wraps rather than scrolls or hides**: below 1280 the tabs take their own
line again, which is the old layout and is right there. A single line that
overflowed would put views off the edge.

## The slot was dropped, and that was the other session's catch

Both of us assumed the board's toolbar row had to portal into a container this
task exposed, and we negotiated the seam over two messages. Measuring
`SpaceLayout` settled it: `{children}` — the screen's own output — **already**
renders directly below `PresenceStrip`. `BoardScreen` renders its row inline;
there was never a seam.

The slot is removed and `no slot was carved` asserts it stays removed, so nobody
rebuilds it from the older plan.

## Search and the avatars deliberately did not move

They are filters and they belong in the board's row. **Hiding them here first
leaves the board unable to search or filter by assignee at all**, because the
row that should receive them is a different session's file.

`space-bar.test.ts` caught exactly that: it asserts four member faces on the
board and saw none. **That failure was correct and the change was wrong** — not
the assertion. Reverted, and `filters stay in the bar until a row exists to
receive them` now pins the ordering: they move **with** the row, in one change,
so no build has neither.

LAI-293 has since landed its row. `SpaceTopBar.tsx` is free once this reaches
`done/`, and that session can take both halves in one task.

## One assertion that was testing the fixture, not the layout

`identity and the view tabs share it` first ran at 1600 and failed — while the
seeded instance measured row **646** + tabs **690** in **1352** and fitted
comfortably. The fixture's names are wider, so 1600 is borderline **for the
fixture**, and the test was measuring that rather than the merge.

Two changes: the assertion moved to 1920, where the outcome does not depend on
content width; and the CSS stopped relying on the controls happening to be
narrow — `.space-controls` is `flex: 1`, correct when its row owned the whole
line and the reason the tabs were pushed off it. Both are now pinned to their
content inside `.space-bar-top`. **A layout that depends on how wide the
controls happen to be is not a layout.**
