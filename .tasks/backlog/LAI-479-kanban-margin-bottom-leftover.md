---
id: LAI-479
title: 'A 32px margin under the lanes, left over from when the board scrolled'
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-283
status: backlog
---

## Goal

**Small, cosmetic, and measured.** After LAI-283 made the lanes fill the window,
there are **50px between the bottom of a lane and the bottom of the viewport**:

```
lane bottom        850
.board-main bottom 900   == innerHeight
```

Fully accounted for, and one of the two is a leftover:

- **18px** — `.board-main`'s `padding-bottom`, which is the design's figure
  (`padding:14px 18px 18px`). **Correct, keep.**
- **32px** — `.kanban, .list { margin-bottom: var(--space-6) }`, where
  `--space-6: 2rem`. **This dates from when the board was a scrolling page and
  needed clearance below it.** The board no longer scrolls; the lanes are sized
  to what is left.

## Acceptance criteria

- [ ] Decide whether the 32px is still wanted now the board does not scroll, and
      **say which in the task** — this is a judgement, not a bug, and "kept it
      deliberately" is a valid outcome.
- [ ] If removed: lane bottom sits at `innerHeight - 18px`, measured in a
      browser at two viewport heights.
- [ ] **`.list` shares that rule.** The list view *does* scroll — check it there
      before changing it, and split the rule rather than regressing the list to
      save a line.
- [ ] LAI-283's criteria still hold: heights at 900 and 700 still differ by
      exactly 200, and nothing sits below the scrollable area.
- [ ] Both themes. Full gate — repo root, all three `EXIT 0`.

## Notes / context

**Found during the LAI-283 review, and it does not detract from it.** LAI-283's
falsifiable criterion passes exactly (716 vs 516 = 200), and `.board-main`
reaches the viewport bottom to the pixel. This is the last 32px, and it is the
kind of thing that is invisible until someone puts the design beside the app.

**The owner may not care.** If the board looks right, closing this as "kept"
costs one line and is a real answer.
