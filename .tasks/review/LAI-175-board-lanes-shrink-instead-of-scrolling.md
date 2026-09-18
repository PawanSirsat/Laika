---
id: LAI-175
title: 'Board lanes shrink to fit instead of scrolling — the owner asked for the cards to keep their width'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-171
started: 2026-09-18T11:09:31+05:30
finished: 2026-09-18T11:38:52+05:30
status: review
---

## Goal

**Asked for directly by the owner, with a screenshot of the Board:**

> *"don't decrease the card width here, add the left-right scroll so that it
> looks good"*

On a wide viewport the five lanes are squeezed — task titles wrap to three lines,
`blocked by LC-2 …` truncates mid-word, and the lane to the right of `DONE` is
clipped at the edge. **The cards are giving up width to make five columns fit,
and the owner wants the opposite: keep the card width and scroll.**

## Where it is

`server/web/src/routes/screens/board/board.css`:

```css
.kanban {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));   /* ← the shrink */
  gap: 0.6875rem;
  align-items: start;
}

/* Below this the five columns stop being readable; scroll them instead. */
@media (max-width: 1100px) {
  .kanban {
    grid-template-columns: repeat(5, minmax(11rem, 1fr));
    overflow-x: auto;
  }
}
```

`minmax(0, 1fr)` lets every column shrink without limit, so the lanes always fit
and never scroll. **Horizontal scrolling already exists — it is just gated behind
`max-width: 1100px`**, which is the case the owner is not in.

## The trap, which is written down and should not be re-learned

The docblock above that rule says why the floor was removed:

> *A `minmax(13rem, …)` floor forced the grid past 1100px, so once the rail took
> its 266px the last column ran underneath it.*

**`BoardRail` is ~266px and shares the row.** A floor plus `overflow-x` on the
wrong element puts the last lane under the rail instead of into a scroller — that
is the bug this rule was written to fix, and the screenshot's clipped right-hand
lane suggests it is close to happening again.

So the scroll container has to be the lanes' own box, **sized against the space
left after the rail**, not the page.

## Acceptance criteria

- [x] **A lane has a floor width and keeps it** at every viewport size. Pick the
      number from the design (`docs/design/`), not from what happens to stop the
      wrapping.
- [x] **The lane strip scrolls horizontally when the lanes do not fit**, at all
      widths — not only under 1100px. The `max-width: 1100px` special case should
      disappear rather than gain a sibling.
- [x] **The last lane is never underneath `BoardRail`.** Assert it: a browser
      test that measures the right edge of the last lane against the rail's left
      edge, at a width where they would collide. The existing comment records
      this happening once; a comment is not a guard.
- [x] **Card titles stop wrapping to three lines at a normal desktop width.**
      Whatever the number, the screenshot's `Transcript webhook authentication`
      over two lines and `blocked by LC-2 Parity tests for the MCP …`
      truncating are the before.
- [x] **Both themes, and the scrollbar does not sit on top of a card** — a
      scroller that overlays its last row is the same bug one axis over.
- [~] **`pnpm test` is `EXIT 0` (1932 passed).** `pnpm lint` is `EXIT 1` on
      `master` in CORE's area — inherited, unchanged, same as LAI-240/241.

## Notes / context

**Filed by CORE, who cannot do it**: the Board is `server/web/`, SHELL's under
D-031, and CLAUDE.md §1 says to file rather than cross. The owner asked CORE
directly; **the area rule does not have an exception for that**, and inventing
one for a CSS change is how it stops meaning anything.

**p1 because the owner asked and it is visible on the main screen.**

**Claimed as a copy, not a `git mv`** — the file exists only on `core`, because
CORE filed it and `master` has not taken their branch yet. So there was nothing
on `shell` to move. This is §2's *"filing a task for another session"* shape
arriving from the other end: `core` still holds it at `.tasks/backlog/`, `shell`
holds this one at `.tasks/in-progress/`, and **the claim is visible to every
worktree the moment it is committed**, which is what the lock is for. Whoever
merges deletes the copy furthest back — CORE's — per §2.

