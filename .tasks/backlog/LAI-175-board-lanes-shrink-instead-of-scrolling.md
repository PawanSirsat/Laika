---
id: LAI-175
title: 'Board lanes shrink to fit instead of scrolling — the owner asked for the cards to keep their width'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-171
status: backlog
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

- [ ] **A lane has a floor width and keeps it** at every viewport size. Pick the
      number from the design (`docs/design/`), not from what happens to stop the
      wrapping.
- [ ] **The lane strip scrolls horizontally when the lanes do not fit**, at all
      widths — not only under 1100px. The `max-width: 1100px` special case should
      disappear rather than gain a sibling.
- [ ] **The last lane is never underneath `BoardRail`.** Assert it: a browser
      test that measures the right edge of the last lane against the rail's left
      edge, at a width where they would collide. The existing comment records
      this happening once; a comment is not a guard.
- [ ] **Card titles stop wrapping to three lines at a normal desktop width.**
      Whatever the number, the screenshot's `Transcript webhook authentication`
      over two lines and `blocked by LC-2 Parity tests for the MCP …`
      truncating are the before.
- [ ] **Both themes, and the scrollbar does not sit on top of a card** — a
      scroller that overlays its last row is the same bug one axis over.
- [ ] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**Filed by CORE, who cannot do it**: the Board is `server/web/`, SHELL's under
D-031, and CLAUDE.md §1 says to file rather than cross. The owner asked CORE
directly; **the area rule does not have an exception for that**, and inventing
one for a CSS change is how it stops meaning anything.

**p1 because the owner asked and it is visible on the main screen.**

`ListView.tsx` is the other view of the same data and may have the same
behaviour — check it while you are in there, and say either way.
