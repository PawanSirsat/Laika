---
id: LAI-244
title: 'The Live stream rail is pinned while the lanes scroll under it — put it in the scroll row'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-175
started: 2026-09-18T11:52:10+05:30
finished: 2026-09-18T12:24:40+05:30
status: review
---

## Goal

**Asked for directly by the owner, with a screenshot, immediately after LAI-175
landed:**

> *"also add that live stream in the scroll row so that will not fixed there on
> screen"*

LAI-175 made the lanes scroll horizontally. **`BoardRail` was left outside that
scroller**, so it stays pinned to the right edge while the lanes slide beneath
it — the `DONE` lane disappears under a rail that never moves. The owner wants
the rail **inside the scrolling row**, so the whole board moves together.

## Where it is

`server/web/src/routes/screens/board/board-rail.css`:

```css
.board-main {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;       /* ← the rail is a sibling, outside the scroller */
}
.board-main > .kanban,
.board-main > .list {
  flex: 1;
  min-width: 0;
}
```

and `board.css`, where LAI-175 put the scroller **on `.kanban`** rather than on
the row:

```css
.kanban { overflow-x: auto; }
```

**The scroller has to move up one level**, from `.kanban` to `.board-main`, so
the rail is inside it.

## Acceptance criteria

- [x] **The Live stream rail scrolls with the lanes.** Scroll the row right and
      the rail moves left with it; it does not stay pinned.
- [x] **The lanes keep their `12.875rem` floor** — LAI-175's measured number from
      `docs/design/Laika Prototype.dc.html`. This must not quietly undo it.
- [x] **The rail keeps its width and never overlaps a lane.** They are siblings
      in one flex row; assert the lane strip's right edge against the rail's
      left edge, as LAI-175 does.
- [x] **On a wide screen there is no scrollbar and nothing is clipped** — the row
      only scrolls when it genuinely does not fit.
- [x] **The page body never scrolls sideways** at any width.
- [x] **LAI-175's test is updated to assert the property, not the mechanism.**
      `board-lane-scroll.test.ts` currently asserts `.kanban` has
      `overflow-x: auto`. That pins *which element scrolls*, and this task
      legitimately changes it — the LAI-158 shape. Rewrite those assertions
      around *the row scrolls and the lanes keep their width*, so they survive a
      correct change and still fail an incorrect one.
- [~] Both themes. **`pnpm test` `EXIT 0` (1938 passed).** `pnpm lint` is
      `EXIT 1` on `master` in CORE's area — inherited, unchanged.

## Notes / context

**Renumbered from LAI-243 to LAI-244 before any review.** CHIEF filed
`LAI-243-client-mirror-for-the-failed-status.md` **2m13s earlier** (09:51:17 vs
09:53:30), and `task-file-state.test.ts` caught the collision on the next full
gate. §2's tie-break is the earlier commit, so theirs stands and this one moved.

**Worth CHIEF's attention rather than just fixing quietly: `LAI-200`–`LAI-299` is
SHELL's range** (D-017). Their id came out of it, which is the thing ranges exist
to prevent — *"next unused number is not a lock"*. Renumbering mine was the
cheaper repair because it is newer and referenced only by my own commits, and it
unblocked the gate without editing a file in `.tasks/` that is CHIEF's. Their
call whether LAI-243 should move to `LAI-4xx`; **I have not touched it.**

**Filed and claimed in one step, by SHELL, because the owner asked directly and
there was no task file.** §2 allows no builder exception for that, so the task
exists before the work rather than instead of it. CHIEF to fold or renumber if
they would rather it had been an addition to LAI-175 — **but LAI-175 is in
review, and §2 says its criteria are frozen**, which is why this is separate.

**Below 1200px the rail already drops beneath the lanes** (`board-rail.css`
media query). That case is unaffected: there is no side-by-side row to scroll.


---

## Two id problems to see before accepting