`ListView.tsx` is the other view of the same data and may have the same
behaviour — check it while you are in there, and say either way.


---

## The number came from the design, measured not calculated

**`12.875rem` = 206px.** Rendering `docs/design/Laika Prototype.dc.html` in a
browser gives a 1074px grid computing to `206px 206px 206px 206px 206px`, gap
11px. I did not derive it from canvas arithmetic — the board-only frame
(`Laika 01`) has no sidebar and the README calls it superseded, so parts I might
have mis-identified would have produced a plausible wrong number.

**The design's own markup is identical to ours** —
`flex:1;min-width:0;display:grid;grid-template-columns:repeat(5,1fr);gap:11px` —
so the design states no floor. Its lane width **at its own canvas size** is the
only number in it, and that is the one used.

## The old comment blamed the wrong thing

It said a `minmax(13rem, …)` floor *"forced the grid past 1100px, so once the
rail took its 266px the last column ran underneath it."*

**13rem is 208px — the design's number, to within rounding. The floor was never
the bug.** The bug was a floor with **nowhere to overflow to**. Adding
`overflow-x: auto` to `.kanban` — which is `flex: 1` beside the rail — makes the
box sized by what the rail leaves, and the tracks scroll inside it. Measured at
five widths: the strip's right edge is 12px (the flex gap) short of the rail's
left edge at every one.

## There were two `max-width: 1100px` blocks, not one

The task quotes one. **There is a second, 370 lines further down**, setting
`minmax(12rem, 1fr)` — 192px. My own test caught it: the floor held at every
width except 1100, where a lane came out 192px. Both are gone; AC2 said the
special case should disappear rather than gain a sibling, and a sibling is what
it already had.

Not a criticism of the diagnosis — it is the reason AC1 says *measure*, and the
reason the assertion runs at six widths rather than one.

## ListView — checked, and it does not share the behaviour

It is a `<table>`, not a five-track grid: cells reflow and wrap, they do not
squeeze to nothing. Measured at 1280px — `list` right edge 984, rail left 996,
no horizontal scroll needed, no page overflow. **No change, and this is the
"say either way" the task asked for.**

## One mutation came back green, and it was the most important one

**`min-width: 0` removed from `.board-main > .kanban` — the exact shape of the
original collision — did not turn anything red.** Rather than re-aim the test I
measured it: `min-width` computes to **`0px` either way**, and the geometry is
byte-identical, because a flex item that is a scroll container resolves
`min-width: auto` to zero. The mutation is a no-op, so the green is correct.

**But my docblock had credited `min-width: 0` with the property**, which the
measurement contradicts — §5's rule about a comment claiming more than the code
proves. The comment now says `overflow-x: auto` carries it alone, and that the
declaration is kept as a hint for anyone who later removes the overflow.

**4/4 real mutations caught**: the floor removed · the scroller removed ·
scrollbar clearance removed · a smaller-than-design floor.

## What the owner should look at

At widths where the lanes do not fit, **the rightmost visible lane is clipped by
the scrollport** — which is how a horizontal scroller signals there is more, and
is what was asked for. It resembles the original screenshot at a glance and is a
different mechanism: before, the lane was *too narrow*; now it is *scrolled*. The
cards keep full width either way. Worth an eye on the running instance.

## Verified on the live instance, not only in fixtures

`localhost:3371`, `laika-core`:

| viewport | lanes | scrolls | strip right / rail left | page overflow |
| --- | --- | --- | --- | --- |
| 1680 | 222px each | no | 1384 / 1396 | 0 |
| 1440 | **206px each** | yes | 1144 / 1156 | 0 |
| 1280 | **206px each** | yes | 984 / 996 | 0 |

Both themes; List view checked at 1280.