**This task was filed as LAI-243 and is now LAI-244.** CHIEF filed their own
LAI-243 (D-057's client mirror) concurrently; mine renumbered. **The two code
commits are therefore tagged `[LAI-243]`** —
`aa845ca fix(web): the Live stream rail scrolls with the lanes [LAI-243]` and
`45e685b test(web): …[LAI-243]` — which now points at somebody else's task. They
are pushed-adjacent history and §4 says never rewrite another session's or one's
own landed commits, so they stand, wrong, and are recorded here instead.

**And I then filed a second task as LAI-244**, from a "lowest free" check taken
before the renumber landed — two of my own tasks wearing one id. That one moved
to **LAI-245** (nothing referenced it). D-017's point, arriving from a direction
it does not describe: *"lowest unused number"* is not a lock against **yourself**
when two filings straddle a rename.

## Measured on the live instance

| viewport | lanes | row scrolls | strip right / rail left | page overflow |
| --- | --- | --- | --- | --- |
| 1920 | 270px | no | 1624 / 1636 | 0 |
| 1600 | **206px** | yes | 1305 / 1317 | 0 |
| 1440 | **206px** | yes | 1305 / 1317 | 0 |
| 1280 | **206px** | yes | 1305 / 1317 | 0 |
| 1220 | **206px** | yes | 1305 / 1317 | 0 |

Scrolling to the end moves the rail **321px** left, 1317 → 996: it travels with
the board instead of staying pinned, which is the ask.

## Three attempts, two wrong, all measured

**`flex: 1 0 auto`** — a `flex-basis: auto` grid sizes to its **max-content**,
which `1fr` leaves unbounded. Lanes ballooned to 311px, the strip to 1602px,
before scrolling was considered at all.

**`min-width: 0`** — stops the strip growing but lets the tracks overflow a box
nothing scrolls. At 1440px the row reported no overflow while the grid spilled
161px past its own edge: **the lanes-under-the-rail collision, back and silent.**

**`flex: 1 1 0` with `min-width: min-content`** — basis from the row, floor at
1074px. Correct at every width.

## The page overflow was never the board

146px of horizontal page scrollbar at 1280px, with every box in the layout
measuring correctly. Bisecting found the only elements reaching the document's
width were **`span.visually-hidden`** and their `<b>` siblings inside the rail's
feed: `position: absolute` with no coordinates, so they sit at their static
position — inside the scrolled-out part of the rail — and an **unpositioned**
scroller is not their containing block, so `overflow-x` never clipped them.

`position: relative` on `.board-main` fixes it. **The general case is LAI-245**,
because every future scroller inherits it and the symptom is a page scrollbar
with no visibly oversized element.

## Two green mutations, both the test's fault

| | against the original fixture |
| --- | --- |
| `position: relative` removed | **GREEN** — the fixture's rail had no feed rows, so no `.visually-hidden` existed inside the scrolled region |
| `flex: 1 0 auto` restored | **GREEN** — the lane assertion was `>= 206`, and 311 satisfies it |

**Fixed in the test, not re-aimed.** The fixture now carries three sprints and
three activity rows, so the board it renders is shaped like a real one; and the
lane assertion gained an upper bound that applies whenever the row scrolls —
*a floor alone is half an assertion.* **5/5 after that**, including the 146px
bug, which was only ever catchable once the fixture stopped being emptier than
the screen.

## AC6 — the old test asserted the mechanism

It asserted `.kanban` had `overflow-x: auto`, which pins *which element scrolls*
— and this task legitimately moved it, so the assertion went red for a correct
change. LAI-158's shape. It now walks up from a lane to find whatever scrolls,
and separately asserts the rail **moves**, which is the owner's actual complaint
rather than a selector.

## One process note

Mid-task I re-added an assertion that was already present, because I grepped for
a phrase the existing version did not use and concluded it was absent. `tsc`
caught it (`Cannot redeclare 'scrolling'`). **The check was wrong, not the
file** — the same class of error as everything else here, living in the
instrument rather than the code.
